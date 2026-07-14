import { D, toMoney } from './money';

/**
 * EQUIVALENCIAS DE COBRO POR PERFIL DE TASA (Venezuela).
 *
 * El costeo y el precio SIEMPRE viven en USD (la base del motor). Esta capa es
 * puramente de PRESENTACIÓN/decisión de cobro: dado un precio de venta en USD y
 * una tasa de REFERENCIA (la que refleja el valor real del dólar, típicamente el
 * paralelo/Binance), calcula cuántos bolívares hay que recibir para NO perder
 * margen y, para cada tasa disponible, el precio USD equivalente a cotizar si se
 * cobra convirtiendo con esa tasa.
 *
 * No toca `calculateQuote`: es una función aparte que consume su resultado.
 *
 * Fórmula:
 *   targetVes       = baseUsd × tasaReferencia        (Bs que se deben recibir)
 *   adjustedBaseUsd = targetVes / tasaPerfil          (USD a cotizar en ese perfil)
 *   plainVes        = baseUsd × tasaPerfil            (Bs si se cobra SIN ajustar)
 *   shortfallVes    = targetVes − plainVes            (Bs que se dejarían de recibir)
 */

/** Nombres por defecto (legibles) de las 3 tasas de protección sembradas. */
export const RATE_LABELS = {
  BINANCE: 'Binance / USDT',
  BCV_USD: 'BCV Dólar',
  BCV_EUR: 'BCV Euro',
} as const;

/** Etiqueta de la tasa de referencia por defecto (el "dólar real" que protege el margen). */
export const DEFAULT_PROTECTION_LABEL: string = RATE_LABELS.BINANCE;

/** Una tasa con nombre para el cálculo de equivalencias (unidades destino por 1 USD). */
export interface RateProfileInput {
  label: string;
  currencyCode: string;
  /** unidades de la moneda destino por 1 USD (ej. Bs por USD). */
  rate: number;
}

/** Equivalencia de cobro para UNA tasa/perfil. */
export interface RateEquivalent {
  label: string;
  currencyCode: string;
  rate: number;
  /** ¿la tasa es usable? (rate > 0) */
  available: boolean;
  /** ¿es la tasa de referencia (protección)? */
  isReference: boolean;
  /** bolívares objetivo a recibir para NO perder margen (baseUsd × tasaRef). */
  targetVes: number;
  /** precio USD equivalente a cotizar SI se cobra convirtiendo con ESTA tasa. */
  adjustedBaseUsd: number;
  /** bolívares que se recibirían al cobrar el precio USD base SIN ajustar. */
  plainVes: number;
  /** bolívares que se dejarían de recibir por no ajustar (0 en la referencia). */
  shortfallVes: number;
}

/** Resultado completo para un precio base dado (por unidad o por pedido). */
export interface ChargeEquivalents {
  /** precio base en USD sobre el que se calcula. */
  baseUsd: number;
  /** etiqueta de la tasa de referencia usada como protección (o null si no hay). */
  referenceLabel: string | null;
  /** tasa de referencia (unidades destino por USD); null si no hay o es 0. */
  referenceRate: number | null;
  /** bolívares objetivo (baseUsd × referenceRate); null si no hay referencia usable. */
  targetVes: number | null;
  /** un renglón por perfil de tasa. */
  profiles: RateEquivalent[];
}

export interface ComputeChargeEquivalentsArgs {
  baseUsd: number;
  /** etiqueta de la tasa de referencia (protección). Si no matchea, no hay protección. */
  referenceLabel: string | null;
  /** todas las tasas con nombre disponibles (incluida la de referencia). */
  rates: RateProfileInput[];
}

/**
 * Calcula, para un precio base en USD, la equivalencia de cobro en cada tasa
 * disponible protegiendo el margen contra la tasa de referencia.
 */
export function computeChargeEquivalents({
  baseUsd,
  referenceLabel,
  rates,
}: ComputeChargeEquivalentsArgs): ChargeEquivalents {
  const base = D(baseUsd);
  const ref = referenceLabel ? rates.find((r) => r.label === referenceLabel) ?? null : null;
  const refRate = ref && ref.rate > 0 ? D(ref.rate) : null;
  const targetVes = refRate ? base.times(refRate) : null;

  const profiles: RateEquivalent[] = rates.map((r) => {
    const available = r.rate > 0;
    const rate = D(r.rate);
    const plainVes = available ? base.times(rate) : D(0);
    // Si no hay referencia usable, no hay ajuste: el "ajustado" cae al precio base.
    const adjustedBaseUsd = available && targetVes ? targetVes.div(rate) : base;
    const shortfallVes = available && targetVes ? targetVes.minus(plainVes) : D(0);
    return {
      label: r.label,
      currencyCode: r.currencyCode,
      rate: r.rate,
      available,
      isReference: ref ? r.label === ref.label : false,
      targetVes: targetVes ? toMoney(targetVes) : 0,
      adjustedBaseUsd: toMoney(adjustedBaseUsd),
      plainVes: toMoney(plainVes),
      shortfallVes: toMoney(shortfallVes),
    };
  });

  return {
    baseUsd: toMoney(base),
    referenceLabel: ref ? ref.label : null,
    referenceRate: refRate ? toMoney(refRate) : null,
    targetVes: targetVes ? toMoney(targetVes) : null,
    profiles,
  };
}
