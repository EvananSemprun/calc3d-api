import Decimal from 'decimal.js';
import type { StorePriceTier } from '../schemas/store';

/**
 * Precio unitario tras aplicar el MAYOR tramo cuyo minQty <= qty. Sin tramos
 * aplicables, devuelve `baseUnit`. `compareAtUsd`/Flash Sale no se tocan acá.
 *
 * Las dos formas de tramo se cobran distinto, y la diferencia es lo que pasa con los
 * **recargos de opción** (el "+$1,50 por el tamaño grande"):
 *
 * - **Por porcentaje**: descuenta sobre `baseUnit`, que YA trae los recargos. Es el
 *   comportamiento de siempre y no cambió.
 * - **Por precio fijo**: `unitPriceUsd` reemplaza al precio de LISTA y los recargos se
 *   suman encima (`recargos`). ⚠️ Si reemplazara todo, a partir del tramo el tamaño
 *   grande saldría **gratis** — un agujero de plata silencioso.
 *
 * ⚠️ `recargos` es opcional y vale 0 por defecto, porque hay un llamador que no puede
 * separarlos: el carrito congela `unit` ya sumado al agregar. Hoy eso no cobra de menos
 * —ninguna ficha con tramos tiene recargos— pero el día que una los tenga, ese llamador
 * tiene que pasar la parte del recargo.
 */
export function precioConTramos(
  baseUnit: number,
  qty: number,
  tiers: StorePriceTier[],
  recargos = 0,
): number {
  const aplicable = [...tiers]
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  if (!aplicable) return baseUnit;
  // El precio fijo gana: es lo que el dueño escribió, no una cuenta.
  if (aplicable.unitPriceUsd !== undefined) {
    return new Decimal(aplicable.unitPriceUsd).plus(recargos).toDecimalPlaces(4).toNumber();
  }
  return new Decimal(baseUnit).mul(1 - (aplicable.discountPct ?? 0)).toDecimalPlaces(4).toNumber();
}

/**
 * El descuento de un tramo, en fracción, PARA MOSTRARLO. Nunca para cobrar: lo que se
 * cobra lo decide `precioConTramos`.
 *
 * Con un tramo por precio fijo lo deriva del precio de lista, así el "−17 %" de la
 * vitrina sale solo y no hay un segundo número que mantener de acuerdo con el primero.
 * `null` cuando no se puede calcular (precio de lista en 0): mejor no decir nada que
 * mostrar un porcentaje inventado.
 */
export function descuentoDeTramo(precioLista: number, tramo: StorePriceTier): number | null {
  if (tramo.unitPriceUsd === undefined) return tramo.discountPct ?? null;
  if (!(precioLista > 0)) return null;
  return new Decimal(1).minus(new Decimal(tramo.unitPriceUsd).div(precioLista)).toDecimalPlaces(4).toNumber();
}

/**
 * Los tramos de mayoreo de la CALCULADORA, traducidos a los de una FICHA de
 * tienda (2026-11-07).
 *
 * No es un cast aunque los dos tipos se parezcan: `WholesaleTier` y
 * `StorePriceTier` no aceptan lo mismo, y pasar la lista tal cual hace que el
 * guardado REBOTE con un error de validación. La ficha exige, además de lo que
 * pide la calculadora, que cada tramo empiece **desde 2 unidades**, que las
 * cantidades vayan **estrictamente de menor a mayor** y que no haya más de 8.
 *
 * Qué se cae, y por qué:
 * - `minQty <= minQtyProducto` (1 por defecto): "descuento desde 1 unidad" no
 *   es un tramo, es el precio base. Y el schema de la ficha lo rechaza. El
 *   piso de 1 es el del propio schema: con eso, el `>= 2` que pide la ficha
 *   sale solo y no hace falta repetirlo.
 * - `discountPct <= 0`: un tramo que no descuenta nada solo ensucia la vitrina.
 *   (La calculadora solo habla en porcentajes, así que de acá nunca sale un tramo por
 *   precio fijo: esos se escriben a mano en la ficha.)
 * - Cantidades repetidas: se queda **el de MAYOR descuento**. Si el formulario
 *   dejó dos tramos para la misma cantidad, cobrar de menos por una ambigüedad
 *   es preferible a cobrar de más sin que el dueño lo haya decidido.
 * - Pasados los 8, sobran los de cantidad más alta: los tramos chicos son los
 *   que se usan todos los días.
 *
 * ⚠️ Silencioso a propósito: devuelve lo que SÍ sirve en vez de lanzar. Quien
 * llama está guardando un producto, y volarle el guardado por un tramo de más
 * sería perder el costeo entero por un dato accesorio.
 */
export function tramosParaLaTienda(
  tiers: readonly { minQty: number; discountPct: number }[] | null | undefined,
  minQtyProducto = 1,
): StorePriceTier[] {
  const porCantidad = new Map<number, StorePriceTier>();
  for (const t of tiers ?? []) {
    if (!Number.isInteger(t.minQty)) continue;
    if (t.minQty <= Math.max(1, minQtyProducto)) continue;
    if (!(t.discountPct > 0) || t.discountPct >= 1) continue;
    const previo = porCantidad.get(t.minQty);
    // El ?? 0: de acá solo salen tramos por porcentaje, nunca por precio fijo.
    if (previo && (previo.discountPct ?? 0) >= t.discountPct) continue;
    porCantidad.set(t.minQty, { minQty: t.minQty, discountPct: t.discountPct });
  }
  return [...porCantidad.values()].sort((a, b) => a.minQty - b.minQty).slice(0, 8);
}
