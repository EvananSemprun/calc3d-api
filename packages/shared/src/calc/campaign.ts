import { D, toMoney } from './money';

/**
 * Métricas puras de una campaña publicitaria (Fase 1/2). Todo en USD (base).
 * El costo/ganancia sólo existe para las ventas que traen costo (ligadas a
 * cotización/producto); para el resto se usa ROAS (ingresos ÷ inversión).
 */
export interface CampaignMetricsInput {
  /** USD gastado en publicidad (derivado de los Expense enlazados). */
  invested: number;
  /** Total vendido: suma de ventas atribuidas (USD). */
  revenue: number;
  /** Ganancia de las ventas que SÍ tienen costo conocido (USD). */
  profit: number;
  /** true si al menos una venta atribuida tiene costo (ganancia significativa). */
  hasCost: boolean;
  sales: number;
  orders: number;
}

export type CampaignHealth = 'PROFITABLE' | 'AT_RISK' | 'LOSS' | 'NO_DATA';

/** ROAS = ingresos ÷ inversión (null si no hubo inversión). */
export function roas(revenue: number, invested: number): number | null {
  if (invested <= 0) return null;
  return toMoney(D(revenue).div(invested));
}

/** ROI = (ganancia − inversión) ÷ inversión. null si no hay inversión. */
export function roi(profit: number, invested: number): number | null {
  if (invested <= 0) return null;
  return toMoney(D(profit).minus(invested).div(invested));
}

/** Costo por unidad (por pedido / por cotización). null si count = 0. */
export function costPer(invested: number, count: number): number | null {
  if (count <= 0) return null;
  return toMoney(D(invested).div(count));
}

/** Margen neto después de publicidad = ganancia − inversión. */
export function netAfterAds(profit: number, invested: number): number {
  return toMoney(D(profit).minus(invested));
}

/**
 * Semáforo de la campaña:
 * - NO_DATA: no hay ventas ni pedidos atribuidos.
 * - Con costo conocido: PROFITABLE si la ganancia supera la inversión; AT_RISK si
 *   vendió con ganancia pero no cubre la publicidad; LOSS si ni siquiera hay ganancia.
 * - Sin costo conocido: cae a ROAS (PROFITABLE si vendió ≥ lo invertido, si no AT_RISK).
 */
export function campaignHealth(m: CampaignMetricsInput): CampaignHealth {
  if (m.sales === 0 && m.orders === 0) return 'NO_DATA';
  if (m.invested <= 0) return m.revenue > 0 ? 'PROFITABLE' : 'NO_DATA';
  if (m.hasCost) {
    if (m.profit - m.invested > 0) return 'PROFITABLE';
    if (m.profit > 0) return 'AT_RISK';
    return 'LOSS';
  }
  return m.revenue >= m.invested ? 'PROFITABLE' : 'AT_RISK';
}

/** Acción sugerida para una campaña (Fase 3). */
export type CampaignAction = 'SCALE' | 'KEEP' | 'REVIEW' | 'PAUSE' | 'WAIT';

export interface CampaignRecommendation {
  action: CampaignAction;
  /** Título corto de la acción (ej. "Escalar"). */
  title: string;
  /** Frase de una línea que explica el porqué (español, cara al usuario). */
  reason: string;
}

/**
 * Recomendación automática (Fase 3). Fuente ÚNICA usada por la UI (detalle de
 * campaña) y el PDF de informe, para no duplicar la lógica ni la copia.
 *
 * Criterio ROAS-first, coherente con `campaignHealth`:
 * - Sin inversión registrada → ESPERAR (no hay nada que medir aún).
 * - Sin ventas ni pedidos pero con gasto → ESPERAR (dale tiempo o revisa el enlace).
 * - PÉRDIDA → PAUSAR (cuesta más de lo que deja).
 * - EN RIESGO → REVISAR (vendió, pero no cubre la publicidad).
 * - RENTABLE con señal fuerte (ROAS ≥ 3, o ROI ≥ 100 % cuando hay costo) → ESCALAR.
 * - RENTABLE normal → MANTENER.
 */
export function campaignRecommendation(m: CampaignMetricsInput): CampaignRecommendation {
  const r = roas(m.revenue, m.invested);

  if (m.invested <= 0) {
    return {
      action: 'WAIT',
      title: 'Esperar',
      reason: 'Aún no hay gasto de publicidad registrado; agrégalo para medir el retorno.',
    };
  }
  if (m.sales === 0 && m.orders === 0) {
    return {
      action: 'WAIT',
      title: 'Esperar',
      reason: 'Invertiste pero todavía no hay ventas ni pedidos atribuidos; dale tiempo o revisa que estés eligiendo el origen al vender.',
    };
  }

  const health = campaignHealth(m);
  if (health === 'LOSS') {
    return {
      action: 'PAUSE',
      title: 'Pausar',
      reason: 'La publicidad cuesta más de lo que deja: pausa o rehaz la oferta antes de seguir gastando.',
    };
  }
  if (health === 'AT_RISK') {
    return {
      action: 'REVIEW',
      title: 'Revisar',
      reason: 'Vendió, pero la ganancia no cubre lo invertido; ajusta público, oferta o precio.',
    };
  }

  // RENTABLE: ¿señal fuerte para escalar?
  const strongRoas = r != null && r >= 3;
  const strongRoi = m.hasCost && (() => {
    const ri = roi(m.profit, m.invested);
    return ri != null && ri >= 1;
  })();
  if (strongRoas || strongRoi) {
    return {
      action: 'SCALE',
      title: 'Escalar',
      reason: 'Deja buen retorno: considera subir el presupuesto o replicar la campaña.',
    };
  }
  return {
    action: 'KEEP',
    title: 'Mantener',
    reason: 'Es rentable con retorno moderado: mantenla y vigila que el ROAS no baje.',
  };
}
