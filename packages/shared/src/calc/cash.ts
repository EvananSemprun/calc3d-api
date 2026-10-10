/**
 * CAJA Y FINANCIAMIENTO — las hojas "Caja" e "Inversion" del Excel (2026-09).
 *
 * Toda la plata vive en UNA cuenta de Binance, mezclada con la personal del
 * propietario. Por eso la caja del negocio no se puede leer de ningún lado: se
 * RECONSTRUYE con lo cobrado, lo gastado y quién pagó cada cosa.
 *
 * La regla que evita la doble carga de la hoja: una compra que paga el
 * propietario se anota UNA vez, como gasto con SU contraparte. De ahí salen
 * solos el gasto y el aporte. Solo la plata pura (sacar para él, meter sin
 * comprar nada) es un movimiento aparte.
 *
 * Lo que mete la contraparte se separa en reembolsable (el negocio se lo debe)
 * y capital (a fondo perdido): suben la caja igual, pero solo el primero es
 * deuda. Y un retiro se parte en devolución de deuda (`applied`) y retiro puro.
 *
 * ⚠️ Caja NO es ganancia: una cuota del préstamo o un rollo sin usar sacan plata
 * de la caja sin ser pérdida, y un aporte del propietario la sube sin ser
 * venta. La ganancia acumulada vive en `equipmentRecovery`, y el financiamiento
 * de abajo es el mismo dinero visto desde "quién lo puso" — no se suman.
 *
 * ⚠️ El orden es CLASIFICAR y DESPUÉS SUMAR: `cashEntries` decide a qué línea
 * va cada asiento y `businessCash` solo los suma. Antes la clasificación vivía
 * adentro de nueve filtros anónimos, así que mostrar el detalle de una línea
 * obligaba a rearmar esos filtros en otro lado — dos clasificaciones que tenían
 * que coincidir para siempre, y el día que una cambiara la pantalla mostraría
 * un detalle que suma distinto que su propio total.
 */

import { isCalendarDay, previousDay } from './stock';

/**
 * QUIEN PUSO LA PLATA de un asiento, por TIPO de contraparte.
 *
 * `null` = la caja del negocio. El motor necesita el **tipo** y no el id: lo
 * que decide si un gasto genera deuda no es con quien sea, sino si esa persona
 * es duena del negocio (le volves la plata) o un prestamista (la deuda ya vive
 * en el saldo del prestamo, y contarla aca seria contarla dos veces).
 */
export type PayerKind = 'OWNER' | 'PARTNER' | 'EXTERNAL_LENDER';

/** Un socio se trata igual que el propietario: puso plata y hay que devolversela. */
export const generaObligacion = (p: PayerKind | null): boolean =>
  p === 'OWNER' || p === 'PARTNER';
export type OwnerMovementKind = 'CONTRIBUTION' | 'WITHDRAWAL';

/** Fecha como ISO o `AAAA-MM-DD`; solo se comparan los primeros 10 caracteres. */
type Fecha = string;

/**
 * El `id` de cada asiento es OPCIONAL y el motor NO lo mira: solo lo arrastra
 * hasta `cashEntries` para que la API pueda poner la etiqueta al serializar.
 */
export interface CashLedger {
  sales: { date: Fecha; amount: number; id?: string }[];
  /** Abonos de pedidos: entran a la caja al cobrarse, aunque no se haya entregado. */
  orderPayments: { date: Fecha; amount: number; id?: string }[];
  expenses: {
    date: Fecha;
    amount: number;
    /** `null` = la caja. Ver `PayerKind`. */
    payer: PayerKind | null;
    /**
     * Nació de una factura de compra, así que **su plata ya se contó** por el
     * lado de los abonos. No mueve la caja: solo existe como mercadería.
     *
     * ⚠️ Sin esto, abonar $50 y después recibir la compra de $50 bajaría el
     * saldo $100 — la doble carga que descuadraba la hoja del Excel.
     */
    fromInvoice?: boolean;
    isInvestment: boolean;
    /** Compra de filamento (la hoja la muestra aparte de los gastos generales). */
    isFilament: boolean;
    /** Si lo pagó la contraparte: ¿se le devuelve, o fue capital? */
    refundable: boolean;
    id?: string;
  }[];
  loanPayments: {
    date: Fecha;
    amount: number;
    payer: PayerKind | null;
    refundable: boolean;
    id?: string;
  }[];
  /**
   * ABONOS A FACTURAS DE COMPRA: **esto es lo que mueve la plata**. La
   * mercadería entra después, al recibirla, y ese gasto viene marcado con
   * `fromInvoice` justamente para no contarla dos veces.
   */
  purchasePayments: {
    date: Fecha;
    amount: number;
    /** `null` = la caja. Si no, el negocio se lo debe a esa contraparte. */
    payer: PayerKind | null;
    /** Si lo puso una persona: ¿se le devuelve, o fue capital? */
    refundable: boolean;
    /**
     * Qué fracción de SU factura es filamento (0..1); el resto, equipo.
     *
     * ⚠️ Es una **convención de prorrateo, no un hecho**: un abono de $20
     * contra una factura de dos filamentos y una impresora no "fue" a una
     * línea concreta. Se reparte a prorrata para que la línea "Filamento
     * comprado" siga queriendo decir *todo el filamento que compraste*, venga
     * de una factura o de una compra directa. Con facturas de una sola cosa
     * —lo normal— el reparto es exacto.
     */
    filamentShare: number;
    /**
     * **TOMADO DEL SALDO A FAVOR** con ese proveedor: no mueve la caja.
     *
     * ⚠️ Esa plata ya salió el día que se pagó de más. Usarla después en otra
     * factura no es plata que sale otra vez: es la misma, reconocida por el
     * proveedor. Contarla de nuevo es la misma clase de doble carga que el gasto
     * nacido de una factura, por la otra puerta — y como ahí, lo que la evita es
     * esta marca.
     *
     * ⚠️ Tampoco emite el aporte de la contraparte: si "lo puso" una persona, no
     * puso nada, y el doble asiento gasto+aporte dejaría al negocio debiéndole
     * plata que nunca salió de su bolsillo.
     */
    fromCredit?: boolean;
    id?: string;
  }[];
  movements: {
    date: Fecha;
    amount: number;
    kind: OwnerMovementKind;
    refundable: boolean;
    /** Cuánto de este pago se aplicó a deudas (`DebtApplication`). Default 0. */
    applied?: number;
    id?: string;
  }[];
}

export interface BusinessCash {
  /** Ventas de mostrador + abonos de pedidos (+). */
  collected: number;
  /** Gastos generales, sin filamento ni equipos (−). */
  expenses: number;
  /** Filamento comprado (−). */
  filament: number;
  /** Equipos que pagó la caja (−). */
  equipment: number;
  /** Compras reembolsables que pagó la contraparte + plata suya reembolsable (+). */
  contributionsRefundable: number;
  /** Aporte de capital: sube la caja y NO genera deuda (+). */
  contributionsCapital: number;
  /** Devoluciones contra deudas: bajan caja Y deuda. NO son gasto operativo (−). */
  debtRepayments: number;
  /** Lo que se sacó por encima de la deuda. Tampoco es gasto operativo (−). */
  ownerDraws: number;
  /** Cuotas del préstamo que pagó la caja (−). */
  loanPayments: number;
  balance: number;
}

/** Las nueve líneas de "De dónde sale el saldo", en el orden en que se muestran. */
export type CashCategory =
  | 'collected'
  | 'expenses'
  | 'filament'
  | 'equipment'
  | 'contributionsRefundable'
  | 'contributionsCapital'
  | 'debtRepayments'
  | 'ownerDraws'
  | 'loanPayments';

/** Con qué signo entra cada categoría al saldo. */
export const CASH_SIGN: Record<CashCategory, 1 | -1> = {
  collected: 1,
  expenses: -1,
  filament: -1,
  equipment: -1,
  contributionsRefundable: 1,
  contributionsCapital: 1,
  debtRepayments: -1,
  ownerDraws: -1,
  loanPayments: -1,
};

/**
 * Un asiento ya clasificado. `amount` es SIEMPRE positivo: el signo lo pone la
 * categoría, vía `CASH_SIGN`.
 *
 * Sin etiquetas a propósito: el motor no conoce los nombres de columna de
 * Prisma. La API hace el join `id → texto` al serializar.
 */
export interface CashEntry {
  category: CashCategory;
  date: Fecha;
  amount: number;
  /** El id del registro de origen, si lo trajo el ledger. */
  id?: string;
}

/**
 * Cada asiento de la caja con su categoría. `businessCash` suma esto, y el
 * desplegable de la pantalla muestra esto mismo. Con `until` (`AAAA-MM-DD`)
 * cuenta solo hasta ese día inclusive, igual que `businessCash`.
 *
 * ⚠️ ES LA ÚNICA clasificación. Si alguna vez hay una segunda —en la API, en el
 * front, en el reporte de Excel— el detalle y el total van a divergir el día
 * que una de las dos cambie, y la pantalla se contradice a sí misma.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

export function cashEntries(ledger: CashLedger, until?: Fecha): CashEntry[] {
  const hasta = until?.slice(0, 10);
  const vale = (d: Fecha) => !hasta || d.slice(0, 10) <= hasta;
  const out: CashEntry[] = [];
  // Un asiento en cero no se emite: un retiro totalmente aplicado a deuda no es
  // además un "retiro de $0", y esa fila solo ensuciaría el desplegable.
  const push = (category: CashCategory, x: { date: Fecha; amount: number; id?: string }) => {
    if (x.amount !== 0) out.push({ category, date: x.date, amount: x.amount, id: x.id });
  };

  // Lo pagado con el préstamo nunca toca la caja; los equipos de la contraparte
  // viven en el financiamiento.
  // Lo que paga el prestamista nunca toca la caja, y los equipos de la
  // contraparte viven en el financiamiento.
  // Un gasto nacido de una factura NO mueve la caja: su plata ya se contó al
  // abonar. Sigue existiendo como mercadería (inventario, precio del rollo,
  // análisis), pero acá no suma.
  const operativo = (e: CashLedger['expenses'][number]) =>
    !e.isInvestment && e.payer !== 'EXTERNAL_LENDER' && !e.fromInvoice;
  const deLaContraparte = (e: CashLedger['expenses'][number]) =>
    operativo(e) && generaObligacion(e.payer);

  for (const v of ledger.sales) if (vale(v.date)) push('collected', v);
  for (const p of ledger.orderPayments) if (vale(p.date)) push('collected', p);

  for (const e of ledger.expenses) {
    if (!vale(e.date)) continue;
    // ⚠️ Un gasto operativo de la contraparte emite DOS asientos: el gasto (o el
    // filamento) Y el aporte. No es un bug — es la regla que evita la doble
    // carga: la compra que paga la contraparte es gasto y aporte a la vez, y se
    // anulan en el saldo. Dejar uno solo cambiaría `balance`.
    if (operativo(e) && !e.isFilament) push('expenses', e);
    if (operativo(e) && e.isFilament) push('filament', e);
    if (e.isInvestment && e.payer == null && !e.fromInvoice) push('equipment', e);
    if (deLaContraparte(e)) push(e.refundable ? 'contributionsRefundable' : 'contributionsCapital', e);
  }

  for (const m of ledger.movements) {
    if (!vale(m.date)) continue;
    if (m.kind === 'CONTRIBUTION') {
      push(m.refundable ? 'contributionsRefundable' : 'contributionsCapital', m);
      continue;
    }
    // Un retiro se parte: lo que cancela deuda NO es lo mismo que lo que se
    // saca de más, y el dueño pidió verlos separados. Los dos llevan el MISMO
    // id, porque son el mismo movimiento visto por sus dos mitades.
    push('debtRepayments', { date: m.date, id: m.id, amount: Math.min(m.amount, m.applied ?? 0) });
    push('ownerDraws', { date: m.date, id: m.id, amount: Math.max(0, m.amount - (m.applied ?? 0)) });
  }

  // Los abonos: acá SÍ sale la plata. Se reparten entre filamento y equipo a
  // prorrata de su factura, y si los puso una persona emiten además el aporte
  // —el mismo doble asiento que un gasto de su bolsillo, que se anula en el
  // saldo y deja la deuda.
  for (const a of ledger.purchasePayments) {
    if (!vale(a.date)) continue;
    // Tomado del saldo a favor: esa plata ya salió al pagar de más. Ver
    // `fromCredit`. Sale ANTES del prorrateo: no deja ni un asiento, porque no
    // es un movimiento de plata partido en dos, es ninguno.
    if (a.fromCredit) continue;
    if (a.payer === 'EXTERNAL_LENDER') continue; // lo del prestamista no toca la caja
    const share = Math.min(Math.max(a.filamentShare, 0), 1);
    const enFilamento = round2(a.amount * share);
    push('filament', { ...a, amount: enFilamento });
    push('equipment', { ...a, amount: round2(a.amount - enFilamento) });
    if (generaObligacion(a.payer)) {
      push(a.refundable ? 'contributionsRefundable' : 'contributionsCapital', a);
    }
  }

  for (const c of ledger.loanPayments) {
    if (vale(c.date) && c.payer == null) push('loanPayments', c);
  }

  return out;
}

/**
 * Saldo del negocio. Con `until` (`AAAA-MM-DD`) cuenta solo hasta ese día
 * inclusive: es el saldo que tenía el negocio el día de una conciliación.
 *
 * No clasifica nada por su cuenta: suma los asientos de `cashEntries`.
 */
export function businessCash(ledger: CashLedger, until?: Fecha): BusinessCash {
  const acc: Record<CashCategory, number> = {
    collected: 0,
    expenses: 0,
    filament: 0,
    equipment: 0,
    contributionsRefundable: 0,
    contributionsCapital: 0,
    debtRepayments: 0,
    ownerDraws: 0,
    loanPayments: 0,
  };
  for (const e of cashEntries(ledger, until)) acc[e.category] += e.amount;

  // El saldo sale de los totales SIN redondear y se redondea UNA sola vez, como
  // antes: redondear cada línea y después sumarlas arrastra el error de cada una.
  const balance = (Object.keys(acc) as CashCategory[]).reduce((s, k) => s + CASH_SIGN[k] * acc[k], 0);

  return {
    collected: round2(acc.collected),
    expenses: round2(acc.expenses),
    filament: round2(acc.filament),
    equipment: round2(acc.equipment),
    contributionsRefundable: round2(acc.contributionsRefundable),
    contributionsCapital: round2(acc.contributionsCapital),
    debtRepayments: round2(acc.debtRepayments),
    ownerDraws: round2(acc.ownerDraws),
    loanPayments: round2(acc.loanPayments),
    balance: round2(balance),
  };
}


/**
 * LA CADENA DE UN PERIODO: con cuánto venías, cuánto lo movió, cuánto te queda.
 *
 * `after = before + delta` SIEMPRE, al centavo.
 */
export interface CashChain {
  /** Saldo al cerrar el día ANTERIOR al periodo. */
  before: number;
  /** Lo que el periodo movió la caja. Se DERIVA: `after − before`. */
  delta: number;
  /** Saldo al final del periodo. */
  after: number;
}

/**
 * Arma la cadena de caja de un periodo: "venías con $X · este mes $Y · te
 * queda $Z".
 *
 * ⚠️ El del MEDIO se DERIVA de los otros dos. Calcularlo por su propio camino
 * —cobrado del mes menos gastos del mes, p. ej.— es exactamente el bug que esta
 * función vino a cerrar (2026-10-10): esa cuenta ignoraba los aportes del
 * dueño, las devoluciones y las compras a crédito, así que daba −61.20 al lado
 * de un saldo de 102.83 y el dueño la leyó como un saldo. Dos caminos distintos
 * no cierran entre sí el día que uno cambia.
 *
 * ⚠️ Los extremos se redondean ANTES de restar. Al revés, `before + delta`
 * puede dar un centavo más que `after` (0.125 y 0.25 lo hacen) y los tres
 * números dejan de cerrar en pantalla, que es lo único que la cadena promete.
 *
 * Con `balanceBefore` en `null` devuelve `null`: con el filtro en "Todo" —o con
 * un rango sin inicio— no hay un "antes" y la cadena no significa nada. Un
 * `before: 0` afirmaría que el negocio arrancó en cero justo ahí.
 */
export function cashChain(balanceBefore: number | null, balanceNow: number): CashChain | null {
  if (balanceBefore == null) return null;
  const before = round2(balanceBefore);
  const after = round2(balanceNow);
  return { before, delta: round2(after - before), after };
}

/**
 * QUÉ DOS SALDOS PEDIR para la cadena de un rango, y si ese rango YA CERRÓ.
 *
 * Los dos extremos son el MISMO `businessCash` con distinta fecha de corte: no
 * son dos definiciones de saldo, es una con dos cortes.
 */
export interface CashChainCuts {
  /** Corte del saldo PREVIO (el día anterior al inicio). `null` = no hay cadena. */
  before: string | null;
  /**
   * Corte del saldo FINAL. `null` = **el saldo de hoy**, sin corte: el rango
   * todavía está abierto y su cierre no llegó.
   */
  end: string | null;
  /**
   * El rango TERMINÓ antes de hoy. Lo que dice la cadena es con cuánto quedó al
   * cerrar ese periodo, **no** lo que hay hoy en la cuenta: la palabra de la
   * pantalla tiene que acompañar al número ("cerró con", no "te queda").
   */
  closed: boolean;
}

/**
 * EL TRAMO DEL MEDIO NO PUEDE COMERSE LO QUE VINO DESPUÉS (2026-10-10).
 *
 * La cadena usaba el saldo de **HOY** como extremo derecho, siempre. Con el mes
 * en curso está bien; con un rango ya cerrado miente: elegís septiembre y dice
 * "venías con $X al 31/8 · en el rango $Y", con octubre entero metido en ese Y.
 *
 * ⚠️ El rango ABIERTO (el que termina hoy o más adelante) corta en `null`, o
 * sea en el saldo de hoy, y NO en su `to`: el 31 de octubre todavía no llegó,
 * así que "el saldo al 31" sería pedirle el saldo al futuro. De paso, el
 * extremo derecho de la pantalla normal queda idéntico al de la tarjeta "Saldo
 * en caja" sin una consulta de más.
 *
 * ⚠️ `today` lo calcula QUIEN LLAMA, en día LOCAL (`todayKey()` en el panel).
 * El motor es puro y no decide husos: desde las 20:00 de Caracas, un "hoy" en
 * UTC daría el día siguiente y el mes en curso se leería como cerrado.
 *
 * Sin `from` —filtro en "Todo", o un rango a medio escribir— no hay un "antes"
 * y no hay cadena: un `before: 0` afirmaría que el negocio arrancó en cero
 * justo ahí. Un día que no existe en el calendario se trata igual, porque
 * `previousDay` lanza y eso sería una pantalla en blanco en vez de una cadena
 * de menos.
 */
export function cashChainCuts(
  from: string | null | undefined,
  to: string | null | undefined,
  today: string,
): CashChainCuts {
  if (!from || !isCalendarDay(from)) return { before: null, end: null, closed: false };
  const before = previousDay(from);
  // Un `to` ausente o inventado se lee como "hasta hoy": el rango sigue abierto.
  const cerrado = !!to && isCalendarDay(to) && to < today;
  return { before, end: cerrado ? to! : null, closed: cerrado };
}
