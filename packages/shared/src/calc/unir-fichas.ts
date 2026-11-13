import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * UNIR DOS FICHAS DUPLICADAS (13/11): filamentos o insumos.
 *
 * ⚠️ **Unir repunta, no reescribe.** Cada compra pasada pasa a apuntar a la ficha
 * destino; su monto y su fecha NO se tocan. Lo único que se recalcula es el
 * precio de referencia de la ficha que sobrevive, y sale de la ÚLTIMA compra del
 * conjunto unido (la regla que ya existía: «el precio sigue a la última compra
 * por fecha»), no de elegir a mano el de una de las dos fichas.
 */
export const UnirFichaSchema = z.object({ destinoId: z.string().min(1, 'Falta la ficha destino') });
export type UnirFichaDto = z.infer<typeof UnirFichaSchema>;

/**
 * Lo que una unión va a mover (y lo que movió). Lo calcula UNA sola función de la
 * API, la misma para la vista previa y para la unión, así que el número que el
 * dueño confirma es el que se ejecuta.
 *
 * Los costeos de las fichas de la tienda NO apuntan a la ficha por id: llevan su
 * nombre dentro del snapshot y el recosteo la busca POR NOMBRE. Por eso unir
 * también renombra esa línea (solo el nombre: el costo congelado no se toca) y
 * `productos` cuenta cuántas fichas de la tienda se ven afectadas.
 */
export interface UnionVista {
  origen: { id: string; name: string };
  destino: { id: string; name: string };
  /** Compras (gastos) que pasan a la ficha destino. */
  compras: number;
  /** Líneas de factura que piden la ficha de origen y pasan a la destino. */
  lineasDeFactura: number;
  /** Fichas de la tienda cuyo costeo usa la ficha de origen: su línea pasa a llamarse como el destino. */
  productos: number;
  /** Conteos de rollos que pasan al destino (solo filamento; 0 en insumos). */
  conteos: number;
  /** De esos, los de un mes en que las DOS fichas tenían conteo: se suman. */
  conteosQueSeSuman: number;
  /**
   * Costo de referencia: por ROLLO en filamento, por UNIDAD en insumos. `despues`
   * es el de la última compra del conjunto; sin ninguna compra con cantidad, la
   * ficha destino conserva el suyo (`deLaUltimaCompra: false`).
   */
  precio: { antes: number; despues: number; deLaUltimaCompra: boolean };
}

/** Lo que cuesta cada unidad de un insumo. */
export function costoPorUnidadDeInsumo(packagePrice: number, unitsPerPackage: number): number {
  if (unitsPerPackage <= 0) return 0;
  return new Decimal(packagePrice).div(unitsPerPackage).toNumber();
}

/**
 * El precio del PAQUETE que deja una compra, conservando el costo por unidad de
 * esa compra: `monto / cantidad` por unidad, multiplicado por las unidades del
 * paquete de la ficha. Se conserva el tamaño de paquete de la ficha en vez de
 * cambiarlo, porque «unidades por paquete» es lo que el dueño ve y edita.
 * Redondea a 4 decimales: es lo que guarda la base.
 */
export function paquetePrecioDesdeCompra(amount: number, quantity: number, unitsPerPackage: number): number {
  if (quantity <= 0) throw new Error('La compra no tiene unidades: no hay precio por unidad que calcular');
  return new Decimal(amount).mul(unitsPerPackage).div(quantity).toDecimalPlaces(4).toNumber();
}
