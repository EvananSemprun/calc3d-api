import Decimal from 'decimal.js';
import { D, toMoney } from './money';

/** Una línea de pedido: descripción + cantidad × precio unitario. */
export interface OrderLine {
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
}

/** Total del pedido: suma de cantidad × precio unitario de cada línea. */
export function orderTotal(lines: OrderLine[]): number {
  const total = lines.reduce(
    (acc, l) => acc.plus(D(l.quantity).times(l.unitPrice)),
    new Decimal(0),
  );
  return toMoney(total);
}

/** Total abonado: suma de los montos de los pagos. */
export function orderPaid(amounts: number[]): number {
  return toMoney(amounts.reduce((acc, a) => acc.plus(D(a)), new Decimal(0)));
}

/** Saldo pendiente = total − abonado (nunca negativo en presentación). */
export function orderBalance(lines: OrderLine[], paidAmounts: number[]): number {
  const balance = D(orderTotal(lines)).minus(orderPaid(paidAmounts));
  return toMoney(balance);
}

/** true si el pedido está saldado (saldo ≤ 0). */
export function orderIsPaid(lines: OrderLine[], paidAmounts: number[]): boolean {
  return orderBalance(lines, paidAmounts) <= 0;
}
