/**
 * IMPORTA LA HOJA "Metas" DEL EXCEL.
 *
 *   node --env-file=.env prisma/import-metas.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: calcula, imprime el reporte y no escribe nada.
 *
 * Solo se importan las METAS. Las tres columnas "reales" de la hoja NO se
 * guardan: la app las deriva de sus ventas, pedidos y clientes. Este script las
 * usa para lo contrario —**verificar que la derivación da lo mismo que la
 * hoja**— y falla sin escribir si no coinciden. Es la única forma de saber que
 * "cliente nuevo" o "encargo" significan acá lo mismo que allá.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();
const redondear = (n) => Math.round(n * 100) / 100;
const inicioDe = (mes) => new Date(`${mes}-01T00:00:00.000Z`);
const finDe = (mes) => {
  const d = inicioDe(mes);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/** Lo real del mes, con las mismas definiciones que usa el módulo de metas. */
async function realDe(organizationId, mes) {
  const [desde, hasta] = [inicioDe(mes), finDe(mes)];
  const [ventas, pedidos, clientes] = await Promise.all([
    prisma.sale.findMany({ where: { organizationId, date: { gte: desde, lt: hasta } } }),
    prisma.order.findMany({
      where: { organizationId, deliveryDate: { gte: desde, lt: hasta } },
      select: { lines: true },
    }),
    prisma.client.findMany({
      where: { organizationId },
      select: { orders: { select: { deliveryDate: true } }, sales: { select: { date: true } } },
    }),
  ]);
  const total = (l) => (l ?? []).reduce((s, x) => s + x.quantity * x.unitPrice, 0);
  const nuevos = clientes.filter((c) => {
    const fechas = [...c.orders.map((o) => o.deliveryDate), ...c.sales.map((s) => s.date)].filter(
      Boolean,
    );
    if (!fechas.length) return false;
    const primera = new Date(Math.min(...fechas.map((f) => +f)));
    return primera >= desde && primera < hasta;
  }).length;

  return {
    ventas: redondear(
      ventas.reduce((s, v) => s + Number(v.amount), 0) + pedidos.reduce((s, p) => s + total(p.lines), 0),
    ),
    encargos: pedidos.length,
    clientes: nuevos,
  };
}

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo la hoja Metas.',
    );
  }
  const { metas } = JSON.parse(readFileSync(fuente, 'utf8'));
  if (!metas?.length) throw new Error('El dataset no trae la hoja Metas');

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  console.log('--- METAS A IMPORTAR ---');
  console.log('  mes       ventas  encargos  clientes');
  for (const m of metas) {
    console.log(
      `  ${m.mes}   $${String(m.ventas).padStart(5)}  ${String(m.encargos).padStart(7)}  ${String(m.clientes).padStart(8)}`,
    );
  }

  // Lo real NO se importa: se usa para comprobar que la app cuenta igual.
  console.log('\n--- LO REAL: la hoja vs lo que deriva la app ---');
  const desajustes = [];
  for (const m of metas) {
    const real = await realDe(org.id, m.mes);
    const ok =
      Math.abs(real.ventas - m.realVentasHoja) < 0.05 &&
      real.encargos === m.realEncargosHoja &&
      real.clientes === m.realClientesHoja;
    console.log(
      `  ${m.mes}  hoja: $${m.realVentasHoja}/${m.realEncargosHoja}/${m.realClientesHoja}` +
        `   app: $${real.ventas}/${real.encargos}/${real.clientes}  ${ok ? '✓' : '✗'}`,
    );
    if (!ok) desajustes.push(m.mes);
  }
  if (desajustes.length) {
    throw new Error(
      `La app cuenta distinto que la hoja en: ${desajustes.join(', ')}.\n` +
        'Antes de importar hay que entender por qué: si "encargo" o "cliente nuevo"\n' +
        'no significan lo mismo, las metas van a medir otra cosa.',
    );
  }

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  await prisma.$transaction(
    metas.map((m) =>
      prisma.goal.upsert({
        where: { organizationId_month: { organizationId: org.id, month: inicioDe(m.mes) } },
        create: {
          organizationId: org.id,
          month: inicioDe(m.mes),
          salesTarget: m.ventas,
          ordersTarget: m.encargos,
          newClientsTarget: m.clientes,
          notes: 'Del Excel (hoja Metas).',
        },
        update: {
          salesTarget: m.ventas,
          ordersTarget: m.encargos,
          newClientsTarget: m.clientes,
        },
      }),
    ),
  );

  const guardadas = await prisma.goal.findMany({
    where: { organizationId: org.id },
    orderBy: { month: 'asc' },
  });
  console.log(`\n--- LO QUE QUEDÓ EN LA BASE ---`);
  console.log(`  ${guardadas.length} metas · ventas objetivo $${guardadas.reduce((s, g) => s + Number(g.salesTarget), 0)}`);
  if (guardadas.length !== metas.length) throw new Error('Faltan metas en la base');
  console.log('\nCuadra con el Excel, y lo real que deriva la app coincide con la hoja.');
}

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
