/**
 * CAJA Y FINANCIAMIENTO — las hojas "Caja" e "Inversion" del Excel (2026-09).
 *
 * Toda la plata vive en UNA cuenta de Binance, mezclada con la personal de
 * Vanan. Por eso la caja del negocio no se puede leer de ningún lado: se
 * RECONSTRUYE con lo cobrado, lo gastado y quién pagó cada cosa.
 *
 * La regla que evita la doble carga de la hoja: una compra que paga Vanan se
 * anota UNA vez, como gasto con `paidBy = OWNER`. De ahí salen solos el gasto y
 * el aporte. Solo la plata pura (sacar para él, meter sin comprar nada) es un
 * movimiento aparte.
 *
 * Lo que mete la contraparte se separa en reembolsable (el negocio se lo debe)
 * y capital (a fondo perdido): suben la caja igual, pero solo el primero es
 * deuda. Y un retiro se parte en devolución de deuda (`applied`) y retiro puro.
 *
 * ⚠️ Caja NO es ganancia: una cuota del préstamo o un rollo sin usar sacan plata
 * de la caja sin ser pérdida, y un aporte de Vanan la sube sin ser venta. La
 * ganancia acumulada vive en `equipmentRecovery`, y el financiamiento de abajo
 * es el mismo dinero visto desde "quién lo puso" — no se suman.
 */

export type PaidBy = 'BUSINESS' | 'OWNER' | 'LOAN';
export type OwnerMovementKind = 'CONTRIBUTION' | 'WITHDRAWAL';

/** Fecha como ISO o `AAAA-MM-DD`; solo se comparan los primeros 10 caracteres. */
type Fecha = string;

export interface CashLedger {
  sales: { date: Fecha; amount: number }[];
  /** Abonos de pedidos: entran a la caja al cobrarse, aunque no se haya entregado. */
  orderPayments: { date: Fecha; amount: number }[];
  expenses: {
    date: Fecha;
    amount: number;
    paidBy: PaidBy;
    isInvestment: boolean;
    /** Compra de filamento (la hoja la muestra aparte de los gastos generales). */
    isFilament: boolean;
    /** Si lo pagó la contraparte: ¿se le devuelve, o fue capital? */
    refundable: boolean;
  }[];
  loanPayments: { date: Fecha; amount: number; paidBy: PaidBy; refundable: boolean }[];
  movements: {
    date: Fecha;
    amount: number;
    kind: OwnerMovementKind;
    refundable: boolean;
    /** Cuánto de este pago se aplicó a deudas (`DebtApplication`). Default 0. */
    applied?: number;
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

/**
 * Saldo del negocio. Con `until` (`AAAA-MM-DD`) cuenta solo hasta ese día
 * inclusive: es el saldo que tenía el negocio el día de una conciliación.
 */
export function businessCash(ledger: CashLedger, until?: Fecha): BusinessCash {
  const hasta = until?.slice(0, 10);
  const vale = (d: Fecha) => !hasta || d.slice(0, 10) <= hasta;
  const suma = <T extends { date: Fecha; amount: number }>(xs: T[], f: (x: T) => boolean = () => true) =>
    xs.filter((x) => vale(x.date) && f(x)).reduce((s, x) => s + x.amount, 0);

  // Lo pagado con el préstamo nunca toca la caja; los equipos de la contraparte
  // viven en el financiamiento.
  const operativo = (e: CashLedger['expenses'][number]) => !e.isInvestment && e.paidBy !== 'LOAN';
  const deLaContraparte = (e: CashLedger['expenses'][number]) => operativo(e) && e.paidBy === 'OWNER';

  const collected = suma(ledger.sales) + suma(ledger.orderPayments);
  const expenses = suma(ledger.expenses, (e) => operativo(e) && !e.isFilament);
  const filament = suma(ledger.expenses, (e) => operativo(e) && e.isFilament);
  const equipment = suma(ledger.expenses, (e) => e.isInvestment && e.paidBy === 'BUSINESS');

  const contributionsRefundable =
    suma(ledger.expenses, (e) => deLaContraparte(e) && e.refundable) +
    suma(ledger.movements, (m) => m.kind === 'CONTRIBUTION' && m.refundable);
  const contributionsCapital =
    suma(ledger.expenses, (e) => deLaContraparte(e) && !e.refundable) +
    suma(ledger.movements, (m) => m.kind === 'CONTRIBUTION' && !m.refundable);

  const retiros = ledger.movements.filter((m) => vale(m.date) && m.kind === 'WITHDRAWAL');
  const debtRepayments = retiros.reduce((s, m) => s + Math.min(m.amount, m.applied ?? 0), 0);
  const ownerDraws = retiros.reduce((s, m) => s + Math.max(0, m.amount - (m.applied ?? 0)), 0);

  const loanPayments = suma(ledger.loanPayments, (p) => p.paidBy === 'BUSINESS');

  return {
    collected: round2(collected),
    expenses: round2(expenses),
    filament: round2(filament),
    equipment: round2(equipment),
    contributionsRefundable: round2(contributionsRefundable),
    contributionsCapital: round2(contributionsCapital),
    debtRepayments: round2(debtRepayments),
    ownerDraws: round2(ownerDraws),
    loanPayments: round2(loanPayments),
    balance: round2(
      collected -
        expenses -
        filament -
        equipment +
        contributionsRefundable +
        contributionsCapital -
        debtRepayments -
        ownerDraws -
        loanPayments,
    ),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
