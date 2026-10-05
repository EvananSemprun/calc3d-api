/**
 * BACKFILL de la fase 1 de Caja. Idempotente: se puede correr dos veces.
 *
 *   node --env-file=.env prisma/backfill-caja.mjs            # ENSAYO
 *   node --env-file=.env prisma/backfill-caja.mjs --commit   # escribe
 *
 * ⚠️ El paso 6 (FIFO retroactivo) CAMBIA el reparto por fila de "Quién puso la
 * plata": antes se descontaba por categoría y ahora por fecha. El TOTAL que se
 * debe no cambia, y el script lo verifica antes de confirmar.
 */
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

// Un .mjs no puede importar el build ESM de shared (usa imports sin extensión).
const require = createRequire(import.meta.url);
const { businessCash, obligationLedger, applyPayment } = require('@calc3d/shared');

const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();
const dia = (d) => d.toISOString().slice(0, 10);
const n = (x) => Number(x);

async function backfill(tx, org) {
  // 1-2. Contrapartes.
  let owner = await tx.counterparty.findFirst({
    where: { organizationId: org.id, kind: 'OWNER' },
  });
  if (!owner) {
    owner = await tx.counterparty.create({
      data: { organizationId: org.id, name: org.name, kind: 'OWNER', isDefault: true },
    });
  }
  for (const loan of await tx.loan.findMany({ where: { organizationId: org.id } })) {
    const existe = await tx.counterparty.findFirst({
      where: { organizationId: org.id, kind: 'EXTERNAL_LENDER', name: loan.name },
    });
    if (!existe) {
      await tx.counterparty.create({
        data: { organizationId: org.id, name: loan.name, kind: 'EXTERNAL_LENDER' },
      });
    }
  }

  // 3. La cuenta compartida.
  let cuenta = await tx.cashAccount.findFirst({ where: { organizationId: org.id, isDefault: true } });
  if (!cuenta) {
    cuenta = await tx.cashAccount.create({
      data: {
        organizationId: org.id,
        name: 'Binance',
        kind: 'EXCHANGE',
        currency: 'USD',
        shared: true,
        sharedWithId: owner.id,
        autoAttributeShortfall: false,
        isDefault: true,
      },
    });
  }

  // La contraparte de los movimientos y la cuenta de las conciliaciones las
  // llena la migración `20261006130000_caja_not_null` en SQL puro, porque tienen
  // que estar antes del `SET NOT NULL` que esa misma migración aplica. Acá ya
  // no se pueden ni consultar: el cliente de Prisma rechaza filtrar por null un
  // campo no-nulo.

  // 4. Las conciliaciones heredadas, preservando lo que la pantalla mostraba.
  const ledger = await armarLedger(tx, org.id);
  const conciliaciones = await tx.cashReconciliation.findMany({
    where: { organizationId: org.id },
    orderBy: { date: 'asc' },
  });
  let migradas = 0;
  for (const c of conciliaciones) {
    // La señal de "ya migrada" es el ESTADO, no la cuenta: desde la migración
    // 20261006130000 todas tienen cuenta, así que mirar `accountId` haría que
    // nunca se congelara ninguna.
    if (c.status !== 'DRAFT') continue;
    const esperado = businessCash(ledger, dia(c.date)).balance;
    const total = n(c.totalAmount);
    await tx.cashReconciliation.update({
      where: { id: c.id },
      data: {
        accountId: cuenta.id,
        status: 'CONFIRMED',
        currency: 'USD',
        totalUsd: total,
        // El residuo de antes pasa a ser el personal DECLARADO: la pantalla
        // sigue diciendo exactamente lo mismo que decía.
        personalAmount: total - esperado,
        personalUsd: total - esperado,
        expectedUsd: esperado,
        differenceUsd: 0,
        confirmedAt: c.createdAt,
        source: 'MIGRATION',
      },
    });
    migradas++;
  }

  // 6. FIFO retroactivo: sin esto, las obligaciones suman y nada las baja.
  const deudas = obligationLedger(await obligacionesDe(tx, org.id, owner.id));
  const retiros = await tx.ownerMovement.findMany({
    where: { organizationId: org.id, counterpartyId: owner.id, kind: 'WITHDRAWAL' },
    orderBy: { date: 'asc' },
  });
  const yaAplicado = new Map();
  let aplicadoTotal = 0;
  for (const pago of retiros) {
    const existe = await tx.debtApplication.count({ where: { paymentId: pago.id } });
    if (existe) continue;
    const vivas = deudas.map((d) => ({ ...d, applied: yaAplicado.get(d.sourceId) ?? d.applied }));
    const plan = applyPayment(obligationLedger(vivas), n(pago.amount), 'OLDEST_FIRST');
    for (const a of plan.applications) {
      yaAplicado.set(a.sourceId, (yaAplicado.get(a.sourceId) ?? 0) + a.amount);
      aplicadoTotal += a.amount;
      await tx.debtApplication.create({
        data: {
          organizationId: org.id,
          paymentId: pago.id,
          amount: a.amount,
          ...(a.source === 'EXPENSE' ? { expenseId: a.sourceId } : {}),
          ...(a.source === 'LOAN_PAYMENT' ? { loanPaymentId: a.sourceId } : {}),
          ...(a.source === 'MOVEMENT' ? { obligationMovementId: a.sourceId } : {}),
        },
      });
    }
  }

  return { owner, cuenta, deudas, aplicadoTotal, migradas };
}

/** Las obligaciones de la contraparte, con lo que ya se les aplicó. */
async function obligacionesDe(tx, organizationId, counterpartyId) {
  const [gastos, cuotas, aportes, aplicaciones] = await Promise.all([
    tx.expense.findMany({ where: { organizationId, paidBy: 'OWNER', refundable: true } }),
    tx.loanPayment.findMany({ where: { organizationId, paidBy: 'OWNER', refundable: true } }),
    tx.ownerMovement.findMany({
      where: { organizationId, counterpartyId, kind: 'CONTRIBUTION', refundable: true },
    }),
    tx.debtApplication.findMany({ where: { organizationId } }),
  ]);

  // ⚠️ Leer lo YA aplicado es lo que hace idempotente a la verificación: en una
  // segunda corrida los retiros se saltan (ya tienen su DebtApplication), así
  // que si las obligaciones volvieran a figurar enteras nada las bajaría y el
  // control denunciaría un descuadre inexistente. En la primera corrida no hay
  // ninguna aplicación, el mapa queda vacío y todo arranca en cero igual que antes.
  const aplicado = new Map();
  for (const a of aplicaciones) {
    const sourceId = a.expenseId ?? a.loanPaymentId ?? a.obligationMovementId;
    if (sourceId) aplicado.set(sourceId, (aplicado.get(sourceId) ?? 0) + n(a.amount));
  }

  return [
    ...gastos.map((g) => ({
      source: 'EXPENSE',
      sourceId: g.id,
      date: dia(g.date),
      category: g.isInvestment ? 'EQUIPMENT' : g.category === 'DESIGN' ? 'DESIGN' : 'PURCHASE',
      amount: n(g.amount),
      applied: aplicado.get(g.id) ?? 0,
    })),
    ...cuotas.map((c) => ({
      source: 'LOAN_PAYMENT',
      sourceId: c.id,
      date: dia(c.date),
      category: 'LOAN_PAYMENT',
      amount: n(c.amount),
      applied: aplicado.get(c.id) ?? 0,
    })),
    ...aportes.map((m) => ({
      source: 'MOVEMENT',
      sourceId: m.id,
      date: dia(m.date),
      category: 'CONTRIBUTION',
      amount: n(m.amount),
      applied: aplicado.get(m.id) ?? 0,
    })),
  ];
}

async function armarLedger(tx, organizationId) {
  const where = { organizationId };
  const [ventas, abonos, gastos, cuotas, movimientos] = await Promise.all([
    tx.sale.findMany({ where, select: { date: true, amount: true } }),
    tx.payment.findMany({ where, select: { date: true, amount: true } }),
    tx.expense.findMany({ where }),
    tx.loanPayment.findMany({ where }),
    tx.ownerMovement.findMany({ where }),
  ]);
  return {
    sales: ventas.map((v) => ({ date: dia(v.date), amount: n(v.amount) })),
    orderPayments: abonos.map((p) => ({ date: dia(p.date), amount: n(p.amount) })),
    expenses: gastos.map((g) => ({
      date: dia(g.date),
      amount: n(g.amount),
      paidBy: g.paidBy,
      isInvestment: g.isInvestment,
      isFilament: g.materialId != null,
      refundable: g.refundable,
    })),
    loanPayments: cuotas.map((c) => ({
      date: dia(c.date),
      amount: n(c.amount),
      paidBy: c.paidBy,
      refundable: c.refundable,
    })),
    movements: movimientos.map((m) => ({
      date: dia(m.date),
      amount: n(m.amount),
      kind: m.kind,
      refundable: m.refundable,
    })),
  };
}

/** El total que se debe según la cascada vieja: puesto − retirado, con piso en cero. */
async function totalDeuda(db, organizationId) {
  const [gastos, cuotas, movimientos] = await Promise.all([
    db.expense.findMany({ where: { organizationId, paidBy: 'OWNER' } }),
    db.loanPayment.findMany({ where: { organizationId, paidBy: 'OWNER' } }),
    db.ownerMovement.findMany({ where: { organizationId } }),
  ]);
  const puesto =
    gastos.reduce((s, g) => s + n(g.amount), 0) +
    cuotas.reduce((s, c) => s + n(c.amount), 0) +
    movimientos.filter((m) => m.kind === 'CONTRIBUTION').reduce((s, m) => s + n(m.amount), 0);
  const retirado = movimientos
    .filter((m) => m.kind === 'WITHDRAWAL')
    .reduce((s, m) => s + n(m.amount), 0);
  return Math.max(0, puesto - retirado);
}

const main = async () => {
  const orgs = await prisma.organization.findMany();
  for (const org of orgs) {
    const antes = await totalDeuda(prisma, org.id);

    await prisma.$transaction(async (tx) => {
      const r = await backfill(tx, org);
      const despues = r.deudas.reduce((s, d) => s + d.outstanding, 0) - r.aplicadoTotal;

      console.log(`\n${org.name}`);
      console.log(`  contraparte: ${r.owner.name}   cuenta: ${r.cuenta.name}`);
      console.log(`  conciliaciones migradas: ${r.migradas}`);
      console.log(`  obligaciones: ${r.deudas.length}   aplicado: ${r.aplicadoTotal.toFixed(2)}`);
      console.log(`  deuda antes:   ${antes.toFixed(2)}`);
      console.log(`  deuda despues: ${despues.toFixed(2)}`);

      if (Math.abs(antes - despues) > 0.01) {
        throw new Error(
          `La deuda con ${r.owner.name} cambio de ${antes.toFixed(2)} a ${despues.toFixed(2)}. No se escribe nada.`,
        );
      }
      if (!COMMIT) throw new Error('ENSAYO: nada se escribio. Corre con --commit.');
    });
  }
};

main()
  .catch((e) => {
    console.error(`\n${e.message}`);
    process.exitCode = COMMIT ? 1 : 0;
  })
  .finally(() => prisma.$disconnect());
