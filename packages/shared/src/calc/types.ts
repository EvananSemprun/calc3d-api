import type { PriceStatus, RoundingMode } from '../schemas/calc';

/** Resultado de una línea de insumo. */
export interface SupplyResult {
  name?: string;
  /** costo de esa línea por pieza (qty × unitCost) */
  perPieceCost: number;
  /** costo de esa línea en todo el pedido */
  batchCost: number;
}

/**
 * Desglose de costos del pedido por categoría EN CRUDO (sin merma). La merma va
 * aparte en `wasteAmount`, así las líneas suman exactamente el costo del lote.
 */
export interface CostBreakdown {
  material: number;
  wear: number;
  power: number;
  supplies: number;
  labor: number;
  /** empaque por pieza × cantidad + otros del pedido */
  extras: number;
  /** dinero extra agregado por la merma (filamento + desgaste + luz) */
  wasteAmount: number;
}

/** El precio de venta: del sugerido al que realmente se va a cobrar. */
export interface PriceResult {
  /** margen objetivo aplicado al costo (fracción) */
  markup: number;
  /** costo unitario × (1 + markup) — B49 */
  suggested: number;
  /** sugerido pasado por la regla de redondeo — B53 */
  rounded: number;
  /** el que manda: `manualPrice` si se escribió a mano, si no el redondeado — B54 */
  final: number;
  /** true si `final` viene de un precio escrito a mano */
  isManual: boolean;
  /** margen real sobre el costo con el precio final — B55 */
  marginReal: number;
  /** ganancia por pieza (final − costo unitario) — B56 */
  profitPerUnit: number;
  /** diferencia contra el precio sugerido — B57 */
  diffVsSuggested: number;
  /** semáforo comercial — B58 */
  status: PriceStatus;
}

/** Una opción del comparador de redondeos (D52:F57). */
export interface RoundingOption {
  mode: RoundingMode;
  increment: number;
  /** precio al que llevaría esa regla */
  price: number;
  /** margen real que dejaría ese precio */
  marginReal: number;
}

/** Precio de mayoreo para un tramo. */
export interface WholesaleTierResult {
  minQty: number;
  /** descuento aplicado sobre el precio final (fracción) */
  discountPct: number;
  /** precio unitario del tramo, ya redondeado */
  unitPrice: number;
  marginReal: number;
  profitPerUnit: number;
  /** true si es el tramo aplicable a la cantidad del pedido */
  applies: boolean;
  status: PriceStatus;
}

/** Resumen de mayoreo. */
export interface WholesaleResult {
  tiers: WholesaleTierResult[];
  /** tramo aplicable a la cantidad del pedido */
  appliedTier: WholesaleTierResult | null;
  /** total del pedido al precio del tramo aplicado — B90 */
  orderTotal: number;
  /** ganancia del pedido a ese precio — B91 */
  orderProfit: number;
}

/**
 * Producción por tandas: traduce lo que muestra el laminador para UNA tanda
 * (gramos/horas de una impresión) al pedido completo.
 */
export interface ProductionSummary {
  /** piezas que caben en una impresión/tanda */
  piecesPerBatch: number;
  /** tandas necesarias = ceil(cantidad / piecesPerBatch) — E75 */
  batches: number;
  /** gramos REALES de todo el pedido */
  totalGrams: number;
  /** horas de MÁQUINA de todo el pedido: lo que cuesta en desgaste — E76 */
  machineHours: number;
  /** horas de RELOJ hasta entregar, si hay varias impresoras a la vez — E77 */
  deliveryHours: number;
  /** costo real de producir UNA tanda */
  costPerBatch: number;
  /** costo real por unidad */
  costPerUnit: number;
  /** costo real de TODO el pedido */
  costTotal: number;
}

/**
 * Lo que se COBRA por este pedido. Si la cantidad alcanza un tramo de mayoreo,
 * manda el precio del tramo; si no, el de lista. Es la fuente ÚNICA de este
 * dato para el panel, la cotización del cliente y el registro de la venta.
 */
export interface OrderTotals {
  /** unidades del pedido — B75 */
  units: number;
  /** precio de lista por unidad (antes del descuento por cantidad) */
  listUnitPrice: number;
  /** descuento por cantidad aplicado (fracción); 0 si no aplica ningún tramo */
  discountPct: number;
  /** precio por unidad realmente cobrado, ya redondeado */
  unitPrice: number;
  /** true si `unitPrice` viene de un tramo de mayoreo */
  fromTier: boolean;
  /** total a cobrar — B76 */
  total: number;
  /** ganancia del pedido — B77 */
  profit: number;
  /** margen real del precio cobrado (para no recalcularlo en cada pantalla) */
  marginReal: number;
  /** semáforo del precio COBRADO (puede diferir del de lista) */
  status: PriceStatus;
}

/** RESULTADO COMPLETO del motor de cálculo. */
export interface CalcResult {
  quantity: number;
  currency: string;
  locale: string;

  supplies: SupplyResult[];

  /** desglose del pedido por categoría, en crudo, con la merma en su propia línea */
  breakdown: CostBreakdown;

  /** costo del pedido ANTES de aplicar merma */
  subtotalBeforeWaste: number;
  /** costo total del pedido (con merma) */
  costBatch: number;
  /** costo por unidad */
  costPerUnit: number;

  price: PriceResult;
  /** las 5 opciones de redondeo con el margen de cada una */
  roundingOptions: RoundingOption[];
  /** mayoreo (null si no se definieron tramos) */
  wholesale: WholesaleResult | null;
  production: ProductionSummary;
  order: OrderTotals;
}
