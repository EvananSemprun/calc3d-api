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
    if (previo && previo.discountPct >= t.discountPct) continue;
    porCantidad.set(t.minQty, { minQty: t.minQty, discountPct: t.discountPct });
  }
  return [...porCantidad.values()].sort((a, b) => a.minQty - b.minQty).slice(0, 8);
}
