/**
 * BACKFILL de pagadores: el enum `paidBy` traducido a contrapartes.
 *
 *   node --env-file=.env prisma/backfill-pagadores.mjs            # ENSAYO
 *   node --env-file=.env prisma/backfill-pagadores.mjs --write    # escribe
 *   node --env-file=.env prisma/backfill-pagadores.mjs --undo     # revierte
 *
 * Va ENTRE las dos migraciones: la primera agrega las columnas nulables y la
 * segunda borra `paidBy`. Si esto no corre en el medio, el motor queda leyendo
 * contrapartes que no existen.
 *
 *   BUSINESS -> null (la caja)
 *   OWNER    -> la contraparte propietaria
 *   LOAN     -> el acreedor del prestamo
 *
 * ⚠️ Lo que hace seguro a este script no es el reparto: es el guard. Antes de
 * confirmar recalcula las NUEVE lineas del saldo y la deuda con el propietario,
 * y si alguna se movio un centavo revierte la transaccion y aborta. Esta
 * migracion toca el motor de caja, no solo Prestamos.
 */
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

// Un .mjs no puede importar el build ESM de shared (usa imports sin extensión).
const require = createRequire(import.meta.url);
const { businessCash } = require('@calc3d/shared');

const WRITE = process.argv.includes('--write') || process.argv.includes('--commit');
const UNDO = process.argv.includes('--undo');

// Los 5 s por defecto de Prisma alcanzan contra la base local, pero NO contra
// Railway, que está por internet.
const TX = { timeout: 120_000, maxWait: 30_000 };
const prisma = new PrismaClient();
const dia = (d) => d.toISOString().slice(0, 10);
const n = (x) => Number(x);
const r2 = (x) => Math.round(x * 100) / 100;

/** El enum viejo → tipo de contraparte. El mismo puente que `cash.service.ts`. */
const porEnum = (p) => (p === 'BUSINESS' ? null : p === 'OWNER' ? 'OWNER' : 'EXTERNAL_LENDER');

/**
 * La foto completa de lo que esta migración puede romper: las nueve líneas del
 * saldo y lo que el negocio le debe al propietario.
 *
 * `payerDe` decide cómo se lee quién pagó — por el enum (antes) o por la
 * contraparte (después). Si las dos lecturas no dan lo mismo, el backfill está
 * mal y no se escribe.
 */
async function foto(tx, organizationId, payerDe) {
  const [ventas, abonos, gastos, cuotas, movimientos, aplicaciones, contrapartes] =
    await Promise.all([
      tx.sale.findMany({ where: { organizationId }, select: { date: true, amount: true } }),
      tx.payment.findMany({ where: { organizationId }, select: { date: true, amount: true } }),
      tx.expense.findMany({ where: { organizationId } }),
      tx.loanPayment.findMany({ where: { organizationId } }),
      tx.ownerMovement.findMany({ where: { organizationId } }),
      tx.debtApplication.findMany({ where: { organizationId } }),
      tx.counterparty.findMany({ where: { organizationId }, select: { id: true, kind: true } }),
    ]);

  const kindDe = new Map(contrapartes.map((c) => [c.id, c.kind]));
  const payer = (fila) => payerDe(fila, kindDe);

  const porPago = new Map();
  for (const a of aplicaciones) porPago.set(a.paymentId, (porPago.get(a.paymentId) ?? 0) + n(a.amount));

  const ledger = {
    sales: ventas.map((v) => ({ date: dia(v.date), amount: n(v.amount) })),
    orderPayments: abonos.map((p) => ({ date: dia(p.date), amount: n(p.amount) })),
    expenses: gastos.map((g) => ({
      date: dia(g.date),
      amount: n(g.amount),
      payer: payer(g),
      isInvestment: g.isInvestment,
      isFilament: g.materialId != null,
      refundable: g.refundable,
    })),
    loanPayments: cuotas.map((c) => ({
      date: dia(c.date),
      amount: n(c.amount),
      payer: payer(c),
      refundable: c.refundable,
    })),
    movements: movimientos.map((m) => ({
      date: dia(m.date),
      amount: n(m.amount),
      kind: m.kind,
      refundable: m.refundable,
      applied: porPago.get(m.id) ?? 0,
    })),
  };

  // La deuda con el propietario, con el MISMO criterio que el ledger: lo que
  // puso y es reembolsable, menos lo que se llevó.
  const generaObligacion = (p) => p === 'OWNER' || p === 'PARTNER';
  const puesto =
    gastos
      .filter((g) => generaObligacion(payer(g)) && g.refundable)
      .reduce((s, g) => s + n(g.amount), 0) +
    cuotas.filter((c) => generaObligacion(payer(c)) && c.refundable).reduce((s, c) => s + n(c.amount), 0) +
    movimientos
      .filter((m) => m.kind === 'CONTRIBUTION' && m.refundable)
      .reduce((s, m) => s + n(m.amount), 0);
  const retirado = movimientos
    .filter((m) => m.kind === 'WITHDRAWAL')
    .reduce((s, m) => s + n(m.amount), 0);

  return { ...businessCash(ledger), deudaConElPropietario: r2(Math.max(0, puesto - retirado)) };
}

const comparar = (antes, despues) => {
  const difs = [];
  for (const k of Object.keys(antes)) {
    if (Math.abs(antes[k] - despues[k]) > 0.005) difs.push(`${k}: ${antes[k]} -> ${despues[k]}`);
  }
  return difs;
};

async function revertir(tx, organizationId) {
  const a = await tx.expense.updateMany({ where: { organizationId }, data: { counterpartyId: null } });
  const b = await tx.loanPayment.updateMany({ where: { organizationId }, data: { counterpartyId: null } });
  const c = await tx.loan.updateMany({ where: { organizationId }, data: { counterpartyId: null } });
  console.log(`  revertidos: ${a.count} gastos, ${b.count} cuotas, ${c.count} préstamos`);
}

async function traducir(tx, org) {
  const contrapartes = await tx.counterparty.findMany({ where: { organizationId: org.id } });
  const owner =
    contrapartes.filter((c) => c.kind === 'OWNER').sort((a, b) => Number(b.active) - Number(a.active))[0];
  const prestamistas = contrapartes.filter((c) => c.kind === 'EXTERNAL_LENDER');

  if (!owner) throw new Error('No hay contraparte propietaria: corré antes backfill-caja.mjs.');

  const gastosLoan = await tx.expense.count({ where: { organizationId: org.id, paidBy: 'LOAN' } });
  const prestamosAbiertos = await tx.loan.findMany({ where: { organizationId: org.id, closedAt: null } });

  // ⚠️ Un Expense con paidBy = LOAN NO tiene loanId: a qué acreedor apunta se
  // resuelve solo si hay UNO. Con dos, adivinar el acreedor de un gasto no es
  // algo que un script deba hacer.
  if (gastosLoan > 0 && prestamistas.length !== 1) {
    throw new Error(
      `Hay ${gastosLoan} gasto(s) con paidBy = LOAN y ${prestamistas.length} prestamistas. ` +
        'Con uno solo se resuelve; con otra cantidad hay que decidir a mano.',
    );
  }
  if (prestamosAbiertos.length > 1 && prestamistas.length !== 1) {
    throw new Error(
      `Hay ${prestamosAbiertos.length} préstamos abiertos y ${prestamistas.length} prestamistas: ` +
        'hay que decir a mano cuál es el acreedor de cada uno.',
    );
  }
  const prestamista = prestamistas[0] ?? null;

  const g1 = await tx.expense.updateMany({
    where: { organizationId: org.id, paidBy: 'BUSINESS' },
    data: { counterpartyId: null },
  });
  const g2 = await tx.expense.updateMany({
    where: { organizationId: org.id, paidBy: 'OWNER' },
    data: { counterpartyId: owner.id },
  });
  const g3 = prestamista
    ? await tx.expense.updateMany({
        where: { organizationId: org.id, paidBy: 'LOAN' },
        data: { counterpartyId: prestamista.id },
      })
    : { count: 0 };

  const c1 = await tx.loanPayment.updateMany({
    where: { organizationId: org.id, paidBy: 'BUSINESS' },
    data: { counterpartyId: null },
  });
  const c2 = await tx.loanPayment.updateMany({
    where: { organizationId: org.id, paidBy: 'OWNER' },
    data: { counterpartyId: owner.id },
  });
  const c3 = prestamista
    ? await tx.loanPayment.updateMany({
        where: { organizationId: org.id, paidBy: 'LOAN' },
        data: { counterpartyId: prestamista.id },
      })
    : { count: 0 };

  // El ACREEDOR del préstamo. Sin prestamista no se inventa: queda null y la
  // pantalla lo va a pedir.
  const l = prestamista
    ? await tx.loan.updateMany({
        where: { organizationId: org.id, counterpartyId: null },
        data: { counterpartyId: prestamista.id },
      })
    : { count: 0 };

  return {
    owner: owner.name,
    prestamista: prestamista?.name ?? '(ninguno)',
    gastos: { caja: g1.count, propietario: g2.count, prestamo: g3.count },
    cuotas: { caja: c1.count, propietario: c2.count, prestamo: c3.count },
    prestamosConAcreedor: l.count,
  };
}

const main = async () => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    console.log(`\n${org.name}`);

    if (UNDO) {
      await prisma.$transaction(async (tx) => {
        await revertir(tx, org.id);
        if (!WRITE) throw new Error('ENSAYO: nada se revirtió. Corré con --undo --write.');
      }, TX);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // La foto ANTES se lee por el enum, que es la verdad de hoy.
      const antes = await foto(tx, org.id, (fila) => porEnum(fila.paidBy));

      const r = await traducir(tx, org);

      // La foto DESPUÉS se lee por la contraparte, que es la verdad nueva.
      const despues = await foto(tx, org.id, (fila, kinds) =>
        fila.counterpartyId ? (kinds.get(fila.counterpartyId) ?? null) : null,
      );

      console.log(`  propietario: ${r.owner}   prestamista: ${r.prestamista}`);
      console.log(
        `  gastos  -> caja ${r.gastos.caja} · propietario ${r.gastos.propietario} · préstamo ${r.gastos.prestamo}`,
      );
      console.log(
        `  cuotas  -> caja ${r.cuotas.caja} · propietario ${r.cuotas.propietario} · préstamo ${r.cuotas.prestamo}`,
      );
      console.log(`  préstamos con acreedor: ${r.prestamosConAcreedor}`);
      console.log('\n  las nueve líneas del saldo, antes y después:');
      for (const k of Object.keys(antes)) {
        const igual = Math.abs(antes[k] - despues[k]) <= 0.005;
        console.log(`    ${igual ? 'OK ' : 'XX '} ${k.padEnd(26)} ${String(antes[k]).padStart(10)} -> ${String(despues[k]).padStart(10)}`);
      }

      const difs = comparar(antes, despues);
      if (difs.length) {
        throw new Error(
          `EL BACKFILL MUEVE PLATA. No se escribe nada.\n    ${difs.join('\n    ')}`,
        );
      }

      if (!WRITE) throw new Error('ENSAYO: nada se escribió. Corré con --write para aplicarlo.');
      console.log('\n  Listo: los cambios quedaron escritos.');
    }, TX);
  }
};

main()
  .catch((e) => {
    console.error(`\n${e.message}`);
    process.exitCode = e.message.startsWith('ENSAYO') ? 0 : 1;
  })
  .finally(() => prisma.$disconnect());
