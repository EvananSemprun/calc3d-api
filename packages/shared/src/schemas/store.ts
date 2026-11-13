import { z } from 'zod';
import { CalcInputSchema } from './calc';
import { FECHA_OPCIONAL } from './api';


/**
 * Cuántos grupos de opciones puede tener una ficha (Color, Tamaño…).
 *
 * ⚠️ Lo lee TAMBIÉN el contrato del pedido público, para acotar cuántas
 * opciones puede traer un renglón: no puede haber más opciones elegidas que
 * grupos donde elegirlas. Si se sube acá, el pedido lo sigue solo.
 *
 * ⚠️ Va al PRINCIPIO del archivo: es un `const`, y declarada más abajo los
 * schemas de arriba no pueden usarla (TDZ al cargar el módulo). Es la misma
 * trampa que obligó a subir `FECHA` en `api.ts`.
 */
export const STORE_MAX_OPTION_GROUPS = 10;

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
  /** Id estable de la opción, para que las fotos enlazadas sobrevivan a un guardado. */
  id: z.string().optional(),
  value: z.string().min(1, 'La opción no puede estar vacía').max(60),
  /** Recargo sobre el precio base, en USD. */
  priceDeltaUsd: price.default(0),
  /** Muestra de color para el selector, si el grupo es de color. */
  swatchHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color en formato #RRGGBB')
    .nullable()
    .optional(),
  /**
   * Días de entrega PROPIOS de esta opción, para cuando elegirla cambia el plazo (un
   * tamaño grande, un acabado que lleva otro proceso).
   *
   * ⚠️ Ausente o `null` significa **«esta opción no cambia el plazo»** y manda el del
   * producto. NO es lo mismo que `0`, que sería prometer entrega el mismo día. Por eso
   * es nullable y no tiene `.default(0)`.
   *
   * El tope de 365 no es burocracia: el error que de verdad pasa es un dedo de más
   * (30 → 300) y nadie lo nota hasta que un cliente lee «listo en 300 días».
   */
  leadTimeDays: z
    .number()
    .int('Los días de entrega tienen que ser enteros')
    .min(0, 'Los días de entrega no pueden ser negativos')
    .max(365, 'Ese plazo parece un error: revisa los días')
    .nullable()
    .optional(),
});
export type StoreOptionDto = z.infer<typeof StoreOptionSchema>;

export const StoreOptionGroupSchema = z.object({
  /** Id estable del grupo (ver StoreOptionSchema.id). */
  id: z.string().optional(),
  name: z.string().min(1, 'El grupo necesita un nombre').max(40),
  required: z.boolean().default(false),
  /** Marca el grupo cuyas opciones definen la foto de la ficha. A lo sumo uno por producto. */
  drivesPhoto: z.boolean().default(false),
  options: z.array(StoreOptionSchema).min(1, 'Agrega al menos una opción').max(40),
});
export type StoreOptionGroupDto = z.infer<typeof StoreOptionGroupSchema>;

// ----- Ficha de tienda -----

/** Una fila de la ficha técnica ("Peso" → "12 g"). */
export const StoreSpecSchema = z.object({
  label: z.string().min(1, 'La especificación necesita un nombre').max(40),
  value: z.string().min(1, 'Falta el valor').max(120),
});
export type StoreSpecDto = z.infer<typeof StoreSpecSchema>;

/**
 * Un tramo de precio por cantidad: desde `minQty` unidades.
 *
 * **DOS formas de decir el precio del tramo**, y hay que aceptar las dos:
 *
 * - `unitPriceUsd` — el precio unitario de LISTA para ese tramo, escrito a mano. Es la
 *   forma nueva (2026-11-08) y la preferida: con el descuento en porcentaje no se puede
 *   llegar a un precio redondo (de $1,50 un 27 % da $1,0950), que es justo lo que el
 *   dueño necesita para la vitrina.
 * - `discountPct` — descuento sobre el unitario (fracción, 0.10 = 10 %). Es la forma
 *   vieja. ⚠️ **NO se puede retirar**: hay fichas publicadas guardadas así, y dejar de
 *   leerla las deja sin mayoreo sin un solo error.
 *
 * Tiene que venir **exactamente una**. Las dos a la vez no se rechazan por el tipo
 * —un dato viejo migrado podría traerlas—, pero el motor le da prioridad al precio
 * fijo: es lo que el dueño escribió.
 */
export const StorePriceTierSchema = z
  .object({
    minQty: z.number().int().min(2, 'El tramo empieza desde 2 unidades'),
    discountPct: z.number().min(0).lt(1, 'El descuento va entre 0 y menos de 1').optional(),
    unitPriceUsd: z.number().positive('El precio del tramo tiene que ser mayor que 0').optional(),
  })
  .refine((t) => t.discountPct !== undefined || t.unitPriceUsd !== undefined, {
    message: 'El tramo necesita un precio o un descuento',
  });
export type StorePriceTier = z.infer<typeof StorePriceTierSchema>;

/** Valida los tramos: crecientes por `minQty`, sin duplicados, y el primero por
 *  encima del mínimo del producto (cuando `minQty` del producto viene en el DTO). */
const validarTramos = (
  val: { priceTiers?: StorePriceTier[]; minQty?: number },
  ctx: z.RefinementCtx,
) => {
  const tiers = val.priceTiers ?? [];
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minQty <= tiers[i - 1].minQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceTiers', i, 'minQty'],
        message: 'Los tramos tienen que ir de menor a mayor cantidad',
      });
    }
  }
  if (tiers.length > 0 && val.minQty != null && tiers[0].minQty <= val.minQty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priceTiers', 0, 'minQty'],
      message: 'El primer tramo tiene que superar el mínimo del producto',
    });
  }
};

const StoreProductFields = z.object({
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
  /**
   * Insignia de esquina escrita por el dueño ('Más vendido', 'Edición limitada').
   *
   * ⚠️ 'Nuevo' NO se acepta: desde el 2026-11-08 es AUTOMÁTICA y sale de la fecha de
   * publicación. Escribirla a mano dejaría dos insignias iguales pegadas, y una que
   * miente cuando el producto deje de ser nuevo y nadie la borre.
   */
  badge: z
    .string()
    .max(24)
    .refine((v) => v.trim().toLowerCase() !== 'nuevo', {
      message: '«Nuevo» se pone solo en los productos recién publicados: elige otra palabra',
    })
    .nullable()
    .optional(),
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
  /** Tramos de precio por cantidad (mayoreo). El descuento lo aplica el servidor. */
  priceTiers: z.array(StorePriceTierSchema).max(8).default([]),
  optionGroups: z.array(StoreOptionGroupSchema).max(STORE_MAX_OPTION_GROUPS).default([]),
});

export const StoreProductCreateSchema = StoreProductFields.superRefine(validarTramos);
export type StoreProductCreateDto = z.infer<typeof StoreProductCreateSchema>;

export const StoreProductUpdateSchema = StoreProductFields.partial().superRefine(validarTramos);
export type StoreProductUpdateDto = z.infer<typeof StoreProductUpdateSchema>;


/** Reordenar la vitrina: la posición es el índice en la lista. */
export const StoreReorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});
export type StoreReorderDto = z.infer<typeof StoreReorderSchema>;

// ----- Categorías -----

export const StoreCategorySchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  slug: SlugSchema.optional(),
  /** `null` = moverla a la raíz; ausente = no tocarla. Las dos hacen falta. */
  parentId: z.string().min(1).nullable().optional(),
});
export type StoreCategoryDto = z.infer<typeof StoreCategorySchema>;

/**
 * PATCH de categoría: PARCIAL. Mover manda solo `parentId` y renombrar solo `name`;
 * si el contrato exigiera `name`, mover pisaría el nombre (y el enlace público) con el
 * valor cacheado del panel.
 */
export const StoreCategoryUpdateSchema = StoreCategorySchema.partial();
export type StoreCategoryUpdateDto = z.infer<typeof StoreCategoryUpdateSchema>;

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
  /** Si la foto es de un color: id de una opción de un grupo que define la foto.
   *  El servidor valida que la opción sea del producto. Ausente = galería base. */
  optionId: z.string().optional(),
});
export type StoreImageConfirmDto = z.infer<typeof StoreImageConfirmSchema>;

// ----- Banners del carrusel -----
//
// La imagen se sube con el MISMO flujo de 2 pasos que las fotos de ficha
// (StoreImageUploadUrlSchema arriba): se guarda la clave de R2, no la URL.

/** A dónde lleva el banner al hacerle clic. UN solo tipo por banner. */
/**
 * QUÉ clase de banner es, o sea DÓNDE se muestra. No confundir con `linkType`, que es
 * adónde LLEVA: un banner de categoría puede además enlazar a un producto.
 *  - HERO: el carrusel de la portada.
 *  - TEXTO: la franja de arriba, en todas las páginas. No lleva imagen.
 *  - CATEGORIA: se ve en esa categoría y en las fichas de sus productos.
 */
export const StoreBannerKindSchema = z.enum(['HERO', 'TEXTO', 'CATEGORIA']);
export type StoreBannerKind = z.infer<typeof StoreBannerKindSchema>;

export const StoreBannerLinkTypeSchema = z.enum(['NONE', 'CATEGORY', 'PRODUCT', 'URL']);
export type StoreBannerLinkType = z.infer<typeof StoreBannerLinkTypeSchema>;

export const StoreBannerCreateSchema = z
  .object({
    title: z.string().min(1, 'El título es obligatorio').max(120),
    subtitle: z.string().max(200).nullable().optional(),
    kind: StoreBannerKindSchema.default('HERO'),
    /**
     * Clave del objeto en R2 (ya subido vía URL firmada). OPCIONAL en el contrato y
     * exigida por tipo en el `superRefine`: un banner de TEXTO no tiene imagen.
     */
    imageKey: z.string().min(1, 'Falta la imagen').max(200).nullable().optional(),
    /**
     * EL FONDO del hero: la imagen grande que se ve detrás del texto, a todo el ancho.
     * Solo en HERO.
     *
     * ⚠️ Es OTRA cosa que `imageKey`, que es el arte al costado del texto (el que
     * reemplaza al banano). Un banner de portada puede llevar las dos, solo el fondo —y
     * entonces el título va sobre la foto, que es como se ve la mayoría de las campañas—
     * o solo el arte, que es como funcionaba hasta el 2026-11-11. Lo único que no puede
     * es no llevar ninguna.
     */
    backgroundKey: z.string().min(1).max(200).nullable().optional(),
    /** Categoría donde se muestra. Solo en CATEGORIA. */
    categoryId: z.string().max(60).nullable().optional(),
    linkType: StoreBannerLinkTypeSchema.default('NONE'),
    /** slug de categoría/producto, o URL http(s); vacío para NONE. */
    linkValue: z.string().max(500).nullable().optional(),
    visible: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    // Cada tipo EXIGE lo suyo y PROHÍBE lo ajeno. Lo segundo importa tanto como lo
    // primero: un campo que el tipo no usa, guardado porque el formulario lo ofrecía,
    // después alguien lo lee como información.
    const falta = (campo: 'imageKey' | 'backgroundKey' | 'categoryId', message: string) =>
      ctx.addIssue({ code: 'custom', path: [campo], message });

    if (v.kind === 'TEXTO') {
      if (v.imageKey) falta('imageKey', 'Un banner de texto no lleva imagen');
      if (v.backgroundKey) falta('backgroundKey', 'Un banner de texto no lleva fondo');
      if (v.categoryId) falta('categoryId', 'Un banner de texto no va en una categoría');
    } else if (v.kind === 'CATEGORIA') {
      if (!v.imageKey) falta('imageKey', 'Falta la imagen');
      // El fondo es del hero: en una categoría la imagen YA es el banner entero.
      if (v.backgroundKey) falta('backgroundKey', 'El fondo es solo para los banners de portada');
      if (!v.categoryId) falta('categoryId', 'Elige la categoría donde se muestra');
    } else {
      // HERO: le sirve cualquiera de las dos, pero alguna tiene que haber — sin ninguna
      // la portada quedaría con un título flotando sobre el fondo liso de siempre, que es
      // peor que el hero de marca que reemplaza.
      if (!v.imageKey && !v.backgroundKey) {
        falta('imageKey', 'Sube el fondo, la imagen de al lado, o las dos');
      }
      if (v.categoryId) falta('categoryId', 'Un banner de portada no va en una categoría');
    }

    if (v.linkType === 'NONE') {
      if (v.linkValue) {
        ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'Un banner sin enlace no lleva destino' });
      }
      return;
    }
    if (!v.linkValue) {
      ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'Falta el destino del banner' });
      return;
    }
    // Solo http(s) con el protocolo escrito: un `javascript:` no puede terminar
    // en el href de la tienda.
    if (v.linkType === 'URL' && !/^https?:\/\//i.test(v.linkValue)) {
      ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'El enlace tiene que empezar con http:// o https://' });
    }
  });
export type StoreBannerCreateDto = z.infer<typeof StoreBannerCreateSchema>;

/**
 * El Update exige el objeto completo (no `.partial()`: ZodEffects del
 * `superRefine` no lo soporta, y el panel manda el banner entero igual que la
 * ficha). Si la imagen no cambió, se repite la `imageKey` vigente.
 */
export const StoreBannerUpdateSchema = StoreBannerCreateSchema;
export type StoreBannerUpdateDto = z.infer<typeof StoreBannerUpdateSchema>;

// ----- Colección principal de la portada -----

export const StoreCollectionVerTodoSchema = z.enum(['CATEGORIA', 'COLECCION', 'NONE']);
export type StoreCollectionVerTodo = z.infer<typeof StoreCollectionVerTodoSchema>;

/**
 * Una entrada de la colección: una categoría entera O un producto suelto, nunca las dos
 * ni ninguna (la tabla lo impone con un CHECK; esto lo dice antes, con un mensaje).
 *
 * `id` es OPCIONAL a propósito: sin id es una entrada nueva; con id es una que ya existe
 * y el servidor la ACTUALIZA. Es lo que permite el diff por id y evita borrar y recrear.
 */
export const StoreCollectionItemInputSchema = z
  .object({
    id: z.string().min(1).max(60).optional(),
    categoryId: z.string().min(1).max(60).nullable().optional(),
    productId: z.string().min(1).max(60).nullable().optional(),
    position: z.number().int().min(0).max(10_000),
  })
  .superRefine((v, ctx) => {
    const cuantos = (v.categoryId ? 1 : 0) + (v.productId ? 1 : 0);
    if (cuantos !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'Cada entrada es una categoría o un producto suelto, no las dos ni ninguna',
      });
    }
  });
export type StoreCollectionItemInput = z.infer<typeof StoreCollectionItemInputSchema>;

/**
 * Crear y editar una colección. El panel manda la colección ENTERA (como los banners).
 *
 * ⚠️ `esPrincipal` NO está acá: cuál es la principal se decide con su propio endpoint
 * (tarea 3), dentro de una transacción. Si viajara en el cuerpo, dos ediciones podrían
 * dejar dos principales a la vez.
 */
export const StoreCollectionUpsertSchema = z
  .object({
    /**
     * Enlace público de la colección. Opcional: sin él se arma del nombre (y al editar se
     * conserva el que tenía, para que renombrar no cambie la URL).
     */
    slug: SlugSchema.optional(),
    nombre: z.string().min(1, 'El nombre es obligatorio').max(80),
    titulo: z.string().min(1, 'El título es obligatorio').max(120),
    subtitulo: z.string().max(200).nullable().optional(),
    verTodoTipo: StoreCollectionVerTodoSchema.default('NONE'),
    /** SIEMPRE un slug (de categoría o de colección según el tipo), jamás un id: se publica. */
    verTodoValor: z.string().min(1).max(120).nullable().optional(),
    visible: z.boolean().default(true),
    // Fechas de NEGOCIO (día pelado AAAA-MM-DD, validado contra el calendario): un
    // '2026-02-30' guardado se corre al 2 de marzo y la colección arrancaría otro día.
    startsAt: FECHA_OPCIONAL,
    endsAt: FECHA_OPCIONAL,
    items: z.array(StoreCollectionItemInputSchema).max(200).default([]),
    /** ids de producto excluidos aunque entren por su categoría. */
    exclusiones: z.array(z.string().min(1).max(60)).max(500).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.verTodoTipo === 'NONE') {
      if (v.verTodoValor) {
        ctx.addIssue({ code: 'custom', path: ['verTodoValor'], message: 'Sin «Ver todo» no hay destino' });
      }
    } else if (!v.verTodoValor) {
      ctx.addIssue({ code: 'custom', path: ['verTodoValor'], message: 'Falta el destino del «Ver todo»' });
    }

    // Repetir la misma categoría o producto es un error del formulario, no dos entradas:
    // la tabla lo rechazaría con un 500 de índice único; acá sale con mensaje.
    const vistas = new Set<string>();
    v.items.forEach((it, i) => {
      const clave = it.categoryId ? `c:${it.categoryId}` : it.productId ? `p:${it.productId}` : null;
      if (!clave) return;
      if (vistas.has(clave)) {
        ctx.addIssue({ code: 'custom', path: ['items', i], message: 'Esa categoría o producto ya está en la colección' });
      }
      vistas.add(clave);
    });

    if (new Set(v.exclusiones).size !== v.exclusiones.length) {
      ctx.addIssue({ code: 'custom', path: ['exclusiones'], message: 'Hay un producto excluido dos veces' });
    }

    // Bordes inclusivos (tarea 3), así que el mismo día es una ventana válida de un día.
    if (v.startsAt && v.endsAt && v.startsAt > v.endsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'La colección no puede terminar antes de empezar' });
    }
  });
export type StoreCollectionUpsertDto = z.infer<typeof StoreCollectionUpsertSchema>;
