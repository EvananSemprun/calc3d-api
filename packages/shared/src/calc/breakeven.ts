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
