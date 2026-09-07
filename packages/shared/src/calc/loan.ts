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

export interface LoanLike {
  monthlyPayment: number;
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
    .reduce((s, l) => s + (Number.isFinite(l.monthlyPayment) ? l.monthlyPayment : 0), 0);
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
