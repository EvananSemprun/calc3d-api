/**
 * SINCRONIZA lo que el Excel tiene y la app todavía no.
 *
 *   node --env-file=.env prisma/sincronizar-excel.mjs [--commit]
 *
 * Sin `--commit` es un ENSAYO: compara, imprime el diff y no escribe nada.
 *
 * A diferencia de los `import-*.mjs`, que son de carga inicial y fallan si ya
 * hay datos, este está pensado para correrse **cada vez que el Excel cambie**:
 * compara contra la base y carga SOLO la diferencia. Correrlo dos veces seguidas
 * no hace nada la segunda vez.
 *
 * Qué mira (lo que se lleva fila por fila):
 *  - **Clientes** por nombre.
 *  - **Encargos** por cliente + fecha + monto. Uno con "Total del pedido" queda
 *    con saldo abierto: el pedido vale el total y el abono es lo cobrado.
 *  - **Mostrador**, día por día, desde el TEXTO de la hoja `Ventas` (las filas
 *    auxiliares quedaron sin recalcular y vienen vacías).
 *  - **Encargos de la nota semanal**, descontando semana por semana lo que ya
 *    existe como pedido. Ese descuento es lo que evita contar dos veces.
 *
 * Lo que NO toca: filamento, gastos, campañas, deuda, metas y equipos. Esos ya
 * cuadran y tienen su propio script de carga.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const prisma = new PrismaClient();

const r2 = (n) => Math.round(n * 100) / 100;
const dia = (iso) => new Date(`${iso}T00:00:00.000Z`);
const finDeSemana = (lunes) => new Date(dia(lunes).getTime() + 6 * 86400000);
const norm = (s) => (s ?? '').trim().toLowerCase();

/** El canal como lo anota el Excel → la atribución de la app. */
const CANAL = {
  WhatsApp: 'WHATSAPP',
  Referido: 'REFERRAL',
  // Vino por Instagram, pero nada dice que haya sido por un anuncio.
  Instagram: 'ORGANIC',
  // Contacto directo y cliente que vuelve: ninguno es un canal de captación.
  Personal: 'OTHER',
  'Cliente recurrente': 'OTHER',
};

const totalLineas = (lines) => (lines ?? []).reduce((s, l) => s + l.quantity * l.unitPrice, 0);

async function main() {
  const fuente = join(AQUI, 'negocio-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta negocio-excel.json. NO se versiona (son datos del negocio y el repo es público).\n' +
        'Se regenera del .xlsx con openpyxl leyendo Encargos, Clientes y Ventas.',
    );
  }
  const d = JSON.parse(readFileSync(fuente, 'utf8'));
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');
  const where = { organizationId: org.id };

  const [clientesDb, pedidosDb, ventasDb] = await Promise.all([
    prisma.client.findMany({ where, select: { id: true, name: true } }),
    prisma.order.findMany({ where, include: { client: true, payments: true } }),
    prisma.sale.findMany({ where, select: { date: true, amount: true, kind: true } }),
  ]);

  // ---------- Clientes que faltan ----------
  const porNombre = new Map(clientesDb.map((c) => [norm(c.name), c]));
  const clientesFaltan = d.clientes.filter((c) => !porNombre.has(norm(c.nombre)));

  // ---------- Encargos que faltan ----------
  // Se identifican por CLIENTE + MONTO + DESCRIPCIÓN, no por fecha.
  //
  // La fecha NO sirve como identidad: un pedido cargado a mano puede tener un
  // día distinto del que quedó escrito en el Excel (un cliente, 10/09 en la app y
  // 09/09 en la hoja). Pero tolerar días tampoco alcanza, y es PEOR: el Excel
  // tiene dos encargos de un mismo cliente por $10 en la misma semana ("2 macetas" el
  // 05/09 y "2 materos" el 09/09) y con tolerancia el segundo se tomaba como
  // ya cargado — una venta real que nunca entraba.
  //
  // La descripción sí es identidad: la escribió el dueño en la hoja y es lo que
  // el import copió a la línea del pedido, así que coincide exacta.
  const yaCargados = pedidosDb.map((p) => ({
    cliente: norm(p.client?.name),
    monto: r2(p.payments.reduce((s, x) => s + Number(x.amount), 0)),
    desc: norm((p.lines ?? []).map((l) => l.description).join(' ')),
    fecha: p.deliveryDate,
    code: p.code,
    usado: false,
  }));

  const parecidos = [];
  const encargosFaltan = d.encargos.filter((e) => {
    // `usado` evita que un solo pedido de la app tape dos filas iguales del Excel.
    const match = yaCargados.find(
      (p) =>
        !p.usado &&
        p.cliente === norm(e.cliente) &&
        p.monto === r2(e.cobrado) &&
        p.desc === norm(e.descripcion),
    );
    if (!match) return true;
    match.usado = true;
    if (match.fecha && match.fecha.toISOString().slice(0, 10) !== e.fecha) {
      parecidos.push(
        `${e.cliente} $${e.cobrado} «${e.descripcion.slice(0, 28)}»: Excel ${e.fecha} · app ` +
          `${match.fecha.toISOString().slice(0, 10)} (pedido #${match.code})`,
      );
    }
    return false;
  });

  // ---------- Días de mostrador que faltan ----------
  const ventasPorDia = new Set(
    ventasDb
      .filter((v) => v.kind === 'COUNTER')
      .map((v) => `${v.date.toISOString().slice(0, 10)}|${r2(Number(v.amount))}`),
  );
  const mostradorFalta = d.ventas.mostrador.filter(
    (m) => !ventasPorDia.has(`${m.fecha}|${r2(m.monto)}`),
  );

  console.log('--- LO QUE FALTA CARGAR ---');
  console.log(`  clientes  : ${clientesFaltan.length}`);
  for (const c of clientesFaltan) console.log(`     · ${c.nombre}`);
  console.log(`  encargos  : ${encargosFaltan.length}`);
  for (const e of encargosFaltan) {
    const saldo = e.total ? ` (de $${e.total}, queda $${r2(e.total - e.cobrado)} por cobrar)` : '';
    console.log(`     · ${e.fecha} ${e.cliente} — $${e.cobrado}${saldo} · ${e.canal}`);
  }
  if (parecidos.length) {
    console.log("  ya cargados, con la fecha corrida (NO se duplican):");
    for (const p of parecidos) console.log(`     · ${p}`);
  }
  console.log(`  mostrador : ${mostradorFalta.length} días`);
  for (const m of mostradorFalta) console.log(`     · ${m.fecha} ${m.dia} $${m.monto}`);

  if (!clientesFaltan.length && !encargosFaltan.length && !mostradorFalta.length) {
    console.log('\n  Nada que cargar: el Excel y la app dicen lo mismo.');
  }

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    await resumen(org.id, d);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // ---- Clientes ----
    for (const c of clientesFaltan) {
      const creado = await tx.client.create({
        data: {
          organizationId: org.id,
          name: c.nombre,
          type: 'CLIENT',
          notes: c.tipo ? `${c.tipo} (del Excel)` : null,
        },
      });
      porNombre.set(norm(c.nombre), creado);
    }

    // ---- Encargos ----
    const ultimo = await tx.order.aggregate({ where, _max: { code: true } });
    let code = (ultimo._max.code ?? 0) + 1;

    for (const e of encargosFaltan) {
      const cliente = porNombre.get(norm(e.cliente));
      if (!cliente) throw new Error(`El encargo de "${e.cliente}" no encontró su cliente`);
      const fecha = dia(e.fecha);
      // El pedido vale el TOTAL; el abono es lo que ya se cobró. Sin esa
      // distinción, un pedido a medio pagar entraría como si estuviera saldado.
      const valor = e.total ?? e.cobrado;
      const saldado = r2(valor) <= r2(e.cobrado);

      const pedido = await tx.order.create({
        data: {
          organizationId: org.id,
          clientId: cliente.id,
          code: code++,
          status: saldado ? 'DELIVERED' : 'CONFIRMED',
          deliveryDate: fecha,
          lines: [{ description: e.descripcion, quantity: 1, unit: 'Unidad', unitPrice: valor }],
          notes: [`Del Excel (hoja Encargos). Canal anotado: ${e.canal}.`, e.notas]
            .filter(Boolean)
            .join(' '),
          originChannel: CANAL[e.canal] ?? 'OTHER',
        },
      });

      if (e.cobrado > 0) {
        await tx.payment.create({
          data: {
            organizationId: org.id,
            orderId: pedido.id,
            date: fecha,
            amount: e.cobrado,
            note: saldado ? 'Cobrado (del Excel)' : 'Abono (del Excel)',
          },
        });
      }
    }

    // ---- Mostrador ----
    for (const m of mostradorFalta) {
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
  });

  // ---- Encargos de la nota semanal: recalcular el agregado de cada semana ----
  // Se hace DESPUÉS de crear los pedidos, para descontar los nuevos.
  await ajustarAgregadosSemanales(org.id, d);

  console.log('\n--- LO QUE QUEDÓ ---');
  await resumen(org.id, d);
}

/**
 * Ajusta la venta semanal agregada de cada semana: la nota menos lo que ya
 * existe como pedido. Si un encargo pasó a ser pedido, su agregado se achica o
 * desaparece — así el mismo dinero no se cuenta dos veces.
 */
async function ajustarAgregadosSemanales(organizationId, d) {
  for (const semana of d.ventas.encargos) {
    const desde = dia(semana.lunes);
    const hasta = finDeSemana(semana.lunes);

    const pedidos = await prisma.order.findMany({
      where: { organizationId, deliveryDate: { gte: desde, lte: hasta } },
      select: { lines: true },
    });
    const yaPedido = r2(pedidos.reduce((s, p) => s + totalLineas(p.lines), 0));
    const resto = r2(Math.max(0, semana.monto - yaPedido));

    const actual = await prisma.sale.findFirst({
      where: { organizationId, kind: 'ENCARGO', date: desde },
    });

    if (resto <= 0) {
      if (actual) {
        await prisma.sale.delete({ where: { id: actual.id } });
        console.log(`  semana ${semana.lunes}: el agregado se va (ya está todo como pedido)`);
      }
      continue;
    }
    const nota =
      `Encargos de la semana (del Excel, sin detalle). Nota original: «${semana.nota}»` +
      (yaPedido > 0 ? ` — menos $${yaPedido} ya cargados como pedido.` : '');

    if (!actual) {
      await prisma.sale.create({
        data: { organizationId, date: desde, amount: resto, kind: 'ENCARGO', note: nota },
      });
      console.log(`  semana ${semana.lunes}: agregado nuevo $${resto}`);
    } else if (r2(Number(actual.amount)) !== resto) {
      await prisma.sale.update({ where: { id: actual.id }, data: { amount: resto, note: nota } });
      console.log(`  semana ${semana.lunes}: $${r2(Number(actual.amount))} → $${resto}`);
    }
  }
}

/** Contrasta los totales de la app con los del Excel. */
async function resumen(organizationId, d) {
  const [ventas, pedidos, clientes] = await Promise.all([
    prisma.sale.findMany({ where: { organizationId }, select: { amount: true, kind: true } }),
    prisma.order.findMany({ where: { organizationId }, include: { payments: true } }),
    prisma.client.count({ where: { organizationId } }),
  ]);
  const most = r2(
    ventas.filter((v) => v.kind === 'COUNTER').reduce((s, v) => s + Number(v.amount), 0),
  );
  const encSem = r2(
    ventas.filter((v) => v.kind === 'ENCARGO').reduce((s, v) => s + Number(v.amount), 0),
  );
  const cobradoPedidos = r2(
    pedidos.flatMap((p) => p.payments).reduce((s, x) => s + Number(x.amount), 0),
  );
  const valorPedidos = r2(pedidos.reduce((s, p) => s + totalLineas(p.lines), 0));

  const excelMost = r2(d.ventas.mostrador.reduce((s, m) => s + m.monto, 0));
  const excelEnc = r2(d.ventas.encargos.reduce((s, n) => s + n.monto, 0));
  const excelCobrado = r2(d.encargos.reduce((s, e) => s + e.cobrado, 0));

  const linea = (etiqueta, app, excel) =>
    console.log(
      `  ${etiqueta.padEnd(28)} app $${String(app).padStart(9)}   excel $${String(excel).padStart(9)}   ${
        Math.abs(app - excel) < 0.05 ? '✓' : '✗ difiere $' + r2(app - excel)
      }`,
    );

  console.log(`  clientes: ${clientes} · pedidos: ${pedidos.length}`);
  linea('mostrador', most, excelMost);
  linea('encargos cobrados', cobradoPedidos, excelCobrado);
  linea('encargos (nota + pedidos)', r2(encSem + cobradoPedidos), excelEnc);
  console.log(`  valor de los pedidos: $${valorPedidos} (incluye lo no cobrado todavía)`);
}

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
