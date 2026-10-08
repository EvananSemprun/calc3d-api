/**
 * DEUDA — el préstamo con el que se compró un equipo y sus pagos.
 *
 * Igual que el saldo de un pedido, **el saldo NO se almacena**: se deriva del
 * capital menos los abonos. Un saldo guardado y un abono nuevo son dos verdades
 * que tarde o temprano se contradicen.
 *
 * Un pago de préstamo **no es un gasto** y por eso no vive en el ledger: el
 * equipo que se compró con ese dinero ya entró ahí como inversión, y contarlo
 * otra vez sería contar la misma máquina dos veces. Devolver capital no es un
 * costo — el costo fue la impresora.
 */

export interface LoanPaymentLike {
  amount: number;
}

/** Cada cuánto se propone pagar. Es el período del OBJETIVO, no una promesa. */
export type PaymentFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

/** Cuántos períodos de esa frecuencia entran en un mes. */
const POR_MES: Record<PaymentFrequency, number> = {
  WEEKLY: 365.2425 / 7 / 12,
  BIWEEKLY: 365.2425 / 14 / 12,
  MONTHLY: 1,
};

/** Días que dura un período. Para medir el ritmo REAL contra el calendario. */
const DIAS: Record<PaymentFrequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 365.2425 / 12,
};

export interface LoanLike {
  /**
   * La cuota OBJETIVO, expresada en su propia frecuencia. Con `WEEKLY` son $X
   * por semana, no por mes.
   */
  monthlyPayment: number;
  paymentFrequency?: PaymentFrequency;
  /** Fecha en que se terminó de pagar; null mientras siga abierto. */
  closedAt?: string | Date | null;
}

/** Lo devuelto hasta hoy. */
export function loanPaid(payments: LoanPaymentLike[]): number {
  return payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
}

/** Lo que falta. Nunca negativo: pagar de más no genera un saldo a favor. */
export function loanBalance(principal: number, payments: LoanPaymentLike[]): number {
  return Math.max(0, principal - loanPaid(payments));
}

/** Fracción del capital ya devuelta (0..1). Sin capital, no se debe nada. */
export function loanProgress(principal: number, payments: LoanPaymentLike[]): number {
  if (!(principal > 0)) return 1;
  return Math.max(0, Math.min(1, loanPaid(payments) / principal));
}

/**
 * Lo que hay que pagar cada mes entre todos los préstamos ABIERTOS. Es lo que
 * alimenta el nivel 2 del punto de equilibrio; por eso se deriva de los
 * préstamos y no se escribe a mano en Configuración: el mismo número en dos
 * lugares termina diciendo dos cosas.
 */
export function monthlyLoanPayments(loans: LoanLike[]): number {
  return loans
    .filter((l) => !l.closedAt)
    .reduce((s, l) => s + aMensual(l.monthlyPayment, l.paymentFrequency ?? 'MONTHLY'), 0);
}

/**
 * La cuota llevada a su equivalente MENSUAL.
 *
 * ⚠️ Sin esto, una cuota semanal de $50 entra al punto de equilibrio como $50
 * al mes cuando en realidad son **$217**, y el nivel 2 pediría facturar menos
 * de lo que hace falta para pagarla.
 */
export function aMensual(cuota: number, frecuencia: PaymentFrequency): number {
  return Number.isFinite(cuota) ? cuota * POR_MES[frecuencia] : 0;
}

/**
 * Meses que faltan al ritmo de la cuota. Redondea hacia ARRIBA: un mes a medias
 * sigue siendo un mes en el que hay que pagar. `null` si no hay cuota, porque
 * entonces no se sabe cuándo termina, y un 0 ahí se leería como "ya está".
 */
export function monthsToPayOff(balance: number, monthlyPayment: number): number | null {
  if (balance <= 0) return 0;
  if (!(monthlyPayment > 0)) return null;
  return Math.ceil(balance / monthlyPayment);
}

export interface PayOffEstimate {
  /** Períodos que faltan al ritmo OBJETIVO. `null` si no hay cuota válida. */
  atTarget: number | null;
  /** Períodos que faltan al ritmo REAL de los pagos. `null` si no se puede medir. */
  atActualPace: number | null;
  /** Lo que de verdad se viene pagando por período, medido. */
  actualPace: number | null;
  /** La unidad de los dos números: la frecuencia del préstamo. */
  unit: PaymentFrequency;
}

/**
 * Cuánto falta, en DOS lecturas: al ritmo que el dueño se propuso y al que de
 * verdad lleva.
 *
 * ⚠️ Una sola lectura miente cuando los pagos son irregulares, que es el caso
 * real: $50, $50, $100, $50 y un mes sin pagar nada contra una cuota objetivo
 * de $100. "Faltan 8 meses" es cierto solo si se cumple el objetivo, y no se
 * venía cumpliendo.
 *
 * El ritmo real se mide contra el CALENDARIO (desde que arrancó hasta hoy), no
 * contra la cantidad de pagos: tres pagos en un año no son el mismo ritmo que
 * tres pagos en un mes, y promediar por pago diría que sí.
 */
export function payOffEstimate({
  balance,
  installment,
  frequency = 'MONTHLY',
  payments,
  startDate,
  now,
}: {
  balance: number;
  /** La cuota objetivo, en la frecuencia del préstamo. */
  installment: number;
  frequency?: PaymentFrequency;
  payments: LoanPaymentLike[];
  startDate?: string | Date | null;
  now: Date;
}): PayOffEstimate {
  const atTarget = monthsToPayOff(balance, installment);
  const vacio: PayOffEstimate = { atTarget, atActualPace: null, actualPace: null, unit: frequency };

  if (balance <= 0) return { ...vacio, atActualPace: 0, actualPace: null };
  if (!startDate || payments.length === 0) return vacio;

  const desde = new Date(startDate).getTime();
  const transcurridos = (now.getTime() - desde) / (DIAS[frequency] * 86_400_000);
  // Menos de un período no alcanza para hablar de ritmo: dividir por 0,2 daría
  // un ritmo cinco veces mayor que lo que se pagó.
  if (!(transcurridos >= 1)) return vacio;

  const actualPace = loanPaid(payments) / transcurridos;
  if (!(actualPace > 0)) return vacio;

  return { atTarget, atActualPace: Math.ceil(balance / actualPace), actualPace, unit: frequency };
}
