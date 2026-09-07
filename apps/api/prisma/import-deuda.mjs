/**
 * IMPORTA LA HOJA "Deuda" y los parámetros del punto de equilibrio de "Resumen".
 *
 *   node --env-file=.env prisma/import-deuda.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: calcula, imprime el reporte y no escribe nada.
 *
 * Dos cosas que NO hace, a propósito:
 *  - **No crea un `Expense` por cada pago.** La impresora ya está en el ledger
 *    como inversión; contar además cada cuota sería contar la misma máquina dos
 *    veces. La hoja lo dice igual: "este préstamo se paga aparte de la
 *    operación... no toca el capital".
 *  - **No guarda la cuota en Configuración.** El nivel 2 del equilibrio la
 *    deriva de los préstamos abiertos; el mismo número en dos lugares termina
 *    diciendo dos cosas distintas.
 *
 * El "costo variable" de la hoja (25 %) y el "margen de contribución" de la app
 * son el mismo dato al revés: se guarda `1 − 0,25 = 0,75`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

// El build ESM de shared usa imports sin extensión, que el ESM nativo de Node no
// resuelve; el CJS (el que consume Nest) sí. Se importa de ahí para NO
// reimplementar las cuentas del saldo en el script.
const require = createRequire(import.meta.url);
const { loanBalance, loanPaid, monthsToPayOff } = require('@calc3d/shared');

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();
const redondear = (n) => Math.round(n * 100) / 100;

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo las hojas Deuda y Resumen.',
    );
  }
  const { deuda, equilibrio } = JSON.parse(readFileSync(fuente, 'utf8'));
  if (!deuda?.pagos?.length) throw new Error('El dataset no trae la hoja Deuda');

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  const yaHay = await prisma.loan.count({ where: { organizationId: org.id } });
  if (yaHay > 0) {
    throw new Error(`Ya hay ${yaHay} préstamo(s) cargados. Revisá antes de volver a importar.`);
  }

  // El préstamo fue para la P2S: enlazarlo permite ver, en la impresora, cuánto
  // se debe todavía de ella.
  const printer = await prisma.printer.findFirst({
    where: { organizationId: org.id, name: { contains: 'P2S', mode: 'insensitive' } },
  });

  const pagado = loanPaid(deuda.pagos.map((p) => ({ amount: p.monto })));
  const saldo = loanBalance(deuda.capital, deuda.pagos.map((p) => ({ amount: p.monto })));
  const fijos = redondear(equilibrio.disenador + equilibrio.otrosFijos);
  const margen = redondear(1 - equilibrio.costoVariablePct);

  console.log('--- PRÉSTAMO ---');
  console.log(`  ${deuda.nombre}`);
  console.log(`  capital $${deuda.capital} · cuota $${deuda.cuota}/mes`);
  console.log(`  equipo   : ${printer?.name ?? '⚠️ no encontré la impresora P2S; queda sin enlazar'}`);
  for (const p of deuda.pagos) console.log(`    ${p.fecha}  $${p.monto}`);
  console.log(`  pagado $${pagado} · saldo $${saldo} · faltan ${monthsToPayOff(saldo, deuda.cuota)} meses`);

  console.log('\n--- PUNTO DE EQUILIBRIO (Configuración) ---');
  console.log(`  costos fijos      : $${equilibrio.disenador} diseñador + $${equilibrio.otrosFijos} otros = $${fijos}/mes`);
  console.log(`  margen contribución: ${(margen * 100).toFixed(0)} %  (costo variable ${(equilibrio.costoVariablePct * 100).toFixed(0)} % en la hoja)`);
  console.log(`  reserva equipos    : $${equilibrio.reservaEquipos}/mes`);
  const nivel = (extra) => redondear((fijos + extra) / margen);
  console.log(`\n  1. No perder dinero          : $${nivel(0)}`);
  console.log(`  2. Además pagar la cuota     : $${nivel(deuda.cuota)}`);
  console.log(`  3. Además reservar equipos   : $${nivel(deuda.cuota + equilibrio.reservaEquipos)}`);

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.loan.create({
      data: {
        organizationId: org.id,
        name: deuda.nombre,
        principal: deuda.capital,
        monthlyPayment: deuda.cuota,
        startDate: new Date(`${deuda.pagos[0].fecha}T00:00:00.000Z`),
        printerId: printer?.id ?? null,
        notes:
          'Del Excel (hoja Deuda). Se paga aparte de la operación: la impresora ' +
          'ya está en el ledger como inversión.',
        payments: {
          create: deuda.pagos.map((p) => ({
            organizationId: org.id,
            date: new Date(`${p.fecha}T00:00:00.000Z`),
            amount: p.monto,
            reference: p.referencia,
          })),
        },
      },
    });

    await tx.settings.update({
      where: { organizationId: org.id },
      data: {
        fixedCosts: [
          { concept: 'Diseñador', monthlyAmount: equilibrio.disenador },
          { concept: 'Otros gastos fijos', monthlyAmount: equilibrio.otrosFijos },
        ],
        breakEvenMarginPct: margen,
        equipmentReserve: equilibrio.reservaEquipos,
      },
    });
  });

  // ---- Comprobar contra el Excel ----
  const loan = await prisma.loan.findFirst({
    where: { organizationId: org.id },
    include: { payments: true, printer: { select: { name: true } } },
  });
  const pagos = loan.payments.map((p) => ({ amount: Number(p.amount) }));
  const saldoReal = loanBalance(Number(loan.principal), pagos);
  const s = await prisma.settings.findFirst({ where: { organizationId: org.id } });

  console.log('\n--- LO QUE QUEDÓ EN LA BASE ---');
  console.log(`  ${loan.name} → ${loan.printer?.name ?? 'sin equipo'}`);
  console.log(`  ${loan.payments.length} pagos · pagado $${loanPaid(pagos)} · saldo $${saldoReal}`);
  console.log(`  fijos ${JSON.stringify(s.fixedCosts)} · margen ${s.breakEvenMarginPct} · reserva $${s.equipmentReserve}`);

  const errores = [
    loan.payments.length !== deuda.pagos.length && 'faltan pagos',
    Math.abs(saldoReal - saldo) > 0.05 && `saldo $${saldoReal} ≠ $${saldo}`,
    Math.abs(s.breakEvenMarginPct - margen) > 0.0001 && 'el margen no quedó guardado',
  ].filter(Boolean);
  if (errores.length) throw new Error(`NO CUADRA con el Excel: ${errores.join(' · ')}`);
  console.log('\nCuadra con el Excel: saldo $750 y los tres niveles de la hoja Metas.');
}

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
