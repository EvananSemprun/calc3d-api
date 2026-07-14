import type { PriceResult } from './types';

/**
 * Helpers de selección/lectura de precios, compartidos entre front y back para
 * que la UI, el PDF y las ventas coincidan SIEMPRE en "cuál es el precio
 * sugerido" y "cuánto se cobra realmente" (con diseño/urgencia/mínimo).
 */

/** Precio sugerido: la ganancia elegida si existe, o el tramo del medio (o el último si hay menos). */
export function pickSuggestedPrice(
  prices: PriceResult[],
  selectedRate?: number | null,
): PriceResult | undefined {
  if (!prices.length) return undefined;
  if (selectedRate != null) {
    const match = prices.find((p) => p.marginPct === selectedRate);
    if (match) return match;
  }
  return prices[Math.min(1, prices.length - 1)];
}

/** Precio FINAL por unidad (con diseño/urgencia). Fallback para snapshots pre-Fase-2A. */
export function priceFinalPerUnit(p: PriceResult): number {
  return p.finalPerUnit ?? p.priceRounded;
}

/** Total del pedido a este precio (con extras y piso mínimo). Fallback para snapshots viejos. */
export function priceJobTotal(p: PriceResult, quantity: number): number {
  return p.jobTotal ?? p.priceRounded * quantity;
}

/** true si el precio lleva algún extra (diseño, urgencia o mínimo aplicado). */
export function priceHasSurcharges(p: PriceResult): boolean {
  return !!p.designPerUnit || !!p.rushAmount || !!p.hitMinimum;
}
