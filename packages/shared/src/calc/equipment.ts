/**
 * REPOSICIÓN DE EQUIPOS — la hoja "Inversion" del Excel.
 *
 * Las impresoras no son gasto: son inversión que el negocio devuelve con su
 * propia ganancia. Esta cuenta responde cuánto de cada máquina ya se pagó sola.
 *
 * El reparto es una **cascada en orden de compra**: la primera se cubre hasta su
 * costo y recién lo que sobra pasa a la siguiente. No se prorratea, porque
 * repartir a medias dejaría a las dos eternamente a medio pagar y ninguna
 * "terminada"; con la cascada se sabe cuál ya se devolvió.
 *
 * La **ganancia acumulada** que entra acá es ingresos menos gastos operativos,
 * SIN contar la inversión en equipos (sería descontar dos veces lo mismo) ni los
 * pagos del préstamo (devolver capital no es un costo; ver `calc/loan.ts`).
 */

export interface EquipmentLike {
  id?: string;
  name: string;
  cost: number;
}

export interface EquipmentRecoveryRow {
  id?: string;
  name: string;
  cost: number;
  recovered: number;
  missing: number;
  /** Fracción del equipo ya devuelta (0..1). Un equipo de costo 0 está cubierto. */
  progress: number;
}

export interface EquipmentRecovery {
  rows: EquipmentRecoveryRow[];
  totalCost: number;
  totalRecovered: number;
  /**
   * Lo que queda después de reponer los equipos. **No se recorta en cero**: si
   * la ganancia acumulada es negativa, el capital libre es ese número en rojo, y
   * esconderlo sería el dato más importante que falta.
   */
  freeCapital: number;
}

export function equipmentRecovery(
  accumulatedProfit: number,
  equipment: EquipmentLike[],
): EquipmentRecovery {
  let disponible = Math.max(0, accumulatedProfit);

  const rows = equipment.map((e) => {
    const cost = Math.max(0, e.cost);
    const recovered = Math.min(disponible, cost);
    disponible -= recovered;
    return {
      id: e.id,
      name: e.name,
      cost,
      recovered,
      missing: cost - recovered,
      progress: cost > 0 ? recovered / cost : 1,
    };
  });

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalRecovered = rows.reduce((s, r) => s + r.recovered, 0);

  return {
    rows,
    totalCost,
    totalRecovered,
    freeCapital: accumulatedProfit - totalRecovered,
  };
}
