import type { FixedCost } from '../schemas/api';

/**
 * Punto de equilibrio (análisis de salud del negocio; NO toca el precio por pieza).
 * Equilibrio en INGRESOS = costos fijos mensuales ÷ margen de contribución.
 * Ej.: $500 fijos con 40 % de margen → hay que vender $1250/mes para no perder.
 */

/** Suma de los costos fijos mensuales. */
export function fixedCostsTotal(costs: FixedCost[]): number {
  return costs.reduce((s, c) => s + (Number.isFinite(c.monthlyAmount) ? c.monthlyAmount : 0), 0);
}

/**
 * Ingreso mensual necesario para cubrir los costos fijos, dado un margen de
 * contribución (fracción). Devuelve null si el margen es 0 o inválido (con
 * margen 0 nunca se cubre lo fijo, no hay equilibrio finito).
 */
export function breakEvenRevenue(fixedMonthly: number, marginPct: number): number | null {
  if (!(marginPct > 0)) return null;
  return fixedMonthly / marginPct;
}

/**
 * Progreso hacia el equilibrio en el periodo: fracción de las ventas sobre el
 * ingreso de equilibrio (0..1, recortado a 1). null si no hay equilibrio finito.
 */
export function breakEvenProgress(sales: number, breakEven: number | null): number | null {
  if (breakEven == null || breakEven <= 0) return null;
  return Math.max(0, Math.min(1, sales / breakEven));
}

/**
 * Los TRES niveles de la hoja "Resumen" del Excel. No es lo mismo "no perder
 * dinero" que "poder pagar la cuota" ni que "además reponer los equipos": un
 * solo número esconde que el negocio puede estar en verde y aun así no dar para
 * pagar el préstamo.
 *
 * `loanPayment` se DERIVA de los préstamos abiertos (`monthlyLoanPayments`), no
 * se escribe en Configuración.
 */
export interface BreakEvenLevels {
  /** 1. Cubrir los costos fijos. */
  survive: number | null;
  /** 2. Además, la cuota del préstamo. */
  withDebt: number | null;
  /** 3. Además, la reserva mensual para reponer equipos. */
  withReserve: number | null;
}

export function breakEvenLevels({
  fixedMonthly,
  marginPct,
  loanPayment = 0,
  equipmentReserve = 0,
}: {
  fixedMonthly: number;
  marginPct: number;
  loanPayment?: number;
  equipmentReserve?: number;
}): BreakEvenLevels {
  return {
    survive: breakEvenRevenue(fixedMonthly, marginPct),
    withDebt: breakEvenRevenue(fixedMonthly + loanPayment, marginPct),
    withReserve: breakEvenRevenue(fixedMonthly + loanPayment + equipmentReserve, marginPct),
  };
}

/**
 * El equilibrio del mes Y, AL LADO, lo que se debe de facturas de compra.
 *
 * ⚠️ **Lo comprometido NO entra en el cálculo del equilibrio, y esa es la razón
 * de ser de esta función.** Una factura se paga UNA vez: meterla entre los
 * costos fijos haría saltar el número mes a mes —arriba el mes de una compra
 * grande, abajo el siguiente— y lo volvería inútil justo para lo que sirve, que
 * es decidir precios. Los costos fijos son lo que se repite TODOS los meses; un
 * compromiso puntual no es uno de ellos.
 *
 * Que los dos números viajen juntos no es un lujo: la tentación de sumarlos
 * aparece cada vez que alguien lee la pantalla ("si además debo esto, el
 * equilibrio es más alto, ¿no?"). Devolverlos de la misma función, con el
 * equilibrio calculado SIN el compromiso, deja la regla escrita en un solo lugar
 * y con un test que la sostiene (`breakeven-compromiso.spec.ts`).
 */
export interface EquilibrioYCompromiso {
  /** Los tres niveles del mes. ⚠️ Sin lo comprometido adentro. */
  niveles: BreakEvenLevels;
  /**
   * Lo que se debe de facturas de compra (`totals.proveedores` de
   * `GET /loans/overview`). Va AL LADO del equilibrio, nunca sumado.
   *
   * ⚠️ Lo pagado **de más** no se resta acá: no compensa lo que se debe en otra
   * factura (decisión de la Tarea 3) y restarlo inventaría un pago.
   */
  compromiso: number;
  /** Cuántas facturas con saldo lo componen, para que el aviso sea concreto. */
  facturas: number;
  /** Si hay algo que decir al lado del equilibrio. */
  mostrar: boolean;
}

export function equilibrioYCompromiso({
  fixedMonthly,
  marginPct,
  loanPayment = 0,
  equipmentReserve = 0,
  compromiso = 0,
  facturas = 0,
}: {
  fixedMonthly: number;
  marginPct: number;
  loanPayment?: number;
  equipmentReserve?: number;
  /** Lo que se debe de facturas. ⚠️ No se usa para calcular los niveles. */
  compromiso?: number;
  facturas?: number;
}): EquilibrioYCompromiso {
  // Un compromiso negativo o inválido es 0: no hay deuda negativa, y dejarlo
  // pasar lo convertiría en un descuento sobre lo que se debe.
  const monto = Number.isFinite(compromiso) && compromiso > 0 ? compromiso : 0;
  const cuantas = Number.isFinite(facturas) && facturas > 0 ? Math.trunc(facturas) : 0;

  return {
    // ⚠️ `compromiso` NO se pasa acá, a propósito. Sumarlo a `fixedMonthly`
    // compila, se ve razonable y es exactamente el error que esta función
    // existe para evitar.
    niveles: breakEvenLevels({ fixedMonthly, marginPct, loanPayment, equipmentReserve }),
    compromiso: monto,
    facturas: cuantas,
    mostrar: monto > 0,
  };
}
