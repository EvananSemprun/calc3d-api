import Decimal from 'decimal.js';

/**
 * Helpers PUROS de rentabilidad de un producto del catálogo (Fase 4).
 *
 * Un producto guarda un precio de venta fijado (`priceSet`) y el costo unitario
 * al momento de guardarlo (`costAtSave`). Cuando el costo de los insumos sube
 * (devaluación, recompra más cara), el recosteo trae el costo de HOY (`costNow`)
 * y estos helpers derivan si el producto sigue dando el margen esperado.
 *
 * Convención de "margen": es el MARKUP sobre el costo (ganancia/costo), coherente
 * con cómo el motor calcula los precios (`markups`). NO es margen sobre el precio.
 */

/** Markup sobre el costo: (precio − costo) / costo. 0 si el costo es ≤ 0. */
export function productMarkup(price: number, cost: number): number {
  if (!(cost > 0)) return 0;
  return new Decimal(price).minus(cost).div(cost).toDecimalPlaces(4).toNumber();
}

/** Variación relativa del costo: (costoHoy − costoAlGuardar) / costoAlGuardar. */
export function costDeltaPct(costAtSave: number, costNow: number): number {
  if (!(costAtSave > 0)) return 0;
  return new Decimal(costNow).minus(costAtSave).div(costAtSave).toDecimalPlaces(4).toNumber();
}

export interface ProductStatus {
  /** Markup con el que se fijó el precio (referencia). */
  markupAtSave: number;
  /** Markup con el costo de HOY (lo que realmente estás ganando). */
  markupNow: number;
  /** Cuánto subió (o bajó) el costo respecto a cuando guardaste. */
  costDeltaPct: number;
  /** true si el markup de hoy cayó por debajo del mínimo aceptable. */
  belowMin: boolean;
}

/**
 * Estado de rentabilidad de un producto: cruza el precio fijado contra el costo
 * de hoy y avisa si el margen cayó por debajo del mínimo configurable.
 *
 * `minMarginPct` es una FRACCIÓN (0.15 = 15 %). La alerta se dispara solo cuando
 * hay costo real (> 0) y el markup de hoy queda por debajo de ese piso.
 */
export function productStatus(
  priceSet: number,
  costAtSave: number,
  costNow: number,
  minMarginPct: number,
): ProductStatus {
  const markupNow = productMarkup(priceSet, costNow);
  return {
    markupAtSave: productMarkup(priceSet, costAtSave),
    markupNow,
    costDeltaPct: costDeltaPct(costAtSave, costNow),
    belowMin: costNow > 0 && markupNow < minMarginPct,
  };
}
