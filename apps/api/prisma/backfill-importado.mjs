/**
 * BACKFILL de "Importado" (tarea 4 de la fase 3 de Caja). Idempotente.
 *
 * Marca `source = 'EXCEL_IMPORT'` en los registros que entraron desde el Excel,
 * para que la pantalla pueda distinguir lo que importó la migración de lo que
 * cargó el dueño a mano.
 *
 *   node --env-file=.env prisma/backfill-importado.mjs                 # ENSAYO
 *   node --env-file=.env prisma/backfill-importado.mjs --write         # escribe
 *   node --env-file=.env prisma/backfill-importado.mjs --undo          # ENSAYO de la reversa
 *   node --env-file=.env prisma/backfill-importado.mjs --undo --write  # revierte
 *
 * ⚠️ CORRERLO SIEMPRE PRIMERO EN ENSAYO. El ensayo abre la transacción, aplica
 * los cambios y la revierte, así que los números que imprime son los reales.
 *
 * ⚠️ El corte se verificó contra la copia LOCAL del 01/10. Producción tiene
 * datos que esa copia no tiene, así que el script imprime el recuento por día
 * de creación y ABORTA si encuentra una fila anterior al corte creada en un día
 * que no sea de la importación: marcar como "Importado" algo que el dueño cargó
 * a mano es una mentira silenciosa sobre el origen de su dinero.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const WRITE = process.argv.includes('--write');
const UNDO = process.argv.includes('--undo');

/**
 * Todo lo creado ANTES de esta fecha (UTC) vino del Excel. Las dos corridas de
 * importación fueron el 07/09 (la migración grande) y el 26/09 (compras de
 * filamento y la hoja `Inversion`).
 */
const CORTE = new Date('2026-09-27T00:00:00.000Z');
const DIAS_DEL_EXCEL = ['2026-09-07', '2026-09-26'];

/**
 * Las cuatro tablas que llenó la importación.
 *
 * ⚠️ `OwnerMovement` queda EXCLUIDO A PROPÓSITO. El único que existe antes del
 * corte es el cuadre manual del 17/09 ("Dinero de la caja usado por …
 * (regularizacion)", $475,14), que escribió la APP durante la feature de Caja:
 * no es una fila del Excel. Marcarlo "Importado" sería mentir sobre el origen
 * de un movimiento de dinero, que es justamente lo que la insignia existe para
 * evitar. Tampoco entra `CashReconciliation`: sus filas heredadas ya quedaron
 * en `MIGRATION` con el backfill de la fase 1.
 */
const TABLAS = [
  { modelo: 'Expense', delegado: 'expense', etiqueta: 'Gastos' },
  { modelo: 'LoanPayment', delegado: 'loanPayment', etiqueta: 'Cuotas del prestamo' },
  { modelo: 'Sale', delegado: 'sale', etiqueta: 'Ventas' },
  { modelo: 'Payment', delegado: 'payment', etiqueta: 'Abonos de pedidos' },
];

const prisma = new PrismaClient();
const dia = (d) => d.toISOString().slice(0, 10); // UTC, el mismo criterio del corte

/** ENSAYO no es un fallo: se usa para revertir la transacción sin ensuciar la salida. */
class Ensayo extends Error {}

/**
 * ¿El cliente de Prisma generado conoce este campo?
 *
 * `Sale.source` y `Payment.source` los agrega la tarea 2 de esta misma fase. Si
 * todavía no corrió, el script tiene que AVISARLO y seguir con las dos tablas
 * que sí existen, en vez de reventar con un error de Prisma que no explica nada.
 */
const tieneCampo = (modelo, campo) =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === modelo)
    ?.fields.some((f) => f.name === campo) ?? false;

/** Cuántas filas hay por día de creación, ordenadas por día. */
const porDia = (filas) => {
  const mapa = new Map();
  for (const f of filas) mapa.set(dia(f.createdAt), (mapa.get(dia(f.createdAt)) ?? 0) + 1);
  return [...mapa.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
};

const imprimirDias = (titulo, filas) => {
  console.log(`  ${titulo}`);
  if (filas.length === 0) {
    console.log('    (ninguna)');
    return;
  }
  for (const [d, n] of porDia(filas)) console.log(`    ${d}   ${String(n).padStart(4)}`);
  console.log(`    ${'total'.padEnd(10)} ${String(filas.length).padStart(4)}`);
};

/** El recuento previo de una tabla, con el guard del corte ya aplicado. */
async function revisar(tabla) {
  const filas = await prisma[tabla.delegado].findMany({
    select: { id: true, createdAt: true, source: true },
  });
  const antes = filas.filter((f) => f.createdAt < CORTE);
  const despues = filas.filter((f) => f.createdAt >= CORTE);

  console.log(`\n${tabla.etiqueta} (${tabla.modelo})`);
  imprimirDias('A MARCAR — anteriores al corte:', antes);
  imprimirDias('QUEDA FUERA — desde el corte:', despues);

  // Lo que ya tiene otro origen (MIGRATION / RECONCILIATION) no se pisa: ese
  // dato también dice de dónde salió la fila, y sobreescribirlo seria otra
  // mentira, nada más que al revés.
  const conOtroOrigen = antes.filter((f) => f.source !== 'MANUAL' && f.source !== 'EXCEL_IMPORT');
  if (conOtroOrigen.length > 0) {
    const origenes = [...new Set(conOtroOrigen.map((f) => f.source))].join(', ');
    console.log(`  ⚠️ ${conOtroOrigen.length} con otro origen (${origenes}): NO se tocan.`);
  }

  const inesperadas = antes.filter((f) => !DIAS_DEL_EXCEL.includes(dia(f.createdAt)));
  if (inesperadas.length > 0) {
    const dias = [...new Set(inesperadas.map((f) => dia(f.createdAt)))].join(', ');
    throw new Error(
      `${tabla.modelo}: ${inesperadas.length} fila(s) anteriores al corte creadas el ${dias}, ` +
        `que no es un dia de importacion (${DIAS_DEL_EXCEL.join(', ')}). ` +
        'Esta base tiene datos que el plan no verificó: marcarlas como importadas seria ' +
        'mentir sobre su origen. No se escribe nada.',
    );
  }

  return antes.filter((f) => f.source === 'MANUAL').length;
}

async function marcar() {
  console.log(`Corte: createdAt < ${dia(CORTE)} (UTC)`);
  console.log(`Dias de importacion esperados: ${DIAS_DEL_EXCEL.join(', ')}`);
  console.log('OwnerMovement queda EXCLUIDO (ver el comentario del script).');

  const disponibles = [];
  for (const tabla of TABLAS) {
    if (tieneCampo(tabla.modelo, 'source')) disponibles.push(tabla);
    else
      console.log(
        `\n⚠️ ${tabla.etiqueta} (${tabla.modelo}): el cliente de Prisma no conoce el campo ` +
          'source. FALTA LA MIGRACION DE LA TAREA 2 (source en Sale y Payment). ' +
          'Esta tabla se SALTA: volve a correr el backfill despues de aplicarla.',
      );
  }

  let total = 0;
  for (const tabla of disponibles) total += await revisar(tabla);

  console.log(`\nSe marcarian ${total} fila(s) como EXCEL_IMPORT.`);
  if (total === 0) {
    console.log('Nada que hacer.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    let escritas = 0;
    for (const tabla of disponibles) {
      const r = await tx[tabla.delegado].updateMany({
        where: { createdAt: { lt: CORTE }, source: 'MANUAL' },
        data: { source: 'EXCEL_IMPORT' },
      });
      console.log(`  ${tabla.etiqueta}: ${r.count}`);
      escritas += r.count;
    }
    if (escritas !== total) {
      throw new Error(
        `Se esperaban ${total} filas y se escribieron ${escritas}. No se confirma nada.`,
      );
    }
    if (!WRITE) throw new Ensayo();
  });
}

async function deshacer() {
  console.log('REVERSA: todo lo que este en EXCEL_IMPORT vuelve a MANUAL.');
  const disponibles = TABLAS.filter((t) => tieneCampo(t.modelo, 'source'));
  for (const t of TABLAS) {
    if (!disponibles.includes(t)) {
      console.log(`⚠️ ${t.etiqueta} (${t.modelo}): sin campo source, se salta (tarea 2).`);
    }
  }

  await prisma.$transaction(async (tx) => {
    let total = 0;
    for (const tabla of disponibles) {
      const r = await tx[tabla.delegado].updateMany({
        where: { source: 'EXCEL_IMPORT' },
        data: { source: 'MANUAL' },
      });
      console.log(`  ${tabla.etiqueta}: ${r.count}`);
      total += r.count;
    }
    console.log(`\nSe devolverian ${total} fila(s) a MANUAL.`);
    if (!WRITE) throw new Ensayo();
  });
}

(UNDO ? deshacer() : marcar())
  .then(() => {
    if (WRITE) console.log('\nListo: los cambios quedaron escritos.');
  })
  .catch((e) => {
    if (e instanceof Ensayo) {
      console.log('\nENSAYO: no se escribio nada. Corre con --write para aplicarlo.');
      return;
    }
    console.error(`\n${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
