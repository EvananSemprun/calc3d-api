import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { businessDateKey, esNuevo } from '@calc3d/shared';
import { activeSale, type SaleWindow } from './active-sale';

/**
 * Cara PÚBLICA del catálogo: lo único del sistema que se sirve SIN sesión.
 *
 * Dos reglas que no se negocian acá:
 *
 * 1. **Lista blanca de campos.** Cada respuesta se arma campo por campo, nunca
 *    devolviendo la fila de Prisma. Un `include` nuevo en el futuro no puede
 *    filtrar `costAtPublish`, `productId`, `quoteId` ni `organizationId` porque
 *    no hay ningún camino por el que salgan.
 * 2. **La organización la fija el servidor.** Sin sesión no hay `organizationId`,
 *    así que sale de `STORE_ORGANIZATION_ID`. Jamás de un parámetro del cliente:
 *    eso sería un listado de datos de cualquier organización a pedido.
 */

interface PublicOption {
  value: string;
  priceDeltaUsd: number;
  swatchHex: string | null;
  /** Fotos propias de este color (solo las tienen las opciones del grupo que
   *  define la foto). Vacío = la ficha usa la galería base. */
  images: PublicImage[];
}

interface PublicOptionGroup {
  name: string;
  required: boolean;
  /** true en el grupo cuyas opciones definen la galería de la ficha. */
  drivesPhoto: boolean;
  options: PublicOption[];
}

interface PublicImage {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

interface PublicCategory {
  name: string;
  slug: string;
}

/** Nodo del árbol de categorías, en lista plana: la madre viaja como SLUG (el id
 *  es interno). Para armar el árbol con `arbolDeCategorias` (shared) hay que mapear cada
 *  nodo a `CategoriaPlana`: `id: slug`, `parentId: parentSlug`, `position: el índice` en la
 *  lista. NO se exponen `id` ni `position` reales: la lista blanca los prohíbe. */
interface PublicCategoryNode extends PublicCategory {
  parentSlug: string | null;
}

/** Una fila de la ficha técnica. */
interface PublicSpec {
  label: string;
  value: string;
}

/** Muestra de color para la tarjeta (la vitrina filtra por color). */
interface PublicSwatch {
  value: string;
  swatchHex: string;
}

/** Tarjeta de la vitrina: lo mínimo para listar. */
interface PublicProductCard {
  slug: string;
  name: string;
  kind: 'PHYSICAL' | 'SERVICE';
  summary: string | null;
  priceUsd: number;
  compareAtUsd: number | null;
  /**
   * Tramos de precio por cantidad (mayoreo), para mostrar y recalcular en la tienda.
   * DOS formas, y viaja SOLO la que el tramo tiene (ver `tramoPublico`).
   */
  priceTiers: ({ minQty: number } & ({ unitPriceUsd: number } | { discountPct: number }))[];
  leadTimeDays: number | null;
  minQty: number;
  material: string | null;
  badge: string | null;
  custom: boolean;
  category: PublicCategory | null;
  image: PublicImage | null;
  /** Colores disponibles, para las muestras y el filtro de la vitrina. */
  colors: PublicSwatch[];
  /** true si hay que elegir algo antes de pedirlo: la vitrina manda a la ficha
   *  en vez de agregar a ciegas y cotizar un precio que no corresponde. */
  requiresOptions: boolean;
  /**
   * Insignia «Nuevo», DERIVADA de cuándo se publicó la ficha (`esNuevo` de shared).
   *
   * ⚠️ Se calcula al responder, y la tienda la hornea en su build porque es estática:
   * una ficha deja de ser nueva recién cuando el sitio se reconstruye. Decidido y
   * aceptado por el dueño el 2026-11-08 — en la práctica se corrige solo, porque
   * publicar un producto reconstruye la tienda y recalcula a todas.
   */
  nuevo: boolean;
}

/** Ficha completa. */
interface PublicProductDetail extends Omit<PublicProductCard, 'image'> {
  description: string | null;
  specs: PublicSpec[];
  images: PublicImage[];
  optionGroups: PublicOptionGroup[];
}

interface PublicBanner {
  /** DÓNDE se muestra. No confundir con `linkType`, que es adónde lleva. */
  kind: 'HERO' | 'TEXTO' | 'CATEGORIA';
  title: string;
  subtitle: string | null;
  /** null en los de TEXTO: no tienen imagen. */
  imageUrl: string | null;
  /** Solo en CATEGORIA: el slug de la categoría donde se muestra. */
  categorySlug: string | null;
  linkType: 'NONE' | 'CATEGORY' | 'PRODUCT' | 'URL';
  linkValue: string | null;
}

/** Campos de la fila de Prisma que alimentan la tarjeta. */
interface CardRow {
  slug: string;
  name: string;
  kind: 'PHYSICAL' | 'SERVICE';
  summary: string | null;
  priceUsd: unknown;
  compareAtUsd: unknown;
  priceTiers: unknown;
  leadTimeDays: number | null;
  minQty: number;
  material: string | null;
  badge: string | null;
  custom: boolean;
  publishedAt: Date | null;
  category: PublicCategory | null;
}

interface ImageRow {
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

/** Galería BASE: solo las fotos de nivel producto. Las de una opción (color) salen
 *  por su opción; sin este filtro la foto de la tarjeta podía ser la de un color. */
const GALERIA_BASE = { optionId: null } as const;

/** Consulta de la tarjeta: la categoría, UNA foto base y los grupos de opciones. */
function includeTarjeta() {
  return {
    category: { select: { name: true, slug: true } },
    images: { where: GALERIA_BASE, orderBy: { position: 'asc' as const }, take: 1 },
    // TODOS los grupos con todas sus opciones, no solo el de color: no se filtra
    // por nombre. La tarjeta los lee para los colores y `requiresOptions`.
    optionGroups: {
      orderBy: { position: 'asc' as const },
      include: { options: { orderBy: { position: 'asc' as const } } },
    },
  };
}

/** Consulta de la ficha: la galería base entera y las fotos de cada opción. */
function includeFicha() {
  return {
    category: { select: { name: true, slug: true } },
    images: { where: GALERIA_BASE, orderBy: { position: 'asc' as const } },
    optionGroups: {
      orderBy: { position: 'asc' as const },
      include: {
        options: {
          orderBy: { position: 'asc' as const },
          include: { images: { orderBy: { position: 'asc' as const } } },
        },
      },
    },
  };
}

type TramoGuardado = { minQty?: unknown; discountPct?: unknown; unitPriceUsd?: unknown };

/**
 * Un tramo de mayoreo, saneado para la tienda.
 *
 * **DOS formas y hay que respetar las dos**: `unitPriceUsd` es el precio unitario fijo
 * (la nueva, la única que permite un precio redondo) y `discountPct` el descuento (la
 * vieja, que NO se puede retirar porque hay fichas publicadas guardadas así).
 *
 * ⚠️ **La clave que no corresponde se OMITE; nunca viaja en `null`.** `precioConTramos`
 * —acá en shared y reimplementado en la tienda— pregunta `unitPriceUsd !== undefined`:
 * un `null` PASA esa guarda y el tramo pasaría a valer 0.
 *
 * ⚠️ **Y nunca sale un `NaN`.** Así se rompió el 2026-11-08: este mapeo armaba
 * `{ minQty, discountPct }` a mano, `Number(undefined)` daba NaN y en JSON viajaba como
 * `null`, así que la tienda mostraba el precio de lista en todos los tramos mientras el
 * servidor cobraba el del tramo (lo lee de la base, no de acá).
 */
function tramoPublico(t: TramoGuardado) {
  const minQty = Number(t.minQty);
  if (t.unitPriceUsd != null) return { minQty, unitPriceUsd: Number(t.unitPriceUsd) };
  // Un tramo sin ninguna de las dos está corrupto: degrada a "sin descuento", que es
  // el lado seguro, en vez de publicar un NaN.
  return { minQty, discountPct: Number(t.discountPct ?? 0) };
}

@Injectable()
export class StorePublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly rates: ExchangeRatesService,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Organización que publica la tienda. Del entorno, nunca del cliente. */
  private get organizationId(): string {
    const id = this.config.get<string>('STORE_ORGANIZATION_ID');
    if (!id) {
      throw new ServiceUnavailableException('La tienda no está configurada');
    }
    return id;
  }

  /** Datos del negocio que la tienda necesita para su cabecera y el botón de WhatsApp. */
  async info() {
    const organizationId = this.organizationId;
    const [org, settings] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.settings.findUnique({
        where: { organizationId },
        select: { businessPhone: true, currency: true, defaultRateLabel: true },
      }),
    ]);
    if (!org) throw new NotFoundException('Tienda no encontrada');

    return {
      businessName: org.name,
      // Se publica a propósito: es el canal de pedido de la tienda.
      whatsappPhone: settings?.businessPhone ?? null,
      currency: settings?.currency ?? 'USD',
      // Tasa VIGENTE para mostrar bolívares. El motor no convierte: esto es
      // presentación, y la tienda multiplica el precio USD por acá.
      rate: await this.currentRate(organizationId, settings?.defaultRateLabel ?? null),
      // Si el servidor puede recibir fotos: la tienda esconde el cargador de
      // personalización cuando R2 no está configurado, en vez de ofrecer una
      // subida que va a fallar.
      storageReady: this.storage.configured,
    };
  }

  async categories(): Promise<{ categories: PublicCategoryNode[] }> {
    const rows = await this.prisma.storeCategory.findMany({
      where: { organizationId: this.organizationId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { name: true, slug: true, parent: { select: { slug: true } } },
    });
    // Lista blanca: ni `id` ni `parentId` salen; la ruta pública se arma con slugs.
    return {
      categories: rows.map((c) => ({ name: c.name, slug: c.slug, parentSlug: c.parent?.slug ?? null })),
    };
  }

  /** Banners del carrusel: solo los visibles, en el orden del panel. Lista
   *  blanca explícita — nunca sale id, clave de R2 ni la organización.
   *
   *  Un destino CATEGORY/PRODUCT que se borró u ocultó DESPUÉS de crear el banner
   *  dejaría un "Ver más" roto (el `assertLink` del admin valida solo al escribir).
   *  Acá se degrada ese destino a NONE en vez de publicar un enlace muerto. */
  async banners(): Promise<{ banners: PublicBanner[] }> {
    const organizationId = this.organizationId;
    const rows = await this.prisma.storeBanner.findMany({
      where: { organizationId, visible: true },
      orderBy: { position: 'asc' },
      include: { category: { select: { slug: true } } },
    });

    const catSlugs = rows.filter((b) => b.linkType === 'CATEGORY' && b.linkValue).map((b) => b.linkValue as string);
    const prodSlugs = rows.filter((b) => b.linkType === 'PRODUCT' && b.linkValue).map((b) => b.linkValue as string);
    const [cats, prods] = await Promise.all([
      catSlugs.length
        ? this.prisma.storeCategory.findMany({ where: { organizationId, slug: { in: catSlugs } }, select: { slug: true } })
        : Promise.resolve([] as { slug: string }[]),
      prodSlugs.length
        ? this.prisma.storeProduct.findMany({ where: { organizationId, slug: { in: prodSlugs }, visible: true }, select: { slug: true } })
        : Promise.resolve([] as { slug: string }[]),
    ]);
    const catOk = new Set(cats.map((c) => c.slug));
    const prodOk = new Set(prods.map((p) => p.slug));

    return {
      // ⚠️ Un banner de CATEGORIA sin categoría no se devuelve: no hay página donde
      // mostrarlo. Mismo criterio que degradar un destino colgado, pero acá no alcanza
      // con degradar — el banner entero no tiene dónde ir.
      banners: rows
        .filter((b) => b.kind !== 'CATEGORIA' || !!b.category)
        .map((b) => {
        const vivo =
          b.linkType === 'CATEGORY' ? catOk.has(b.linkValue ?? '')
          : b.linkType === 'PRODUCT' ? prodOk.has(b.linkValue ?? '')
          : true; // NONE y URL no dependen del catálogo
        return {
          kind: b.kind,
          title: b.title,
          subtitle: b.subtitle,
          imageUrl: b.imageKey ? this.storage.publicUrl(b.imageKey) : null,
          categorySlug: b.category?.slug ?? null,
          linkType: vivo ? b.linkType : 'NONE',
          linkValue: vivo ? b.linkValue : null,
        };
      }),
    };
  }

  /** Vitrina: solo lo publicado, en el orden que fijó el dueño.
   *
   *  Dos modos, con UNA sola consulta cada uno:
   *  - tarjeta (por defecto): lo mínimo para listar.
   *  - `detalle === 'full'`: la ficha completa de cada producto, para que la tienda
   *    construya el sitio sin pedir las fichas una por una (con 1.000 productos
   *    serían 1.000 peticiones y el límite público rechazaría casi todas). Sale del
   *    mismo `include` de siempre: descripción, ficha técnica y grupos de opciones
   *    ya viajaban desde la base y se descartaban; solo se suman la galería entera
   *    y las fotos por opción. Eso agrega UNA consulta agrupada (el `include` anidado de `options.images`), no un viaje por producto. */
  async list(categorySlug?: string): Promise<{ products: PublicProductCard[] }>;
  async list(categorySlug: string | undefined, detalle: 'full'): Promise<{ products: PublicProductDetail[] }>;
  async list(
    categorySlug?: string,
    detalle?: string,
  ): Promise<{ products: PublicProductCard[] | PublicProductDetail[] }>;
  async list(
    categorySlug?: string,
    detalle?: string,
  ): Promise<{ products: PublicProductCard[] | PublicProductDetail[] }> {
    const where = {
      organizationId: this.organizationId,
      visible: true,
      // La madre incluye los productos de sus hijas; una hija, solo los suyos.
      ...(categorySlug
        ? { category: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] } }
        : {}),
    };
    const orderBy = [{ position: 'asc' as const }, { createdAt: 'desc' as const }];

    if (detalle === 'full') {
      const products = await this.prisma.storeProduct.findMany({ where, orderBy, include: includeFicha() });
      return { products: products.map((p) => this.detail(p)) };
    }
    const products = await this.prisma.storeProduct.findMany({ where, orderBy, include: includeTarjeta() });
    return { products: products.map((p) => this.listCard(p)) };
  }

  /** Flash Sale: la ventana vigente + los productos en oferta. Vacío ({ sale: null })
   *  si no hay ventana activa O si ningún producto tiene compareAtUsd > priceUsd.
   *  Solo TACHA: el pedido se sigue cobrando priceUsd; acá no viaja ningún precio. */
  async sale(): Promise<{ sale: (SaleWindow & { products: PublicProductCard[] }) | null }> {
    const organizationId = this.organizationId;
    const settings = await this.prisma.settings.findUnique({
      where: { organizationId },
      select: { saleTitle: true, saleStartsAt: true, saleEndsAt: true },
    });
    const window = settings ? activeSale(settings, new Date()) : null;
    if (!window) return { sale: null };

    const rows = await this.prisma.storeProduct.findMany({
      where: { organizationId, visible: true, compareAtUsd: { not: null } },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: includeTarjeta(),
    });
    // Prisma no compara dos columnas; el "compareAt > price" se filtra acá.
    const products = rows
      .filter((p) => p.compareAtUsd != null && Number(p.compareAtUsd) > Number(p.priceUsd))
      .map((p) => this.listCard(p));
    if (!products.length) return { sale: null };

    return { sale: { ...window, products } };
  }

  /** Ficha por enlace. `visible` se filtra TAMBIÉN acá: si no, un borrador sería
   *  alcanzable por quien adivine o recuerde su enlace. */
  async bySlug(slug: string): Promise<PublicProductDetail> {
    const product = await this.prisma.storeProduct.findFirst({
      where: { organizationId: this.organizationId, slug, visible: true },
      include: includeFicha(),
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    return this.detail(product);
  }

  // ----- Proyecciones (la lista blanca vive acá y en ningún otro lado) -----

  /** Lo que la vitrina necesita saber de las opciones: qué colores pintar y si hay
   *  que elegir antes de pedir. UNA definición, para la tarjeta y la ficha. */
  private opciones(
    groups: { name: string; required: boolean; options: { value: string; swatchHex: string | null }[] }[],
  ) {
    return {
      colors: (groups.find((g) => /color/i.test(g.name))?.options ?? [])
        .filter((o) => o.swatchHex)
        .map((o) => ({ value: o.value, swatchHex: o.swatchHex as string })),
      requiresOptions: groups.some((g) => g.required && g.options.length > 0),
    };
  }

  /**
   * ⚠️ El «hoy» se calcula en hora de VENEZUELA, no con `new Date()` a secas: el
   * servidor corre en UTC y desde las 20:00 de Caracas ya cree que es mañana, así que
   * una ficha publicada esa noche contaría un día de más.
   */
  private esNueva(publishedAt: Date | null) {
    return esNuevo(publishedAt, businessDateKey(new Date()));
  }

  /** Tarjeta de vitrina CON imagen y colores. Única lista blanca para el listado
   *  y para el Flash Sale: no pueden divergir. */
  private listCard(
    p: CardRow & {
      images: ImageRow[];
      optionGroups: { name: string; required: boolean; options: { value: string; swatchHex: string | null }[] }[];
    },
  ): PublicProductCard {
    return {
      ...this.card(p),
      image: p.images[0] ? this.image(p.images[0]) : null,
      ...this.opciones(p.optionGroups),
    };
  }

  /** Ficha completa. Única lista blanca para `bySlug` y para el listado en modo
   *  completo: dos copias terminarían publicando formas distintas del mismo producto.
   *  Las opciones se proyectan campo por campo: las de Prisma traen `id`, `groupId`
   *  y `position`, que jamás pueden salir. */
  private detail(
    p: CardRow & {
      description: string | null;
      specs: unknown;
      images: ImageRow[];
      optionGroups: {
        name: string;
        required: boolean;
        drivesPhoto: boolean;
        options: { value: string; priceDeltaUsd: unknown; swatchHex: string | null; images: ImageRow[] }[];
      }[];
    },
  ): PublicProductDetail {
    return {
      ...this.card(p),
      ...this.opciones(p.optionGroups),
      description: p.description,
      // La ficha técnica es libre: se sanea la forma antes de publicarla, para
      // que un JSON viejo o a medias no rompa la tienda.
      specs: Array.isArray(p.specs)
        ? (p.specs as unknown[])
            .filter((x): x is PublicSpec => !!x && typeof x === 'object' && 'label' in x && 'value' in x)
            .map((x) => ({ label: String(x.label), value: String(x.value) }))
        : [],
      images: p.images.map((img) => this.image(img)),
      optionGroups: p.optionGroups.map((g) => ({
        name: g.name,
        required: g.required,
        drivesPhoto: g.drivesPhoto,
        options: g.options.map((o) => ({
          value: o.value,
          priceDeltaUsd: Number(o.priceDeltaUsd),
          swatchHex: o.swatchHex,
          images: o.images.map((img) => this.image(img)),
        })),
      })),
    };
  }

  private card(p: CardRow) {
    return {
      slug: p.slug,
      name: p.name,
      kind: p.kind,
      summary: p.summary,
      priceUsd: Number(p.priceUsd),
      compareAtUsd: p.compareAtUsd == null ? null : Number(p.compareAtUsd),
      priceTiers: Array.isArray(p.priceTiers) ? (p.priceTiers as TramoGuardado[]).map(tramoPublico) : [],
      leadTimeDays: p.leadTimeDays,
      minQty: p.minQty,
      material: p.material,
      badge: p.badge,
      custom: p.custom,
      // Derivado, nunca guardado: la fecha de publicacion es el unico dato.
      nuevo: this.esNueva(p.publishedAt),
      category: p.category,
    };
  }

  private image(img: ImageRow): PublicImage {
    // Sale la URL pública, no la clave del bucket: la estructura interna del
    // almacenamiento no es asunto del cliente.
    return {
      url: this.storage.publicUrl(img.key),
      alt: img.alt,
      width: img.width,
      height: img.height,
    };
  }

  /** Tasa vigente de la moneda por defecto, o null si la tienda va solo en USD. */
  private async currentRate(organizationId: string, label: string | null) {
    if (!label) return null;
    const live = await this.rates.latest(organizationId);
    const found = live.find((r) => r.label === label);
    if (!found) return null;
    return { label: found.label, currencyCode: found.currencyCode, rate: found.rate };
  }
}
