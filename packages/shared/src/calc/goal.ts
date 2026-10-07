/**
 * METAS MENSUALES — la hoja "Metas" del Excel: ventas, encargos y clientes
 * nuevos que el dueño se propone cada mes, contra lo que realmente pasó.
 *
 * **Lo real NUNCA se guarda**: se deriva de las ventas, los pedidos y los
 * clientes del mes. Una meta es un dato que se escribe; el cumplimiento es una
 * consecuencia, y guardarlo lo dejaría viejo en cuanto entre una venta.
 *
 * Las metas las **decide el dueño**, mes a mes. Los números del Excel
 * (250 → 325 → 450 → 600 → enero 350) llevan adentro una decisión sobre la
 * temporada: diciembre sube y enero cae. Una proyección automática borraría
 * justo eso.
 *
 * Por eso `suggestGoals` **sugiere y no guarda**: rellena el formulario, se
 * puede editar entero, y avisa cuando la base lo va a engañar. La regla no es
 * "no se proyecta": es que **la última palabra no la tiene el promedio**.
 */

export interface GoalMonthLike {
  salesTarget: number;
  sales: number;
  ordersTarget: number;
  orders: number;
  newClientsTarget: number;
  newClients: number;
}

/**
 * Fracción de la meta cumplida. `null` cuando no hay meta: sin meta no hay nada
 * que cumplir, y un 0 % ahí se leería como un fracaso que nadie se propuso.
 *
 * **No se recorta arriba de 1**, a diferencia del punto de equilibrio: pasarse
 * de la meta es información, y un 100 % pelado escondería que se vendió el
 * doble.
 */
export function goalProgress(real: number, target: number): number | null {
  if (!(target > 0)) return null;
  return real / target;
}

export interface GoalsSummary extends GoalMonthLike {
  salesProgress: number | null;
  ordersProgress: number | null;
  newClientsProgress: number | null;
}

/**
 * Acumulado de varios meses. El avance total sale de los **totales**, no del
 * promedio de los avances: promediar un 27 % con un 0 % daría 13,7 %, que no es
 * lo que se lleva cumplido.
 */
export function goalsSummary(months: GoalMonthLike[]): GoalsSummary {
  const sumar = (k: keyof GoalMonthLike) => months.reduce((s, m) => s + (m[k] || 0), 0);

  const total = {
    salesTarget: sumar('salesTarget'),
    sales: sumar('sales'),
    ordersTarget: sumar('ordersTarget'),
    orders: sumar('orders'),
    newClientsTarget: sumar('newClientsTarget'),
    newClients: sumar('newClients'),
  };

  return {
    ...total,
    salesProgress: goalProgress(total.sales, total.salesTarget),
    ordersProgress: goalProgress(total.orders, total.ordersTarget),
    newClientsProgress: goalProgress(total.newClients, total.newClientsTarget),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// SUGERIR UNA META
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cuánto crece la sugerencia sobre la base histórica. El porcentaje que se
 * MUESTRA y el que se APLICA salen de acá, para que no puedan divergir.
 */
export const GROWTH_LEVELS = {
  CONSERVADOR: 0,
  MODERADO: 0.1,
  AMBICIOSO: 0.25,
} as const;

export type GrowthLevel = keyof typeof GROWTH_LEVELS;

/** Un mes del historial: su valor y si esa métrica tenía con qué contar. */
export interface HistoricMonth {
  /** `AAAA-MM`. */
  month: string;
  value: number;
  /**
   * `false` = el mes es anterior al primer dato de la métrica. NO es lo mismo
   * que un mes sin actividad: ese vale 0 y sí entra en el promedio.
   */
  hasData: boolean;
}

/** Por qué una métrica no se pudo sugerir. */
export type SuggestionReason = 'SIN_DATOS';

export interface MetricSuggestion {
  /** `null` cuando no se puede sugerir. **No es 0**: 0 sería una recomendación. */
  value: number | null;
  reason: SuggestionReason | null;
  /** La base antes de aplicar el crecimiento. */
  base: number | null;
  /** El mes completo más reciente con datos, para la comparación en pantalla. */
  previous: number | null;
  /** Qué meses se usaron. La pantalla los NOMBRA, no solo los cuenta. */
  monthsUsed: string[];
}

const mediana = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * La base histórica: **mediana → recorte → promedio ponderado**, en ese orden.
 *
 * ⚠️ El recorte no es un adorno. El pedido exige dos cosas que tiran en
 * direcciones opuestas: dar más peso a lo reciente **y** reducir el efecto de un
 * mes excepcional. Una ponderada sola NO hace lo segundo — si el mes raro es el
 * más reciente, lo **amplifica**. Por eso cada mes se recorta antes a
 * `[0,5 × mediana, 1,5 × mediana]` y recién después se pondera 3/2/1.
 *
 * Con la mediana en 0 el recorte aplastaría a 0 cualquier mes bueno
 * (`[0, 0, 300]` daría 0), así que ahí no se recorta: sin un centro positivo no
 * hay con qué medir qué es "excepcional".
 */
export function weightedBase(months: HistoricMonth[]): number | null {
  const utiles = months.filter((m) => m.hasData);
  if (utiles.length === 0) return null;

  // Del más reciente al más viejo: los pesos dependen del orden.
  const orden = [...utiles].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 3);
  const valores = orden.map((m) => m.value);

  // ⚠️ Si los meses vienen TODOS en subida o TODOS en bajada, no hay un mes raro
  // que recortar: hay una tendencia, y recortarla sugiere por debajo del último
  // mes. Medido contra los datos reales de 2026: con 0, 1 y 14 clientes nuevos
  // el recorte proponía **1**, y con $117, $188 y $315 proponía $223. Un mes
  // excepcional se reconoce porque ROMPE la serie, no porque sea el más alto.
  const deViejoANuevo = [...valores].reverse();
  const tendencia =
    deViejoANuevo.every((v, i) => i === 0 || v >= deViejoANuevo[i - 1]) ||
    deViejoANuevo.every((v, i) => i === 0 || v <= deViejoANuevo[i - 1]);

  const centro = mediana(valores);
  const recortados =
    centro > 0 && !tendencia
      ? valores.map((v) => Math.min(Math.max(v, centro * 0.5), centro * 1.5))
      : valores;

  const pesos = [3, 2, 1];
  let suma = 0;
  let total = 0;
  recortados.forEach((v, i) => {
    suma += v * pesos[i];
    total += pesos[i];
  });
  return suma / total;
}

const sugerirUna = (months: HistoricMonth[], growth: GrowthLevel): MetricSuggestion => {
  const utiles = months.filter((m) => m.hasData).sort((a, b) => (a.month < b.month ? 1 : -1));
  const base = weightedBase(months);
  if (base == null) {
    return { value: null, reason: 'SIN_DATOS', base: null, previous: null, monthsUsed: [] };
  }
  const usados = utiles.slice(0, 3);
  return {
    value: Math.round(base * (1 + GROWTH_LEVELS[growth])),
    reason: null,
    base: Math.round(base * 100) / 100,
    previous: usados[0]?.value ?? null,
    monthsUsed: usados.map((m) => m.month),
  };
};

export interface SuggestGoalsInput {
  sales: HistoricMonth[];
  orders: HistoricMonth[];
  newClients: HistoricMonth[];
  growth?: GrowthLevel;
}

export interface GoalSuggestion {
  sales: MetricSuggestion;
  orders: MetricSuggestion;
  newClients: MetricSuggestion;
  growth: GrowthLevel;
  /** Fracción, como todo porcentaje del motor: 0,1 = 10 %. */
  growthPct: number;
}

/**
 * La propuesta para los tres renglones. **No guarda nada y no sabe de fechas**:
 * quién decide qué meses son "completos" es el llamador.
 *
 * Una métrica sin datos devuelve `value: null` **con su motivo**, nunca 0: un 0
 * sería una recomendación, y recomendar vender cero es peor que no recomendar.
 */
export function suggestGoals(input: SuggestGoalsInput): GoalSuggestion {
  const growth = input.growth ?? 'CONSERVADOR';
  return {
    sales: sugerirUna(input.sales, growth),
    orders: sugerirUna(input.orders, growth),
    newClients: sugerirUna(input.newClients, growth),
    growth,
    growthPct: GROWTH_LEVELS[growth],
  };
}

/**
 * ⚠️ Tres estados, no dos. `SIN_HISTORIA` significa **"no se pudo medir"**, y
 * leerlo como "no hay riesgo" es justo el error que este aviso existe para
 * evitar: con historial desde febrero 2026 el primer mes medible es febrero
 * 2027, y hasta entonces el silencio no es una aprobación.
 */
export type SeasonalCheck =
  | { status: 'SIN_HISTORIA' }
  | { status: 'ESTABLE' }
  | { status: 'ATIPICO'; month: string; deviationPct: number };

/**
 * ¿El mes que se está cargando suele despegarse de su propia base?
 *
 * Se mira el MISMO mes del año anterior contra la base de los tres meses que lo
 * precedieron. Si se despegó más del umbral, la sugerencia de hoy —que sale de
 * los últimos tres meses— va a errar para el mismo lado.
 */
export function seasonalCheck(
  sameMonthLastYear: HistoricMonth | null | undefined,
  baseLastYear: HistoricMonth[],
  threshold = 0.25,
): SeasonalCheck {
  if (!sameMonthLastYear?.hasData) return { status: 'SIN_HISTORIA' };
  const base = weightedBase(baseLastYear);
  if (base == null || base <= 0) return { status: 'SIN_HISTORIA' };

  const desvio = (sameMonthLastYear.value - base) / base;
  if (Math.abs(desvio) < threshold) return { status: 'ESTABLE' };
  return {
    status: 'ATIPICO',
    month: sameMonthLastYear.month,
    deviationPct: Math.round(desvio * 1000) / 1000,
  };
}
