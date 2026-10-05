/**
 * CONCILIACIÓN DE CAJA.
 *
 * En una cuenta COMPARTIDA (el negocio y el propietario usan la misma), el
 * total que muestra la cuenta no significa nada por sí solo. Lo que se compara
 * contra el saldo esperado es `total − personal declarado`.
 *
 * ⚠️ Lo personal NO se deriva: el dinero personal del dueño entra y sale por
 * fuera del negocio y el sistema no lo ve. Hasta shared 0.20.0 se calculaba
 * como residuo (`total − esperado`), y por construcción eso nunca podía dar un
 * faltante. Es un dato DECLARADO por quien concilia.
 */
import { D, toCents } from './money';

export type ReconciliationKind = 'SQUARE' | 'FAVOR' | 'SHORT';

/** Un centavo: debajo de eso, cuadra. */
export const RECONCILE_TOLERANCE = 0.01;

export interface ReconcileInput {
  /** Lo que el negocio DEBERÍA tener a esa fecha (`businessCash(ledger, date)`). */
  expectedUsd: number;
  /** Lo que de verdad hay en la cuenta, ya convertido a USD. */
  totalUsd: number;
  /** Cuánto de ese total es personal, declarado por quien concilia. */
  personalUsd: number;
  tolerance?: number;
}

export interface ReconcileResult {
  /** `totalUsd − personalUsd`: lo que de verdad hay para el negocio. */
  businessActualUsd: number;
  /** `businessActualUsd − expectedUsd`. Negativo = falta plata del negocio. */
  differenceUsd: number;
  kind: ReconciliationKind;
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const tolerancia = D(Math.abs(input.tolerance ?? RECONCILE_TOLERANCE));
  const real = D(input.totalUsd).minus(input.personalUsd);
  const diferencia = real.minus(input.expectedUsd);

  const kind: ReconciliationKind = diferencia.abs().lte(tolerancia)
    ? 'SQUARE'
    : diferencia.gt(0)
      ? 'FAVOR'
      : 'SHORT';

  return {
    businessActualUsd: toCents(real),
    differenceUsd: toCents(diferencia),
    kind,
  };
}
