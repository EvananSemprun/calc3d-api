import type { MarginMode, ProrationMode } from '../schemas/calc';

/** Resultado de cálculo de una línea de material. */
export interface MaterialResult {
  name?: string;
  /** Costo de material por pieza. */
  perPieceCost: number;
  /** Costo de material del lote (perPieceCost * cantidad). */
  batchCost: number;
}

/** Resultado de un componente comprado por paquete. */
export interface ComponentResult {
  name?: string;
  /** precio_paquete / unidades_por_paquete */
  unitCost: number;
  /** unidades_por_pieza * cantidad */
  totalUnits: number;
  /** ceil(totalUnits / unidades_por_paquete) */
  packagesToBuy: number;
  /** sobrante = paquetes*unidades_por_paquete - totalUnits */
  leftover: number;
  /** costo prorrateado solo por unidades usadas */
  usedCost: number;
  /** costo cargando los paquetes completos comprados */
  fullPackageCost: number;
  /** costo realmente aplicado al pedido según prorationMode */
  appliedCost: number;
  /** costo aplicado repartido por pieza (appliedCost / cantidad) */
  perPieceCost: number;
  prorationMode: ProrationMode;
}

/** Resultado de una línea de empaque (misma lógica de paquete que componente). */
export interface PackagingResult extends ComponentResult {
  scope: 'PER_PIECE' | 'PER_ORDER';
}

/** Resultado de una tarea de mano de obra. */
export interface LaborResult {
  name?: string;
  scope: 'PER_PIECE' | 'PER_ORDER';
  /** costo total de la tarea aplicado al lote */
  batchCost: number;
  /** costo repartido por pieza */
  perPieceCost: number;
}

/** Desglose de costos del lote por categoría EN CRUDO (sin merma). La merma va
 *  aparte en `wasteAmount`, así las líneas suman exactamente el costo del lote. */
export interface CostBreakdown {
  material: number;
  wear: number;
  power: number;
  components: number;
  packaging: number;
  labor: number;
  /** costo de arranque por tanda × número de tandas */
  setup: number;
  /** dinero extra agregado por la merma */
  wasteAmount: number;
}

/** Precio de venta calculado para un margen. */
export interface PriceResult {
  /** fracción de margen ingresada (0.3 = 30 %) */
  marginPct: number;
  mode: MarginMode;
  /** precio sin redondear */
  price: number;
  /** precio redondeado según la regla de redondeo (presentación) */
  priceRounded: number;
  /** ganancia en dinero por pieza (sobre el precio redondeado) */
  profit: number;
  /** margen real sobre el precio de venta: profit / price */
  realMarginOnPrice: number;
  /** markup real sobre el costo: profit / costo */
  markupOnCost: number;
  /** tarifa de diseño repartida por unidad (designFee / cantidad) */
  designPerUnit: number;
  /** recargo por urgencia por unidad, sobre (precio + diseño) */
  rushAmount: number;
  /** precio final por unidad = priceRounded + designPerUnit + rushAmount */
  finalPerUnit: number;
  /** total del pedido a este precio (finalPerUnit × cantidad), elevado al mínimo */
  jobTotal: number;
  /** true si el precio mínimo de pedido levantó el total */
  hitMinimum: boolean;
}

/** Precio de mayoreo para un tramo. */
export interface WholesaleTierResult {
  minQty: number;
  marginPct: number;
  unitPrice: number;
  unitPriceRounded: number;
  lotTotal: number;
  /** true si es el tramo aplicable a la cantidad del pedido */
  applies: boolean;
}

/** Resumen de mayoreo. */
export interface WholesaleResult {
  tiers: WholesaleTierResult[];
  /** tramo aplicable a la cantidad del pedido (o null si no hay tramos) */
  appliedTier: WholesaleTierResult | null;
  /** total del lote a precio de menudeo (tramo de menor cantidad) */
  retailTotal: number;
  /** total del lote a precio del tramo aplicable */
  wholesaleTotal: number;
  /** ahorro = retailTotal - wholesaleTotal */
  savings: number;
}

/**
 * Producción por tandas: traduce lo que muestra el slicer para UNA tanda
 * (gramos/horas de una impresión) al pedido completo. Siempre presente en un
 * cálculo nuevo; los snapshots viejos (guardados antes) pueden no traerla.
 */
export interface ProductionSummary {
  /** piezas que caben en una impresión/tanda (= piecesPerBatch, o la cantidad total
   *  si el trabajo entra en una sola impresión) */
  piecesPerBatch: number;
  /** tandas necesarias = ceil(cantidad / piecesPerBatch) */
  batches: number;
  /** gramos REALES de todo el pedido (gramos de una tanda × cantidad/piezasPorTanda) */
  totalGrams: number;
  /** horas REALES de todo el pedido (horas de una tanda × cantidad/piezasPorTanda) */
  totalHours: number;
  /** costo real de producir UNA tanda */
  costPerBatch: number;
  /** costo real por unidad */
  costPerUnit: number;
  /** costo real de TODO el pedido */
  costTotal: number;
}

/** Estructura de tandas del trabajo (null si no hay multi-tanda). */
export interface BatchSummary {
  /** piezas por tanda (capacidad de la cama) */
  size: number;
  /** número de tandas = ceil(cantidad / size) */
  count: number;
  /** tandas llenas = floor(cantidad / size) */
  full: number;
  /** piezas en la tanda parcial (0 si la cantidad divide exacto) */
  partialPieces: number;
  /** costo de arranque por tanda */
  setupCostPerBatch: number;
  /** costo de arranque total (setupCostPerBatch × count) */
  setupCostTotal: number;
}

/** RESULTADO COMPLETO del motor de cálculo. */
export interface CalcResult {
  quantity: number;
  currency: string;
  locale: string;

  materials: MaterialResult[];
  components: ComponentResult[];
  packaging: PackagingResult[];
  labor: LaborResult[];

  /** desglose del lote por categoría (con merma aplicada donde corresponde) */
  breakdown: CostBreakdown;

  /** costo real del lote ANTES de aplicar merma */
  subtotalBeforeWaste: number;
  /** costo real total del lote (con merma) */
  costBatch: number;
  /** costo real por unidad */
  costPerUnit: number;

  /** precios de venta por margen (sobre el costo unitario) */
  prices: PriceResult[];

  /** mayoreo (null si no se definieron tramos) */
  wholesale: WholesaleResult | null;

  /** desglose por tandas; null cuando no se usó multi-tanda */
  batches: BatchSummary | null;

  /** producción por tandas (gramos/horas/costo reales del pedido). Opcional solo
   *  por retrocompatibilidad con snapshots guardados antes de existir este campo. */
  production?: ProductionSummary;
}
