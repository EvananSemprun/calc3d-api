import { z } from 'zod';

/**
 * Schemas Zod del MOTOR DE CÁLCULO.
 *
 * El contrato sigue la hoja "Costeo" del Excel de Banano Lab: una pantalla,
 * un filamento, una tabla de insumos, un margen objetivo y un precio final.
 *
 * Convenciones:
 * - Los porcentajes se expresan como FRACCIÓN decimal: 0.08 = 8 %, 0.3 = 30 %.
 *   La UI hace la conversión (8 -> 0.08) para evitar confusiones en el motor.
 * - El dinero entra como número y se calcula internamente con decimal.js.
 * - No se permiten divisores 0 (gramos de rollo, vida útil, cantidad de piezas,
 *   piezas por tanda, impresoras en paralelo).
 */

const positive = z.number().positive();
const nonNegative = z.number().min(0);

/** Regla de redondeo (solo presentación). */
export const RoundingModeSchema = z.enum(['NONE', 'NEAREST', 'UP', 'DOWN']);
export type RoundingMode = z.infer<typeof RoundingModeSchema>;

export const RoundingSchema = z.object({
  mode: RoundingModeSchema.default('NONE'),
  /** Incremento al que redondear: 0.5, 1, 5, 10... */
  increment: positive.default(1),
});
export type Rounding = z.infer<typeof RoundingSchema>;

/**
 * Estado comercial de un precio (fórmula B58 de la hoja).
 * - `LOSS`: el precio no cubre el costo.
 * - `LOW`: margen bajo el piso considerado sano.
 * - `BELOW_TARGET`: por debajo del margen objetivo, pero sobre el piso.
 * - `OK`: alcanza el objetivo.
 */
export const PriceStatusSchema = z.enum(['LOSS', 'LOW', 'BELOW_TARGET', 'OK']);
export type PriceStatus = z.infer<typeof PriceStatusSchema>;

/**
 * Piso de margen POR DEFECTO (60 %, tomado de la hoja). Es solo el default de
 * `margins.minMarginPct`: el valor efectivo lo decide el negocio en Settings.
 */
export const LOW_MARGIN_THRESHOLD = 0.6;

/** Cómo se dice cada estado, en la app y en los documentos internos. */
export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = {
  LOSS: 'PIERDES DINERO',
  LOW: 'Margen bajo',
  BELOW_TARGET: 'Por debajo de tu objetivo',
  OK: 'OK',
};

/**
 * Filamento del trabajo. `grams` son los de UNA TANDA, tal como los reporta el
 * laminador para la placa completa — NO los de una pieza suelta.
 */
export const FilamentSchema = z.object({
  name: z.string().optional(),
  rollPrice: nonNegative,
  rollGrams: positive, // no dividir entre 0
  grams: nonNegative,
});
export type Filament = z.infer<typeof FilamentSchema>;

/** Merma por fallos: se aplica SIEMPRE a filamento, desgaste y luz. */
export const WasteSchema = z.object({
  /** Fracción: 0.08 = 8 %. */
  pct: nonNegative.default(0.08),
});
export type Waste = z.infer<typeof WasteSchema>;

/**
 * Insumo con costo unitario ya resuelto (argolla, bolsita, imán...).
 * `qty` es cuántos lleva CADA PIEZA.
 */
export const SupplyLineSchema = z.object({
  name: z.string().optional(),
  qty: nonNegative,
  unitCost: nonNegative,
});
export type SupplyLine = z.infer<typeof SupplyLineSchema>;

/** Impresora elegida para el trabajo. `hours` son las de UNA tanda. */
export const PrinterInputSchema = z.object({
  name: z.string().optional(),
  price: nonNegative,
  lifetimeHours: positive, // no dividir entre 0
  hours: nonNegative,
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

/** Postprocesado: minutos POR PIEZA y el valor de la hora de trabajo. */
export const LaborSchema = z.object({
  minutes: nonNegative.default(0),
  hourlyRate: nonNegative.default(0),
});
export type Labor = z.infer<typeof LaborSchema>;

/**
 * Costos sueltos. El empaque es por pieza (una bolsita por llavero); "otros"
 * es un cargo único del pedido (diseño, envío, lo que sea) que se reparte
 * entre las unidades.
 */
export const ExtrasSchema = z.object({
  packagingPerPiece: nonNegative.default(0),
  otherPerOrder: nonNegative.default(0),
});
export type Extras = z.infer<typeof ExtrasSchema>;

/** Margen objetivo (markup sobre el costo), piso y regla de redondeo. */
export const MarginsSchema = z.object({
  /** Fracción: 1.0 = 100 % de ganancia sobre el costo. */
  markup: nonNegative.default(1),
  /**
   * Piso de margen real: por debajo, el precio se marca `LOW`. Es una decisión
   * del negocio (vive en Settings), no una constante escondida en el motor.
   */
  minMarginPct: nonNegative.default(LOW_MARGIN_THRESHOLD),
  rounding: RoundingSchema.default({ mode: 'NONE', increment: 1 }),
});
export type Margins = z.infer<typeof MarginsSchema>;

/** Tramo de mayoreo: un DESCUENTO sobre el precio final desde N unidades. */
export const WholesaleTierSchema = z.object({
  minQty: z.number().int().positive(),
  /** Fracción: 0.1 = 10 % de descuento. Un 100 % dejaría el precio en 0. */
  discountPct: z.number().min(0).lt(1),
});
export type WholesaleTier = z.infer<typeof WholesaleTierSchema>;

export const WholesaleSchema = z.object({
  tiers: z.array(WholesaleTierSchema).default([]),
});
export type Wholesale = z.infer<typeof WholesaleSchema>;

/** ENTRADA COMPLETA del motor de cálculo. */
export const CalcInputSchema = z.object({
  // 1. La pieza
  quantity: z.number().int().positive(), // no dividir entre 0
  /** Piezas que salen en UNA impresión. Los gramos y horas son los de esa tanda. */
  piecesPerBatch: z.number().int().positive().default(1),
  // 2. Filamento
  filament: FilamentSchema,
  waste: WasteSchema.default({ pct: 0.08 }),
  // 3. Insumos
  supplies: z.array(SupplyLineSchema).default([]),
  // 4. Máquina y energía
  printer: PrinterInputSchema.optional(),
  electricity: ElectricitySchema.default({ enabled: true, kwhPrice: 0 }),
  /** Impresoras trabajando a la vez. Solo acorta la ENTREGA: el desgaste es el mismo. */
  parallelPrinters: z.number().int().positive().default(1),
  // 5. Tu tiempo
  labor: LaborSchema.default({ minutes: 0, hourlyRate: 0 }),
  // 6. Empaque y otros
  extras: ExtrasSchema.default({ packagingPerPiece: 0, otherPerOrder: 0 }),
  // 7-8. Precio
  margins: MarginsSchema.default({
    markup: 1,
    minMarginPct: LOW_MARGIN_THRESHOLD,
    rounding: { mode: 'NONE', increment: 1 },
  }),
  /** Precio por pieza escrito a mano. Si viene, pisa al sugerido redondeado. */
  manualPrice: positive.nullable().default(null),
  // 11. Mayoreo
  wholesale: WholesaleSchema.default({ tiers: [] }),
  /** Solo para formateo en presentación; el motor no lo usa para calcular. */
  currency: z.string().default('USD'),
  locale: z.string().default('en-US'),
});
export type CalcInput = z.infer<typeof CalcInputSchema>;
