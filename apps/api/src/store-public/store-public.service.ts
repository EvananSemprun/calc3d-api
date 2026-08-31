import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ObjectStorageService } from '../storage/object-storage.service';

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
}

interface PublicOptionGroup {
  name: string;
  required: boolean;
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
}

/** Ficha completa. */
interface PublicProductDetail extends Omit<PublicProductCard, 'image'> {
  description: string | null;
  specs: PublicSpec[];
  images: PublicImage[];
  optionGroups: PublicOptionGroup[];
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
    };
  }

  async categories() {
    const categories = await this.prisma.storeCategory.findMany({
      where: { organizationId: this.organizationId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { name: true, slug: true },
    });
    return { categories };
  }

  /** Vitrina: solo lo publicado, en el orden que fijó el dueño. */
  async list(categorySlug?: string): Promise<{ products: PublicProductCard[] }> {
    const products = await this.prisma.storeProduct.findMany({
      where: {
        organizationId: this.organizationId,
        visible: true,
        ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: {
        category: { select: { name: true, slug: true } },
        images: { orderBy: { position: 'asc' }, take: 1 },
        // Solo el grupo de COLOR: la vitrina filtra por color, y traer todos los
        // grupos engordaría el listado sin que nada los use.
        optionGroups: {
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        },
      },
    });

    return {
      products: products.map((p) => ({
        ...this.card(p),
        image: p.images[0] ? this.image(p.images[0]) : null,
        colors: (p.optionGroups.find((g) => /color/i.test(g.name))?.options ?? [])
          .filter((o) => o.swatchHex)
          .map((o) => ({ value: o.value, swatchHex: o.swatchHex as string })),
        requiresOptions: p.optionGroups.some((g) => g.required && g.options.length > 0),
      })),
    };
  }

  /** Ficha por enlace. `visible` se filtra TAMBIÉN acá: si no, un borrador sería
   *  alcanzable por quien adivine o recuerde su enlace. */
  async bySlug(slug: string): Promise<PublicProductDetail> {
    const product = await this.prisma.storeProduct.findFirst({
      where: { organizationId: this.organizationId, slug, visible: true },
      include: {
        category: { select: { name: true, slug: true } },
        images: { orderBy: { position: 'asc' } },
        optionGroups: {
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    return {
      ...this.card(product),
      requiresOptions: product.optionGroups.some((g) => g.required && g.options.length > 0),
      colors: (product.optionGroups.find((g) => /color/i.test(g.name))?.options ?? [])
        .filter((o) => o.swatchHex)
        .map((o) => ({ value: o.value, swatchHex: o.swatchHex as string })),
      description: product.description,
      // La ficha técnica es libre: se sanea la forma antes de publicarla, para
      // que un JSON viejo o a medias no rompa la tienda.
      specs: Array.isArray(product.specs)
        ? (product.specs as unknown[])
            .filter((x): x is PublicSpec => !!x && typeof x === 'object' && 'label' in x && 'value' in x)
            .map((x) => ({ label: String(x.label), value: String(x.value) }))
        : [],
      images: product.images.map((img) => this.image(img)),
      optionGroups: product.optionGroups.map((g) => ({
        name: g.name,
        required: g.required,
        options: g.options.map((o) => ({
          value: o.value,
          priceDeltaUsd: Number(o.priceDeltaUsd),
          swatchHex: o.swatchHex,
        })),
      })),
    };
  }

  // ----- Proyecciones (la lista blanca vive acá y en ningún otro lado) -----

  private card(p: {
    slug: string;
    name: string;
    kind: 'PHYSICAL' | 'SERVICE';
    summary: string | null;
    priceUsd: unknown;
    compareAtUsd: unknown;
    leadTimeDays: number | null;
    minQty: number;
    material: string | null;
    badge: string | null;
    custom: boolean;
    category: PublicCategory | null;
  }) {
    return {
      slug: p.slug,
      name: p.name,
      kind: p.kind,
      summary: p.summary,
      priceUsd: Number(p.priceUsd),
      compareAtUsd: p.compareAtUsd == null ? null : Number(p.compareAtUsd),
      leadTimeDays: p.leadTimeDays,
      minQty: p.minQty,
      material: p.material,
      badge: p.badge,
      custom: p.custom,
      category: p.category,
    };
  }

  private image(img: {
    key: string;
    alt: string | null;
    width: number | null;
    height: number | null;
  }): PublicImage {
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
