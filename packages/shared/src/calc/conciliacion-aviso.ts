/**
 * ¿ESTE MOVIMIENTO INVALIDA UNA CONCILIACIÓN? (2026-11-12, fase B tarea 8)
 *
 * El dueño concilia la caja (cuenta la plata real y la compara con la esperada)
 * y después carga un movimiento con fecha anterior. La conciliación queda
 * mintiendo y nadie avisa: una CONFIRMADA congela sus importes y solo muestra
 * `stale` dentro de la fila expandida; una DRAFT no congela nada y **cambia en
 * silencio**. Las dos avisan.
 *
 * ⚠️ **La regla vive acá y no en el servicio**, igual que
 * `anulacionNecesitaConfirmacion`: el panel tiene que poder mostrar la
 * advertencia sin adivinarla, y si el servidor y la pantalla la escribieran
 * por separado, un día dirían cosas distintas.
 *
 * ⚠️ **El esperado es GLOBAL, no por cuenta** (ver `escribir-conciliacion`): un
 * movimiento de cualquier cuenta —o sin cuenta— entra en el esperado de TODA
 * conciliación con fecha igual o posterior. Por eso acá no se mira la cuenta:
 * filtrar por ella dejaría pasar justo los ~100 movimientos históricos que no
 * tienen cuenta.
 *
 * Pura: sin Nest ni base. La consulta de las conciliaciones la hace el servidor.
 */

export type EstadoConciliacionAviso = 'DRAFT' | 'CONFIRMED' | 'VOID';

export interface ConciliacionParaAviso {
  id: string;
  /** Fecha de negocio de la conciliación (el corte del esperado). */
  date: Date | string;
  status: EstadoConciliacionAviso;
}

/**
 * Día `AAAA-MM-DD` de una FECHA DE NEGOCIO.
 *
 * Una `Date` de negocio se guarda a medianoche UTC y ya ES el día elegido: se
 * lee por UTC. Pasarla por la hora de Caracas la correría un día para atrás.
 */
function dia(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d.slice(0, 10);
}

/**
 * Las conciliaciones que un movimiento con esas fechas deja desactualizadas.
 *
 * - Cuenta si la fecha es **igual o anterior** a la de la conciliación: el
 *   esperado se corta con `<=`, así que el mismo día entra.
 * - Una fecha POSTERIOR no pide nada: queda fuera del esperado.
 * - Una conciliación ANULADA ya no habla de la caja de nadie.
 * - `fechas` es una lista porque EDITAR mueve un movimiento: lo que sale de
 *   su día viejo y lo que entra en el nuevo cambian ambos esperados.
 */
export function conciliacionesQueSeInvalidan(
  fechas: ReadonlyArray<Date | string>,
  conciliaciones: ReadonlyArray<ConciliacionParaAviso>,
): ConciliacionParaAviso[] {
  const dias = fechas.map(dia);
  return conciliaciones.filter(
    (c) => c.status !== 'VOID' && dias.some((d) => d <= dia(c.date)),
  );
}

/** El texto del 400. Dice QUÉ pasó y CÓMO seguir. */
export function mensajeDeConciliacionAfectada(
  afectadas: ReadonlyArray<ConciliacionParaAviso>,
): string {
  const lista = afectadas
    .map(
      (c) =>
        `${dia(c.date)} (${c.status === 'CONFIRMED' ? 'confirmada' : 'borrador'})`,
    )
    .join(', ');
  const hayConfirmada = afectadas.some((c) => c.status === 'CONFIRMED');
  const hayBorrador = afectadas.some((c) => c.status === 'DRAFT');
  const efectos = [
    hayConfirmada ? 'una confirmada quedará desactualizada' : null,
    hayBorrador ? 'un borrador cambiará su esperado sin avisar' : null,
  ]
    .filter(Boolean)
    .join(' y ');
  return (
    `Este movimiento tiene fecha igual o anterior a ${afectadas.length === 1 ? 'una conciliación' : `${afectadas.length} conciliaciones`} de caja: ${lista}. ` +
    `Si lo guardas, ${efectos}. ` +
    'Vuelve a intentarlo confirmando; después anula la conciliación y crea otra para que vuelva a decir la verdad.'
  );
}
