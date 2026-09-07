/**
 * MEDICIÓN DE LA PRODUCCIÓN — los tres datos que ni el Excel ni la app tenían.
 *
 * Ninguno se puede migrar: no existen todavía. Lo que arreglan:
 *
 *  - **Horas de máquina**: sin ellas nadie sabe qué tan cerca está cada equipo
 *    de su vida útil, y el costo de desgaste (inversión ÷ vida útil) es un
 *    supuesto que nunca se contrasta.
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
  /** Horas de máquina del trabajo; null si no se midió. */
  machineHours: number | null;
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
  /** Horas de máquina acumuladas (de todos los trabajos que las anotaron). */
  hours: number;
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
    // Las horas se cuentan aparte: se puede saber cuánto imprimió la máquina
    // sin haber contado las reimpresiones.
    hours: round4(jobs.reduce((s, j) => s + (j.machineHours ?? 0), 0)),
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
