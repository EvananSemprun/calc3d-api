import { z } from 'zod';

/**
 * Schemas Zod del MOTOR DE CÁLCULO.
 *
 * Convenciones:
 * - Los porcentajes se expresan como FRACCIÓN decimal: 0.08 = 8 %, 0.3 = 30 %.
 *   La UI hace la conversión (8 -> 0.08) para evitar confusiones en el motor.
 * - El dinero entra como número y se calcula internamente con decimal.js.
 * - No se permiten divisores 0 (gramos de rollo, vida útil, unidades por
 *   paquete, cantidad de piezas).
 */

const positive = z.number().positive();
const nonNegative = z.number().min(0);

/** Cómo se carga el costo de un componente/empaque comprado por paquete. */
export const ProrationModeSchema = z.enum(['USED', 'FULL_PACKAGE']);
export type ProrationMode = z.infer<typeof ProrationModeSchema>;

/** Si un costo aplica a cada pieza o una sola vez al pedido completo. */
export const ScopeSchema = z.enum(['PER_PIECE', 'PER_ORDER']);
export type Scope = z.infer<typeof ScopeSchema>;

/** Categorías sobre las que puede aplicarse la merma. */
export const WasteCategorySchema = z.enum([
  'MATERIAL',
  'WEAR',
  'POWER',
  'COMPONENTS',
  'PACKAGING',
  'LABOR',
]);
export type WasteCategory = z.infer<typeof WasteCategorySchema>;

/** Markup (sobre costo) o margin (sobre precio de venta). */
export const MarginModeSchema = z.enum(['MARKUP', 'MARGIN']);
export type MarginMode = z.infer<typeof MarginModeSchema>;

/** Regla de redondeo (solo presentación). */
export const RoundingModeSchema = z.enum(['NONE', 'NEAREST', 'UP', 'DOWN']);
export type RoundingMode = z.infer<typeof RoundingModeSchema>;

export const RoundingSchema = z.object({
  mode: RoundingModeSchema.default('NONE'),
  /** Incremento al que redondear: 0.5, 1, 5, 10... */
  increment: positive.default(1),
});
export type Rounding = z.infer<typeof RoundingSchema>;

/** Línea de material: un rollo y los gramos TOTALES usados en el lote/trabajo
 *  (igual que las horas de la tanda; el costo por pieza se obtiene dividiendo
 *  entre la cantidad). Es el dato que da el slicer para toda la placa. */
export const MaterialLineSchema = z.object({
  name: z.string().optional(),
  rollPrice: nonNegative,
  rollGrams: positive, // no dividir entre 0
  grams: nonNegative,
});
export type MaterialLine = z.infer<typeof MaterialLineSchema>;

/** Impresora elegida para el lote. */
export const PrinterInputSchema = z.object({
  name: z.string().optional(),
  price: nonNegative,
  lifetimeHours: positive, // no dividir entre 0
  hours: nonNegative, // horas de la tanda (lote completo)
  powerKw: nonNegative.default(0),
  maintPerHour: nonNegative.default(0),
});
export type PrinterInput = z.infer<typeof PrinterInputSchema>;

/** Electricidad. Puede desactivarse. */
export const ElectricitySchema = z.object({
  enabled: z.boolean().default(true),
  kwhPrice: nonNegative.default(0),
});
export type Electricity = z.infer<typeof ElectricitySchema>;

/** Componente comprado por paquete (argolla, imán, tornillo...). */
export const ComponentLineSchema = z.object({
  name: z.string().optional(),
  packagePrice: nonNegative,
  unitsPerPackage: positive, // no dividir entre 0
  unitsPerPiece: nonNegative, // cuántas lleva CADA pieza
  prorationMode: ProrationModeSchema.default('FULL_PACKAGE'),
});
export type ComponentLine = z.infer<typeof ComponentLineSchema>;

/** Empaque (bolsa, caja, etiqueta...). Por pieza o por pedido. */
export const PackagingLineSchema = z.object({
  name: z.string().optional(),
  packagePrice: nonNegative,
  unitsPerPackage: positive,
  unitsPerPiece: nonNegative.default(1),
  scope: ScopeSchema.default('PER_PIECE'),
  prorationMode: ProrationModeSchema.default('FULL_PACKAGE'),
});
export type PackagingLine = z.infer<typeof PackagingLineSchema>;

/** Tarea de mano de obra / postprocesado. */
export const LaborLineSchema = z.object({
  name: z.string().optional(),
  hourlyRate: nonNegative,
  hours: nonNegative,
  scope: ScopeSchema.default('PER_PIECE'),
});
export type LaborLine = z.infer<typeof LaborLineSchema>;

/** Configuración de merma por fallos. */
export const WasteSchema = z.object({
  /** Fracción: 0.08 = 8 %. */
  pct: nonNegative.default(0.08),
  /** Categorías a las que se aplica. */
  appliesTo: z.array(WasteCategorySchema).default(['MATERIAL', 'WEAR', 'POWER']),
});
export type Waste = z.infer<typeof WasteSchema>;

/** Configuración de márgenes de ganancia. */
export const MarginsSchema = z.object({
  /** Fracciones: [0.3, 0.5, 1.0] = 30/50/100 %. */
  markups: z.array(nonNegative).default([0.3, 0.5, 1.0]),
  mode: MarginModeSchema.default('MARKUP'),
  rounding: RoundingSchema.default({ mode: 'NONE', increment: 1 }),
});
export type Margins = z.infer<typeof MarginsSchema>;

/** Tramo de mayoreo. */
export const WholesaleTierSchema = z.object({
  minQty: z.number().int().positive(),
  /** Fracción de margen para ese tramo. */
  marginPct: nonNegative,
});
export type WholesaleTier = z.infer<typeof WholesaleTierSchema>;

export const WholesaleSchema = z.object({
  tiers: z.array(WholesaleTierSchema).default([]),
});
export type Wholesale = z.infer<typeof WholesaleSchema>;

/** Lote por tandas: capacidad de la cama y costo de arranque por tanda.
 *  Sin piecesPerBatch, el trabajo entero es "una tanda" (comportamiento clásico). */
export const BatchSchema = z.object({
  /** Piezas que caben en una cama (tanda). Vacío = una sola tanda con todo. */
  piecesPerBatch: z.number().int().positive().optional(),
  /** Costo de preparación/arranque por CADA tanda (dinero). */
  setupCost: nonNegative.default(0),
});
export type Batch = z.infer<typeof BatchSchema>;

/** Ajustes al PRECIO de venta (no al costo). */
export const SurchargesSchema = z.object({
  /** Cobro único por diseño/modelado, amortizado entre las unidades. */
  designFee: nonNegative.default(0),
  /** Recargo por urgencia como FRACCIÓN (0.5 = 50 %) sobre el precio final. */
  rushPct: nonNegative.default(0),
  /** Piso al total del pedido: si el total queda por debajo, se eleva a este valor. */
  minOrderPrice: nonNegative.default(0),
});
export type Surcharges = z.infer<typeof SurchargesSchema>;

/** ENTRADA COMPLETA del motor de cálculo. */
export const CalcInputSchema = z.object({
  quantity: z.number().int().positive(), // no dividir entre 0
  materials: z.array(MaterialLineSchema).default([]),
  printer: PrinterInputSchema.optional(),
  electricity: ElectricitySchema.default({ enabled: true, kwhPrice: 0 }),
  components: z.array(ComponentLineSchema).default([]),
  packaging: z.array(PackagingLineSchema).default([]),
  labor: z.array(LaborLineSchema).default([]),
  waste: WasteSchema.default({ pct: 0.08, appliesTo: ['MATERIAL', 'WEAR', 'POWER'] }),
  margins: MarginsSchema.default({
    markups: [0.3, 0.5, 1.0],
    mode: 'MARKUP',
    rounding: { mode: 'NONE', increment: 1 },
  }),
  wholesale: WholesaleSchema.default({ tiers: [] }),
  batch: BatchSchema.default({ setupCost: 0 }),
  surcharges: SurchargesSchema.default({ designFee: 0, rushPct: 0, minOrderPrice: 0 }),
  /** Solo para formateo en presentación; el motor no lo usa para calcular. */
  currency: z.string().default('USD'),
  locale: z.string().default('en-US'),
});
export type CalcInput = z.infer<typeof CalcInputSchema>;
