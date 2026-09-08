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

const round4 = (n: number) => Math.round(n * 10000) / 10000;

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
