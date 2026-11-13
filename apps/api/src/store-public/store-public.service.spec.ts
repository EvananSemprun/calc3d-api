import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StorePublicService } from './store-public.service';
import { resolverColeccion } from '@calc3d/shared';

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
  publishedAt: null as Date | null,
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
  backgroundKey: null as string | null,
  kind: 'HERO' as const,
  category: null as { slug: string } | null,
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
  collectionFindMany?: jest.Mock;
  collectionFindFirst?: jest.Mock;
  settings?: Record<string, unknown>;
} = {}) {
  const findFirst = overrides.findFirst ?? jest.fn().mockResolvedValue(PRODUCTO);
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([PRODUCTO]);
  const bannerFindMany = overrides.bannerFindMany ?? jest.fn().mockResolvedValue([BANNER]);
  // Por defecto la categoría destino del BANNER ('llaveros') EXISTE, así que el
  // banner sigue vivo. Los tests de destino colgado la vacían.
  const categoryFindMany = overrides.categoryFindMany ?? jest.fn().mockResolvedValue([{ slug: 'llaveros', name: 'Llaveros' }]);
  // Por defecto NO hay colección: es el estado del día uno.
  const collectionFindMany = overrides.collectionFindMany ?? jest.fn().mockResolvedValue([]);
  const collectionFindFirst = overrides.collectionFindFirst ?? jest.fn().mockResolvedValue(null);
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
    storeCollection: { findMany: collectionFindMany, findFirst: collectionFindFirst },
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
  return { service, prisma, findFirst, findMany, bannerFindMany, categoryFindMany, collectionFindMany, collectionFindFirst };
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
  /**
   * Los TRES TIPOS (2026-11-08). `kind` es DÓNDE se muestra; `linkType`, adónde lleva.
   * Spec: `docs/superpowers/specs/2026-11-08-tres-tipos-de-banner-design.md`.
   */
  it('el de TEXTO viaja sin imagen, no con una URL inventada', async () => {
    const { service } = makeService({ bannerFindMany: jest.fn().mockResolvedValue([{ ...BANNER, kind: 'TEXTO', imageKey: null, linkType: 'NONE', linkValue: null }]) });
    const { banners } = await service.banners();
    expect(banners[0].imageUrl).toBeNull();
    expect(banners[0].kind).toBe('TEXTO');
  });

  it('el de CATEGORIA dice el slug de su categoría', async () => {
    const { service } = makeService({
      bannerFindMany: jest.fn().mockResolvedValue([{ ...BANNER, kind: 'CATEGORIA', categoryId: 'cat1', category: { slug: 'navidad' }, linkType: 'NONE', linkValue: null }]),
    });
    const { banners } = await service.banners();
    expect(banners[0].categorySlug).toBe('navidad');
  });

  it('un CATEGORIA sin categoría NO se devuelve: no hay página donde mostrarlo', async () => {
    const { service } = makeService({
      bannerFindMany: jest.fn().mockResolvedValue([{ ...BANNER, kind: 'CATEGORIA', categoryId: 'cat1', category: null, linkType: 'NONE', linkValue: null }]),
    });
    const { banners } = await service.banners();
    expect(banners).toHaveLength(0);
  });

  it('su hermano alcanzable: con la categoría puesta SÍ se devuelve', async () => {
    // Sin este caso, un filtro que descartara todos los banners pasaría el test de arriba.
    const { service } = makeService({
      bannerFindMany: jest.fn().mockResolvedValue([{ ...BANNER, kind: 'CATEGORIA', categoryId: 'cat1', category: { slug: 'navidad' }, linkType: 'NONE', linkValue: null }]),
    });
    expect((await service.banners()).banners).toHaveLength(1);
  });

  it('un HERO no se filtra por tener la categoría vacía', async () => {
    // La guarda es SOLO para CATEGORIA: los otros dos tipos no tienen categoría y
    // filtrarlos por eso los borraría a todos.
    const { service } = makeService({ bannerFindMany: jest.fn().mockResolvedValue([{ ...BANNER, kind: 'HERO', category: null, linkType: 'NONE', linkValue: null }]) });
    expect((await service.banners()).banners).toHaveLength(1);
  });

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

  it('publica el FONDO del hero en `backgroundUrl`, que es otro campo que `imageUrl`', async () => {
    // ⚠️ Este test existe por una lección cara: guardar un campo y PUBLICARLO son dos
    // cambios. Con los tramos de precio el panel aprendió a guardarlos, los tests
    // quedaron verdes y esta proyección —la que ve la tienda— nunca se tocó: durante un
    // día la ficha mostró un precio y el servidor cobró otro.
    const { service } = makeService({
      bannerFindMany: jest.fn().mockResolvedValue([
        { ...BANNER, backgroundKey: `${ORG}/store/banners/fondo.png`, linkType: 'NONE', linkValue: null },
      ]),
    });
    const { banners } = await service.banners();
    expect(banners[0].backgroundUrl).toBe(`https://cdn.example/${ORG}/store/banners/fondo.png`);
    // Las dos imágenes viajan por separado: el fondo no pisa al arte de al lado.
    expect(banners[0].imageUrl).toBe(`https://cdn.example/${ORG}/store/banners/promo.png`);
    // La clave interna del bucket NO sale: con ella se podrían construir rutas a objetos
    // de otra organización.
    expect(banners[0]).not.toHaveProperty('backgroundKey');
  });

  it('un banner SIN fondo lo publica como null, no lo omite', async () => {
    // El hermano alcanzable: sin él, una proyección que nunca devolviera el campo pasaría
    // el test de arriba si el fixture fuera el único con fondo.
    const { service } = makeService();
    const { banners } = await service.banners();
    expect(banners[0].backgroundUrl).toBeNull();
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

    describe('tramos por PRECIO FIJO (regresión del 2026-11-09)', () => {
      /**
       * El panel aprendió a guardar `unitPriceUsd` el 2026-11-08 y esta proyección
       * nunca aprendió a enviarlo: mapeaba `{ minQty, discountPct }` a mano, así que
       * `Number(undefined)` daba NaN y viajaba como `null`. La tienda mostraba el
       * precio de lista en todos los tramos MIENTRAS el servidor cobraba el del tramo
       * (lee de la base, no de acá): la ficha decía $15,00 por 10 identificadores y el
       * pedido se cobraba $12,50.
       */
      const conTramos = (priceTiers: unknown) => ({
        findMany: jest.fn().mockResolvedValue([{ ...PRODUCTO, priceTiers }]),
        findFirst: jest.fn().mockResolvedValue({ ...PRODUCTO, priceTiers }),
      });

      it('la vitrina manda el PRECIO del tramo', async () => {
        const { service } = makeService(conTramos([{ minQty: 10, unitPriceUsd: 1.25 }]));
        const { products } = await service.list();
        expect(products[0].priceTiers).toEqual([{ minQty: 10, unitPriceUsd: 1.25 }]);
      });

      it('la ficha también: es la misma proyección', async () => {
        const { service } = makeService(conTramos([{ minQty: 5, unitPriceUsd: 2.4 }]));
        const ficha = await service.bySlug('llavero-mundial');
        expect(ficha.priceTiers).toEqual([{ minQty: 5, unitPriceUsd: 2.4 }]);
      });

      it('el tramo viejo por porcentaje sigue viajando igual', async () => {
        const { service } = makeService(conTramos([{ minQty: 10, discountPct: 0.17 }]));
        const { products } = await service.list();
        expect(products[0].priceTiers).toEqual([{ minQty: 10, discountPct: 0.17 }]);
      });

      it('NUNCA manda una clave en null: la tienda la leería como precio 0', async () => {
        // ⚠️ `precioConTramos` pregunta `unitPriceUsd !== undefined`, acá y en la
        // tienda. Un `null` pasa esa guarda y el precio del tramo se vuelve 0.
        const { service } = makeService(conTramos([{ minQty: 10, unitPriceUsd: 1.25 }]));
        const { products } = await service.list();
        const tramo = products[0].priceTiers[0] as Record<string, unknown>;
        expect('discountPct' in tramo).toBe(false);
        expect(Object.values(tramo)).not.toContain(null);
      });

      it('tampoco manda NaN, que es como se rompió', async () => {
        const { service } = makeService(conTramos([{ minQty: 10, unitPriceUsd: 1.25 }]));
        const { products } = await service.list();
        for (const valor of Object.values(products[0].priceTiers[0])) {
          expect(Number.isNaN(valor as number)).toBe(false);
        }
      });
    });

    describe('días de entrega por opción (2026-11-09)', () => {
      /**
       * El plazo era del producto entero y el dueño lo escribía a mano DENTRO del
       * nombre de la opción («20 cm · 3 días»): texto, que la ficha no puede comparar
       * ni sumar. Ahora cada opción trae los suyos y la ficha muestra el mayor de las
       * elegidas.
       */
      const conOpciones = (options: unknown[]) => {
        const fila = { ...PRODUCTO, optionGroups: [{ ...PRODUCTO.optionGroups[0], options }] };
        return { findFirst: jest.fn().mockResolvedValue(fila) };
      };

      it('la ficha publica los días propios de cada opción', async () => {
        const { service } = makeService(
          conOpciones([
            { value: '15 cm', priceDeltaUsd: '0', swatchHex: null, position: 0, images: [], leadTimeDays: null },
            { value: '30 cm', priceDeltaUsd: '14.0000', swatchHex: null, position: 1, images: [], leadTimeDays: 3 },
          ]),
        );
        const ficha = await service.bySlug('llavero-mundial');
        expect(ficha.optionGroups[0].options.map((o) => o.leadTimeDays)).toEqual([null, 3]);
      });

      it('la opción que no cambia el plazo viaja en null, NO en 0', async () => {
        // ⚠️ Un 0 sería prometer entrega el mismo día. La ficha necesita distinguir
        // «no cambia el plazo» de «sale hoy».
        const { service } = makeService(
          conOpciones([{ value: 'Liso', priceDeltaUsd: '0', swatchHex: null, position: 0, images: [], leadTimeDays: null }]),
        );
        const ficha = await service.bySlug('llavero-mundial');
        expect(ficha.optionGroups[0].options[0].leadTimeDays).toBeNull();
      });

      it('una fila vieja, sin la columna, no rompe la ficha', async () => {
        // Las opciones creadas antes de la migración llegan sin el campo.
        const { service } = makeService(
          conOpciones([{ value: 'Rojo', priceDeltaUsd: '0', swatchHex: '#FF0000', position: 0, images: [] }]),
        );
        const ficha = await service.bySlug('llavero-mundial');
        expect(ficha.optionGroups[0].options[0].leadTimeDays).toBeNull();
      });
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
        leadTimeDays: null,
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
      expect(where.category).toEqual({ OR: [{ slug: 'llaveros' }, { parent: { slug: 'llaveros' } }] });
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

describe('Subcategorías de la tienda', () => {
  // Árbol: Llaveros (raíz) > Mundial, Anime. Hogar (raíz) > Macetas.
  const CATEGORIAS = [
    { name: 'Llaveros', slug: 'llaveros', parent: null },
    { name: 'Mundial', slug: 'mundial', parent: { slug: 'llaveros' } },
    { name: 'Anime', slug: 'anime', parent: { slug: 'llaveros' } },
    { name: 'Hogar', slug: 'hogar', parent: null },
    { name: 'Macetas', slug: 'macetas', parent: { slug: 'hogar' } },
  ];
  const catDe = (slug: string) => CATEGORIAS.find((c) => c.slug === slug)!;
  const producto = (slug: string, catSlug: string) => ({
    ...PRODUCTO,
    slug,
    name: slug,
    category: { name: catDe(catSlug).name, slug: catSlug },
    categoryRow: catDe(catSlug),
  });
  const PRODUCTOS = [
    producto('p-madre', 'llaveros'),
    producto('p-mundial', 'mundial'),
    producto('p-anime', 'anime'),
    producto('p-maceta', 'macetas'),
  ];

  /** Evalúa el `where.category` como lo haría Postgres: por slug propio o por el de la madre. */
  function coincide(cat: { slug: string; parent: { slug: string } | null }, filtro: any): boolean {
    if (filtro.OR) return filtro.OR.some((f: unknown) => coincide(cat, f));
    if (filtro.slug !== undefined && cat.slug !== filtro.slug) return false;
    if (filtro.parent?.slug !== undefined && cat.parent?.slug !== filtro.parent.slug) return false;
    return true;
  }
  const productosFalsos = () =>
    jest.fn(async (args: any) =>
      PRODUCTOS.filter((p) => !args.where.category || coincide(p.categoryRow, args.where.category)),
    );
  const slugsDe = (r: { products: { slug: string }[] }) => r.products.map((p) => p.slug).sort();

  it('categories() devuelve parentSlug de cada categoría, y null en las raíces', async () => {
    const { service } = makeService({ categoryFindMany: jest.fn().mockResolvedValue(CATEGORIAS) });
    const { categories } = await service.categories();
    expect(categories).toEqual([
      { name: 'Llaveros', slug: 'llaveros', parentSlug: null },
      { name: 'Mundial', slug: 'mundial', parentSlug: 'llaveros' },
      { name: 'Anime', slug: 'anime', parentSlug: 'llaveros' },
      { name: 'Hogar', slug: 'hogar', parentSlug: null },
      { name: 'Macetas', slug: 'macetas', parentSlug: 'hogar' },
    ]);
  });

  it('⚠️ categories() NO filtra por lista blanca de más: sigue sin id, organizationId ni position', async () => {
    const filaInterna = { ...CATEGORIAS[1], id: 'c2', organizationId: ORG, position: 3, parentId: 'c1' };
    const { service } = makeService({ categoryFindMany: jest.fn().mockResolvedValue([filaInterna]) });
    const claves = clavesDe(await service.categories());
    for (const prohibida of [...PROHIBIDOS, 'parentId', 'parent']) {
      expect(claves.has(prohibida)).toBe(false);
    }
    expect(claves.has('parentSlug')).toBe(true);
  });

  it('list() con el slug de una madre trae los productos de sus hijas', async () => {
    const { service } = makeService({ findMany: productosFalsos() });
    expect(slugsDe(await service.list('llaveros'))).toEqual(['p-anime', 'p-madre', 'p-mundial']);
  });

  it('list() con el slug de una hija trae solo los suyos (hermano alcanzable)', async () => {
    const { service } = makeService({ findMany: productosFalsos() });
    expect(slugsDe(await service.list('mundial'))).toEqual(['p-mundial']);
    expect(slugsDe(await service.list('anime'))).toEqual(['p-anime']);
  });

  it('list() sin categoría los trae todos', async () => {
    const { service } = makeService({ findMany: productosFalsos() });
    expect(slugsDe(await service.list())).toEqual(['p-anime', 'p-maceta', 'p-madre', 'p-mundial']);
  });
});

describe('Listado público en modo completo (?detail=full)', () => {
  /** Fila cruda de Prisma, con TODO lo interno que trae el include real: ids,
   *  groupId, optionId, position, claves de bucket y el costo. */
  const FILA_CRUDA = {
    ...PRODUCTO,
    description: 'Texto largo de la ficha',
    specs: [
      { label: 'Material', value: 'PLA' },
      { basura: true },
    ],
    images: [
      { id: 'img1', productId: 'sp1', optionId: null, position: 0, key: `${ORG}/store/sp1/a.jpg`, alt: 'A', width: 800, height: 800 },
      { id: 'img2', productId: 'sp1', optionId: null, position: 1, key: `${ORG}/store/sp1/b.jpg`, alt: null, width: 600, height: 600 },
    ],
    optionGroups: [
      {
        id: 'g1',
        productId: 'sp1',
        name: 'Color',
        required: true,
        drivesPhoto: true,
        position: 0,
        options: [
          {
            id: 'o1',
            groupId: 'g1',
            value: 'Rojo',
            priceDeltaUsd: '1.5000',
            swatchHex: '#FF0000',
            position: 0,
            images: [
              { id: 'img3', productId: 'sp1', optionId: 'o1', position: 0, key: `${ORG}/store/sp1/rojo.jpg`, alt: 'Rojo', width: 500, height: 500 },
            ],
          },
          { id: 'o2', groupId: 'g1', value: 'Azul', priceDeltaUsd: '0', swatchHex: null, position: 1, images: [] },
        ],
      },
    ],
  };

  it('con detail=full cada producto trae description, specs, images y optionGroups', async () => {
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([FILA_CRUDA]) });
    const { products } = await service.list(undefined, 'full');
    const p = products[0];
    expect(p.description).toBe('Texto largo de la ficha');
    expect(p.specs).toEqual([{ label: 'Material', value: 'PLA' }]);
    expect(p.images).toHaveLength(2);
    expect(p.images[0].url).toBe(`https://cdn.example/${ORG}/store/sp1/a.jpg`);
    expect(p.optionGroups).toEqual([
      {
        name: 'Color',
        required: true,
        drivesPhoto: true,
        options: [
          {
            value: 'Rojo',
            priceDeltaUsd: 1.5,
            swatchHex: '#FF0000',
            leadTimeDays: null,
            images: [{ url: `https://cdn.example/${ORG}/store/sp1/rojo.jpg`, alt: 'Rojo', width: 500, height: 500 }],
          },
          { value: 'Azul', priceDeltaUsd: 0, swatchHex: null, leadTimeDays: null, images: [] },
        ],
      },
    ]);
    // Conserva lo de la tarjeta: la tienda sigue pintando el listado igual.
    expect(p.colors).toEqual([{ value: 'Rojo', swatchHex: '#FF0000' }]);
    expect(p.requiresOptions).toBe(true);
  });

  it('⚠️ con detail=full NO se filtra nada interno: ni id, ni groupId, ni position, ni costAtPublish', async () => {
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([FILA_CRUDA]) });
    const { products } = await service.list(undefined, 'full');
    const claves = clavesDe(products);
    for (const campo of [...PROHIBIDOS, 'groupId', 'optionId']) expect([...claves]).not.toContain(campo);
    expect(JSON.stringify(products)).not.toContain('1.25');
  });

  it('sin el parámetro la respuesta sigue siendo la tarjeta de siempre (ni description ni optionGroups)', async () => {
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([FILA_CRUDA]) });
    for (const r of [await service.list(), await service.list(undefined, 'otra-cosa')]) {
      const claves = clavesDe(r.products);
      for (const campo of ['description', 'specs', 'images', 'optionGroups']) expect(claves.has(campo)).toBe(false);
      expect(r.products[0]).toHaveProperty('image');
    }
  });

  it('detail=full respeta el filtro por categoría, incluidas las hijas', async () => {
    const { service, findMany } = makeService({ findMany: jest.fn().mockResolvedValue([FILA_CRUDA]) });
    await service.list('llaveros', 'full');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          visible: true,
          category: { OR: [{ slug: 'llaveros' }, { parent: { slug: 'llaveros' } }] },
        }),
      }),
    );
  });

  it('la foto de la tarjeta sale de la galería base, no de una opción (los dos modos)', async () => {
    const { service, findMany } = makeService();
    await service.list();
    await service.list(undefined, 'full');
    for (const [args] of findMany.mock.calls) {
      expect(args.include.images.where).toEqual({ optionId: null });
    }
    // Tarjeta: una sola foto. Completo: la galería entera.
    expect(findMany.mock.calls[0][0].include.images.take).toBe(1);
    expect(findMany.mock.calls[1][0].include.images.take).toBeUndefined();
  });

  it('el modo completo no suma consultas: es UN findMany y las fotos de opción viajan dentro del include', async () => {
    const { service, findMany, prisma } = makeService();
    await service.list(undefined, 'full');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].include.optionGroups.include.options.include).toEqual({
      images: { orderBy: { position: 'asc' } },
    });
    expect(prisma.storeProduct.findFirst).not.toHaveBeenCalled();
  });

  it('el modo tarjeta no pide las fotos por opción', async () => {
    const { service, findMany } = makeService();
    await service.list();
    expect(findMany.mock.calls[0][0].include.optionGroups.include.options.include).toBeUndefined();
  });

  it('la ficha individual y el modo completo publican exactamente la misma forma', async () => {
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([FILA_CRUDA]),
      findFirst: jest.fn().mockResolvedValue(FILA_CRUDA),
    });
    const [enLista] = (await service.list(undefined, 'full')).products;
    const ficha = await service.bySlug('llavero-mundial');
    expect(enLista).toEqual(ficha);
  });
});

/**
 * La insignia «Nuevo» (2026-11-08): DERIVADA de `publishedAt`, nunca guardada.
 * La regla pura vive en `shared/calc/novedad.ts`; acá se fija el CABLEADO — que el
 * endpoint la calcule y la publique.
 */
describe('Insignia «Nuevo» en la vitrina pública', () => {
  const conFecha = (publishedAt: Date | null) => ({
    ...PRODUCTO,
    publishedAt,
    images: [],
    optionGroups: [],
  });

  it('una ficha recién publicada sale como nueva', async () => {
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([conFecha(new Date())]) });
    const { products } = await service.list();
    expect(products[0].nuevo).toBe(true);
  });

  it('una vieja no, y su hermano alcanzable lo prueba', async () => {
    const vieja = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([conFecha(vieja)]) });
    expect((await service.list()).products[0].nuevo).toBe(false);
  });

  it('sin fecha de publicación NO es nueva', async () => {
    const { service } = makeService({ findMany: jest.fn().mockResolvedValue([conFecha(null)]) });
    expect((await service.list()).products[0].nuevo).toBe(false);
  });
});

describe('Colección de la portada', () => {
  /** Una colección tal como la devuelve Prisma (fila interna, con id y organización). */
  const COLECCION = {
    id: 'col-interna-1',
    organizationId: ORG,
    slug: 'navidad-2026',
    nombre: 'Navidad 2026 (interno)',
    titulo: 'Colección Navidad',
    subtitulo: 'Lo de la temporada',
    verTodoTipo: 'CATEGORIA' as 'CATEGORIA' | 'COLECCION' | 'NONE',
    verTodoValor: 'llaveros' as string | null,
    esPrincipal: true,
    visible: true,
    startsAt: null as Date | null,
    endsAt: null as Date | null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    items: [{ id: 'it1', collectionId: 'col-interna-1', categoryId: 'cat1', productId: null, position: 0 }],
    exclusions: [] as { id: string; collectionId: string; productId: string }[],
  };
  // La categoría 'cat1' (slug 'llaveros') existe: el «Ver todo» está vivo.
  const CATEGORIAS = [{ id: 'cat1', slug: 'llaveros', name: 'Llaveros', parentId: null }];

  const conColeccion = (c: Partial<typeof COLECCION> = {}, extra = {}) =>
    makeService({
      collectionFindMany: jest.fn().mockResolvedValue([{ ...COLECCION, ...c }]),
      categoryFindMany: jest.fn().mockResolvedValue(CATEGORIAS),
      ...extra,
    });

  it('publica la colección vigente con sus productos resueltos', async () => {
    const { service } = conColeccion();
    const { coleccion } = await service.coleccion();
    expect(coleccion).not.toBeNull();
    expect(coleccion!.titulo).toBe('Colección Navidad');
    expect(coleccion!.subtitulo).toBe('Lo de la temporada');
    expect(coleccion!.verTodo).toEqual({ tipo: 'CATEGORIA', valor: 'llaveros' });
    expect(coleccion!.productos.map((p) => p.slug)).toEqual(['llavero-mundial']);
  });

  it('SIN colección vigente cae a «Destacados», no a una lista vacía', async () => {
    // El día uno no hay ninguna colección. El endpoint lo dice con `coleccion: null` y la
    // tienda dibuja «Destacados»; si publicara una lista vacía la portada quedaría hueca.
    const sin = makeService();
    expect(await sin.service.coleccion()).toEqual({ coleccion: null });
    // Una principal VENCIDA tampoco cuenta.
    const vencida = conColeccion({ endsAt: new Date('2020-01-01T00:00:00Z') });
    expect(await vencida.service.coleccion()).toEqual({ coleccion: null });
    // Ni una principal oculta.
    const oculta = conColeccion({ visible: false });
    expect(await oculta.service.coleccion()).toEqual({ coleccion: null });
  });

  it('nunca publica ids internos ni la fila cruda de Prisma', async () => {
    const { service } = conColeccion();
    const respuesta = await service.coleccion();
    const claves = [...clavesDe(respuesta)];
    for (const campo of [...PROHIBIDOS, 'nombre', 'esPrincipal', 'items', 'exclusions', 'verTodoTipo', 'verTodoValor'])
      expect(claves).not.toContain(campo);
    // El «Ver todo» viaja por SLUG: ningún id interno aparece en ningún valor.
    const texto = JSON.stringify(respuesta);
    expect(texto).not.toContain('col-interna-1');
    expect(texto).not.toContain('cat1');
  });

  it('un «Ver todo» que apunta a una categoría borrada degrada a NONE', async () => {
    const { service } = conColeccion({}, { categoryFindMany: jest.fn().mockResolvedValue([{ id: 'cat1', slug: 'otra', name: 'Otra', parentId: null }]) });
    const { coleccion } = await service.coleccion();
    expect(coleccion!.verTodo).toEqual({ tipo: 'NONE', valor: null });
    // La colección sigue viva: solo el enlace colgado se cae.
    expect(coleccion!.productos).toHaveLength(1);
  });

  it('un «Ver todo» que apunta a una colección borrada u oculta degrada a NONE', async () => {
    const colgado = conColeccion({ verTodoTipo: 'COLECCION', verTodoValor: 'otra-coleccion' });
    expect((await colgado.service.coleccion()).coleccion!.verTodo).toEqual({ tipo: 'NONE', valor: null });
    // La consulta exige la organización del entorno y `visible: true`.
    expect(colgado.collectionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, slug: 'otra-coleccion', visible: true } }),
    );
    // Su hermano vivo: si la colección existe, el enlace se conserva.
    const vivo = conColeccion(
      { verTodoTipo: 'COLECCION', verTodoValor: 'otra-coleccion' },
      { collectionFindFirst: jest.fn().mockResolvedValue({ slug: 'otra-coleccion' }) },
    );
    expect((await vivo.service.coleccion()).coleccion!.verTodo).toEqual({ tipo: 'COLECCION', valor: 'otra-coleccion' });
  });

  it('la organización sale del entorno, nunca del cliente', async () => {
    const { service, collectionFindMany } = conColeccion();
    await service.coleccion();
    expect(collectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
    );
  });
});

describe('Página de una colección (/coleccion/<slug>/)', () => {
  const fila = (extra: Record<string, unknown> = {}) => ({
    id: 'col-interna-2',
    organizationId: ORG,
    slug: 'regalos',
    nombre: 'Regalos (interno)',
    titulo: 'Para regalar',
    subtitulo: null as string | null,
    verTodoTipo: 'NONE',
    verTodoValor: null as string | null,
    esPrincipal: false,
    visible: true,
    startsAt: null as Date | null,
    endsAt: null as Date | null,
    items: [{ id: 'i1', collectionId: 'col-interna-2', categoryId: 'cat1', productId: null, position: 0 }],
    exclusions: [] as { id: string; collectionId: string; productId: string }[],
    ...extra,
  });
  const CATS = [{ id: 'cat1', slug: 'llaveros', parentId: null }];
  const OTRO = { ...PRODUCTO, id: 'sp2', slug: 'llavero-b', categoryId: 'cat1' };
  const AJENO = { ...PRODUCTO, id: 'sp3', slug: 'sin-categoria', categoryId: null };
  const CATALOGO = [PRODUCTO, OTRO, AJENO];

  const con = (f: ReturnType<typeof fila> | null, extra = {}) =>
    makeService({
      findMany: jest.fn().mockResolvedValue(CATALOGO),
      categoryFindMany: jest.fn().mockResolvedValue(CATS),
      collectionFindFirst: jest.fn().mockResolvedValue(f),
      collectionFindMany: jest.fn().mockResolvedValue(f ? [f] : []),
      ...extra,
    });

  it('lista EXACTAMENTE los mismos productos que resolverColeccion, en su orden', async () => {
    // Es la UNICA definición: si la página resolviera por su cuenta, el dueño aprobaría una
    // lista en la vista previa y la página mostraría otra.
    const f = fila({ exclusions: [{ id: 'e1', collectionId: 'col-interna-2', productId: 'sp1' }] });
    const esperado = resolverColeccion(f.items, ['sp1'], CATALOGO, CATS).map((p) => p.slug);
    expect(esperado).toEqual(['llavero-b']); // sanidad: la exclusión sí saca uno
    const { service } = con(f);
    const c = await service.coleccionPorSlug('regalos');
    expect(c.productos.map((p) => p.slug)).toEqual(esperado);
    expect(c.titulo).toBe('Para regalar');
    expect(c.slug).toBe('regalos');
  });

  it('un slug inexistente da 404, no rompe', async () => {
    const { service, collectionFindFirst } = con(null);
    await expect(service.coleccionPorSlug('fantasma')).rejects.toBeInstanceOf(NotFoundException);
    // Y la consulta es de la organización del entorno y solo de las visibles.
    expect(collectionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, slug: 'fantasma', visible: true } }),
    );
  });

  it('una colección FUERA DE SU VENTANA da 404: no hay portada fantasma', async () => {
    const vencida = con(fila({ endsAt: new Date('2020-01-01T00:00:00Z') }));
    await expect(vencida.service.coleccionPorSlug('regalos')).rejects.toBeInstanceOf(NotFoundException);
    const futura = con(fila({ startsAt: new Date('2999-01-01T00:00:00Z') }));
    await expect(futura.service.coleccionPorSlug('regalos')).rejects.toBeInstanceOf(NotFoundException);
    // Su hermano alcanzable: sin ventana SÍ se sirve, aunque no sea la principal.
    await expect(con(fila()).service.coleccionPorSlug('regalos')).resolves.toBeDefined();
  });

  it('no publica ids internos ni la fila cruda', async () => {
    const c = await con(fila()).service.coleccionPorSlug('regalos');
    const claves = [...clavesDe(c)];
    for (const campo of [...PROHIBIDOS, 'nombre', 'esPrincipal', 'items', 'exclusions', 'verTodoTipo'])
      expect(claves).not.toContain(campo);
    expect(JSON.stringify(c)).not.toContain('col-interna-2');
  });

  it('colecciones() lista las visibles en ventana, con los mismos productos', async () => {
    const f = fila();
    const { service, collectionFindMany } = con(f);
    const { colecciones } = await service.colecciones();
    expect(colecciones.map((c) => c.slug)).toEqual(['regalos']);
    expect(colecciones[0].productos.map((p) => p.slug)).toEqual(
      resolverColeccion(f.items, [], CATALOGO, CATS).map((p) => p.slug),
    );
    expect(collectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, visible: true } }),
    );
    // Una vencida no tiene página, así que no se lista.
    const vencida = con(fila({ endsAt: new Date('2020-01-01T00:00:00Z') }));
    expect((await vencida.service.colecciones()).colecciones).toEqual([]);
  });

  it('un «Ver todo» a una colección FUERA DE VENTANA degrada a NONE', async () => {
    const colgada = { slug: 'otra', startsAt: null, endsAt: new Date('2020-01-01T00:00:00Z') };
    const { service } = con(fila({ verTodoTipo: 'COLECCION', verTodoValor: 'otra' }), {
      collectionFindFirst: jest.fn().mockResolvedValue(colgada),
    });
    // findFirst devuelve `colgada` también para la propia colección: se prueba con la lista.
    const { colecciones } = await service.colecciones();
    expect(colecciones[0].verTodo).toEqual({ tipo: 'NONE', valor: null });
  });
});
