import { CalcInputSchema, type CalcInput } from '../schemas/calc';
import { calculateQuote } from './calculateQuote';

/**
 * MAYOREO, del lado de quien lo carga: leer los tramos como rangos y proponer
 * unos que no rompan el piso de margen.
 *
 * El precio de cada tramo lo sigue calculando `calculateQuote` (descuento sobre
 * el precio final y DESPUÉS redondeo). Acá no hay una segunda fórmula de margen
 * a propósito: la sugerencia le pregunta al motor, así un tramo que la app
 * propone nunca puede aparecer en rojo en la misma pantalla.
 */

export interface TierInput {
  minQty: number;
  /** fracción: 0.05 = 5 % */
  discountPct: number;
}

/** Problemas de un tramo que no se ven mirando el número suelto. */
export type TierWarning = 'FROM_ONE' | 'DUPLICATE_QTY' | 'NO_BETTER';

export const TIER_WARNING_LABEL: Record<TierWarning, string> = {
  FROM_ONE: 'Desde 1 aplica a todos los pedidos: es bajar tu precio de lista.',
  DUPLICATE_QTY: 'Otro tramo empieza en la misma cantidad.',
  NO_BETTER: 'No descuenta más que el tramo anterior: nunca conviene.',
};

export interface TierRange extends TierInput {
  /** posición en la lista original, para editar el tramo correcto */
  index: number;
  /** última cantidad del tramo; null = "o más" */
  maxQty: number | null;
  warnings: TierWarning[];
}

/** Los tramos ordenados, con hasta dónde llega cada uno y sus avisos. */
export function tierRanges(tiers: TierInput[]): TierRange[] {
  const sorted = tiers
    .map((t, index) => ({ ...t, index }))
    .sort((a, b) => a.minQty - b.minQty || a.index - b.index);

  return sorted.map((t, i) => {
    const next = sorted.find((x) => x.minQty > t.minQty);
    const prev = sorted
      .slice(0, i)
      .reverse()
      .find((x) => x.minQty < t.minQty);

    const warnings: TierWarning[] = [];
    if (t.minQty <= 1) warnings.push('FROM_ONE');
    if (sorted.some((x) => x !== t && x.minQty === t.minQty)) warnings.push('DUPLICATE_QTY');
    if (prev && t.discountPct <= prev.discountPct) warnings.push('NO_BETTER');

    return {
      index: t.index,
      minQty: t.minQty,
      maxQty: next ? next.minQty - 1 : null,
      discountPct: t.discountPct,
      warnings,
    };
  });
}

export interface TierSuggestion {
  /** el mayor descuento entero (fracción) que deja el margen en el piso o arriba */
  maxDiscountPct: number;
  tiers: TierInput[];
}

/** Cuántas veces la cantidad inicial: una tanda, dos, cinco. */
const ESCALONES = [1, 2, 5];
/** Sin tandas de varias piezas, el primer tramo arranca acá. Nunca en 1. */
const INICIO_SIN_TANDA = 5;

/**
 * Propone tres tramos crecientes con el mayor descuento que el piso de margen
 * permite. Arranca en una tanda completa (el mayoreo natural de una placa), y
 * reparte el descuento máximo en tercios hacia abajo.
 */
export function suggestTiers(raw: CalcInput): TierSuggestion {
  const input = CalcInputSchema.parse(raw);

  const statuses = (tiers: TierInput[]) =>
    calculateQuote({ ...input, wholesale: { tiers } }).wholesale?.tiers ?? [];
  const sirve = (pct: number) => {
    const [t] = statuses([{ minQty: 1, discountPct: pct / 100 }]);
    return t.status === 'OK' || t.status === 'BELOW_TARGET';
  };

  if (!sirve(1)) return { maxDiscountPct: 0, tiers: [] };

  // El margen baja con el descuento (el redondeo no lo invierte): búsqueda binaria.
  let lo = 1;
  let hi = 99;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (sirve(mid)) lo = mid;
    else hi = mid - 1;
  }

  const inicio = input.piecesPerBatch > 1 ? input.piecesPerBatch : INICIO_SIN_TANDA;
  const pcts = [Math.floor(lo / 3), Math.floor((2 * lo) / 3), lo];

  const tiers: TierInput[] = [];
  ESCALONES.forEach((veces, i) => {
    const pct = pcts[i];
    const anterior = tiers[tiers.length - 1];
    if (pct <= 0 || (anterior && pct / 100 <= anterior.discountPct)) return;
    tiers.push({ minQty: inicio * veces, discountPct: pct / 100 });
  });

  // Confirmación final contra el motor, por las dudas: nada en rojo sale de acá.
  const ok = new Set(
    statuses(tiers)
      .filter((t) => t.status === 'OK' || t.status === 'BELOW_TARGET')
      .map((t) => t.minQty),
  );

  return { maxDiscountPct: lo / 100, tiers: tiers.filter((t) => ok.has(t.minQty)) };
}
