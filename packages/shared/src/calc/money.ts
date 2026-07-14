import Decimal from 'decimal.js';
import type { RoundingMode } from '../schemas/calc';

/**
 * Utilidades de dinero. Toda la aritmética del motor usa decimal.js para
 * evitar errores de punto flotante; los números crudos solo se exponen en los
 * bordes (resultado final).
 */

export type Num = Decimal.Value;

export const D = (x: Num): Decimal => new Decimal(x);

/**
 * Precisión interna de las cifras monetarias del resultado: 4 decimales
 * (precisión sub-centavo). NO es un redondeo de presentación —solo evita
 * artefactos de coma flotante como 0.30000000000000004 al serializar.
 */
const MONEY_DP = 4;

/** Convierte un Decimal a número con precisión monetaria estable (4 dp). */
export const toMoney = (d: Decimal): number => d.toDecimalPlaces(MONEY_DP).toNumber();

/** Suma una lista de Decimals. */
export const sum = (values: Decimal[]): Decimal =>
  values.reduce((acc, v) => acc.plus(v), new Decimal(0));

/**
 * Redondeo de PRESENTACIÓN a un incremento (0.5, 1, 5, 10...).
 * NEAREST = al más cercano, UP = hacia arriba, DOWN = hacia abajo.
 */
export const roundToIncrement = (
  value: Decimal,
  mode: RoundingMode,
  increment: Num,
): Decimal => {
  if (mode === 'NONE') return value;
  const inc = new Decimal(increment);
  if (inc.lte(0)) return value;
  const ratio = value.div(inc);
  let steps: Decimal;
  switch (mode) {
    case 'UP':
      steps = ratio.ceil();
      break;
    case 'DOWN':
      steps = ratio.floor();
      break;
    case 'NEAREST':
    default:
      steps = ratio.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      break;
  }
  return steps.times(inc);
};
