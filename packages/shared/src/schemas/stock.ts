import { z } from 'zod';

/**
 * Contratos del CONTROL DE FILAMENTO: compras y conteo mensual de rollos.
 * Equivalen a las hojas "Inventario" y "Stock mensual" del Excel.
 */

/** Un color que se sigue comprando, o uno que se decidió no reponer más. */
export const MaterialStatusSchema = z.enum(['ACTIVE', 'DISCONTINUED']);
export type MaterialStatus = z.infer<typeof MaterialStatusSchema>;

/**
 * Descontinuar o reactivar una ficha (`PATCH /materials/:id/status`). Va aparte
 * del formulario de la ficha a propósito: guardar un precio nunca cambia el estado.
 */
export const MaterialStatusUpdateSchema = z.object({ status: MaterialStatusSchema });
export type MaterialStatusUpdateDto = z.infer<typeof MaterialStatusUpdateSchema>;

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

/**
 * CERRAR el conteo de un mes: la única forma de escribir conteos. Lo que no
 * viene en `counts` se guarda en 0 (casillas vacías = no hay, como el Excel).
 */
export const StockMonthCloseSchema = z.object({
  month: MonthSchema,
  counts: z
    .array(StockCountPartsSchema.extend({ materialId: z.string().min(1, 'Falta el material') }))
    .max(500, 'Demasiadas fichas en un solo cierre')
    .default([]),
});
export type StockMonthCloseDto = z.infer<typeof StockMonthCloseSchema>;

/** Reabrir un mes cerrado para corregirlo. */
export const StockMonthReopenSchema = z.object({ month: MonthSchema });
export type StockMonthReopenDto = z.infer<typeof StockMonthReopenSchema>;

/** Estado del cierre de un mes (`GET /filament/stock/status`). */
export interface StockMonthStatus {
  /** `AAAA-MM` */
  month: string;
  closed: boolean;
  /** ISO; null si está abierto */
  closedAt: string | null;
  /** ISO de la última reapertura; null si nunca se reabrió */
  reopenedAt: string | null;
  /** hoy, en la zona del negocio, ya es el último día del mes o después */
  canClose: boolean;
  /** `'AAAA-MM-DD'`: desde qué día se puede cerrar */
  closableFrom: string;
}

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
   * CERRAR el mes (el cierre escribe `needsBrandCheck: false` en todas las
   * fichas), no al moverlo al material correcto.
   */
  needsBrandCheck: boolean;
  /**
   * true si el mes está CERRADO (lo no marcado vale 0); false si está
   * abierto o reabierto.
   */
  counted: boolean;
}

/** Una compra de filamento, con lo que costó de verdad. */
export interface FilamentPurchase {
  id: string;
  date: string;
  materialId: string | null;
  materialName: string | null;
  /** Marca, tipo y color de la ficha: es con lo que se agrupa el análisis. */
  brand: string | null;
  type: string | null;
  color: string | null;
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
