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
   * un saldo negativo que se lee como "la factura te debe a ti", y lo que
   * pasó es que pagaste de más o la factura está mal cargada.
   */
  aFavor: number;
  /**
   * Lo pagado de más que **todavía se puede usar**: `aFavor − lo ya aplicado` a
   * otras facturas del mismo proveedor, nunca negativo.
   *
   * ⚠️ **`aFavor` y esto son dos cosas distintas y las dos hacen falta.**
   * `aFavor` es un HECHO del pasado (pagaste $15 de más) y no se mueve nunca;
   * esto es lo que queda. Mostrar solo el primero diría que el proveedor te
   * debe plata que ya te devolvió en mercadería; mostrar solo el segundo borraría
   * del historial que el sobrepago existió.
   *
   * ⚠️ **Es la única definición de "disponible"** en el proyecto. El rollup por
   * proveedor (`saldoAFavorPorProveedor`) y la guarda de "no más de lo que hay"
   * (`evaluarUsoDeSaldo`) SUMAN este número; no lo recalculan.
   */
  aFavorDisponible: number;
  /** Unidades pedidas y recibidas, que NO son plata. */
  pedido: number;
  recibido: number;
  /** Unidades que faltan llegar. */
  porRecibir: number;
  /**
   * Lo que vale la mercadería que YA llegó: las recepciones a su precio real y
   * lo recibido sin recepción registrada al precio pedido.
   */
  valorRecibido: number;
  /**
   * Lo que te llegó y todavía no pagaste: `máx(0, valorRecibido − pagado)`.
   *
   * ⚠️ **No es `saldo`.** `saldo` es lo que falta pagar de TODA la factura
   * (incluida la mercadería que no llegó); esto es solo lo que ya recibiste.
   * Son dos preguntas distintas y las dos hacen falta.
   */
  deuda: number;
  /**
   * Lo que pagaste y todavía no te llegó: `máx(0, pagado − valorRecibido)`.
   * Plata ya salida a cambio de mercadería pendiente.
   */
  anticipo: number;
  /**
   * Lo que falta pagar de mercadería que tampoco llegó:
   * `máx(0, total − máx(pagado, valorRecibido))`.
   *
   * ⚠️ Se recorta en 0: un compromiso negativo no significa nada, y el
   * excedente de una factura pagada de más ya lo cuenta `aFavor`.
   */
  comprometido: number;
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
  const { cubiertos, dinero } = dineroDeRecepciones(l);

  return dinero.plus(D(pedido - cubiertos).times(Math.max(l.unitPrice, 0)));
};

/**
 * LO QUE VALE LO YA RECIBIDO de una línea: hermano de `dineroDeLinea` que corta
 * en `recibido` en vez de en `pedido`.
 *
 * Las recepciones valen a su precio REAL y lo recibido **sin** recepción
 * registrada, al precio PEDIDO. Lo que todavía no llegó no cuenta: no es
 * mercadería que se pueda deber, es un compromiso (ver `comprometido`).
 */
const valorRecibidoDeLinea = (l: InvoiceLineInput): Decimal => {
  const { cubiertos, dinero } = dineroDeRecepciones(l);

  return dinero.plus(D(recibidoDe(l) - cubiertos).times(Math.max(l.unitPrice, 0)));
};

/** Lo que cuestan las recepciones de una línea y cuántas unidades cubren. */
const dineroDeRecepciones = (l: InvoiceLineInput): { cubiertos: number; dinero: Decimal } => {
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

  return { cubiertos, dinero };
};

/**
 * Las cuentas de una factura.
 *
 * ⚠️ Una línea con cantidad o precio negativo se trata como 0: una factura no
 * es el lugar para una devolución, y dejarla pasar restaría del total sin que
 * nadie lo vea.
 *
 * ⚠️ **`creditoTomado`** es cuánto del sobrepago de ESTA factura ya se usó en
 * otras (lo deriva `creditoTomadoPorFactura`, en `supplier-credit.ts`). Entra
 * como parámetro y no se consulta adentro porque son abonos de **otras**
 * facturas: esta función solo ve las líneas y los abonos propios. Por defecto 0,
 * así que una factura vieja sigue dando el mismo número que daba ayer.
 */
export function invoiceTotals(
  lines: InvoiceLineInput[],
  payments: InvoicePaymentInput[],
  creditoTomado = 0,
): InvoiceTotals {
  const total = lines.reduce((s, l) => s.plus(dineroDeLinea(l)), D(0));
  const pagado = payments.reduce((s, p) => (p.voided ? s : s.plus(Math.max(p.amount, 0))), D(0));

  const diferencia = total.minus(pagado);
  const aFavor = Decimal.max(diferencia.negated(), 0);
  const pedido = lines.reduce((s, l) => s + Math.max(Math.trunc(l.quantity), 0), 0);
  const recibido = lines.reduce((s, l) => s + recibidoDe(l), 0);
  const valorRecibido = lines.reduce((s, l) => s.plus(valorRecibidoDeLinea(l)), D(0));

  return {
    total: toCents(total),
    pagado: toCents(pagado),
    saldo: toCents(Decimal.max(diferencia, 0)),
    aFavor: toCents(aFavor),
    aFavorDisponible: toCents(Decimal.max(aFavor.minus(Math.max(creditoTomado, 0)), 0)),
    pedido,
    recibido,
    porRecibir: pedido - recibido,
    valorRecibido: toCents(valorRecibido),
    deuda: toCents(Decimal.max(valorRecibido.minus(pagado), 0)),
    anticipo: toCents(Decimal.max(pagado.minus(valorRecibido), 0)),
    comprometido: toCents(Decimal.max(total.minus(Decimal.max(pagado, valorRecibido)), 0)),
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

/**
 * EL CÓDIGO PROPIO de una compra: `C-0001`.
 *
 * ⚠️ No confundir con `reference`, que es el número que le pone **el
 * proveedor** (su "A-001", su "Recibo 0003"). Ese es suyo, no nuestro: puede
 * faltar, puede repetirse entre proveedores y puede cambiar de formato cuando
 * al proveedor se le ocurra. El código de acá es el que identifica la compra
 * dentro de la app, y lo asigna ella.
 *
 * El relleno a cuatro cifras es un MÍNIMO: la compra 12 345 se muestra entera.
 */
export function codigoDeCompra(code: number): string {
  return `C-${String(code).padStart(4, '0')}`;
}

/**
 * CUÁNTOS DÍAS SE PUEDE ANULAR SIN DAR EXPLICACIONES (2026-11-07).
 *
 * Tres: el plazo que pidió el dueño. La anulación es la única operación de
 * Compras que revierte plata ya contada, y un click distraído sobre una
 * factura vieja descuadra la deuda con el proveedor sin que nadie lo note.
 */
export const DIAS_PARA_ANULAR_SIN_CONFIRMAR = 3;

/**
 * ¿Anular esto necesita la confirmación extra?
 *
 * ⚠️ **Se cuenta desde que se CARGÓ (`createdAt`), no desde la fecha del
 * documento.** Son dos cosas distintas en este dominio y la diferencia es
 * visible en los datos: hay compras del 05/10 con un abono fechado el 02/11.
 * Contando por la fecha del documento, un abono cargado con fecha vieja
 * **nacería necesitando confirmación** — o sea que el plazo no existiría para
 * él.
 *
 * ⚠️ **Es un candado BLANDO: devuelve si hay que confirmar, no si se puede.**
 * Un candado duro sobre un negocio de una sola persona significa "hay que
 * tocar la base a mano", y el error que se descubre al cuarto día es un caso
 * real. Lo que evita es el click distraído, que es el problema que había.
 *
 * `ahora` entra como PARÁMETRO y no se lee del reloj acá: un test contra el
 * reloj pasa hoy y falla solo algún martes. Misma convención que
 * `facturasAtrasadas` y `cashChainCuts`.
 */
export function anulacionNecesitaConfirmacion(cargadoEl: Date | string, ahora: Date): boolean {
  const desde = cargadoEl instanceof Date ? cargadoEl : new Date(cargadoEl);
  const ms = desde.getTime();
  // Una fecha ilegible NO puede abrir la puerta: si no se sabe cuándo se cargó,
  // se pide la confirmación. Lo contrario convertiría un dato roto en un
  // permiso.
  if (!Number.isFinite(ms)) return true;
  const dias = (ahora.getTime() - ms) / 86_400_000;
  return dias > DIAS_PARA_ANULAR_SIN_CONFIRMAR;
}
