/**
 * IMPORTA LAS HOJAS DIRECTAS DEL EXCEL: clientes, encargos, publicidad,
 * inversión en equipos e insumos.
 *
 *   node --env-file=.env prisma/import-negocio.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: calcula, imprime el reporte y no escribe nada.
 *
 * NO toca la hoja `Ventas` (ver §6 de docs/excel-vs-app.md: hay $1.292 de
 * encargos históricos y $23,50 de descuadre por decidir antes) ni el filamento,
 * que ya se importó con `import-filamento.mjs`.
 *
 * Decisiones tomadas con el dueño el 2026-09-07:
 *  - Los encargos entran como PEDIDOS ENTREGADOS con su abono: ya están
 *    cobrados, así que el pedido nace en DELIVERED y el pago cubre el total.
 *  - Atribución conservadora: "Instagram" es ORGANIC y "Personal" es OTHER. No
 *    se atribuyen a ninguna campaña sin evidencia; inflar el ROI con ventas que
 *    quizá no vinieron de la pauta es mentirse a favor.
 *  - Los cinco contactos entran como CLIENT; que Toplevel sea un negocio queda
 *    en sus notas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

/** El canal como lo anota el Excel → la atribución de la app. */
const CANAL = {
  WhatsApp: 'WHATSAPP',
  Referido: 'REFERRAL',
  // Vino por Instagram, pero nada dice que haya sido por un anuncio.
  Instagram: 'ORGANIC',
  // Contacto directo: la app no tiene un canal para eso.
  Personal: 'OTHER',
};

const OBJETIVO = { Conversaciones: 'MESSAGES', 'Visitas al perfil': 'VISITS' };

/** Vida útil por defecto de una impresora, la misma que usa la hoja Costeo. */
const VIDA_UTIL_HORAS = 4800;

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo las hojas Clientes, Encargos,\n' +
        'Publicidad, Inversion y Materiales.',
    );
  }
  const d = JSON.parse(readFileSync(fuente, 'utf8'));
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  const esperado = {
    clientes: d.clientes.length,
    encargos: d.encargos.length,
    encargosTotal: round2(d.encargos.reduce((s, e) => s + e.monto, 0)),
    campanas: d.campanas.length,
    pauta: round2(d.campanas.reduce((s, c) => s + c.gasto, 0)),
    equipos: d.equipos.length,
    equiposTotal: round2(d.equipos.reduce((s, e) => s + e.costo, 0)),
    insumos: d.insumos.length,
  };

  console.log('--- LO QUE SE VA A IMPORTAR ---');
  console.log(`  clientes  : ${esperado.clientes}`);
  console.log(`  encargos  : ${esperado.encargos} pedidos entregados ($${esperado.encargosTotal}, con su abono)`);
  console.log(`  campañas  : ${esperado.campanas} ($${esperado.pauta} de pauta, cada una con su gasto)`);
  console.log(`  equipos   : ${esperado.equipos} impresoras ($${esperado.equiposTotal}, como inversión)`);
  console.log(`  insumos   : ${esperado.insumos} (con su compra)`);
  for (const e of d.encargos) {
    console.log(`     · ${e.fecha} ${e.cliente} — ${e.canal} → ${CANAL[e.canal] ?? 'OTHER'}`);
  }

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // ---- Clientes: se cruzan por nombre para no duplicar los que ya existan ----
    const clientes = new Map();
    for (const c of d.clientes) {
      const ya = await tx.client.findFirst({
        where: { organizationId: org.id, name: { equals: c.nombre, mode: 'insensitive' } },
      });
      if (ya) {
        clientes.set(c.nombre, ya.id);
        continue;
      }
      const creado = await tx.client.create({
        data: {
          organizationId: org.id,
          name: c.nombre,
          type: 'CLIENT',
          // La app no distingue empresa de persona; el dato no se pierde.
          notes: c.tipo ? `${c.tipo} (del Excel)` : null,
        },
      });
      clientes.set(c.nombre, creado.id);
    }

    // ---- Encargos: pedidos ENTREGADOS, con el abono que los cobró ----
    const ultimo = await tx.order.aggregate({
      where: { organizationId: org.id },
      _max: { code: true },
    });
    let code = (ultimo._max.code ?? 0) + 1;

    for (const e of d.encargos) {
      const fecha = new Date(`${e.fecha}T00:00:00.000Z`);
      const clientId = clientes.get(e.cliente);
      if (!clientId) throw new Error(`El encargo de "${e.cliente}" no encontró su cliente`);

      const pedido = await tx.order.create({
        data: {
          organizationId: org.id,
          clientId,
          code: code++,
          status: 'DELIVERED',
          deliveryDate: fecha,
          lines: [
            { description: e.descripcion, quantity: 1, unit: 'Unidad', unitPrice: e.monto },
          ],
          // El canal original queda escrito: la atribución de la app es una
          // traducción, y conviene poder revisarla después.
          notes: `Del Excel (hoja Encargos). Canal anotado: ${e.canal}.`,
          originChannel: CANAL[e.canal] ?? 'OTHER',
        },
      });

      // Ya estaba cobrado: sin el abono, el pedido queda con saldo y no cuenta
      // como ingreso en el dashboard.
      await tx.payment.create({
        data: {
          organizationId: org.id,
          orderId: pedido.id,
          date: fecha,
          amount: e.monto,
          note: 'Cobrado (del Excel)',
        },
      });
    }

    // ---- Campañas + su gasto en el ledger ----
    const hoy = new Date();
    for (const c of d.campanas) {
      const fecha = new Date(`${c.fecha}T00:00:00.000Z`);
      const delMes =
        fecha.getUTCFullYear() === hoy.getUTCFullYear() && fecha.getUTCMonth() === hoy.getUTCMonth();
      const campana = await tx.campaign.create({
        data: {
          organizationId: org.id,
          name: c.nombre,
          // Formato "Publicación"/"Reel": es Instagram.
          platform: 'INSTAGRAM',
          objective: OBJETIVO[c.objetivo] ?? null,
          status: delMes ? 'ACTIVE' : 'FINISHED',
          startDate: fecha,
          endDate: delMes ? null : fecha,
          budget: c.gasto,
          notes: [c.formato && `Formato: ${c.formato}`, c.publico && `Público: ${c.publico}`]
            .filter(Boolean)
            .join(' · '),
          reach: c.alcance,
          conversations: c.conversaciones,
          profileVisits: c.visitas,
        },
      });
      // El gasto REAL se deriva del ledger, no del presupuesto: por eso cada
      // campaña necesita su Expense enlazado.
      await tx.expense.create({
        data: {
          organizationId: org.id,
          date: fecha,
          category: 'ADVERTISING',
          description: `Pauta: ${c.nombre}`,
          amount: c.gasto,
          isInvestment: false,
          campaignId: campana.id,
        },
      });
    }

    // ---- Equipos: la impresora y lo que costó ----
    for (const e of d.equipos) {
      const printer = await tx.printer.create({
        data: {
          organizationId: org.id,
          name: e.nombre,
          price: e.costo,
          lifetimeHours: VIDA_UTIL_HORAS,
          powerKw: 0,
          maintPerHour: 0,
        },
      });
      await tx.expense.create({
        data: {
          organizationId: org.id,
          date: new Date('2026-08-31T00:00:00.000Z'),
          category: 'EQUIPMENT',
          description: `${e.nombre} — inversión (del Excel, fecha real no registrada)`,
          amount: e.costo,
          // Las impresoras no son gasto: son inversión que el negocio devuelve.
          isInvestment: true,
          printerId: printer.id,
        },
      });
    }

    // ---- Insumos: la ficha del catálogo y la compra ----
    for (const i of d.insumos) {
      const comp = await tx.component.create({
        data: {
          organizationId: org.id,
          name: i.nombre,
          packagePrice: i.total,
          unitsPerPackage: i.cantidad || 1,
          scope: 'PER_PIECE',
        },
      });
      await tx.expense.create({
        data: {
          organizationId: org.id,
          date: i.fecha ? new Date(`${i.fecha}T00:00:00.000Z`) : new Date('2026-08-31T00:00:00.000Z'),
          category: 'CONSUMABLE',
          description: `Compra ${i.nombre}`,
          amount: i.total,
          isInvestment: false,
          quantity: i.cantidad,
          componentId: comp.id,
        },
      });
    }
  });

  // ---- Comprobar contra la base ----
  const [clientes, pedidos, campanas, printers, comps] = await Promise.all([
    prisma.client.count({ where: { organizationId: org.id } }),
    prisma.order.findMany({
      where: { organizationId: org.id, status: 'DELIVERED' },
      include: { payments: true },
    }),
    prisma.campaign.findMany({ where: { organizationId: org.id }, include: { expenses: true } }),
    prisma.printer.count({ where: { organizationId: org.id } }),
    prisma.component.count({ where: { organizationId: org.id } }),
  ]);
  const cobrado = round2(
    pedidos.flatMap((p) => p.payments).reduce((s, p) => s + Number(p.amount), 0),
  );
  const pauta = round2(
    campanas.flatMap((c) => c.expenses).reduce((s, e) => s + Number(e.amount), 0),
  );

  console.log('\n--- LO QUE QUEDÓ EN LA BASE ---');
  console.log(`  clientes            : ${clientes}`);
  console.log(`  pedidos entregados  : ${pedidos.length}  (cobrado $${cobrado})`);
  console.log(`  campañas            : ${campanas.length}  (pauta $${pauta})`);
  console.log(`  impresoras          : ${printers}`);
  console.log(`  insumos             : ${comps}`);

  const errores = [
    Math.abs(cobrado - esperado.encargosTotal) > 0.05 &&
      `encargos: $${cobrado} ≠ $${esperado.encargosTotal}`,
    Math.abs(pauta - esperado.pauta) > 0.05 && `pauta: $${pauta} ≠ $${esperado.pauta}`,
    campanas.length < esperado.campanas && `campañas: ${campanas.length} < ${esperado.campanas}`,
  ].filter(Boolean);
  if (errores.length) throw new Error(`NO CUADRA con el Excel: ${errores.join(' · ')}`);
  console.log('\nTodo cuadra con el Excel.');
}

const round2 = (n) => Math.round(n * 100) / 100;

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
