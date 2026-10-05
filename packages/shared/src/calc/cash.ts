/**
 * CAJA Y FINANCIAMIENTO — las hojas "Caja" e "Inversion" del Excel (2026-09).
 *
 * Toda la plata vive en UNA cuenta de Binance, mezclada con la personal del
 * propietario. Por eso la caja del negocio no se puede leer de ningún lado: se
 * RECONSTRUYE con lo cobrado, lo gastado y quién pagó cada cosa.
 *
 * La regla que evita la doble carga de la hoja: una compra que paga el
 * propietario se anota UNA vez, como gasto con `paidBy = OWNER`. De ahí salen
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

export type PaidBy = 'BUSINESS' | 'OWNER' | 'LOAN';
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
    paidBy: PaidBy;
    isInvestment: boolean;
    /** Compra de filamento (la hoja la muestra aparte de los gastos generales). */
    isFilament: boolean;
    /** Si lo pagó la contraparte: ¿se le devuelve, o fue capital? */
    refundable: boolean;
    id?: string;
  }[];
  loanPayments: { date: Fecha; amount: number; paidBy: PaidBy; refundable: boolean; id?: string }[];
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
  const operativo = (e: CashLedger['expenses'][number]) => !e.isInvestment && e.paidBy !== 'LOAN';
  const deLaContraparte = (e: CashLedger['expenses'][number]) => operativo(e) && e.paidBy === 'OWNER';

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
    if (e.isInvestment && e.paidBy === 'BUSINESS') push('equipment', e);
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

  for (const c of ledger.loanPayments) {
    if (vale(c.date) && c.paidBy === 'BUSINESS') push('loanPayments', c);
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

const round2 = (n: number) => Math.round(n * 100) / 100;
