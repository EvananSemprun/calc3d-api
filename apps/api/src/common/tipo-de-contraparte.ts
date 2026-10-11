import type { PayerKind } from '@calc3d/shared';

/**
 * EL TIPO DE UNA CONTRAPARTE, estrechado al que entiende el motor.
 *
 * Prisma devuelve el enum como `string`, y el motor de caja razona sobre
 * `PayerKind`. Lo que decide si una contraparte genera una obligación del
 * negocio no es quién es, sino **qué** es: al propietario y al socio se les
 * devuelve la plata, y lo del prestamista ya vive en el saldo del préstamo.
 *
 * ⚠️ **Un tipo desconocido cae en `null`, o sea "lo puso la caja", y es lo
 * correcto**: sin saber qué es esa contraparte no hay a quién deberle, y
 * suponer un tipo movería plata en el desglose. Mismo criterio que
 * `tipoPagador` en `cash.service.ts`, que es el que alimenta a `cashEntries`.
 */
export function tipoDeContraparte(kind: string | null | undefined): PayerKind | null {
  return kind === 'OWNER' || kind === 'PARTNER' || kind === 'EXTERNAL_LENDER' ? kind : null;
}
