import { z } from 'zod';
import { CalcInputSchema } from './calc';

/**
 * Contratos de la TIENDA — el catálogo ÚNICO del negocio.
 *
 * Desde 2026-09-07 la ficha de tienda es también el producto interno: guarda lo
 * que ve el cliente (fotos, opciones, visibilidad, slug) **y** su costeo
 * (`input` + `costAtPublish`), que es opcional. Un servicio o algo cargado a
 * mano simplemente no lo tiene. Spec:
 * `docs/superpowers/specs/2026-09-07-catalogo-unico-design.md`.
 */

/** Producto físico (se imprime y se entrega) o servicio (diseño, reparación). */
export const StoreProductKindSchema = z.enum(['PHYSICAL', 'SERVICE']);
export type StoreProductKind = z.infer<typeof StoreProductKindSchema>;

/** Identificador de URL: minúsculas, números y guiones. */
export const SlugSchema = z
  .string()
  .min(1, 'El enlace es obligatorio')
  .max(80, 'El enlace no puede pasar de 80 caracteres')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

/**
 * Convierte un nombre en slug. Vive en `shared` para que el panel muestre el
 * mismo enlace que después genera el backend (que es quien manda).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    // Tras NFD las tildes quedan como marcas sueltas; se van con el resto
    // de lo no-ASCII (asi 'cancion' no se parte en 'cancio-n').
    .replace(/[^ -~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

const price = z.number().min(0, 'El precio no puede ser negativo');

// ----- Opciones (color, tamaño, acabado) -----
//
// SIN combinatoria: al producirse bajo pedido no hay stock por combinación, así
// que no hacen falta SKU por variante. El recargo por opción alcanza.

export const StoreOptionSchema = z.object({
  value: z.string().min(1, 'La opción no puede estar vacía').max(60),
  /** Recargo sobre el precio base, en USD. */
  priceDeltaUsd: price.default(0),
  /** Muestra de color para el selector, si el grupo es de color. */
  swatchHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Usá un color en formato #RRGGBB')
    .nullable()
    .optional(),
});
export type StoreOptionDto = z.infer<typeof StoreOptionSchema>;

export const StoreOptionGroupSchema = z.object({
  name: z.string().min(1, 'El grupo necesita un nombre').max(40),
  required: z.boolean().default(false),
  options: z.array(StoreOptionSchema).min(1, 'Agregá al menos una opción').max(40),
});
export type StoreOptionGroupDto = z.infer<typeof StoreOptionGroupSchema>;

// ----- Ficha de tienda -----

/** Una fila de la ficha técnica ("Peso" → "12 g"). */
export const StoreSpecSchema = z.object({
  label: z.string().min(1, 'La especificación necesita un nombre').max(40),
  value: z.string().min(1, 'Falta el valor').max(120),
});
export type StoreSpecDto = z.infer<typeof StoreSpecSchema>;

export const StoreProductCreateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(120),
  /** Opcional: si no viene, el backend lo deriva del nombre y resuelve choques. */
  slug: SlugSchema.optional(),
  kind: StoreProductKindSchema.default('PHYSICAL'),
  summary: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  priceUsd: price,
  compareAtUsd: price.nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  /** Material de impresión que se muestra en la vitrina ("PLA", "PETG"). */
  material: z.string().max(40).nullable().optional(),
  /** Insignia de esquina de la tarjeta ("Nuevo", "Más vendido"). */
  badge: z.string().max(24).nullable().optional(),
  /** Si se puede pedir con nombre, logo o forma del cliente. */
  custom: z.boolean().default(false),
  /** Ficha técnica libre. */
  specs: z.array(StoreSpecSchema).max(20).default([]),
  minQty: z.number().int().positive().default(1),
  visible: z.boolean().default(false),
  categoryId: z.string().nullable().optional(),
  /**
   * Costeo de la ficha: el `CalcInput` con el que se calculó, tal cual lo deja
   * la calculadora. **El COSTO no se acepta del cliente**: el servidor lo
   * deriva corriendo el motor sobre este input.
   *
   * null / ausente = ficha sin costeo (un servicio, o algo cargado a mano).
   */
  input: CalcInputSchema.nullable().optional(),
  /** Origen de costeo heredado (se elimina con `Product` y `Quote`). */
  productId: z.string().nullable().optional(),
  quoteId: z.string().nullable().optional(),
  optionGroups: z.array(StoreOptionGroupSchema).max(10).default([]),
});
export type StoreProductCreateDto = z.infer<typeof StoreProductCreateSchema>;

export const StoreProductUpdateSchema = StoreProductCreateSchema.partial();
export type StoreProductUpdateDto = z.infer<typeof StoreProductUpdateSchema>;

/** Publicar en la tienda a partir de un producto interno o de una cotización. */
export const StoreProductFromSourceSchema = z
  .object({
    productId: z.string().optional(),
    quoteId: z.string().optional(),
  })
  .refine((v) => !!v.productId !== !!v.quoteId, {
    message: 'Indicá un producto o una cotización, no ambos',
  });
export type StoreProductFromSourceDto = z.infer<typeof StoreProductFromSourceSchema>;

/** Reordenar la vitrina: la posición es el índice en la lista. */
export const StoreReorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});
export type StoreReorderDto = z.infer<typeof StoreReorderSchema>;

// ----- Categorías -----

export const StoreCategorySchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  slug: SlugSchema.optional(),
});
export type StoreCategoryDto = z.infer<typeof StoreCategorySchema>;

// ----- Fotos -----

/** Tipos aceptados. WebP entra porque pesa menos en una vitrina. */
export const STORE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type StoreImageMimeType = (typeof STORE_IMAGE_MIME_TYPES)[number];

/** Tope por foto: 5 MB. */
export const STORE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Fotos por ficha. */
export const STORE_IMAGE_MAX_COUNT = 8;

/**
 * Paso 1 de la subida: el panel pide una URL firmada y sube el archivo DIRECTO
 * al almacenamiento. La foto nunca pasa por la API (si pasara, cada imagen de
 * varios MB chocaría contra el límite del body y quemaría CPU del servidor).
 */
export const StoreImageUploadUrlSchema = z.object({
  contentType: z.enum(STORE_IMAGE_MIME_TYPES, {
    errorMap: () => ({ message: 'La foto debe ser PNG, JPEG o WebP' }),
  }),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(STORE_IMAGE_MAX_BYTES, 'La foto no puede pesar más de 5 MB'),
});
export type StoreImageUploadUrlDto = z.infer<typeof StoreImageUploadUrlSchema>;

/**
 * Paso 2: confirmar la subida. El backend verifica contra el almacenamiento que
 * el objeto exista, tenga el tipo declarado y no exceda el tope — la firma acota
 * la subida, pero la confirmación es la que decide qué queda registrado.
 */
export const StoreImageConfirmSchema = z.object({
  key: z.string().min(1).max(200),
  alt: z.string().max(140).nullable().optional(),
  width: z.number().int().positive().max(20000).nullable().optional(),
  height: z.number().int().positive().max(20000).nullable().optional(),
});
export type StoreImageConfirmDto = z.infer<typeof StoreImageConfirmSchema>;
