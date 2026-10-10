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
import { daysBetween, isCalendarDay } from './stock';

/**
 * UNA RECEPCIÓN: cuántos llegaron y **a cuánto salieron de verdad**.
 *
 * ⚠️ Pediste 10 a $7 y el proveedor te facturó $7,50. La línea guarda **lo que
 * pediste** —es el pedido, y no se reescribe— y cada recepción guarda **lo que
 * costó**. Hasta que esto existió había que corregir la línea ANTES de
 * recibir, y si ya habías recibido algo no se podía por ninguna puerta.
 */
export interface InvoiceReceiptInput {
  quantity: number;
  /** El precio que de verdad te cobraron por unidad en ESA entrega. */
  unitPrice: number;
}

/** Una línea: cuántos se pidieron, a cuánto, y cuántos ya llegaron. */
export interface InvoiceLineInput {
  quantity: number;
  unitPrice: number;
  /** Cuántos de esos ya llegaron. Se recorta a [0, quantity]. */
  received?: number;
  /**
   * Las entregas de esta línea, cada una con **el precio que te cobraron**.
   *
   * ⚠️ **No es una segunda definición de `received`.** Las unidades las sigue
   * diciendo `received` y nada más; esto solo pone PRECIO a las que ya
   * llegaron. Una recepción que pretenda cubrir más unidades que las recibidas
   * se recorta, y lo recibido que no tenga recepción registrada (un dato de
   * antes de que esto existiera) vale el precio PEDIDO.
   */
  recepciones?: InvoiceReceiptInput[];
}

/** Un abono. Uno anulado NO cuenta, pero sigue existiendo en el historial. */
export interface InvoicePaymentInput {
  amount: number;
  voided?: boolean;
}

export interface InvoiceTotals {
  /**
   * Lo que cuesta la factura: el precio **real** de lo ya recibido más el
   * **pedido** de lo que falta. Ya NO es `Σ cantidad × precio pedido`.
   */
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
 * LO QUE CUESTA UNA LÍNEA: el precio REAL de lo que ya llegó y el PEDIDO para
 * lo que falta.
 *
 * ⚠️ Hasta la fase 2 esto era `cantidad × precio pedido` y nada más, así que
 * una factura que te cobraron a otro precio solo se podía arreglar corrigiendo
 * la línea **antes** de recibir: después quedaba mintiendo para siempre.
 *
 * ⚠️ **Lo que una recepción NO cubre vale lo pedido**, y eso incluye dos casos
 * distintos a propósito: lo que todavía no llegó (no hay precio real porque no
 * hay entrega) y lo recibido sin recepción registrada (toda la base anterior a
 * esto). Así un total viejo sigue dando el mismo número que daba ayer.
 */
const dineroDeLinea = (l: InvoiceLineInput): Decimal => {
  const pedido = Math.max(l.quantity, 0);
  const recibido = recibidoDe(l);

  let cubiertos = 0;
  let dinero = D(0);
  for (const r of l.recepciones ?? []) {
    // `received` sigue siendo la única definición de cuántos llegaron: una
    // recepción que diga más se recorta, no agranda lo recibido.
    const unidades = Math.min(Math.max(Math.trunc(r.quantity), 0), recibido - cubiertos);
    if (unidades <= 0) continue;
    dinero = dinero.plus(D(unidades).times(Math.max(r.unitPrice, 0)));
    cubiertos += unidades;
  }

  return dinero.plus(D(pedido - cubiertos).times(Math.max(l.unitPrice, 0)));
};

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
  const total = lines.reduce((s, l) => s.plus(dineroDeLinea(l)), D(0));
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

// ----- Lo que no llegó -----
//
// `expectedAt` ("¿cuándo llega?") se guardaba desde el día uno y NADIE lo
// miraba: encargabas algo para el martes, no llegaba, y la app no decía nada.
// Encontrarlo dependía de que al dueño se le ocurriera revisar la lista.

/** Una factura, vista por la única pregunta de acá: "¿esto ya llegó?". */
export interface FacturaParaAtraso {
  id: string;
  /**
   * La fecha prometida. Es una **fecha de negocio**: se guarda a medianoche
   * UTC y llega como instante ISO (o `Date`), así que se lee en UTC.
   * `null` = no se prometió ninguna.
   */
  expectedAt: string | Date | null;
  /** Anulada; `null` = viva. */
  voidedAt: string | Date | null;
  lines: InvoiceLineInput[];
}

/** Una factura que no llegó cuando dijeron. */
export interface FacturaAtrasada {
  id: string;
  /** El día que habían prometido, como `'AAAA-MM-DD'`. */
  expectedAt: string;
  /** Cuántos días pasaron desde ese día. **Siempre ≥ 1**: hoy no es atraso. */
  diasDeAtraso: number;
  /** Unidades que todavía faltan llegar. */
  porRecibir: number;
}

/**
 * Los abonos NO deciden si la mercadería llegó.
 *
 * ⚠️ Es la regla central de este módulo: la plata y la mercadería son dos
 * cuentas separadas, y una factura pagada entera y sin llegar es justo el caso
 * que este aviso existe para encontrar. Por eso `invoiceTotals` se llama con
 * la lista de abonos vacía: el eje `mercaderia` no los mira, y pedírselos a
 * quien llama sería pedir un dato que no cambia la respuesta.
 */
const SIN_ABONOS: InvoicePaymentInput[] = [];

/** Un día de negocio guardado, leído en UTC: `'2026-10-05'`. */
const diaDeNegocio = (v: string | Date): string =>
  (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);

/**
 * Las facturas que no llegaron cuando dijeron, de la más atrasada a la menos.
 *
 * ⚠️ **`hoy` ENTRA COMO PARÁMETRO** (`'AAAA-MM-DD'`, el día de quien mira la
 * pantalla) y no se lee adentro. Una función que preguntara el reloj no se
 * podría testear: el test pasaría hoy y fallaría solo algún martes, y quien lo
 * viera fallar no tendría cómo saber por qué.
 *
 * ⚠️ **Lo recibido NO se recalcula acá**: sale de `invoiceTotals` +
 * `invoiceStatus`, que son la única definición de "llegó todo" en el proyecto.
 * Una segunda cuenta diría algo distinto de la insignia que la factura muestra
 * al lado, el día que una de las dos cambie.
 *
 * Las cuatro formas de que este aviso mienta, y por qué ninguna cuenta:
 * - **Anulada**: esa factura ya no existe como compromiso.
 * - **Recibida entera**: llegó, aunque haya llegado tarde. Lo que se avisa es
 *   lo que FALTA, no un historial de demoras.
 * - **Sin fecha esperada**: no se prometió nada, así que no se puede
 *   incumplir. Avisar ahí sería inventar una promesa que nadie hizo.
 * - **Esperada HOY**: el día todavía no terminó. Avisar a las 9 de la mañana
 *   de algo que llega a las 5 de la tarde enseña a ignorar el aviso.
 */
export function facturasAtrasadas(
  facturas: FacturaParaAtraso[],
  hoy: string,
): FacturaAtrasada[] {
  if (!isCalendarDay(hoy)) {
    throw new Error(`Hoy inválido: "${hoy}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }

  const atrasadas: FacturaAtrasada[] = [];
  for (const f of facturas) {
    if (f.voidedAt != null) continue;
    if (f.expectedAt == null) continue;

    const dia = diaDeNegocio(f.expectedAt);
    // Una fecha que no se entiende no es una promesa incumplida: es un dato
    // roto, y tratarla como atraso sería avisar de algo que nadie prometió.
    if (!isCalendarDay(dia)) continue;
    // ESTRICTO: el día de hoy no cuenta todavía.
    if (dia >= hoy) continue;

    const totales = invoiceTotals(f.lines, SIN_ABONOS);
    // Ya llegó todo: llegó tarde, pero llegó. Lo que se avisa es lo que FALTA.
    if (invoiceStatus(totales).mercaderia === 'RECIBIDA') continue;
    // Y no se pidió nada: una factura sin líneas (o con todo en cero) no está
    // "sin recibir", está sin nada que recibir, y un aviso de 0 unidades es
    // ruido.
    //
    // ⚠️ Las dos guardas son DISTINTAS a propósito y las dos hacen falta. La
    // segunda estuvo escrita como `porRecibir <= 0`, que es verdadera en los
    // dos casos y dejaba a la primera **sin efecto**: la verificación por
    // mutación lo destapó —borrar el chequeo de `RECIBIDA` no tumbaba un solo
    // test—. Código muerto en una guarda de las que deciden si un aviso miente
    // es peor que no tenerla: parece que la regla está puesta.
    if (totales.pedido <= 0) continue;

    atrasadas.push({
      id: f.id,
      expectedAt: dia,
      diasDeAtraso: daysBetween(dia, hoy),
      porRecibir: totales.porRecibir,
    });
  }

  return atrasadas.sort((a, b) => b.diasDeAtraso - a.diasDeAtraso);
}
