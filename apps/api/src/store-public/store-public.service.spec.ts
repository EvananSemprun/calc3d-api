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
      position: 0,
      options: [
        { value: 'Rojo', priceDeltaUsd: '0', swatchHex: '#FF0000', position: 0 },
        { value: 'Grande', priceDeltaUsd: '3.0000', swatchHex: null, position: 1 },
      ],
    },
  ],
};

function makeService(overrides: {
  storeOrganizationId?: string | null;
  findFirst?: jest.Mock;
  findMany?: jest.Mock;
} = {}) {
  const findFirst = overrides.findFirst ?? jest.fn().mockResolvedValue(PRODUCTO);
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([PRODUCTO]);
  const prisma = {
    storeProduct: { findFirst, findMany },
    storeCategory: { findMany: jest.fn().mockResolvedValue([]) },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Banano Lab' }) },
    settings: {
      findUnique: jest.fn().mockResolvedValue({
        businessPhone: '0412 0366355',
        currency: 'USD',
        defaultRateLabel: null,
      }),
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
  const storage = { publicUrl: (key: string) => `https://cdn.example/${key}` };
  const service = new StorePublicService(
    prisma as never,
    config as never,
    rates as never,
    storage as never,
  );
  return { service, prisma, findFirst, findMany };
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
      });
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
      });
    });
  });
});
