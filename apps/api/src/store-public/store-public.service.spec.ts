import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StorePublicService } from './store-public.service';

/**
 * Regresión de seguridad del catálogo público — la ÚNICA superficie del sistema
 * que responde sin sesión.
 *
 * Lo que se fija acá no es que "funcione", sino que no filtre: ni el costo, ni el
 * enlace con el costeo, ni los borradores, ni datos de otra organización. Si
 * alguien cambia una proyección por un `include` cómodo, esto se cae.
 */

const ORG = 'org-A';

const PRODUCTO = {
  id: 'sp1',
  organizationId: ORG,
  slug: 'llavero-mundial',
  name: 'Llavero del Mundial',
  kind: 'PHYSICAL' as const,
  summary: 'Impreso en PLA',
  description: 'Texto largo de la ficha',
  priceUsd: '3.5000',
  compareAtUsd: '4.0000',
  priceTiers: [{ minQty: 10, discountPct: 0.1 }],
  leadTimeDays: 5,
  minQty: 1,
  visible: true,
  position: 0,
  // ---- Todo lo de abajo es INTERNO y no puede salir por la API pública ----
  costAtPublish: '1.2500',
  productId: 'prod-interno-1',
  quoteId: 'quote-interno-1',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  categoryId: 'cat1',
  category: { name: 'Llaveros', slug: 'llaveros' },
  images: [{ key: `${ORG}/store/sp1/foto.jpg`, alt: 'Llavero', width: 800, height: 800 }],
  // La vitrina filtra por color, así que el listado también los trae.
  optionGroups: [
    {
      name: 'Color',
      required: true,
      drivesPhoto: false,
      position: 0,
      options: [
        { value: 'Rojo', priceDeltaUsd: '0', swatchHex: '#FF0000', position: 0, images: [] },
        { value: 'Grande', priceDeltaUsd: '3.0000', swatchHex: null, position: 1, images: [] },
      ],
    },
  ],
};

/** Un banner tal como lo devuelve Prisma (fila interna). */
const BANNER = {
  id: 'ban1',
  organizationId: ORG,
  title: 'Promo de temporada',
  subtitle: 'Hasta agotar',
  imageKey: `${ORG}/store/banners/promo.png`,
  linkType: 'CATEGORY' as const,
  linkValue: 'llaveros',
  position: 0,
  visible: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

function makeService(overrides: {
  storeOrganizationId?: string | null;
  findFirst?: jest.Mock;
  findMany?: jest.Mock;
  bannerFindMany?: jest.Mock;
  categoryFindMany?: jest.Mock;
  settings?: Record<string, unknown>;
} = {}) {
  const findFirst = overrides.findFirst ?? jest.fn().mockResolvedValue(PRODUCTO);
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([PRODUCTO]);
  const bannerFindMany = overrides.bannerFindMany ?? jest.fn().mockResolvedValue([BANNER]);
  // Por defecto la categoría destino del BANNER ('llaveros') EXISTE, así que el
  // banner sigue vivo. Los tests de destino colgado la vacían.
  const categoryFindMany = overrides.categoryFindMany ?? jest.fn().mockResolvedValue([{ slug: 'llaveros', name: 'Llaveros' }]);
  const settingsRow = overrides.settings ?? {
    businessPhone: '0412 0366355',
    currency: 'USD',
    defaultRateLabel: null,
    saleTitle: null,
    saleStartsAt: null,
    saleEndsAt: null,
  };
  const prisma = {
    storeProduct: { findFirst, findMany },
    storeBanner: { findMany: bannerFindMany },
    storeCategory: { findMany: categoryFindMany },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Banano Lab' }) },
    settings: {
      findUnique: jest.fn().mockResolvedValue(settingsRow),
    },
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'STORE_ORGANIZATION_ID'
        ? overrides.storeOrganizationId === undefined
          ? ORG
          : (overrides.storeOrganizationId ?? undefined)
        : undefined,
    ),
  };
  const rates = { latest: jest.fn().mockResolvedValue([]) };
  const storage = { configured: true, publicUrl: (key: string) => `https://cdn.example/${key}` };
  const service = new StorePublicService(
    prisma as never,
    config as never,
    rates as never,
    storage as never,
  );
  return { service, prisma, findFirst, findMany, bannerFindMany, categoryFindMany };
}

/** Campos que jamás pueden aparecer en una respuesta pública. */
const PROHIBIDOS = ['costAtPublish', 'productId', 'quoteId', 'organizationId', 'id', 'key', 'position'];

/** Todas las claves del objeto, a cualquier profundidad. Se compara por CLAVE y
 *  no por texto: buscar "id" como subcadena daría falso positivo con "width". */
function clavesDe(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) clavesDe(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      clavesDe(v, out);
    }
  }
  return out;
}

describe('Banners públicos', () => {
  it('devuelve solo banners visibles de la organización del entorno, por posición', async () => {
    const { service, bannerFindMany } = makeService();
    const { banners } = await service.banners();
    expect(banners).toHaveLength(1);
    expect(bannerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG, visible: true },
        orderBy: { position: 'asc' },
      }),
    );
  });

  it('no expone id, clave de R2, organización ni posición', async () => {
    const { service } = makeService();
    const { banners } = await service.banners();
    const claves = clavesDe(banners);
    for (const campo of [...PROHIBIDOS, 'imageKey']) expect([...claves]).not.toContain(campo);
  });

  it('publica la URL de la imagen (campo imageUrl), sin el campo imageKey', async () => {
    const { service } = makeService();
    const { banners } = await service.banners();
    expect(banners[0].imageUrl).toBe(`https://cdn.example/${ORG}/store/banners/promo.png`);
    // 'imageKey' ya se verifica ausente en el test de arriba (lista blanca).
    expect(banners[0]).not.toHaveProperty('imageKey');
  });

  it('sin STORE_ORGANIZATION_ID no responde', async () => {
    const { service } = makeService({ storeOrganizationId: null });
    await expect(service.banners()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('conserva el destino CATEGORY cuando la categoría existe', async () => {
    const { service } = makeService(); // categoría 'llaveros' existe por defecto
    const { banners } = await service.banners();
    expect(banners[0].linkType).toBe('CATEGORY');
    expect(banners[0].linkValue).toBe('llaveros');
  });

  it('degrada a NONE un destino CATEGORY que ya no existe', async () => {
    const { service } = makeService({ categoryFindMany: jest.fn().mockResolvedValue([]) });
    const { banners } = await service.banners();
    expect(banners[0].linkType).toBe('NONE');
    expect(banners[0].linkValue).toBeNull();
  });

  it('degrada a NONE un destino PRODUCT oculto o inexistente', async () => {
    const bannerProd = { ...BANNER, linkType: 'PRODUCT' as const, linkValue: 'llavero-mundial' };
    const { service } = makeService({
      bannerFindMany: jest.fn().mockResolvedValue([bannerProd]),
      findMany: jest.fn().mockResolvedValue([]), // el producto no está visible / no existe
    });
    const { banners } = await service.banners();
    expect(banners[0].linkType).toBe('NONE');
    expect(banners[0].linkValue).toBeNull();
  });

  it('un destino URL no se toca (no depende del catálogo)', async () => {
    const bannerUrl = { ...BANNER, linkType: 'URL' as const, linkValue: 'https://wa.me/58412' };
    const { service } = makeService({ bannerFindMany: jest.fn().mockResolvedValue([bannerUrl]) });
    const { banners } = await service.banners();
    expect(banners[0].linkType).toBe('URL');
    expect(banners[0].linkValue).toBe('https://wa.me/58412');
  });
});

describe('Catálogo público', () => {
  describe('no filtra nada interno', () => {
    it('la vitrina no expone costo, origen de costeo ni la organización', async () => {
      const { service } = makeService();
      const { products } = await service.list();
      const claves = clavesDe(products);
      for (const campo of PROHIBIDOS) expect([...claves]).not.toContain(campo);
      // Y tampoco el NÚMERO del costo, que delata el margen igual que el campo.
      expect(JSON.stringify(products)).not.toContain('1.25');
    });

    it('la ficha tampoco, ni siquiera con todo incluido', async () => {
      const { service } = makeService();
      const ficha = await service.bySlug('llavero-mundial');
      const claves = clavesDe(ficha);
      for (const campo of PROHIBIDOS) expect([...claves]).not.toContain(campo);
      expect(JSON.stringify(ficha)).not.toContain('1.25');
    });

    it('publica la URL de la foto, no la clave del bucket', async () => {
      // La estructura interna del almacenamiento (que empieza por el id de la
      // organización) no es asunto del cliente.
      const { service } = makeService();
      const ficha = await service.bySlug('llavero-mundial');
      expect(ficha.images[0].url).toBe(`https://cdn.example/${ORG}/store/sp1/foto.jpg`);
      expect([...clavesDe(ficha.images)]).not.toContain('key');
    });

    it('avisa cuándo hay que elegir opciones antes de pedir', async () => {
      // Sin esta bandera la vitrina agregaría al carrito sin color ni tamaño y
      // cotizaría el precio base: un total equivocado para el cliente.
      const { service } = makeService();
      const { products } = await service.list();
      expect(products[0].requiresOptions).toBe(true);
      const ficha = await service.bySlug('llavero-mundial');
      expect(ficha.requiresOptions).toBe(true);
    });

    it('la vitrina expone los tramos de precio por cantidad', async () => {
      const { service } = makeService();
      const { products } = await service.list();
      expect(products[0].priceTiers).toEqual([{ minQty: 10, discountPct: 0.1 }]);
    });

    it('la vitrina recibe los colores para el filtro y las muestras', async () => {
      const { service } = makeService();
      const { products } = await service.list();
      expect(products[0].colors).toEqual([{ value: 'Rojo', swatchHex: '#FF0000' }]);
      // La opción sin muestra ("Grande") no es un color y no debe colarse.
      expect(products[0].colors).toHaveLength(1);
    });

    it('sí devuelve lo que la tienda necesita', async () => {
      const { service } = makeService();
      const ficha = await service.bySlug('llavero-mundial');
      expect(ficha).toMatchObject({
        slug: 'llavero-mundial',
        name: 'Llavero del Mundial',
        kind: 'PHYSICAL',
        priceUsd: 3.5,
        compareAtUsd: 4,
        leadTimeDays: 5,
        category: { name: 'Llaveros', slug: 'llaveros' },
      });
      expect(ficha.optionGroups[0].options[1]).toEqual({
        value: 'Grande',
        priceDeltaUsd: 3,
        swatchHex: null,
        images: [],
      });
    });

    it('la ficha expone las fotos por opción del grupo que define la foto, con URL (sin optionId ni key)', async () => {
      const conFoto = {
        ...PRODUCTO,
        optionGroups: [
          {
            name: 'Color',
            required: true,
            drivesPhoto: true,
            position: 0,
            options: [
              {
                value: 'Rojo',
                priceDeltaUsd: '0',
                swatchHex: '#FF0000',
                position: 0,
                images: [{ key: `${ORG}/store/sp1/rojo.jpg`, alt: 'Rojo', width: 600, height: 600 }],
              },
              { value: 'Azul', priceDeltaUsd: '0', swatchHex: '#0000FF', position: 1, images: [] },
            ],
          },
        ],
      };
      const { service } = makeService({ findFirst: jest.fn().mockResolvedValue(conFoto) });
      const ficha = await service.bySlug('llavero-mundial');

      const grupoFoto = ficha.optionGroups.find((g) => g.drivesPhoto);
      expect(grupoFoto).toBeTruthy();
      const rojo = grupoFoto!.options.find((o) => o.value === 'Rojo')!;
      expect(rojo.images[0].url).toBe(`https://cdn.example/${ORG}/store/sp1/rojo.jpg`);
      // Un color sin fotos propias no rompe: sale con lista vacía.
      const azul = grupoFoto!.options.find((o) => o.value === 'Azul')!;
      expect(azul.images).toEqual([]);
      // Lista blanca: ni optionId ni la clave del bucket.
      const claves = clavesDe(ficha.optionGroups);
      expect([...claves]).not.toContain('optionId');
      expect([...claves]).not.toContain('key');
    });
  });

  describe('solo lo publicado, y solo de la organización de la tienda', () => {
    it('la vitrina filtra por visible y por organización', async () => {
      const { service, findMany } = makeService();
      await service.list();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG, visible: true }),
        }),
      );
    });

    it('un borrador NO es alcanzable aunque se conozca su enlace', async () => {
      // El olvido clásico: filtrar `visible` en el listado pero no en la ficha.
      const { service, findFirst } = makeService({
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(where.visible === true ? null : PRODUCTO),
        ),
      });
      await expect(service.bySlug('borrador')).rejects.toThrow(NotFoundException);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG, visible: true }),
        }),
      );
    });

    it('la organización sale del entorno, nunca de un parámetro', async () => {
      // Si se pudiera elegir por parámetro, cualquiera listaría el catálogo de
      // cualquier organización.
      const { service, findMany } = makeService();
      await service.list('llaveros');
      const where = findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG);
      expect(where.category).toEqual({ slug: 'llaveros' });
    });

    it('sin STORE_ORGANIZATION_ID la tienda no sirve nada', async () => {
      const { service } = makeService({ storeOrganizationId: null });
      await expect(service.list()).rejects.toThrow(ServiceUnavailableException);
      await expect(service.bySlug('x')).rejects.toThrow(ServiceUnavailableException);
      await expect(service.info()).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('info del negocio', () => {
    it('devuelve solo lo que la vitrina necesita', async () => {
      const { service } = makeService();
      const info = await service.info();
      expect(info).toEqual({
        businessName: 'Banano Lab',
        whatsappPhone: '0412 0366355',
        currency: 'USD',
        rate: null,
        storageReady: true,
      });
    });
  });
});

describe('Flash Sale público (GET /public/store/sale)', () => {
  const ventana = {
    saleTitle: 'Oferta',
    saleStartsAt: new Date('2026-10-20T22:00:00.000Z'),
    saleEndsAt: new Date('2026-10-27T03:59:00.000Z'),
  };
  // Producto SIN descuento (compareAt null): no entra al Flash Sale.
  const SIN_OFERTA = { ...PRODUCTO, slug: 'taza', priceUsd: '8.0000', compareAtUsd: null };

  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-22T10:00:00.000Z')));
  afterEach(() => jest.useRealTimers());

  it('devuelve la ventana + solo los productos con compareAt > price, con lista blanca', async () => {
    const { service } = makeService({
      settings: ventana,
      findMany: jest.fn().mockResolvedValue([PRODUCTO, SIN_OFERTA]),
    });
    const { sale } = await service.sale();
    expect(sale).not.toBeNull();
    expect(sale!.title).toBe('Oferta');
    expect(sale!.startsAt).toBe('2026-10-20T22:00:00.000Z');
    expect(sale!.endsAt).toBe('2026-10-27T03:59:00.000Z');
    expect(sale!.products).toHaveLength(1);
    expect(sale!.products[0].slug).toBe('llavero-mundial');
    expect(sale!.products[0].compareAtUsd).toBe(4);
    // Lista blanca: nada interno (ni el número del costo).
    const claves = clavesDe(sale!.products);
    for (const campo of PROHIBIDOS) expect([...claves]).not.toContain(campo);
    expect(JSON.stringify(sale!.products)).not.toContain('1.25');
  });

  it('{ sale: null } si no hay ventana activa', async () => {
    const { service } = makeService({
      settings: { saleTitle: 'x', saleStartsAt: null, saleEndsAt: null },
      findMany: jest.fn().mockResolvedValue([PRODUCTO]),
    });
    expect(await service.sale()).toEqual({ sale: null });
  });

  it('{ sale: null } si la ventana está activa pero ningún producto tiene compareAt > price', async () => {
    const { service } = makeService({
      settings: ventana,
      findMany: jest.fn().mockResolvedValue([SIN_OFERTA]),
    });
    expect(await service.sale()).toEqual({ sale: null });
  });

  it('la organización sale del entorno y filtra por visible', async () => {
    const { service, findMany } = makeService({
      settings: ventana,
      findMany: jest.fn().mockResolvedValue([PRODUCTO]),
    });
    await service.sale();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, visible: true }),
      }),
    );
  });

  it('sin STORE_ORGANIZATION_ID no responde', async () => {
    const { service } = makeService({ storeOrganizationId: null, settings: ventana });
    await expect(service.sale()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
