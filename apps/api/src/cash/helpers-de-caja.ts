import type { ObligationRef, ObligationSource, PayerKind } from '@calc3d/shared';
import type { RecordSource } from '@prisma/client';

/**
 * LOS AYUDANTES DE CAJA: traducciones de la base al motor, sin estado.
 *
 * Salieron de `cash.service.ts` el 2026-10-11, cuando ese archivo pasó las 900
 * líneas (su propia nota pedía partirlo a las 480). **Ninguno toca la base ni
 * guarda nada**: convierten una fila de Prisma en algo que el motor entiende,
 * y por eso se pueden leer —y testear— sin levantar medio Nest.
 *
 * ⚠️ Lo que vive acá NO decide números de plata: eso es del motor
 * (`shared/calc/cash.ts`). Acá solo se traduce. Si alguna función de este
 * archivo empieza a sumar dinero, su lugar es shared, donde los tests la
 * agarran sin mocks.
 */

export const dia = (d: Date) => d.toISOString().slice(0, 10);
export const n = (x: unknown) => Number(x);

/**
 * De qué TIPO es quien puso la plata, para el motor. `null` = la caja.
 *
 * ⚠️ Una contraparte que no está en la lista (borrada en el mismo instante)
 * cae a `null`, o sea "lo puso la caja". Es lo correcto y no lo inventado: sin
 * contraparte NO hay a quién deberle, y suponer un tipo movería el saldo. La
 * relación es `onDelete: Restrict`, así que no debería pasar nunca.
 */
export const tipoPagador = (
  fila: { counterpartyId: string | null },
  contrapartes: { id: string; kind: string }[],
): PayerKind | null => {
  if (!fila.counterpartyId) return null;
  const kind = contrapartes.find((c) => c.id === fila.counterpartyId)?.kind;
  return kind === 'OWNER' || kind === 'PARTNER' || kind === 'EXTERNAL_LENDER' ? kind : null;
};
export const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * LAS CUOTAS VIGENTES: las que de verdad se pagaron.
 *
 * Anular una cuota NO la borra —la fila se queda en el historial con su
 * motivo— pero ese pago **no ocurrió**: el saldo del préstamo vuelve a subir,
 * la caja no pagó nada y quien la puso de su bolsillo no tiene nada que
 * cobrar. Es la regla del módulo de préstamos (`serialize()` de
 * `loans.module.ts` calcula sobre los vigentes) y Caja la ignoraba: anular
 * subía el saldo en Deuda y **no** en Caja, así que Caja **subestimaba** la
 * deuda con el prestamista. Dos definiciones del mismo número.
 *
 * ⚠️ La exclusión NO va en el `where` de Prisma, a propósito: lo anulado viaja
 * con su `voidedAt` y la decisión la toma ESTE código, que es el que los tests
 * corren. El motor (`loanBalance`, `cashEntries`) no conoce `voidedAt`, así que
 * con el filtro en SQL no quedaría ninguna guarda ejercida —la base falsa de
 * los specs no resuelve el `where` anidado de una relación— y borrarla no
 * tumbaría un solo test: peor que no tenerla, porque parece puesta.
 *
 * Regresión: `cash.service.spec.ts`, "Caja y Deuda cuentan lo mismo".
 */
export const vigentes = <T extends { voidedAt: Date | null }>(filas: T[]) =>
  filas.filter((f) => f.voidedAt == null);

/**
 * Qué fracción de una factura es filamento. El resto es equipo.
 *
 * ⚠️ Es una **convención de prorrateo**: un abono no "fue" a una línea
 * concreta. Se reparte así para que "Filamento comprado" siga queriendo decir
 * todo el filamento que compraste, venga de una factura o de una compra
 * directa. Con facturas de una sola cosa —lo normal— es exacto.
 *
 * Una factura sin líneas (recién creada) cuenta como filamento: es el caso de
 * lejos más común y deja el abono en una línea con sentido en vez de en
 * "equipos".
 */
export function proporcionDeFilamento(
  lineas: { quantity: number; unitPrice: unknown; printerId: string | null }[],
): number {
  let total = 0;
  let deFilamento = 0;
  for (const l of lineas) {
    const monto = Math.max(l.quantity, 0) * Math.max(n(l.unitPrice), 0);
    total += monto;
    if (l.printerId == null) deFilamento += monto;
  }
  return total > 0 ? deFilamento / total : 1;
}

/** Lo que la pantalla muestra de cada asiento, además de la fecha y el monto. */
export interface EtiquetaAsiento {
  label: string;
  source: RecordSource;
}

/**
 * Cuando el asiento no trae id —o su origen no está en el mapa— la plata se
 * muestra igual, sin etiqueta. El número es lo importante: esconder la fila
 * haría que el detalle sumara menos que su propio total.
 */
export const SIN_DETALLE: EtiquetaAsiento = { label: 'Sin detalle', source: 'MANUAL' };

/** Un texto vacío o en blanco no es una etiqueta: hay que caer al respaldo. */
export const texto = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/**
 * Los dos campos sueltos del DTO, como la referencia que entiende el motor.
 *
 * El schema ya garantiza que vengan los dos o ninguno; esto solo traduce. NO
 * valida que la deuda exista: eso lo decide la lista derivada de obligaciones.
 */
export const destinoDe = (dto: {
  targetSource?: ObligationSource | null;
  targetSourceId?: string | null;
}): ObligationRef | null =>
  dto.targetSource && dto.targetSourceId
    ? { source: dto.targetSource, sourceId: dto.targetSourceId }
    : null;
