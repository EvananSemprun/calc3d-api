/**
 * FACTURAS DE COMPRA: lo pedido, lo abonado y lo recibido.
 *
 * ⚠️ **Los abonos son la PLATA; la recepción es la MERCADERÍA.** Son dos
 * cuentas separadas y este motor las lleva separadas a propósito: una factura
 * puede estar pagada entera y sin recibir, o recibida entera y sin pagar. Que
 * "falte plata" y que "falte mercadería" son preguntas distintas.
 *
 * Nada de esto se guarda: se DERIVA de las líneas y los abonos. Un total
 * almacenado se desincroniza de sus partes el día que alguien corrige una
 * línea — la misma regla que el saldo de un préstamo y la deuda con una
 * contraparte.
 */
import Decimal from 'decimal.js';
import { D, toCents } from './money';

/** Una línea: cuántos se pidieron, a cuánto, y cuántos ya llegaron. */
export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  /** Cuántos de esos ya llegaron. Se recorta a [0, quantity]. */
  received?: number;
}

/** Un abono. Uno anulado NO cuenta, pero sigue existiendo en el historial. */
export interface InvoicePaymentInput {
  amount: number;
  voided?: boolean;
}

export interface InvoiceTotals {
  /** Σ cantidad × precio unitario. */
  total: number;
  /** Σ abonos NO anulados. */
  pagado: number;
  /** Lo que falta pagar. **Nunca negativo**: ver abajo. */
  saldo: number;
  /**
   * Lo pagado DE MÁS, si lo hay. Un abono de más es plata que igual salió de
   * la caja, así que no se puede esconder restándolo del saldo: ahí quedaría
   * un saldo negativo que se lee como "la factura te debe a vos", y lo que
   * pasó es que pagaste de más o la factura está mal cargada.
   */
  aFavor: number;
  /** Unidades pedidas y recibidas, que NO son plata. */
  pedido: number;
  recibido: number;
  /** Unidades que faltan llegar. */
  porRecibir: number;
}

/** Lo recibido de una línea, acotado: ni negativo ni mayor que lo pedido. */
const recibidoDe = (l: InvoiceLineInput): number =>
  Math.min(Math.max(Math.trunc(l.received ?? 0), 0), Math.max(Math.trunc(l.quantity), 0));

/**
 * Las cuentas de una factura.
 *
 * ⚠️ Una línea con cantidad o precio negativo se trata como 0: una factura no
 * es el lugar para una devolución, y dejarla pasar restaría del total sin que
 * nadie lo vea.
 */
export function invoiceTotals(
  lines: InvoiceLineInput[],
  payments: InvoicePaymentInput[],
): InvoiceTotals {
  const total = lines.reduce(
    (s, l) => s.plus(D(Math.max(l.quantity, 0)).times(Math.max(l.unitPrice, 0))),
    D(0),
  );
  const pagado = payments.reduce((s, p) => (p.voided ? s : s.plus(Math.max(p.amount, 0))), D(0));

  const diferencia = total.minus(pagado);
  const pedido = lines.reduce((s, l) => s + Math.max(Math.trunc(l.quantity), 0), 0);
  const recibido = lines.reduce((s, l) => s + recibidoDe(l), 0);

  return {
    total: toCents(total),
    pagado: toCents(pagado),
    saldo: toCents(Decimal.max(diferencia, 0)),
    aFavor: toCents(Decimal.max(diferencia.negated(), 0)),
    pedido,
    recibido,
    porRecibir: pedido - recibido,
  };
}

/**
 * En qué estado está la factura, para mostrarlo en una palabra.
 *
 * ⚠️ Son DOS ejes que no se pueden mezclar en uno: una factura puede estar
 * pagada y sin recibir. Por eso esto devuelve los dos y la pantalla decide
 * cómo contarlo, en vez de un único "estado" que tendría que elegir cuál de
 * las dos verdades contar.
 */
export interface InvoiceStatus {
  pago: 'SIN_PAGAR' | 'PARCIAL' | 'PAGADA' | 'PAGADA_DE_MAS';
  mercaderia: 'SIN_RECIBIR' | 'PARCIAL' | 'RECIBIDA';
}

export function invoiceStatus(t: InvoiceTotals): InvoiceStatus {
  const pago =
    t.aFavor > 0
      ? 'PAGADA_DE_MAS'
      : t.pagado <= 0
        ? 'SIN_PAGAR'
        : t.saldo > 0
          ? 'PARCIAL'
          : 'PAGADA';

  const mercaderia =
    t.recibido <= 0 ? 'SIN_RECIBIR' : t.porRecibir > 0 ? 'PARCIAL' : 'RECIBIDA';

  return { pago, mercaderia };
}
