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
 *   # suma grupos sin marca que el dueño ya confirmó que son del Excel:
 *   node --env-file=.env prisma/backfill-importado.mjs --incluir=Expense:2026-09-07,LoanPayment:2026-09-07
 *
 * `--commit` es sinónimo de `--write` (es la bandera que usa `backfill-caja.mjs`;
 * que dos scripts hermanos pidieran banderas distintas hacía que la corrida
 * "real" saliera en ensayo y se leyera como éxito).
 *
 * ⚠️ CORRERLO SIEMPRE PRIMERO EN ENSAYO. El ensayo abre la transacción, aplica
 * los cambios y la revierte, así que los números que imprime son los reales.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CRITERIO ES LA MARCA TEXTUAL, NO LA FECHA.
 *
 * ⚠️ Hubo una versión anterior que marcaba por `createdAt < 2026-09-27`, con
 * una lista de "días de importación" y un guard que abortaba ante un día
 * inesperado. **Ese criterio era falso y está derogado.** La importación no fue
 * un evento de uno o dos días: un `sincronizar-excel.mjs` (borrado del árbol el
 * 2026-10-04, cuando se decidió dejar de sincronizar) estuvo escribiendo a
 * cuentagotas durante semanas. La prueba: en la copia local hay **2 ventas
 * creadas el 2026-10-01** cuya nota dice "Mostrador — Lunes (del Excel, hoja
 * Ventas)". Con cualquier corte por fecha quedaban como cargadas a mano.
 *
 * No volver a poner un corte por fecha: la fecha es una aproximación a "esto
 * salió del libro" y la marca es la cosa misma. Lo único que sobrevive de
 * aquella versión es agrupar por día **en hora de Caracas** (ver `dia`), que
 * acá ya no decide nada: solo ordena el informe de revisión.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { createRequire } from 'node:module';
import { PrismaClient, Prisma } from '@prisma/client';

// Un .mjs no puede importar el build ESM de shared (usa imports sin extensión).
const require = createRequire(import.meta.url);
const { businessDateKey, BUSINESS_TIME_ZONE } = require('@calc3d/shared');

const WRITE = process.argv.includes('--write') || process.argv.includes('--commit');

// Los 5 s por defecto de Prisma alcanzan contra la base local, pero NO contra
// Railway, que esta por internet: el ensayo (que abre la transaccion, aplica y
// revierte) se corta a mitad de camino con 'Transaction already closed'.
const TX = { timeout: 120_000, maxWait: 30_000 };
const UNDO = process.argv.includes('--undo');

/** Los grupos sin marca que el dueño ya confirmó, como `Modelo:AAAA-MM-DD`. */
const INCLUIR = process.argv
  .filter((a) => a.startsWith('--incluir='))
  .flatMap((a) => a.slice('--incluir='.length).split(','))
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * La huella que dejó la importación en el texto de cada fila. Es precisa: para
 * que marque algo que cargó el dueño, él tendría que haber tipeado esta frase.
 *
 * ⚠️ VA SIN EL PARÉNTESIS DE APERTURA, A PROPÓSITO. Los importadores dejaron
 * DOS redacciones distintas y las dos son del libro:
 *   · `"… (del Excel)"` / `"… (del Excel, hoja Ventas)"` / `"… (del Excel,
 *     fecha real no registrada)"`  → 20 gastos, 122 ventas, 21 abonos
 *   · `"… — histórica del Excel, fecha real no registrada"`, sin paréntesis
 *     → 48 gastos
 * Exigir `'(del excel'` dejaba esas 48 afuera aunque el propio dato dice que
 * son históricas del libro. Verificado el 2026-10-05 contra la copia local:
 * no existe una TERCERA redacción (cero filas que mencionen "excel", "hoja" o
 * "histórica" de otra forma en las cuatro tablas), así que no hace falta una
 * lista de variantes. **No le agregues el paréntesis "para que sea más
 * preciso": lo vuelve a romper.**
 */
const MARCA = 'del excel';
const tieneMarca = (texto) => (texto ?? '').toLowerCase().includes(MARCA);

/**
 * El día de creación en la zona del negocio, nunca en UTC. Solo agrupa el
 * informe, pero agrupar en UTC partiría en dos un lote cargado de noche: el
 * servidor corre en UTC y Venezuela está en UTC−4. Se reusa `businessDateKey`
 * de shared, el helper canónico del repo (`stock.ts`).
 */
const dia = (d) => businessDateKey(d);

/**
 * Las cuatro tablas que llenó la importación, con el campo de texto donde
 * dejó su marca y el campo del monto.
 *
 * ⚠️ `OwnerMovement` queda EXCLUIDO A PROPÓSITO, y ahora el motivo se apoya en
 * la marca: el único que existe es el cuadre manual del 17/09 ("Dinero de la
 * caja usado por … (regularizacion)", $475,14), y su concepto **no lleva la
 * marca del Excel** porque no salió del libro — lo escribió la APP durante la
 * feature de Caja. Marcarlo "Importado" sería mentir sobre el origen de un
 * movimiento de dinero, que es justamente lo que la insignia existe para
 * evitar. Tampoco entra `CashReconciliation`: sus filas heredadas ya quedaron
 * en `MIGRATION` con el backfill de la fase 1.
 */
const TABLAS = [
  { modelo: 'Expense', delegado: 'expense', etiqueta: 'Gastos', texto: 'description' },
  {
    modelo: 'LoanPayment',
    delegado: 'loanPayment',
    etiqueta: 'Cuotas del prestamo',
    texto: 'reference',
  },
  { modelo: 'Sale', delegado: 'sale', etiqueta: 'Ventas', texto: 'note' },
  { modelo: 'Payment', delegado: 'payment', etiqueta: 'Abonos de pedidos', texto: 'note' },
];

const prisma = new PrismaClient();

/** ENSAYO no es un fallo: se usa para revertir la transacción sin ensuciar la salida. */
class Ensayo extends Error {}

/**
 * ¿El cliente de Prisma generado conoce este campo?
 *
 * `Sale.source` y `Payment.source` los agrega la tarea 2 de esta misma fase. Si
 * todavía no corrió, el script tiene que AVISARLO y seguir con las tablas que
 * sí existen, en vez de reventar con un error de Prisma que no explica nada.
 */
const tieneCampo = (modelo, campo) =>
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === modelo)
    ?.fields.some((f) => f.name === campo) ?? false;

const plata = (n) => `$${n.toFixed(2).padStart(10)}`;
const sumar = (filas) => filas.reduce((s, f) => s + Number(f.monto), 0);

/** Agrupa por día de creación, ordenado por día. */
const porDia = (filas) => {
  const mapa = new Map();
  for (const f of filas) {
    const k = dia(f.createdAt);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(f);
  }
  return [...mapa.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
};

/** Lee una tabla y parte sus filas en: con marca, sin marca, y las que no se tocan. */
async function leer(tabla) {
  const filas = await prisma[tabla.delegado].findMany({
    select: { id: true, createdAt: true, source: true, amount: true, [tabla.texto]: true },
  });
  const normal = filas.map((f) => ({
    id: f.id,
    createdAt: f.createdAt,
    source: f.source,
    monto: f.amount,
    texto: f[tabla.texto],
  }));

  // Lo que ya tiene otro origen (MIGRATION / RECONCILIATION) no se pisa: ese
  // dato también dice de dónde salió la fila, y sobreescribirlo seria otra
  // mentira, nada más que al revés. Lo ya marcado se saltea: idempotencia.
  const tocables = normal.filter((f) => f.source === 'MANUAL');
  const ajenas = normal.filter((f) => f.source !== 'MANUAL' && f.source !== 'EXCEL_IMPORT');

  return {
    tabla,
    conMarca: tocables.filter((f) => tieneMarca(f.texto)),
    sinMarca: tocables.filter((f) => !tieneMarca(f.texto)),
    yaMarcadas: normal.filter((f) => f.source === 'EXCEL_IMPORT').length,
    ajenas,
  };
}

function informeAutomatico(lecturas) {
  console.log('\n===== 1) CON LA MARCA DEL EXCEL — se marcan solas =====');
  let total = 0;
  for (const l of lecturas) {
    console.log(`\n${l.tabla.etiqueta} (${l.tabla.modelo}) — campo \`${l.tabla.texto}\``);
    if (l.conMarca.length === 0) {
      console.log('  (ninguna)');
    } else {
      for (const [d, filas] of porDia(l.conMarca)) {
        console.log(`    ${d}   ${String(filas.length).padStart(4)}   ${plata(sumar(filas))}`);
      }
      console.log(
        `    ${'total'.padEnd(10)}   ${String(l.conMarca.length).padStart(4)}   ${plata(sumar(l.conMarca))}`,
      );
    }
    if (l.yaMarcadas > 0) console.log(`  (${l.yaMarcadas} ya estaban en EXCEL_IMPORT)`);
    if (l.ajenas.length > 0) {
      const origenes = [...new Set(l.ajenas.map((f) => f.source))].join(', ');
      console.log(`  ⚠️ ${l.ajenas.length} con otro origen (${origenes}): NO se tocan.`);
    }
    total += l.conMarca.length;
  }
  console.log(`\nSubtotal automatico: ${total} fila(s).`);
}

/** Los grupos `Modelo:dia` sin marca, que NO se marcan salvo que los pidan. */
function gruposSinMarca(lecturas) {
  const grupos = new Map();
  for (const l of lecturas) {
    for (const [d, filas] of porDia(l.sinMarca)) {
      grupos.set(`${l.tabla.modelo}:${d}`, { tabla: l.tabla, dia: d, filas });
    }
  }
  return grupos;
}

function informeRevision(grupos) {
  console.log('\n===== 2) SIN LA MARCA — para revisar con el dueño =====');
  if (grupos.size === 0) {
    console.log('\nNo quedo ninguna fila sin marca. Nada que revisar.');
    return;
  }
  console.log(
    '\nEstos grupos NO se marcan. El que el dueño confirme que vino del Excel se suma\n' +
      'pasando su clave en --incluir=<Modelo:AAAA-MM-DD>, separadas por coma.\n',
  );
  for (const [clave, g] of grupos) {
    const elegido = INCLUIR.includes(clave);
    console.log(
      `  [${elegido ? 'x' : ' '}] ${clave.padEnd(26)} ${String(g.filas.length).padStart(4)} fila(s)   ` +
        `${plata(sumar(g.filas))}${elegido ? '   <- incluido por --incluir' : ''}`,
    );
    for (const f of g.filas.slice(0, 3)) {
      const t = (f.texto ?? '(sin texto)').replace(/\s+/g, ' ');
      console.log(`        · ${t.length > 86 ? `${t.slice(0, 86)}…` : t}`);
    }
    if (g.filas.length > 3) console.log(`        … y ${g.filas.length - 3} mas`);
  }
}

async function marcar() {
  console.log(`Criterio: la marca «${MARCA}» en el texto de la fila. NO se usa la fecha.`);
  console.log(`Los dias del informe se calculan en hora de ${BUSINESS_TIME_ZONE}.`);
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

  const lecturas = [];
  for (const tabla of disponibles) lecturas.push(await leer(tabla));

  informeAutomatico(lecturas);
  const grupos = gruposSinMarca(lecturas);
  informeRevision(grupos);

  // Un grupo pedido que no existe se ABORTA. Ignorarlo marcaría de menos en
  // silencio: el dueño creería que confirmó algo que nunca se tocó (un día mal
  // tipeado, un modelo en minúscula, una clave de otra base).
  const desconocidos = INCLUIR.filter((c) => !grupos.has(c));
  if (desconocidos.length > 0) {
    throw new Error(
      `--incluir nombra grupo(s) que no existen en esta base: ${desconocidos.join(', ')}. ` +
        'Revisá la lista de arriba (las claves son sensibles a mayusculas). No se escribe nada.',
    );
  }

  // El trabajo final: lo automático + lo confirmado, por tabla y por ids ya
  // leídos. La escritura no vuelve a evaluar ningún criterio.
  const trabajo = disponibles.map((tabla) => {
    const l = lecturas.find((x) => x.tabla === tabla);
    const extra = [...grupos]
      .filter(([clave, g]) => INCLUIR.includes(clave) && g.tabla === tabla)
      .flatMap(([, g]) => g.filas);
    return { tabla, ids: [...l.conMarca, ...extra].map((f) => f.id) };
  });
  const total = trabajo.reduce((s, t) => s + t.ids.length, 0);

  const confirmados = total - lecturas.reduce((s, l) => s + l.conMarca.length, 0);
  console.log(
    `\nSe marcarian ${total} fila(s) como EXCEL_IMPORT ` +
      `(${total - confirmados} por la marca + ${confirmados} confirmadas con --incluir).`,
  );
  if (total === 0) {
    console.log('Nada que hacer.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    let escritas = 0;
    for (const { tabla, ids } of trabajo) {
      if (ids.length === 0) continue;
      const r = await tx[tabla.delegado].updateMany({
        where: { id: { in: ids }, source: 'MANUAL' },
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
  }, TX);
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
  }, TX);
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
