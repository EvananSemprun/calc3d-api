/**
 * IMPORTA LA HOJA "Ventas" DEL EXCEL.
 *
 *   node --env-file=.env prisma/import-ventas.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: calcula, imprime el reporte y no escribe nada.
 *
 * La hoja es una grilla semanal donde el mostrador está día por día y los
 * encargos viven SOLO como una nota de texto ("Encargos: 83$"). Las dos trampas:
 *
 *  1. **La fila 11 (`Total`) NO es el mostrador.** Está escrita a mano e incluye
 *     los encargos. Importarla como venta de mostrador lo infla un 200 %. Acá se
 *     usan las filas auxiliares 19-24, que la propia hoja ya calculó.
 *
 *  2. **Los encargos de las notas se solapan con la hoja `Encargos`**, que ya
 *     entró como pedidos. Por eso el descuento es SEMANA POR SEMANA: de la nota
 *     se resta lo que esa misma semana ya tiene cargado como pedido, y solo se
 *     registra el resto. Un corte por fecha ("de agosto en adelante no importo")
 *     parecía suficiente y perdía $46: hay semanas de agosto donde la nota vale
 *     más que los pedidos de la hoja `Encargos`.
 *
 * Lo que queda registrado, decidido con el dueño el 2026-09-07:
 *  - Mostrador: una venta COUNTER por día con monto, con su fecha real.
 *  - Encargos que solo existen en la nota: una venta ENCARGO por semana, fechada
 *    el lunes, sin cliente ni detalle —no existen en ningún lado— con la nota
 *    original copiada. Es eso o perder el 58 % de la facturación histórica.
 *  - Los $23,50 que la hoja no explica NO se inventan: la app va a decir
 *    $2.179,50 contra los $2.203 de la fila 11, y esa diferencia es exactamente
 *    el descuadre de la hoja.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

const redondear = (n) => Math.round(n * 100) / 100;
const dia = (iso) => new Date(`${iso}T00:00:00.000Z`);
/** El domingo de esa semana, para cerrar el rango del lunes. */
const finDeSemana = (lunes) => new Date(dia(lunes).getTime() + 6 * 86400000);

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo la hoja Ventas.',
    );
  }
  const { ventas } = JSON.parse(readFileSync(fuente, 'utf8'));
  if (!ventas?.mostrador?.length) throw new Error('El dataset no trae la hoja Ventas');

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  // Correr esto dos veces duplicaría toda la facturación histórica.
  const yaHay = await prisma.sale.count({ where: { organizationId: org.id } });
  if (yaHay > 0) {
    throw new Error(
      `Ya hay ${yaHay} ventas registradas. Este script importa el histórico completo y no\n` +
        'sabe cuáles son suyas: correrlo ahora duplicaría la facturación. Revisá primero.',
    );
  }

  // ---- Encargos: a cada semana se le descuenta lo que ya es pedido ----
  const filas = [];
  for (const e of ventas.encargos) {
    const pedidos = await prisma.order.findMany({
      where: {
        organizationId: org.id,
        deliveryDate: { gte: dia(e.lunes), lte: finDeSemana(e.lunes) },
      },
      select: { code: true, lines: true },
    });
    const yaCargado = redondear(
      pedidos.reduce(
        (s, p) => s + (p.lines ?? []).reduce((t, l) => t + l.quantity * l.unitPrice, 0),
        0,
      ),
    );
    const resto = redondear(e.monto - yaCargado);
    if (resto < -0.01) {
      throw new Error(
        `La semana del ${e.lunes} tiene $${yaCargado} en pedidos pero su nota dice $${e.monto}.\n` +
          'Los pedidos no pueden valer más que la nota que los engloba: revisá antes de escribir.',
      );
    }
    filas.push({ ...e, yaCargado, resto: Math.max(0, resto), pedidos: pedidos.length });
  }

  const mostradorTotal = redondear(ventas.mostrador.reduce((s, m) => s + m.monto, 0));
  const encargoTotal = redondear(filas.reduce((s, f) => s + f.monto, 0));
  const aRegistrar = redondear(filas.reduce((s, f) => s + f.resto, 0));
  const yaEraPedido = redondear(filas.reduce((s, f) => s + f.yaCargado, 0));

  console.log('--- LO QUE SE VA A IMPORTAR ---');
  console.log(`  mostrador : ${ventas.mostrador.length} ventas diarias  $${mostradorTotal}`);
  console.log(
    `  encargos  : ${filas.filter((f) => f.resto > 0).length} ventas semanales  $${aRegistrar}`,
  );
  console.log(`\n  De los $${encargoTotal} anotados en las notas:`);
  console.log(`    $${yaEraPedido} ya están cargados como pedidos (no se repiten)`);
  console.log(`    $${aRegistrar} solo existen en la nota y entran como venta semanal`);
  console.log('\n  Semanas donde la nota y los pedidos NO coinciden:');
  for (const f of filas.filter((x) => x.pedidos > 0 || x.yaCargado > 0)) {
    console.log(
      `    ${f.lunes}  nota $${f.monto}  pedidos $${f.yaCargado} (${f.pedidos})  → entra $${f.resto}`,
    );
  }

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const m of ventas.mostrador) {
      await tx.sale.create({
        data: {
          organizationId: org.id,
          date: dia(m.fecha),
          amount: m.monto,
          kind: 'COUNTER',
          note: `Mostrador — ${m.dia} (del Excel, hoja Ventas)`,
        },
      });
    }
    for (const f of filas.filter((x) => x.resto > 0)) {
      await tx.sale.create({
        data: {
          organizationId: org.id,
          // El lunes de su semana: la hoja no guarda el día del encargo.
          date: dia(f.lunes),
          amount: f.resto,
          kind: 'ENCARGO',
          note:
            `Encargos de la semana (del Excel, sin detalle). Nota original: «${f.nota}»` +
            (f.yaCargado > 0 ? ` — menos $${f.yaCargado} ya cargados como pedido.` : ''),
        },
      });
    }
  });

  // ---- Comprobar contra el Excel ----
  const [counter, encargo, pedidos] = await Promise.all([
    prisma.sale.aggregate({
      where: { organizationId: org.id, kind: 'COUNTER' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { organizationId: org.id, kind: 'ENCARGO' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.order.findMany({ where: { organizationId: org.id }, select: { lines: true } }),
  ]);
  const enMostrador = redondear(Number(counter._sum.amount ?? 0));
  const enEncargos = redondear(Number(encargo._sum.amount ?? 0));
  const enPedidos = redondear(
    pedidos.reduce(
      (s, p) => s + (p.lines ?? []).reduce((t, l) => t + l.quantity * l.unitPrice, 0),
      0,
    ),
  );

  console.log('\n--- LO QUE QUEDÓ EN LA BASE ---');
  console.log(`  mostrador          : ${counter._count} ventas  $${enMostrador}`);
  console.log(`  encargos semanales : ${encargo._count} ventas  $${enEncargos}`);
  console.log(`  pedidos con cliente: $${enPedidos}`);
  console.log(`  FACTURACIÓN TOTAL  : $${redondear(enMostrador + enEncargos + enPedidos)}`);

  const errores = [
    Math.abs(enMostrador - mostradorTotal) > 0.05 &&
      `mostrador: $${enMostrador} ≠ $${mostradorTotal}`,
    Math.abs(enEncargos + enPedidos - encargoTotal) > 0.05 &&
      `encargos: $${redondear(enEncargos + enPedidos)} ≠ $${encargoTotal} de las notas`,
  ].filter(Boolean);
  if (errores.length) throw new Error(`NO CUADRA con el Excel: ${errores.join(' · ')}`);

  console.log('\nCuadra con el Excel: el mostrador da exacto y los encargos suman');
  console.log('lo mismo que las notas, sin repetir ninguno de los pedidos.');
  console.log(`La fila 11 de la hoja dice $2203: los $23,50 de diferencia son el`);
  console.log('descuadre que la propia hoja no explica (ver docs/excel-vs-app.md §6).');
}

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
