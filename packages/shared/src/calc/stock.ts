import type { MaterialStatus, StockCountParts } from '../schemas/stock';

/**
 * CONTROL DE FILAMENTO — las cuentas de las hojas "Inventario" (compras) y
 * "Stock mensual" (conteo físico) del Excel de Banano Lab.
 *
 * Son enteros y divisiones simples: no hace falta decimal.js acá. El dinero de
 * las compras ya viene calculado en USD base desde el gasto.
 */

/** Rollos que hay: las tres casillas del conteo sumadas. */
export function stockTotal(c: StockCountParts): number {
  return c.sealed + c.inUse + c.running;
}

/**
 * Rollos consumidos en el mes: los que había, más los que entraron, menos los
 * que quedaron.
 *
 * La hoja solo resta los dos totales (`prev − curr`), y por eso un mes con
 * compras le da un "consumo" negativo. Contando lo comprado, el número vuelve a
 * significar lo que dice su nombre.
 *
 * Devuelve `null` si falta alguno de los dos conteos: sin contar un mes no se
 * puede saber cuánto se gastó, y es preferible decir "sin dato" a inventarlo.
 */
export function monthConsumption(
  prevTotal: number | null,
  currentTotal: number | null,
  purchasedInMonth = 0,
): number | null {
  if (prevTotal == null || currentTotal == null) return null;
  const consumed = prevTotal + purchasedInMonth - currentTotal;
  // Un conteo mal cargado daría negativo; como consumo, eso no significa nada.
  return Math.max(0, consumed);
}

/** Lo que costó cada rollo de una compra. */
export function purchaseCostPerRoll(amount: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return amount / quantity;
}

/**
 * Lo que costó el gramo. Usa los gramos REALES del rollo: la hoja divide entre
 * 1000 fijo, lo que miente en cuanto un rollo no es de 1 kg.
 */
export function purchaseCostPerGram(costPerRoll: number, rollGrams: number): number {
  if (rollGrams <= 0) return 0;
  return costPerRoll / rollGrams;
}

/**
 * Si hay que reponer ese filamento:
 * - `OUT`: no queda ninguno (rojo en la hoja).
 * - `LOW`: hay alguno por acabarse (naranja en la hoja).
 * - `OK`: hay stock sano.
 * - `IGNORED`: color descontinuado; no entra en la lista de compras aunque esté
 *   en cero (regla 3 de la hoja).
 *
 * `null` cuando ese mes no se contó: sin conteo no se sabe.
 */
export type RestockStatus = 'OUT' | 'LOW' | 'OK' | 'IGNORED';

export function restockStatus(
  material: { status: MaterialStatus },
  count: StockCountParts | null,
): RestockStatus | null {
  if (material.status === 'DISCONTINUED') return 'IGNORED';
  if (!count) return null;
  if (stockTotal(count) === 0) return 'OUT';
  if (count.running > 0) return 'LOW';
  return 'OK';
}

// ----- Reposición por COLOR -----
//
// La marca cambia de un mes a otro (este mes Creality, el otro Bambu Lab): lo
// que se maneja en el estante es el TIPO + COLOR. Decisión del dueño,
// 2026-09-13. La hoja del Excel ya contaba así, por eso muchas fichas de una
// segunda marca nunca tuvieron conteo propio.

/** Una ficha de filamento, con lo que necesita la reposición. */
export interface RestockMaterial {
  id: string;
  type: string | null;
  color: string | null;
  brand: string | null;
  status: MaterialStatus;
}

/**
 * - `OUT`: no queda ningún rollo de ese color, de ninguna marca.
 * - `LOW`: hay alguno por acabarse.
 * - `SUGGEST`: de los colores que MÁS se compran (más rollos que el promedio
 *   por color) y queda 1 rollo o menos: conviene tener otro antes de quedarse
 *   sin el que más se usa.
 */
export type RestockGroupStatus = 'OUT' | 'LOW' | 'SUGGEST';

export interface RestockGroup {
  /** `tipo|color` normalizado */
  key: string;
  /** "PLA Negro" */
  label: string;
  status: RestockGroupStatus;
  /** rollos que quedan, sumando todas las marcas */
  total: number;
  running: number;
  /** rollos comprados de ese color hasta el cierre del mes */
  purchased: number;
  brands: string[];
}

export interface RestockByColor {
  /** solo los que hay que comprar, de más comprado a menos */
  groups: RestockGroup[];
  /** colores contados ese mes: todos si el mes tiene algún conteo, ninguno si no */
  countedColors: number;
  /** colores que se siguen reponiendo (no todos sus fichas descontinuadas) */
  totalColors: number;
  /** rollos comprados por color, en promedio: el umbral de "los que más se compran" */
  averagePurchased: number;
}

const normalizar = (s: string | null) => (s ?? '').trim().toLowerCase();

/**
 * Agrupa las fichas por tipo + color y decide qué comprar.
 *
 * - Como en el Excel, si el mes se contó (hay al menos un conteo), un color o
 *   una marca sin nada marcado es CERO: no hay. Decisión del dueño, 2026-09-13.
 *   Solo un mes sin NINGÚN conteo es "sin dato": sin eso, al abrir un mes nuevo
 *   todos los colores saldrían "sin rollos".
 * - Un color con TODAS sus fichas descontinuadas no cuenta ni se pide; si solo
 *   una marca está descontinuada, el color se sigue reponiendo.
 * - "Los que más se compran" sale de las compras de la cuenta, no de un número
 *   fijo: los que superan el promedio de rollos por color.
 */
export function restockByColor(
  materials: RestockMaterial[],
  counts: Record<string, StockCountParts | undefined>,
  purchased: Record<string, number | undefined>,
): RestockByColor {
  const grupos = new Map<string, { label: string; fichas: RestockMaterial[] }>();
  for (const m of materials) {
    const key = `${normalizar(m.type)}|${normalizar(m.color)}`;
    const grupo = grupos.get(key);
    if (grupo) {
      grupo.fichas.push(m);
    } else {
      const label =
        [m.type, m.color]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join(' ') || 'Sin tipo ni color';
      grupos.set(key, { label, fichas: [m] });
    }
  }

  const mesContado = Object.values(counts).some((c) => !!c);

  const filas = [...grupos.entries()]
    .filter(([, g]) => g.fichas.some((m) => m.status !== 'DISCONTINUED'))
    .map(([key, g]) => {
      const conteos = g.fichas
        .map((m) => counts[m.id])
        .filter((c): c is StockCountParts => !!c);
      const suma = conteos.reduce(
        (a, c) => ({ sealed: a.sealed + c.sealed, inUse: a.inUse + c.inUse, running: a.running + c.running }),
        { sealed: 0, inUse: 0, running: 0 },
      );
      return {
        key,
        label: g.label,
        // Casillas vacías = no hay: lo que no se marcó en un mes contado suma cero.
        counted: mesContado,
        total: stockTotal(suma),
        running: suma.running,
        purchased: g.fichas.reduce((s, m) => s + (purchased[m.id] ?? 0), 0),
        brands: [...new Set(g.fichas.map((m) => m.brand?.trim()).filter((b): b is string => !!b))],
      };
    });

  const averagePurchased = filas.length
    ? filas.reduce((s, f) => s + f.purchased, 0) / filas.length
    : 0;

  const groups: RestockGroup[] = [];
  for (const f of filas) {
    if (!f.counted) continue;
    let status: RestockGroupStatus | null = null;
    if (f.total === 0) status = 'OUT';
    else if (f.running > 0) status = 'LOW';
    else if (f.purchased > averagePurchased && f.total <= 1) status = 'SUGGEST';
    if (!status) continue;
    groups.push({
      key: f.key,
      label: f.label,
      status,
      total: f.total,
      running: f.running,
      purchased: f.purchased,
      brands: f.brands,
    });
  }
  groups.sort((a, b) => b.purchased - a.purchased || a.label.localeCompare(b.label, 'es'));

  return {
    groups,
    countedColors: filas.filter((f) => f.counted).length,
    totalColors: filas.length,
    averagePurchased,
  };
}

// ----- El mes del conteo -----
//
// Se guarda como el primer día del mes a medianoche UTC, igual que
// `deliveryDate`. Las conversiones van acá y no sueltas en cada pantalla: en
// este proyecto ya hubo un bug por formatear una fecha UTC en la zona local,
// que imprimía el día anterior.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `'2026-08'` → el 1 de agosto de 2026 a medianoche UTC. */
export function monthStart(month: string): Date {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Mes inválido: "${month}". Se espera AAAA-MM (ej. 2026-08).`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/** Una fecha → `'2026-08'`, leyendo el mes en UTC. */
export function monthKey(date: Date): string {
  const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mes}`;
}

/** El mes anterior, para comparar dos conteos. */
export function previousMonth(month: string): string {
  const d = monthStart(month);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthKey(d);
}

// ----- Cierre de mes -----
//
// "El último día del mes" se decide en la zona horaria del negocio. El servidor
// corre en UTC y Venezuela está en UTC−4: comparar en UTC dejaría cerrar agosto
// desde las 20:00 del 30. Es el mismo error que ya rompió el calendario del panel.

/** Zona horaria del negocio (Banano Lab, Venezuela). */
export const BUSINESS_TIME_ZONE = 'America/Caracas';

/** La fecha de HOY en la zona del negocio, como `'AAAA-MM-DD'`. */
export function businessDateKey(now: Date, timeZone = BUSINESS_TIME_ZONE): string {
  // Se arma con las PARTES y no con el texto formateado: el patrón de un locale
  // puede cambiar entre motores y versiones, y una fecha con otro orden
  // compararía mal como texto sin avisar.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valor = (tipo: 'year' | 'month' | 'day') => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** Último día del mes, como `'AAAA-MM-DD'`: desde ese día se puede cerrar. */
export function monthCloseDay(month: string): string {
  const inicio = monthStart(month);
  const ultimo = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
  return ultimo.toISOString().slice(0, 10);
}

/**
 * true si el mes ya se puede cerrar: hoy, en la zona del negocio, es su último
 * día o después. Sin límite hacia adelante (decisión del dueño): si se pasó el
 * día, el mes se cierra igual.
 */
export function canCloseMonth(month: string, now: Date, timeZone = BUSINESS_TIME_ZONE): boolean {
  return businessDateKey(now, timeZone) >= monthCloseDay(month);
}
