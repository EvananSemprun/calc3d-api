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

export type OwnerFinancingKey = 'designer' | 'purchases' | 'loanPayments' | 'equipment';

/** Un aporte de plata pura va a la misma fila que las compras, como la hoja. */
const FILA: Record<ObligationCategory, OwnerFinancingKey> = {
  DESIGN: 'designer',
  PURCHASE: 'purchases',
  CONTRIBUTION: 'purchases',
  LOAN_PAYMENT: 'loanPayments',
  EQUIPMENT: 'equipment',
};

/** El orden es fijo: lo leen la pantalla y la hoja Caja del reporte. */
const ORDEN: OwnerFinancingKey[] = ['designer', 'purchases', 'loanPayments', 'equipment'];

export interface OwnerFinancingRow {
  key: OwnerFinancingKey;
  put: number;
  recovered: number;
  missing: number;
}

export interface OwnerFinancingInput {
  obligations: Obligation[];
  /** Todo lo que se le pagó o retiró a la contraparte. */
  paymentsTotal: number;
  /** Saldo pendiente de los préstamos abiertos con terceros. */
  lenderBalance: number;
}

/**
 * QUIÉN PUSO LA PLATA.
 *
 * ⚠️ Ya NO hay cascada por categoría: las filas son una AGRUPACIÓN de las
 * obligaciones, y lo recuperado de cada una es lo que el FIFO le aplicó. El
 * total que se debe no cambia respecto de la cascada; el reparto por fila sí.
 */
export function ownerFinancing(input: OwnerFinancingInput) {
  const acum = new Map<OwnerFinancingKey, { put: Decimal; recovered: Decimal }>(
    ORDEN.map((k) => [k, { put: D(0), recovered: D(0) }]),
  );

  for (const deuda of input.obligations) {
    const fila = acum.get(FILA[deuda.category]);
    if (!fila) continue;
    fila.put = fila.put.plus(deuda.amount);
    fila.recovered = fila.recovered.plus(deuda.applied);
  }

  const rows: OwnerFinancingRow[] = ORDEN.map((key) => {
    const { put, recovered } = acum.get(key)!;
    return {
      key,
      put: toCents(put),
      recovered: toCents(recovered),
      missing: toCents(Decimal.max(0, put.minus(recovered))),
    };
  });

  const aplicadoTotal = input.obligations.reduce((s, x) => s.plus(x.applied), D(0));
  const owedToOwner = toCents(rows.reduce((s, r) => s.plus(r.missing), D(0)));
  const owedToLender = toCents(Decimal.max(0, D(input.lenderBalance)));

  return {
    rows,
    owedToOwner,
    owedToLender,
    totalOwed: toCents(D(owedToOwner).plus(owedToLender)),
    /** Pagos por encima de todo lo que la contraparte puso: no se esconden. */
    overWithdrawn: toCents(Decimal.max(0, D(input.paymentsTotal).minus(aplicadoTotal))),
  };
}
