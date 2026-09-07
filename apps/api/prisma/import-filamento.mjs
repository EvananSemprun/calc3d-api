/**
 * IMPORTA EL CONTROL DE FILAMENTO DESDE EL EXCEL DEL DUEÑO.
 *
 * Fuente: `filamento-excel.json`, extraído de las hojas "Inventario" (48
 * compras) y "Stock mensual" (33 colores, conteo de agosto 2026).
 *
 *   node --env-file=.env prisma/import-filamento.mjs [--commit]
 *
 * Sin `--commit` hace un ENSAYO: calcula todo, imprime el reporte y no escribe
 * nada. Con `--commit` borra el filamento que haya y escribe el del Excel, todo
 * dentro de una transacción.
 *
 * Reglas de la marca en el conteo (el Excel cuenta por color SIN marca, la app
 * cuenta por material CON marca):
 *   1. El color se compró a UNA sola marca  -> esa marca. Es un hecho.
 *   2. El total del color es CERO           -> cero en todas sus marcas.
 *   3. Ambiguo (varias marcas y hay rollos) -> ficha "Sin especificar" con
 *      `needsBrandCheck`. Asignarlo a la última marca comprada fabricaría un
 *      dato indistinguible de uno real.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');

/** Las compras del Excel no tienen fecha: son el histórico previo a septiembre. */
const FECHA_HISTORICA = new Date('2026-08-31T00:00:00.000Z');
const MES_CONTEO = new Date(Date.UTC(2026, 7, 1)); // agosto 2026
const NOTA_HISTORICA = 'histórica del Excel, fecha real no registrada';
const SIN_MARCA = 'Sin especificar';

const prisma = new PrismaClient();

const clave = (tipo, color, marca) => `${tipo}||${color}||${marca}`;
const nombre = (tipo, color, marca) => [tipo, marca, color].filter(Boolean).join(' ');

async function main() {
  const fuente = join(AQUI, 'filamento-excel.json');
  if (!existsSync(fuente)) {
    throw new Error(
      'Falta filamento-excel.json. NO se versiona (son datos del negocio y el repo es público).
' +
        'Se regenera del .xlsx con openpyxl: leer la hoja "Inventario" (filas 4-111:
' +
        'fecha, tipo, color, marca, cantidad, precio lista, pagado Bs, tasa, proveedor, nota)
' +
        'y "Stock mensual" (filas 5-49: tipo, color, estado y las columnas F/G/H de agosto).
' +
        'El costo real es "pagado Bs ÷ tasa" si se pagó en bolívares, si no el precio de lista.',
    );
  }
  const datos = JSON.parse(readFileSync(fuente, 'utf8'));
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('No hay ninguna organización en la base');

  // ---- 1. Fichas de material: una por tipo + color + marca ----
  const fichas = new Map();
  for (const c of datos.compras) {
    const k = clave(c.tipo, c.color, c.marca);
    const previa = fichas.get(k);
    const costoPorRollo = c.cantidad > 0 ? c.costoReal / c.cantidad : 0;
    // "La última compra manda": las filas sin fecha van en orden de carga, así
    // que la de más abajo en la hoja es la más reciente.
    if (!previa || c.fila > previa.fila) {
      fichas.set(k, { tipo: c.tipo, color: c.color, marca: c.marca, fila: c.fila, rollPrice: costoPorRollo });
    }
  }

  // Estado (activo/descontinuado) desde "Stock mensual", por tipo + color.
  const estados = new Map(
    datos.conteos.map((c) => [`${c.tipo}||${c.color}`, c.estado === 'Activo' ? 'ACTIVE' : 'DISCONTINUED']),
  );

  // ---- 2. Repartir el conteo de agosto ----
  const marcasPorColor = new Map();
  for (const f of fichas.values()) {
    const k = `${f.tipo}||${f.color}`;
    marcasPorColor.set(k, [...(marcasPorColor.get(k) ?? []), f.marca]);
  }

  const conteos = []; // { tipo, color, marca, sealed, inUse, running, needsBrandCheck }
  const ambiguos = [];
  for (const c of datos.conteos) {
    const partes = {
      sealed: c.agosto.sealed ?? 0,
      inUse: c.agosto.inUse ?? 0,
      running: c.agosto.running ?? 0,
    };
    const total = partes.sealed + partes.inUse + partes.running;
    const marcas = marcasPorColor.get(`${c.tipo}||${c.color}`) ?? [];

    if (total === 0) {
      // Cero es cero en todas las marcas: exacto, no hay nada que adivinar.
      for (const marca of marcas) {
        conteos.push({ tipo: c.tipo, color: c.color, marca, ...partes, needsBrandCheck: false });
      }
    } else if (marcas.length === 1) {
      conteos.push({ tipo: c.tipo, color: c.color, marca: marcas[0], ...partes, needsBrandCheck: false });
    } else {
      // Sé cuántos rollos hay; no sé de qué marca son.
      ambiguos.push({ color: `${c.tipo} ${c.color}`, rollos: total, marcas });
      fichas.set(clave(c.tipo, c.color, SIN_MARCA), {
        tipo: c.tipo,
        color: c.color,
        marca: SIN_MARCA,
        fila: 0,
        // Para cotizar mientras no se identifique: el precio de la compra más
        // reciente de ese color, sin importar la marca.
        rollPrice: precioDelColor(fichas, c.tipo, c.color),
      });
      conteos.push({ tipo: c.tipo, color: c.color, marca: SIN_MARCA, ...partes, needsBrandCheck: true });
    }
  }

  // ---- 3. Verificar contra el Excel ANTES de escribir ----
  const esperado = {
    compras: datos.compras.length,
    rollos: datos.compras.reduce((s, c) => s + c.cantidad, 0),
    invertido: round2(datos.compras.reduce((s, c) => s + c.costoReal, 0)),
    contados: datos.conteos.reduce(
      (s, c) => s + (c.agosto.sealed ?? 0) + (c.agosto.inUse ?? 0) + (c.agosto.running ?? 0),
      0,
    ),
  };
  const contadosImportados = conteos.reduce((s, c) => s + c.sealed + c.inUse + c.running, 0);
  if (contadosImportados !== esperado.contados) {
    throw new Error(
      `El conteo no cuadra: el Excel tiene ${esperado.contados} rollos y se repartieron ${contadosImportados}. No se escribió nada.`,
    );
  }

  console.log('--- LO QUE SE VA A IMPORTAR ---');
  console.log(`  fichas de material : ${fichas.size}  (incluye ${ambiguos.length} "${SIN_MARCA}")`);
  console.log(`  compras            : ${esperado.compras}  (${esperado.rollos} rollos, $${esperado.invertido})`);
  console.log(`  filas de conteo    : ${conteos.length}  (${contadosImportados} rollos de agosto 2026)`);
  console.log(`  descontinuados     : ${[...estados.values()].filter((e) => e !== 'ACTIVE').length}`);
  console.log(`  por identificar    : ${ambiguos.length} rollo(s)`);
  for (const a of ambiguos) console.log(`     · ${a.color}: ${a.rollos} rollo(s) entre ${a.marcas.join(', ')}`);

  if (!COMMIT) {
    console.log('\nENSAYO: no se escribió nada. Volvé a correrlo con --commit.');
    return;
  }

  // ---- 4. Escribir, todo o nada ----
  await prisma.$transaction(async (tx) => {
    // Los gastos apuntan al material con onDelete: SetNull, así que borrar los
    // materiales dejaría 52 gastos huérfanos en el dashboard.
    const gastos = await tx.expense.deleteMany({ where: { organizationId: org.id, materialId: { not: null } } });
    const previos = await tx.material.deleteMany({ where: { organizationId: org.id } });

    const ids = new Map();
    for (const [k, f] of fichas) {
      const creado = await tx.material.create({
        data: {
          organizationId: org.id,
          name: nombre(f.tipo, f.color, f.marca),
          type: f.tipo,
          brand: f.marca,
          color: f.color,
          rollPrice: round2(f.rollPrice),
          rollGrams: 1000,
          // Las fichas "Sin especificar" son un marcador temporal para colgar
          // rollos cuya marca no se sabe: nadie va a comprar "PLA Sin
          // especificar Amarillo". Nacen DISCONTINUED para que, al identificar
          // el rollo y dejarlas en cero, no aparezcan en la lista de reposición.
          status:
            f.marca === SIN_MARCA
              ? 'DISCONTINUED'
              : (estados.get(`${f.tipo}||${f.color}`) ?? 'ACTIVE'),
        },
      });
      ids.set(k, creado.id);
    }

    for (const c of datos.compras) {
      const materialId = ids.get(clave(c.tipo, c.color, c.marca));
      await tx.expense.create({
        data: {
          organizationId: org.id,
          date: c.fecha ? new Date(c.fecha) : FECHA_HISTORICA,
          category: 'CONSUMABLE',
          // `Expense` no tiene campo de nota: la aclaración va en la
          // descripción, que es lo que se ve en Gastos y en Compras.
          description: c.fecha
            ? `Compra ${nombre(c.tipo, c.color, c.marca)}`
            : `Compra ${nombre(c.tipo, c.color, c.marca)} — ${NOTA_HISTORICA}`,
          amount: round2(c.costoReal),
          isInvestment: false,
          quantity: c.cantidad,
          materialId,
          // Si se pagó en bolívares, `amount` ya viene en USD y la tasa queda
          // guardada para poder mostrar lo que se pagó de verdad.
          rate: c.tasa ?? null,
          currencyCode: c.pagadoBs ? 'VES' : null,
        },
      });
    }

    for (const c of conteos) {
      const materialId = ids.get(clave(c.tipo, c.color, c.marca));
      if (!materialId) continue;
      await tx.stockCount.create({
        data: {
          organizationId: org.id,
          materialId,
          month: MES_CONTEO,
          sealed: c.sealed,
          inUse: c.inUse,
          running: c.running,
          needsBrandCheck: c.needsBrandCheck,
        },
      });
    }

    console.log(`\n  se borraron ${previos.count} materiales y ${gastos.count} compras anteriores`);
  });

  // ---- 5. Comprobar contra la base, no contra la intención ----
  const [materiales, compras, stock] = await Promise.all([
    prisma.material.count({ where: { organizationId: org.id } }),
    prisma.expense.findMany({
      where: { organizationId: org.id, materialId: { not: null } },
      select: { amount: true, quantity: true },
    }),
    prisma.stockCount.findMany({ where: { organizationId: org.id } }),
  ]);
  const rollos = compras.reduce((s, c) => s + (c.quantity ?? 0), 0);
  const invertido = round2(compras.reduce((s, c) => s + Number(c.amount), 0));
  const contados = stock.reduce((s, c) => s + c.sealed + c.inUse + c.running, 0);

  console.log('\n--- LO QUE QUEDÓ EN LA BASE ---');
  console.log(`  materiales : ${materiales}`);
  console.log(`  compras    : ${compras.length}  (${rollos} rollos, $${invertido})`);
  console.log(`  conteo ago : ${contados} rollos en ${stock.length} filas`);
  console.log(`  pendientes : ${stock.filter((s) => s.needsBrandCheck).length}`);

  const errores = [
    rollos !== esperado.rollos && `rollos: ${rollos} ≠ ${esperado.rollos}`,
    Math.abs(invertido - esperado.invertido) > 0.05 && `invertido: ${invertido} ≠ ${esperado.invertido}`,
    contados !== esperado.contados && `contados: ${contados} ≠ ${esperado.contados}`,
  ].filter(Boolean);
  if (errores.length) throw new Error(`NO CUADRA con el Excel: ${errores.join(' · ')}`);
  console.log('\nTodo cuadra con el Excel.');
}

/** Precio por rollo de la compra más reciente de ese color, sin mirar la marca. */
function precioDelColor(fichas, tipo, color) {
  const delColor = [...fichas.values()].filter((f) => f.tipo === tipo && f.color === color);
  if (!delColor.length) return 0;
  return delColor.sort((a, b) => b.fila - a.fila)[0].rollPrice;
}

const round2 = (n) => Math.round(n * 100) / 100;

main()
  .catch((e) => {
    console.error('\nFALLÓ:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
