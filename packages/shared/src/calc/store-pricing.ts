import Decimal from 'decimal.js';
import type { StorePriceTier } from '../schemas/store';

/**
 * Precio unitario tras aplicar el MAYOR tramo cuyo minQty <= qty. Sin tramos
 * aplicables, devuelve `baseUnit`. El descuento es sobre el unitario que entra
 * (ya con recargos de opción); `compareAtUsd`/Flash Sale no se tocan acá.
 */
export function precioConTramos(baseUnit: number, qty: number, tiers: StorePriceTier[]): number {
  const aplicable = [...tiers]
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  if (!aplicable) return baseUnit;
  return new Decimal(baseUnit).mul(1 - aplicable.discountPct).toDecimalPlaces(4).toNumber();
}
