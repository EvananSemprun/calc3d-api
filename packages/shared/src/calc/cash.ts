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
  }[];
  loanPayments: { date: Fecha; amount: number; paidBy: PaidBy }[];
  movements: { date: Fecha; amount: number; kind: OwnerMovementKind }[];
}

export interface BusinessCash {
  /** Ventas de mostrador + abonos de pedidos (+). */
  collected: number;
  /** Gastos generales, sin filamento ni equipos (−). */
  expenses: number;
  /** Filamento comprado (−). */
  filament: number;
  /** Equipos que pagó la caja (−). Los que pagó Vanan o el préstamo no entran. */
  equipment: number;
  /** Compras que pagó Vanan + plata suya que metió (+). */
  contributions: number;
  /** Plata que Vanan sacó para él (−). */
  withdrawals: number;
  /** Cuotas del préstamo que pagó la caja (−). */
  loanPayments: number;
  balance: number;
}

/**
 * Saldo del negocio (hoja Caja, B13:B19). Con `until` (`AAAA-MM-DD`) cuenta
 * solo hasta ese día inclusive: es el saldo que tenía el negocio el día de un
 * conteo.
 */
export function businessCash(ledger: CashLedger, until?: Fecha): BusinessCash {
  const hasta = until?.slice(0, 10);
  const vale = (d: Fecha) => !hasta || d.slice(0, 10) <= hasta;
  const suma = <T extends { date: Fecha; amount: number }>(xs: T[], f: (x: T) => boolean = () => true) =>
    xs.filter((x) => vale(x.date) && f(x)).reduce((s, x) => s + x.amount, 0);

  // Lo pagado con el préstamo nunca toca la caja; los equipos de Vanan viven
  // en el financiamiento (la hoja tampoco los pone en Caja).
  const operativo = (e: CashLedger['expenses'][number]) => !e.isInvestment && e.paidBy !== 'LOAN';

  const collected = suma(ledger.sales) + suma(ledger.orderPayments);
  const expenses = suma(ledger.expenses, (e) => operativo(e) && !e.isFilament);
  const filament = suma(ledger.expenses, (e) => operativo(e) && e.isFilament);
  const equipment = suma(ledger.expenses, (e) => e.isInvestment && e.paidBy === 'BUSINESS');
  const contributions =
    suma(ledger.expenses, (e) => operativo(e) && e.paidBy === 'OWNER') +
    suma(ledger.movements, (m) => m.kind === 'CONTRIBUTION');
  const withdrawals = suma(ledger.movements, (m) => m.kind === 'WITHDRAWAL');
  const loanPayments = suma(ledger.loanPayments, (p) => p.paidBy === 'BUSINESS');

  return {
    collected: round2(collected),
    expenses: round2(expenses),
    filament: round2(filament),
    equipment: round2(equipment),
    contributions: round2(contributions),
    withdrawals: round2(withdrawals),
    loanPayments: round2(loanPayments),
    balance: round2(
      collected - expenses - filament - equipment + contributions - withdrawals - loanPayments,
    ),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
