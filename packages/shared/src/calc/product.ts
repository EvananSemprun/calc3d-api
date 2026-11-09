import Decimal from 'decimal.js';
import { enUsdt } from './usdt';

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
 *
 * ⚠️ **EL PRECIO Y EL COSTO NO ESTÁN EN LA MISMA MONEDA** (2026-11-08). El costo se
 * calcula en USDT —el dólar real con el que se compra el filamento— pero el precio de
 * la tienda se publica en **dólares BCV**, que valen menos. Dividir uno por el otro
 * infla el margen: un producto a $1,50 BCV con costo $0,22 decía 582 %, cuando en USDT
 * entran $1,32 y el margen real es 498 %. Por eso `productStatus` convierte el precio
 * antes de medir. Ver `conversion` abajo.
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

/**
 * Las dos tasas con las que se traduce el precio publicado a lo que realmente entra.
 *
 * ⚠️ Son las tasas **de HOY**, no las del día que se publicó (decisión del dueño,
 * 2026-11-08). La alerta existe para cazar la erosión del margen, y que la brecha entre
 * el BCV y el Binance se abra ES esa erosión: congelar las tasas la escondería. Lo que
 * se esperaba ganar ya lo dice `markupAtSave`.
 */
export interface MarkupConversion {
  /** Bolívares por dólar BCV (la moneda en la que está puesto el precio). */
  tasaBcv: number;
  /** Bolívares por USDT (el dólar real, con el que se mide el costo). */
  tasaUsdt: number;
}

export interface ProductStatus {
  /**
   * El precio publicado traducido a USDT. Igual a `priceSet` si no hubo conversión.
   * Es lo que de verdad entra por una venta.
   */
  priceUsdt: number;
  /**
   * true si las dos tasas estaban disponibles y se pudo convertir. En false, los
   * márgenes de abajo son NOMINALES y quien los muestre tiene que decirlo: un margen
   * en BCV presentado como "real en USDT" es peor que no mostrar nada.
   */
  converted: boolean;
  /** Markup con el que se fijó el precio (referencia), ya en USDT. */
  markupAtSave: number;
  /** Markup con el costo de HOY y el precio en USDT: lo que realmente estás ganando. */
  markupNow: number;
  /**
   * El mismo markup de hoy pero SIN convertir, o sea contra el precio de etiqueta en
   * BCV. Es el número que la app mostraba hasta el 2026-11-08; se conserva como
   * referencia, nunca como el margen principal.
   */
  markupNominal: number;
  /** Cuánto subió (o bajó) el costo respecto a cuando guardaste. */
  costDeltaPct: number;
  /** true si el markup de hoy (el de USDT) cayó por debajo del mínimo aceptable. */
  belowMin: boolean;
}

/**
 * Estado de rentabilidad de un producto: cruza el precio fijado contra el costo
 * de hoy y avisa si el margen cayó por debajo del mínimo configurable.
 *
 * `minMarginPct` es una FRACCIÓN (0.15 = 15 %). La alerta se dispara solo cuando
 * hay costo real (> 0) y el markup de hoy queda por debajo de ese piso.
 *
 * `conversion` es opcional: sin ella el comportamiento es el de siempre (precio y costo
 * tratados como la misma moneda), que es lo correcto para un negocio sin dos tasas.
 */
export function productStatus(
  priceSet: number,
  costAtSave: number,
  costNow: number,
  minMarginPct: number,
  conversion?: MarkupConversion | null,
): ProductStatus {
  // Si se pidió convertir pero falta una tasa, NO se cae de vuelta al precio nominal en
  // silencio: se marca `converted: false` y quien muestre decide qué decir. Un margen
  // inflado rotulado "real" es justo el error que esto viene a arreglar.
  const convertido = conversion ? enUsdt(priceSet, conversion.tasaBcv, conversion.tasaUsdt) : null;
  const priceUsdt = convertido ?? priceSet;
  const markupNow = productMarkup(priceUsdt, costNow);
  return {
    priceUsdt,
    converted: convertido !== null,
    markupAtSave: productMarkup(priceUsdt, costAtSave),
    markupNow,
    markupNominal: productMarkup(priceSet, costNow),
    costDeltaPct: costDeltaPct(costAtSave, costNow),
    belowMin: costNow > 0 && markupNow < minMarginPct,
  };
}
