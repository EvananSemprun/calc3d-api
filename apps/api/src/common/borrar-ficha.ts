import { ConflictException } from '@nestjs/common';
import { ofreceDescontinuar, type MaterialStatus } from '@calc3d/shared';

const lc = (s?: string | null) => (s ?? '').trim().toLowerCase();

/**
 * ¿El costeo guardado de un producto usa esta ficha? El costeo la guarda POR
 * NOMBRE dentro del JSON (no hay clave foránea), igual que `renombrarEnCosteo`: por
 * eso borrar una ficha deja líneas «sin encontrar» con el precio viejo, y por eso
 * hay que buscarlas a mano antes de borrar.
 */
export function costeoUsaFicha(input: unknown, tipo: 'material' | 'insumo', nombre: string): boolean {
  if (!input || typeof input !== 'object') return false;
  const calc = input as { filament?: { name?: string }; supplies?: { name?: string }[] };
  if (tipo === 'material') return lc(calc.filament?.name) === lc(nombre);
  return (calc.supplies ?? []).some((s) => lc(s.name) === lc(nombre));
}

export interface HistorialDeFicha {
  compras: number;
  lineasDeFactura: number;
  /** Solo filamentos: los insumos no se cuentan por rollos. */
  conteos: number;
  /** Nombres de los productos de la tienda cuyo costeo la usa. */
  productos: string[];
}

export const tieneHistorial = (h: HistorialDeFicha) =>
  h.compras + h.lineasDeFactura + h.conteos + h.productos.length > 0;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** Hasta 5 nombres y el resto contado: una lista de 40 no se lee en un aviso. */
const nombres = (lista: string[]) =>
  lista.length <= 5
    ? lista.map((n) => `«${n}»`).join(', ')
    : `${lista.slice(0, 5).map((n) => `«${n}»`).join(', ')} y ${lista.length - 5} más`;

/**
 * El 409 de borrar una ficha con historial. Dice CUÁNTAS cosas la usan y CUÁLES
 * productos, y sobre todo ofrece la SALIDA con las palabras de los botones que el
 * dueño ve: un rechazo que solo se niega, o que manda a una puerta que no existe,
 * es peor que no tener mensaje.
 *
 * ⚠️ Las salidas NO son las mismas para los dos tipos, y por eso se pasan según lo
 * que de verdad existe:
 * - Filamento: «Descontinuar» solo si su estado actual la ofrece (`ofreceDescontinuar`:
 *   una ya descontinuada no tiene esa acción), y «Unir con otra ficha…».
 * - Insumo: NO tiene estado, así que «Descontinuar» no existe. La única salida es
 *   «Unir con otro insumo», y solo sirve si hay un duplicado: si no, se conserva.
 */
export function rechazoDeBorrado(
  ficha: { nombre: string; tipo: 'material'; estado: MaterialStatus } | { nombre: string; tipo: 'insumo' },
  h: HistorialDeFicha,
): ConflictException {
  const partes = [
    h.compras > 0 && plural(h.compras, 'compra', 'compras'),
    h.lineasDeFactura > 0 && plural(h.lineasDeFactura, 'línea de factura', 'líneas de factura'),
    h.conteos > 0 && plural(h.conteos, 'conteo de rollos', 'conteos de rollos'),
  ].filter((p): p is string => !!p);
  const usadaPor =
    h.productos.length > 0
      ? `${ficha.tipo === 'insumo' ? 'lo' : 'la'} usa${h.productos.length === 1 ? '' : 'n'} ${plural(h.productos.length, 'producto de la tienda', 'productos de la tienda')} (${nombres(h.productos)})`
      : null;
  const que = [partes.length > 0 ? `tiene ${partes.join(', ')}` : null, usadaPor].filter(Boolean).join(' y ');

  let salida: string;
  if (ficha.tipo === 'insumo') {
    salida =
      'Un insumo no se descontinúa. Si es un duplicado de otro, ábrelo con «Unir con otro insumo»: pasa todo al otro y se borra este. Si no lo es, se conserva.';
  } else if (ofreceDescontinuar(ficha.estado)) {
    salida =
      'Ábrela y usa «Descontinuar»: sale de circulación y conserva todo. Si es un duplicado de otra ficha, usa «Unir con otra ficha…».';
  } else {
    salida =
      'Ya está descontinuada, así que se conserva fuera de circulación. Si es un duplicado de otra ficha, ábrela y usa «Unir con otra ficha…».';
  }
  return new ConflictException(`No se puede borrar «${ficha.nombre}»: ${que}. ${ficha.tipo === 'insumo' ? 'Borrarlo' : 'Borrarla'} dejaría ese historial sin ficha. ${salida}`);
}
