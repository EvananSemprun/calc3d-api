import type { FixedCost } from '../schemas/api';

/**
 * Punto de equilibrio (análisis de salud del negocio; NO toca el precio por pieza).
 * Equilibrio en INGRESOS = costos fijos mensuales ÷ margen de contribución.
 * Ej.: $500 fijos con 40 % de margen → hay que vender $1250/mes para no perder.
 */

/** Suma de los costos fijos mensuales. */
export function fixedCostsTotal(costs: FixedCost[]): number {
  return costs.reduce((s, c) => s + (Number.isFinite(c.monthlyAmount) ? c.monthlyAmount : 0), 0);
}

/**
 * Ingreso mensual necesario para cubrir los costos fijos, dado un margen de
 * contribución (fracción). Devuelve null si el margen es 0 o inválido (con
 * margen 0 nunca se cubre lo fijo, no hay equilibrio finito).
 */
export function breakEvenRevenue(fixedMonthly: number, marginPct: number): number | null {
  if (!(marginPct > 0)) return null;
  return fixedMonthly / marginPct;
}

/**
 * Progreso hacia el equilibrio en el periodo: fracción de las ventas sobre el
 * ingreso de equilibrio (0..1, recortado a 1). null si no hay equilibrio finito.
 */
export function breakEvenProgress(sales: number, breakEven: number | null): number | null {
  if (breakEven == null || breakEven <= 0) return null;
  return Math.max(0, Math.min(1, sales / breakEven));
}

/**
 * Los TRES niveles de la hoja "Resumen" del Excel. No es lo mismo "no perder
 * dinero" que "poder pagar la cuota" ni que "además reponer los equipos": un
 * solo número esconde que el negocio puede estar en verde y aun así no dar para
 * pagar el préstamo.
 *
 * `loanPayment` se DERIVA de los préstamos abiertos (`monthlyLoanPayments`), no
 * se escribe en Configuración.
 */
export interface BreakEvenLevels {
  /** 1. Cubrir los costos fijos. */
  survive: number | null;
  /** 2. Además, la cuota del préstamo. */
  withDebt: number | null;
  /** 3. Además, la reserva mensual para reponer equipos. */
  withReserve: number | null;
}

export function breakEvenLevels({
  fixedMonthly,
  marginPct,
  loanPayment = 0,
  equipmentReserve = 0,
}: {
  fixedMonthly: number;
  marginPct: number;
  loanPayment?: number;
  equipmentReserve?: number;
}): BreakEvenLevels {
  return {
    survive: breakEvenRevenue(fixedMonthly, marginPct),
    withDebt: breakEvenRevenue(fixedMonthly + loanPayment, marginPct),
    withReserve: breakEvenRevenue(fixedMonthly + loanPayment + equipmentReserve, marginPct),
  };
}
