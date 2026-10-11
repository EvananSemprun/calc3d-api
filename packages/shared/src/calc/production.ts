import { daysBetween, isCalendarDay, monthCloseDay } from './stock';

/**
 * MEDICIÓN DE LA PRODUCCIÓN — los tres datos que ni el Excel ni la app tenían.
 *
 * Ninguno se puede migrar: no existen todavía. Lo que arreglan:
 *
 *  - **Horas de máquina**: sin ellas nadie sabe qué tan cerca está cada equipo
 *    de su vida útil, y el costo de desgaste (inversión ÷ vida útil) es un
 *    supuesto que nunca se contrasta. Se llevan como el stock de filamento:
 *    una **lectura del contador de la máquina, una vez por mes**, y NO sumando
 *    las horas de cada pedido. Atarlas a los pedidos dejaría fuera todo lo que
 *    se imprime sin vender —pruebas, calibraciones, regalos, una tanda que
 *    salió mal—, que gasta vida útil exactamente igual.
 *  - **Tasa real de fallos**: la merma del 8 % es un número elegido, no medido.
 *    Con dos meses de pedidos anotados pasa a ser un dato.
 *  - **Mantenimiento cobrado vs gastado**: hay repuestos comprados que hoy no
 *    tocan ningún precio.
 *
 * ⚠️ **Un trabajo sin medir NO es un trabajo perfecto.** Los pedidos donde no se
 * anotó nada se excluyen de las cuentas en vez de contarse como cero horas y
 * cero fallos: contarlos bajaría la tasa real con datos que no existen, que es
 * exactamente la clase de número inventado que esto viene a eliminar.
 */

export interface ProductionJobLike {
  /** Piezas reimpresas por fallo; **0 es un dato**, null es "sin medir". */
  reprints: number | null;
  /** Piezas entregadas del pedido. */
  pieces: number;
}

/**
 * Fracción de la vida útil consumida. **No se recorta en 1**: una máquina puede
 * estar más allá de su vida útil, y esconderlo sería tapar justo el aviso.
 * `null` si el equipo no declara vida útil.
 */
export function lifeUsed(accumulatedHours: number, lifetimeHours: number): number | null {
  if (!(lifetimeHours > 0)) return null;
  return accumulatedHours / lifetimeHours;
}

/**
 * Reimpresiones sobre piezas entregadas. Se expresa así —y no sobre el total
 * impreso— para que sea comparable con `waste.pct` del motor, que es un recargo
 * sobre el costo de lo que sí se entrega.
 */
export function failureRate(reprints: number, pieces: number): number | null {
  if (!(pieces > 0)) return null;
  return reprints / pieces;
}

export interface ProductionStats {
  /** Cuántos trabajos tienen los fallos anotados. Es la confianza del dato. */
  measuredJobs: number;
  /** Piezas de esos trabajos medidos, no de todos. */
  pieces: number;
  reprints: number;
  failureRate: number | null;
}

export function productionStats(jobs: ProductionJobLike[]): ProductionStats {
  const conFallos = jobs.filter((j) => j.reprints != null);
  const pieces = conFallos.reduce((s, j) => s + j.pieces, 0);
  const reprints = conFallos.reduce((s, j) => s + (j.reprints ?? 0), 0);

  return {
    measuredJobs: conFallos.length,
    pieces,
    reprints,
    failureRate: failureRate(reprints, pieces),
  };
}

export interface MaintenanceBalance {
  spent: number;
  charged: number;
  /** Negativo = se gastó más de lo que se cobró. */
  difference: number;
}

/** Lo gastado en repuestos contra lo cobrado por hora de máquina. */
export function maintenanceBalance(
  spent: number,
  maintPerHour: number,
  accumulatedHours: number,
): MaintenanceBalance {
  const charged = round4(maintPerHour * accumulatedHours);
  return { spent: round4(spent), charged, difference: round4(charged - spent) };
}

/**
 * MANTENIMIENTO POR HORA, derivado (hoja Costeo, E28:E30): todo lo gastado en
 * repuestos entre las horas impresas de TODAS las máquinas.
 *
 * Es global y no por máquina porque la mayoría de los repuestos no dicen a cuál
 * fueron. Se deriva y no se escribe a mano: una tarifa fija quedó en cero meses
 * mientras se compraban boquillas y hot ends que no tocaban ningún precio.
 * `null` sin horas leídas — no se sabe, y un cero se leería como "gratis".
 */
export function maintenanceRatePerHour(spent: number, hours: number): number | null {
  if (!(hours > 0)) return null;
  return round6(spent / hours);
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ----- Lecturas del contador de la máquina -----
//
// Igual que el conteo mensual de rollos: se anota lo que MARCA la máquina, no
// lo que uno cree que imprimió. Un mes salteado no rompe nada — la lectura
// siguiente sigue siendo acumulada— pero sí deja sin saber el consumo de ese
// mes, y eso se dice, no se rellena.

export interface PrinterReadingLike {
  /** `AAAA-MM` */
  month: string;
  /** Horas acumuladas que muestra la máquina en ese cierre. */
  hours: number;
}

/** La lectura más reciente. `null` si nunca se anotó ninguna. */
export function latestReading(readings: PrinterReadingLike[]): PrinterReadingLike | null {
  if (!readings.length) return null;
  return readings.reduce((a, b) => (b.month > a.month ? b : a));
}

/**
 * Horas impresas EN ese mes: la lectura del mes menos la del anterior.
 *
 * `null` si falta cualquiera de las dos, con el mismo criterio que el consumo
 * de rollos: sin las dos puntas no se sabe cuánto se gastó, y es preferible
 * decirlo a inventar un número.
 */
export function hoursThisMonth(
  readings: PrinterReadingLike[],
  month: string,
): number | null {
  const actual = readings.find((r) => r.month === month);
  if (!actual) return null;
  const anterior = readings
    .filter((r) => r.month < month)
    .reduce<PrinterReadingLike | null>((a, b) => (!a || b.month > a.month ? b : a), null);
  if (!anterior) return null;
  // Un contador que baja (placa cambiada, lectura mal anotada) no da horas
  // negativas: como consumo, eso no significa nada.
  return Math.max(0, round4(actual.hours - anterior.hours));
}

// ----- El recordatorio de la lectura -----
//
// Hay DOS lecturas desde que existe la pantalla, y las dos son del MISMO mes
// (2026-09, una por máquina, cargadas el 26/09/2026): o sea, un solo acto de
// lectura. El dueño, preguntado derecho, dijo que sí quiere llevar el control
// de horas y que lo que faltó fue acordarse (decisión del 2026-10-10): va el
// recordatorio y la pantalla se queda.

/**
 * CUÁNTOS DÍAS SON "MUCHO" SIN LEER EL CONTADOR.
 *
 * ⚠️ **Es una constante con su razón escrita, no un número suelto en medio de
 * un `if`.** Cómo sale:
 *
 * - La lectura es **mensual** (`@@unique([printerId, month])`) y se anota al
 *   CIERRE del mes: la única que existe es de septiembre y se cargó el 26/09.
 * - Entonces, durante **todo** el mes siguiente la próxima lectura todavía está
 *   a tiempo. Del último día de un mes al último del siguiente hay **31 días**
 *   como máximo, así que cualquier umbral de 31 o menos avisaría con la lectura
 *   legítimamente pendiente — y un aviso que aparece cuando no hay nada que
 *   hacer es el que enseña a ignorar a los otros tres.
 * - Se le suman **4 días de gracia**, porque los números del mes a veces se
 *   cierran en los primeros días del siguiente: el conteo de stock de
 *   septiembre se cerró el **1/10/2026**.
 *
 * Resultado: 31 + 4 = **35**, que cae alrededor del día 4 del mes siguiente al
 * que se saltó. O sea, el aviso aparece cuando se perdió un mes entero de
 * horas, que es exactamente lo que pasó entre septiembre y hoy.
 */
export const DIAS_SIN_LECTURA = 35;

/** Lo que hace falta para redactar el aviso de las lecturas. */
export interface LecturaPendiente {
  /**
   * Mes de la última lectura (`AAAA-MM`), o **`null` si NUNCA se leyó ningún
   * contador**: ahí el aviso no puede decir "pasaron N días desde la última" y
   * tiene que decir otra cosa.
   */
  ultimoMes: string | null;
  /** Días desde el cierre de ese mes; `null` si nunca se leyó. */
  dias: number | null;
}

/** Una máquina, con su última lectura (`null` = nunca se leyó). */
export interface MaquinaConLectura {
  lastReading: { month: string } | null;
}

/**
 * true si hace mucho que no se lee ningún contador, con el detalle para el
 * aviso. `null` cuando no hay nada que hacer.
 *
 * ⚠️ **`hoy` entra como PARÁMETRO** (`'AAAA-MM-DD'`, día local calculado por
 * quien llama): el reloj no se lee adentro, igual que en `cashChainCuts`,
 * `facturasAtrasadas` y `conteoDeStockPendiente`.
 *
 * ⚠️ **Sin impresoras no avisa**: no hay contador que leer.
 *
 * ⚠️ Mira la lectura **MÁS RECIENTE de todas las máquinas**, que es lo que mide
 * el hábito. Las máquinas sin lectura propia se cuentan aparte
 * (`printersWithoutReading`, en la pantalla de Producción): si una sola máquina
 * sin leer volviera el aviso "nunca", diría que el hábito no existe cuando sí.
 */
export function lecturaDeHorasPendiente(
  maquinas: MaquinaConLectura[],
  hoy: string,
): LecturaPendiente | null {
  if (!isCalendarDay(hoy)) {
    throw new Error(`Hoy inválido: "${hoy}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }
  if (maquinas.length === 0) return null;

  const meses = maquinas
    .map((m) => m.lastReading?.month)
    .filter((mes): mes is string => !!mes);
  // ⚠️ Valida CADA mes antes de compararlos: `latestReading` compara TEXTO, y
  // un `'2026-13'` ganaría sin avisar — el mismo error que ya mordió en el
  // `?month=` de las lecturas y en `CashBalanceQuerySchema`. `monthCloseDay`
  // lanza si el mes no existe.
  for (const mes of meses) monthCloseDay(mes);
  // La "más reciente" sale de `latestReading`, la misma función que usa la
  // pantalla de Producción: dos definiciones de "la última" divergen.
  const ultima = latestReading(meses.map((month) => ({ month, hours: 0 })));
  // Nunca se leyó ningún contador: hay algo que hacer, pero no hay "última".
  if (!ultima) return { ultimoMes: null, dias: null };

  const dias = daysBetween(monthCloseDay(ultima.month), hoy);
  if (dias < DIAS_SIN_LECTURA) return null;
  return { ultimoMes: ultima.month, dias };
}
