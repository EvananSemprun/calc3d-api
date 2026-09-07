/**
 * IMPORTA LA HOJA "Gastos" DEL EXCEL al ledger de la app.
 *
 *   node --env-file=.env prisma/import-gastos.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: calcula, imprime el reporte y no escribe nada.
 *
 * ⚠️ TRES FILAS NO SE IMPORTAN porque ya están en la app por otro camino: la de
 * publicidad (que son las 7 campañas de la hoja `Publicidad`, ya en el ledger) y
 * los imanes y el papel de burbujas (que entraron con la hoja `Materiales`).
 * En el Excel esas hojas se solapan a propósito; acá duplicarían dinero. El
 * script VERIFICA que cada una esté realmente cargada antes de saltarla: si no
 * la encuentra, no escribe nada.
 *
 * Decisiones tomadas con el dueño el 2026-09-07:
 *  - Categorías: Insumos y Empaque → CONSUMABLE · Repuestos → MAINTENANCE
 *    (enlazado a la impresora cuando la fila dice cuál) · Diseño → OTHER.
 *  - Fechas: la hoja no las lleva, así que van al cierre del histórico
 *    (31/08/2026) y la descripción dice que son del Excel. EXCEPCIÓN: los pagos
 *    al diseñador nombran su mes, y ese dato sí se usa — un gasto mensual
 *    amontonado en agosto arruina cualquier comparación entre meses.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

/** Fecha de las filas que la hoja no fecha: el cierre del histórico. */
const CIERRE = new Date('2026-08-31T00:00:00.000Z');

/** La categoría de la hoja → la de la app. */
const CATEGORIA = {
  Insumos: 'CONSUMABLE',
  Empaque: 'CONSUMABLE',
  Repuestos: 'MAINTENANCE',
  Diseno: 'OTHER',
  Diseño: 'OTHER',
};

/**
 * Filas que YA están en la app por otra hoja. Cada una dice cómo comprobarlo:
 * si la comprobación falla, la suposición era falsa y el script se planta.
 */
const YA_CARGADAS = [
  {
    nombre: 'Publicidad (6 campanas Instagram 2026)',
    porque: 'las 7 campañas de la hoja Publicidad, ya en el ledger',
    verificar: (tx, org) =>
      tx.expense
        .aggregate({
          where: { organizationId: org, category: 'ADVERTISING' },
          _sum: { amount: true },
        })
        .then((r) => Number(r._sum.amount ?? 0)),
  },
  {
    nombre: '100 imanes',
    porque: 'el insumo "Imanes" de la hoja Materiales',
    verificar: (tx, org) => sumaDeInsumo(tx, org, 'Imanes'),
  },
  {
    nombre: '3 metros de papel de burbujas',
    porque: 'el insumo "Papel de burbujas" de la hoja Materiales',
    verificar: (tx, org) => sumaDeInsumo(tx, org, 'Papel de burbujas'),
  },
];

function sumaDeInsumo(tx, organizationId, nombre) {
  return tx.expense
    .findMany({
      where: { organizationId, component: { name: { startsWith: nombre, mode: 'insensitive' } } },
    })
    .then((gs) => gs.reduce((s, g) => s + Number(g.amount), 0));
}

/** La impresora que nombra la fila, si la nombra. */
function impresoraDe(nombre, printers) {
  const t = nombre.toLowerCase();
  return printers.find((p) => t.includes(p.clave)) ?? null;
}

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo la hoja Gastos.',
    );
  }
  const { gastos } = JSON.parse(readFileSync(fuente, 'utf8'));
  if (!gastos?.length) throw new Error('El dataset no trae la hoja Gastos');

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  // ---- Comprobar que lo que vamos a saltar está de verdad cargado ----
  console.log('--- FILAS QUE NO SE IMPORTAN (ya están por otra hoja) ---');
  let saltado = 0;
  for (const y of YA_CARGADAS) {
    const fila = gastos.find((g) => g.nombre === y.nombre);
    if (!fila) throw new Error(`La hoja ya no trae la fila "${y.nombre}": revisá el mapeo`);
    const enLaApp = await y.verificar(prisma, org.id);
    const cuadra = Math.abs(enLaApp - fila.monto) < 0.05;
    console.log(
      `  ${fila.nombre} — $${fila.monto} · ${y.porque} · en la app: $${enLaApp.toFixed(2)} ${
        cuadra ? '✓' : '✗'
      }`,
    );
    if (!cuadra) {
      throw new Error(
        `"${fila.nombre}" vale $${fila.monto} en el Excel pero en la app hay $${enLaApp.toFixed(2)}.\n` +
          'O no está cargada (y entonces hay que importarla) o está mal. No se escribe nada.',
      );
    }
    saltado += fila.monto;
  }

  // ---- Lo que sí entra ----
  const aImportar = gastos.filter((g) => !YA_CARGADAS.some((y) => y.nombre === g.nombre));
  const total = redondear(aImportar.reduce((s, g) => s + g.monto, 0));

  const impresoras = (
    await prisma.printer.findMany({ where: { organizationId: org.id } })
  ).map((p) => ({ id: p.id, name: p.name, clave: claveDe(p.name) }));

  console.log('\n--- LO QUE SE VA A IMPORTAR ---');
  const porCategoria = new Map();
  for (const g of aImportar) {
    const cat = CATEGORIA[g.categoria];
    if (!cat) throw new Error(`Categoría sin mapear en la hoja: "${g.categoria}"`);
    const p = porCategoria.get(cat) ?? { filas: 0, monto: 0 };
    porCategoria.set(cat, { filas: p.filas + 1, monto: redondear(p.monto + g.monto) });
  }
  for (const [cat, v] of porCategoria) console.log(`  ${cat.padEnd(12)} ${v.filas} filas  $${v.monto}`);
  console.log(`  ${'TOTAL'.padEnd(12)} ${aImportar.length} filas  $${total}`);

  const sinMaquina = aImportar.filter(
    (g) => CATEGORIA[g.categoria] === 'MAINTENANCE' && !impresoraDe(g.nombre, impresoras),
  );
  if (sinMaquina.length) {
    console.log('\n  ⚠️ Repuestos sin máquina que los reclame (la fila no dice cuál):');
    for (const g of sinMaquina) console.log(`     · ${g.nombre} — $${g.monto}`);
    console.log('     Entran igual, pero no alimentan el mantenimiento por hora de ninguna.');
  }

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const g of aImportar) {
      const printer = impresoraDe(g.nombre, impresoras);
      await tx.expense.create({
        data: {
          organizationId: org.id,
          date: g.fecha ? new Date(`${g.fecha}T00:00:00.000Z`) : CIERRE,
          category: CATEGORIA[g.categoria],
          description: g.fecha
            ? `${g.nombre} (del Excel)`
            : `${g.nombre} (del Excel, fecha real no registrada)`,
          amount: g.monto,
          isInvestment: false,
          printerId: printer?.id ?? null,
        },
      });
    }
  });

  // ---- Comprobar contra el Excel ----
  const enLaApp = await prisma.expense.aggregate({
    where: { organizationId: org.id },
    _sum: { amount: true },
  });
  const esperado = redondear(
    // Todo el ledger: lo que ya había más lo que acabamos de meter.
    (await gastoPrevio) + total,
  );
  const real = redondear(Number(enLaApp._sum.amount ?? 0));

  console.log('\n--- LO QUE QUEDÓ EN LA BASE ---');
  console.log(`  gastos importados : ${aImportar.length}  ($${total})`);
  console.log(`  ledger completo   : $${real}`);
  if (Math.abs(real - esperado) > 0.05) {
    throw new Error(`El ledger da $${real} y debería dar $${esperado}`);
  }
  console.log(`\nCuadra. La hoja suma $${redondear(total + saltado)}, de los cuales`);
  console.log(`$${redondear(saltado)} ya estaban cargados por las hojas Publicidad y Materiales.`);
}

/** Palabra con la que una fila puede nombrar a la impresora ("a1", "p2s"). */
function claveDe(nombre) {
  const m = /\b(a1|p2s)\b/i.exec(nombre);
  return (m?.[1] ?? nombre).toLowerCase();
}

const redondear = (n) => Math.round(n * 100) / 100;

// Se lee ANTES de escribir: es la base contra la que se verifica el total.
const gastoPrevio = (async () => {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  const r = await prisma.expense.aggregate({
    where: { organizationId: org.id },
    _sum: { amount: true },
  });
  return redondear(Number(r._sum.amount ?? 0));
})();

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
