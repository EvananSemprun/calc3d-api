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

/**
 * Un número con el que se puede hacer cuentas. Un campo que el servidor dejó de
 * mandar llega `undefined`, y `undefined <= 0` es **false**: la comparación no lo
 * atrapa y termina dentro de decimal.js, que lanza y tumba la pantalla entera.
 * Pasó el 2026-10-02 con `stats.quotes` (ver `campaign.spec.ts`).
 */
const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** El número, o 0 si falta. Para cuentas donde "sin dato" equivale a "cero". */
const orZero = (n: unknown): number => (usable(n) ? n : 0);

/** ROAS = ingresos ÷ inversión (null si no hubo inversión o falta un dato). */
export function roas(revenue: number, invested: number): number | null {
  if (!usable(revenue) || !usable(invested) || invested <= 0) return null;
  return toMoney(D(revenue).div(invested));
}

/** ROI = (ganancia − inversión) ÷ inversión. null si no hay inversión. */
export function roi(profit: number, invested: number): number | null {
  if (!usable(profit) || !usable(invested) || invested <= 0) return null;
  return toMoney(D(profit).minus(invested).div(invested));
}

/** Costo por unidad (por pedido / por cotización). null si count = 0 o falta. */
export function costPer(invested: number, count: number): number | null {
  if (!usable(invested) || !usable(count) || count <= 0) return null;
  return toMoney(D(invested).div(count));
}

/** Margen neto después de publicidad = ganancia − inversión. */
export function netAfterAds(profit: number, invested: number): number {
  return toMoney(D(orZero(profit)).minus(orZero(invested)));
}

/**
 * Semáforo de la campaña:
 * - NO_DATA: no hay ventas ni pedidos atribuidos.
 * - Con costo conocido: PROFITABLE si la ganancia supera la inversión; AT_RISK si
 *   vendió con ganancia pero no cubre la publicidad; LOSS si ni siquiera hay ganancia.
 * - Sin costo conocido: cae a ROAS (PROFITABLE si vendió ≥ lo invertido, si no AT_RISK).
 */
export function campaignHealth(m: CampaignMetricsInput): CampaignHealth {
  const invested = orZero(m?.invested);
  const revenue = orZero(m?.revenue);
  const profit = orZero(m?.profit);
  const sales = orZero(m?.sales);
  const orders = orZero(m?.orders);

  if (sales === 0 && orders === 0) return 'NO_DATA';
  if (invested <= 0) return revenue > 0 ? 'PROFITABLE' : 'NO_DATA';
  if (m?.hasCost) {
    if (profit - invested > 0) return 'PROFITABLE';
    if (profit > 0) return 'AT_RISK';
    return 'LOSS';
  }
  return revenue >= invested ? 'PROFITABLE' : 'AT_RISK';
}

/**
 * ESTADO REAL de una campaña (2026-10-02). El `status` guardado se queda viejo:
 * nada lo mueve a FINISHED cuando pasa la fecha de fin, así que una campaña que
 * terminó hace semanas sigue diciendo "Activa" y el Dashboard pedía revisarla.
 *
 * `today` llega como 'YYYY-MM-DD' calculado en día **LOCAL** por quien llama: las
 * fechas se guardan en UTC pero "qué día es hoy" es una pregunta local, y con
 * UTC una campaña que termina hoy se vería cerrada antes de tiempo.
 */
export type CampaignLifecycle = 'RUNNING' | 'PAUSED' | 'FINISHED';

export function campaignLifecycle(
  status: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): CampaignLifecycle {
  if (status === 'FINISHED') return 'FINISHED';
  if (status === 'PAUSED') return 'PAUSED';
  // Vencida por fecha aunque nadie la haya marcado. Comparación de strings
  // 'YYYY-MM-DD', que ordena igual que la fecha y no arrastra husos horarios.
  if (endDate && endDate.slice(0, 10) < today) return 'FINISHED';
  return 'RUNNING';
}

/** Una campaña vigente es la única sobre la que todavía se puede actuar. */
export const isCampaignRunning = (
  status: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): boolean => campaignLifecycle(status, endDate, today) === 'RUNNING';

/** Acción sugerida para una campaña (Fase 3). */
export type CampaignAction = 'SCALE' | 'KEEP' | 'REVIEW' | 'PAUSE' | 'WAIT' | 'CLOSED';

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
 * - Campaña CERRADA → veredicto en pasado, sin orden: no se puede pausar ni
 *   ajustar algo que ya terminó (2026-10-02).
 * - Sin inversión registrada → ESPERAR (no hay nada que medir aún).
 * - Sin ventas ni pedidos pero con gasto → ESPERAR (dale tiempo o revisa el enlace).
 * - PÉRDIDA → PAUSAR (cuesta más de lo que deja).
 * - EN RIESGO → REVISAR (vendió, pero no cubre la publicidad).
 * - RENTABLE con señal fuerte (ROAS ≥ 3, o ROI ≥ 100 % cuando hay costo) → ESCALAR.
 * - RENTABLE normal → MANTENER.
 */
export function campaignRecommendation(
  m: CampaignMetricsInput,
  lifecycle: CampaignLifecycle = 'RUNNING',
): CampaignRecommendation {
  const invested = orZero(m?.invested);
  const revenue = orZero(m?.revenue);
  const sales = orZero(m?.sales);
  const orders = orZero(m?.orders);
  const r = roas(revenue, invested);

  // Una campaña terminada no admite consejos: solo deja el aprendizaje.
  if (lifecycle === 'FINISHED') {
    if (invested <= 0) {
      return {
        action: 'CLOSED',
        title: 'Cerrada',
        reason: 'Terminó sin gasto de publicidad registrado, así que no hay retorno que medir.',
      };
    }
    const health = campaignHealth(m);
    if (health === 'PROFITABLE') {
      return {
        action: 'CLOSED',
        title: 'Cerrada · rindió',
        reason: `Terminó en positivo: costó ${money(invested)} y dejó ${money(revenue)}. Sirve de referencia para la próxima.`,
      };
    }
    if (health === 'NO_DATA') {
      return {
        action: 'CLOSED',
        title: 'Cerrada · sin ventas',
        reason: `Terminó sin ventas ni encargos atribuidos: se gastaron ${money(invested)} sin retorno medible.`,
      };
    }
    return {
      action: 'CLOSED',
      title: 'Cerrada · no rindió',
      reason: `No rindió: costó ${money(invested)} y dejó ${money(revenue)}. Tenerlo en cuenta antes de repetir esta oferta o este público.`,
    };
  }

  if (invested <= 0) {
    return {
      action: 'WAIT',
      title: 'Esperar',
      reason: 'Aún no hay gasto de publicidad registrado; agrégalo para medir el retorno.',
    };
  }
  if (sales === 0 && orders === 0) {
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
  const strongRoi = !!m?.hasCost && (() => {
    const ri = roi(orZero(m?.profit), invested);
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

/**
 * Monto en USD para el texto del veredicto. El motor es puro: no conoce la
 * moneda de presentación de la organización (eso es capa de UI), así que acá
 * solo se formatea el dólar base con dos decimales.
 */
function money(n: number): string {
  return `$${toMoney(D(orZero(n))).toFixed(2)}`;
}
