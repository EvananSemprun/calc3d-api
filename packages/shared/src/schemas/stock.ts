import { z } from 'zod';

/**
 * Contratos del CONTROL DE FILAMENTO: compras y conteo mensual de rollos.
 * Equivalen a las hojas "Inventario" y "Stock mensual" del Excel.
 */

/** Un color que se sigue comprando, o uno que se decidió no reponer más. */
export const MaterialStatusSchema = z.enum(['ACTIVE', 'DISCONTINUED']);
export type MaterialStatus = z.infer<typeof MaterialStatusSchema>;

/** Mes del conteo, como `AAAA-MM`. */
export const MonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes debe ser AAAA-MM (ej. 2026-08)');

const rolls = z.number().int().min(0, 'No puede haber rollos negativos');

/**
 * Las tres casillas que se cuentan a mano al cierre de mes. El TOTAL no está
 * acá a propósito: se deriva con `stockTotal`, para que no pueda contradecir a
 * sus partes.
 */
export const StockCountPartsSchema = z.object({
  /** sellado, sin abrir */
  sealed: rolls.default(0),
  /** abierto y con material */
  inUse: rolls.default(0),
  /** le queda menos de un cuarto */
  running: rolls.default(0),
});
export type StockCountParts = z.infer<typeof StockCountPartsSchema>;

/** Guardar el conteo de un material en un mes. */
export const StockCountUpsertSchema = StockCountPartsSchema.extend({
  materialId: z.string().min(1, 'Falta el material'),
  month: MonthSchema,
});
export type StockCountUpsertDto = z.infer<typeof StockCountUpsertSchema>;

/** Una fila del conteo, como la ve la pantalla. */
export interface StockCountRow extends StockCountParts {
  materialId: string;
  name: string;
  type: string | null;
  brand: string | null;
  color: string | null;
  status: MaterialStatus;
  /** rollos totales de esa ficha (derivado) */
  total: number;
  /**
   * El conteo se importó del Excel sin saber la marca del rollo. Se apaga al
   * moverlo al material correcto.
   */
  needsBrandCheck: boolean;
  /** true si ese mes todavía no se contó (las tres casillas vienen en cero) */
  counted: boolean;
}

/** Una compra de filamento, con lo que costó de verdad. */
export interface FilamentPurchase {
  id: string;
  date: string;
  materialId: string | null;
  materialName: string | null;
  /** rollos comprados */
  quantity: number;
  /** lo pagado, en USD base (si se pagó en Bs, ya viene convertido) */
  amount: number;
  costPerRoll: number;
  costPerGram: number;
  providerName: string | null;
  note: string | null;
  /** tasa y moneda si el pago fue en bolívares */
  rate: number | null;
  currencyCode: string | null;
}
