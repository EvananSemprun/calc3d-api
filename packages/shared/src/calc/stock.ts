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
