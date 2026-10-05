/**
 * OBLIGACIONES CON UNA CONTRAPARTE (el propietario, un socio).
 *
 * Una obligación NO es una fila de base de datos: es un origen que ya existe
 * —un gasto que pagó la contraparte, una cuota suya, un aporte reembolsable—
 * visto como deuda. Su saldo se DERIVA restándole las aplicaciones, igual que
 * `loanBalance` deriva el saldo de un préstamo. Lo único que se persiste es la
 * aplicación (`DebtApplication`).
 *
 * Hasta shared 0.20.0 la deuda eran cuatro totales por categoría y los retiros
 * se descontaban en cascada con un orden fijo. Eso no permitía decir a qué
 * deuda concreta fue un pago, ni pagar "de la más antigua a la más reciente".
 */
import Decimal from 'decimal.js';
import { D, toCents } from './money';

export type ObligationSource = 'EXPENSE' | 'LOAN_PAYMENT' | 'MOVEMENT';

/** Para agrupar en "Quién puso la plata"; no afecta el orden de pago. */
export type ObligationCategory =
  | 'DESIGN'
  | 'PURCHASE'
  | 'LOAN_PAYMENT'
  | 'EQUIPMENT'
  | 'CONTRIBUTION';

export type ApplicationOrder = 'OLDEST_FIRST' | 'NEWEST_FIRST';

export interface ObligationInput {
  source: ObligationSource;
  sourceId: string;
  /** `AAAA-MM-DD`. */
  date: string;
  category: ObligationCategory;
  amount: number;
  /** Lo ya aplicado por pagos anteriores. */
  applied: number;
}

export interface Obligation extends ObligationInput {
  /** `amount − applied`, nunca negativo. */
  outstanding: number;
}

/**
 * ⚠️ El desempate por `sourceId` NO es cosmético: sin él, dos obligaciones del
 * mismo día se aplicarían en el orden en que la base las devuelva, y el mismo
 * pago repartiría distinto en dos corridas.
 */
const porFecha = (a: ObligationInput, b: ObligationInput) =>
  a.date === b.date ? a.sourceId.localeCompare(b.sourceId) : a.date < b.date ? -1 : 1;

export function obligationLedger(items: ObligationInput[]): Obligation[] {
  return [...items].sort(porFecha).map((o) => ({
    ...o,
    amount: toCents(D(o.amount)),
    applied: toCents(D(o.applied)),
    outstanding: toCents(Decimal.max(0, D(o.amount).minus(o.applied))),
  }));
}

export interface PaymentApplication {
  source: ObligationSource;
  sourceId: string;
  amount: number;
}

export interface PaymentPlan {
  applications: PaymentApplication[];
  /** Lo que sobró después de cancelar todo. Se registra como RETIRO, no como
   *  deuda negativa ni como gasto operativo. */
  leftover: number;
}

/**
 * Reparte `amount` entre las obligaciones abiertas.
 *
 * `obligations` tiene que venir de `obligationLedger` (ya ordenado de la más
 * antigua a la más reciente); `NEWEST_FIRST` simplemente lo recorre al revés.
 */
export function applyPayment(
  obligations: Obligation[],
  amount: number,
  order: ApplicationOrder = 'OLDEST_FIRST',
): PaymentPlan {
  let resto = Decimal.max(0, D(amount));
  const cola = order === 'NEWEST_FIRST' ? [...obligations].reverse() : obligations;
  const applications: PaymentApplication[] = [];

  for (const deuda of cola) {
    if (resto.lte(0)) break;
    if (deuda.outstanding <= 0) continue;
    const cuota = Decimal.min(resto, deuda.outstanding);
    applications.push({
      source: deuda.source,
      sourceId: deuda.sourceId,
      amount: toCents(cuota),
    });
    resto = resto.minus(cuota);
  }

  return { applications, leftover: toCents(resto) };
}
