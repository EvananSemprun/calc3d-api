import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

/**
 * Las dos comprobaciones que comparten unir filamentos y unir insumos, ANTES de
 * mirar nada más. Van aparte para que las dos puertas contesten lo mismo.
 */
export function exigirFichasDistintas(origenId: string, destinoId: string): void {
  if (origenId === destinoId) throw new BadRequestException('No puedes unir una ficha consigo misma');
}

/**
 * ⚠️ Las DOS tienen que ser de la organización. Se busca de a las dos con el
 * filtro de organización y se exige encontrar ambas: con el id de una ficha
 * ajena la unión no encuentra nada que repuntar ni que borrar, y responde lo
 * mismo que si no existiera (no revela que existe en otra organización).
 */
export function exigirAmbasPropias<T extends { id: string }>(
  encontradas: T[],
  origenId: string,
  destinoId: string,
  mensaje: string,
): { origen: T; destino: T } {
  const origen = encontradas.find((f) => f.id === origenId);
  const destino = encontradas.find((f) => f.id === destinoId);
  if (!origen || !destino) throw new NotFoundException(mensaje);
  return { origen, destino };
}

const lc = (s?: string | null) => (s ?? '').trim().toLowerCase();

/**
 * Renombra en el costeo guardado de una ficha de tienda la línea que usa la ficha
 * de origen, para que el recosteo (que busca POR NOMBRE) encuentre la destino.
 *
 * ⚠️ Cambia SOLO el nombre: el costo congelado de la línea (`unitCost`,
 * `rollPrice`) no se toca, igual que ningún monto de una compra. Devuelve el
 * costeo nuevo (o el mismo objeto si no había nada que cambiar) y cuántas líneas
 * tocó. Función pura: no escribe.
 */
export function renombrarEnCosteo(
  input: unknown,
  tipo: 'material' | 'insumo',
  nombreOrigen: string,
  nombreDestino: string,
): { input: unknown; cambios: number } {
  if (!input || typeof input !== 'object' || lc(nombreOrigen) === lc(nombreDestino)) return { input, cambios: 0 };
  const calc = input as { filament?: { name?: string }; supplies?: { name?: string }[] };
  if (tipo === 'material') {
    if (lc(calc.filament?.name) !== lc(nombreOrigen)) return { input, cambios: 0 };
    return { input: { ...calc, filament: { ...calc.filament, name: nombreDestino } }, cambios: 1 };
  }
  const supplies = calc.supplies ?? [];
  const cambios = supplies.filter((s) => lc(s.name) === lc(nombreOrigen)).length;
  if (cambios === 0) return { input, cambios: 0 };
  return {
    input: { ...calc, supplies: supplies.map((s) => (lc(s.name) === lc(nombreOrigen) ? { ...s, name: nombreDestino } : s)) },
    cambios,
  };
}

/**
 * updateMany/deleteMany NO lanzan si no afectan filas: devuelven count: 0.
 * Las escrituras de una unión llevan la organización en el where (segunda capa
 * junto a la lectura acotada: la misma regla que setStatusBatch), y por eso hay que
 * MIRAR el conteo: una unión que movió 0 filas no puede seguir de largo como éxito.
 * Lanza DENTRO de la transacción, así que revierte todo.
 */
export function exigirAfectadas(resultado: { count: number }, esperadas: number, que: string): void {
  if (resultado.count !== esperadas) {
    throw new InternalServerErrorException(
      `La unión no pudo escribir ${que} (afectó ${resultado.count} de ${esperadas}): no se unió nada`,
    );
  }
}
