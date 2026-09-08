import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';

/**
 * Regresión del catálogo de tienda del panel. Dos cosas que se fijan acá:
 *
 * - **El costo lo pone el servidor.** Nunca llega del cliente: se calcula con el
 *   motor sobre el `input` que manda la calculadora, o se lee de la cotización
 *   enlazada verificando que sea de la organización. Si viajara en el cuerpo,
 *   cualquiera publicaría con un costo inventado y el margen sería mentira.
 * - **La foto se verifica contra el almacenamiento.** La URL firmada acota la
 *   subida, pero es la confirmación la que decide qué queda registrado: si solo
 *   creyera lo que dice el cliente, bastaría con confirmar una clave ajena.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

/** DTO mínimo válido: los campos con default de Zod ya vienen resueltos. */
const BASE = {
  kind: 'PHYSICAL' as const,
  minQty: 1,
  visible: false,
  custom: false,
  specs: [],
  optionGroups: [],
};

/** Costeo mínimo que manda la calculadora: 1 pieza de 100 g de un rollo de $20. */
const COSTEO = {
  quantity: 1,
  piecesPerBatch: 1,
  filament: { name: 'PLA', rollPrice: 20, rollGrams: 1000, grams: 100 },
  waste: { pct: 0.08 },
  supplies: [],
  printer: undefined,
  electricity: { enabled: false, kwhPrice: 0 },
  parallelPrinters: 1,
  labor: { minutes: 0, hourlyRate: 0 },
  extras: { packagingPerPiece: 0, otherPerOrder: 0 },
  margins: { markup: 1, minMarginPct: 0.6, rounding: { mode: 'NONE' as const, increment: 1 } },
  manualPrice: null,
  wholesale: { tiers: [] },
  currency: 'USD',
  locale: 'en-US',
};

const FICHA = {
  id: 'sp1',
  organizationId: ORG,
  slug: 'llavero',
  name: 'Llavero',
  images: [] as { id: string; key: string }[],
  optionGroups: [],
  category: null,
  productId: null,
  quoteId: null,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    storeProduct: {
      // `findFirst` sirve a dos usos: buscar la ficha por id y comprobar si un
      // slug está ocupado. Por defecto el slug siempre está libre.
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.slug ? null : FICHA),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(FICHA),
      update: jest.fn().mockResolvedValue(FICHA),
      delete: jest.fn().mockResolvedValue(FICHA),
    },
    storeImage: { create: jest.fn(), delete: jest.fn(), update: jest.fn() },
    storeCategory: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn() },
    product: { findFirst: jest.fn() },
    quote: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
  // Se asigna después para no referenciar `prisma` dentro de su propio literal.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
  );
  const storage = {
    configured: true,
    publicUrl: (key: string) => `https://cdn.example/${key}`,
    createUploadUrl: jest.fn().mockResolvedValue({ key: 'k', url: 'https://firmada', headers: {} }),
    head: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const recost = { loadCatalog: jest.fn(), recost: jest.fn().mockResolvedValue(null) };
  return {
    prisma,
    storage,
    service: new StoreService(prisma as never, storage as never, recost as never),
  };
}

describe('Catálogo de tienda (panel)', () => {
  describe('el costo lo resuelve el servidor', () => {
    it('lo CALCULA con el motor sobre el costeo que manda la calculadora', async () => {
      const { prisma, service } = makeDeps();
      await service.create(ORG, {
        ...BASE,
        name: 'Llavero',
        priceUsd: 3.5,
        kind: 'PHYSICAL',
        input: COSTEO,
      });
      const data = prisma.storeProduct.create.mock.calls[0][0].data;
      // El costo del caso: 100 g de un rollo de $20/1000 g = $2, más 8 % de
      // merma = $2.16. Nada de esto vino del cliente.
      expect(Number(data.costAtPublish)).toBeCloseTo(2.16, 2);
      expect(data.input).toBeTruthy();
    });

    it('lo toma del costo por unidad de la cotización enlazada', async () => {
      const { prisma, service } = makeDeps();
      prisma.quote.findFirst.mockResolvedValue({ totals: { costPerUnit: 0.87 } });
      await service.create(ORG, {
        ...BASE,
        name: 'Llavero',
        priceUsd: 3.5,
        kind: 'PHYSICAL',
        quoteId: 'q-1',
      });
      expect(prisma.storeProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ costAtPublish: 0.87 }) }),
      );
    });

    it('el borrador desde una cotización toma su PRECIO FINAL', async () => {
      const { prisma, service } = makeDeps();
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-1',
        name: 'Llavero lote',
        totals: { costPerUnit: 0.87, price: { final: 3.5 } },
      });

      await service.createFromSource(ORG, { quoteId: 'q-1' } as never);

      expect(prisma.storeProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priceUsd: 3.5, costAtPublish: 0.87 }),
        }),
      );
    });

    /**
     * Una cotización guardada antes de shared 0.7.0 no tiene `price`. Publicarla
     * con precio 0 la dejaría a la venta regalada en la tienda pública.
     */
    it('rechaza una cotización sin precio final en vez de publicar en 0', async () => {
      const { prisma, service } = makeDeps();
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-viejo',
        name: 'Formato viejo',
        totals: { costPerUnit: 0.87, prices: [{ priceRounded: 3.5 }] },
      });

      await expect(service.createFromSource(ORG, { quoteId: 'q-viejo' } as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.storeProduct.create).not.toHaveBeenCalled();
    });

    it('una ficha cargada a mano simplemente no tiene costo', async () => {
      const { prisma, service } = makeDeps();
      await service.create(ORG, {
        ...BASE,
        name: 'Diseño a medida',
        priceUsd: 20,
        kind: 'SERVICE',
      });
      expect(prisma.storeProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ costAtPublish: null }) }),
      );
    });

    it('no se puede enlazar el producto de otra organización', async () => {
      const { prisma, service } = makeDeps();
      prisma.product.findFirst.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(where.organizationId === OTHER ? { costAtSave: '1' } : null),
      );
      await expect(
        service.create(ORG, {
          ...BASE,
          name: 'X',
          priceUsd: 1,
          kind: 'PHYSICAL',
          quoteId: 'ajeno',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.storeProduct.create).not.toHaveBeenCalled();
    });
  });

  describe('el enlace público (slug)', () => {
    it('se deriva del nombre cuando no se manda', async () => {
      const { prisma, service } = makeDeps();
      await service.create(ORG, {
        ...BASE,
        name: 'Llaveros de Copa del Mundial',
        priceUsd: 2,
        kind: 'PHYSICAL',
      });
      expect(prisma.storeProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'llaveros-de-copa-del-mundial' }),
        }),
      );
    });

    it('si choca con otro, agrega un sufijo en vez de fallar', async () => {
      const { prisma, service } = makeDeps();
      prisma.storeProduct.findFirst.mockImplementation(
        ({ where }: { where: { slug?: string } }) =>
          // Devuelve la ficha entera (no un {id} suelto) para que el tipo del
          // mock siga coincidiendo con el de la implementación por defecto.
          Promise.resolve(where.slug === 'llavero' ? FICHA : null),
      );
      await service.create(ORG, {
        ...BASE,
        name: 'Llavero',
        priceUsd: 2,
        kind: 'PHYSICAL',
      });
      expect(prisma.storeProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'llavero-2' }) }),
      );
    });
  });

  describe('confirmación de fotos', () => {
    const foto = { key: `${ORG}/store/sp1/abc.jpg` };

    it('rechaza una clave que no sea de este producto', async () => {
      // Sin esta comprobación, confirmar la clave de otra organización
      // registraría su archivo dentro de la ficha propia.
      const { storage, prisma, service } = makeDeps();
      await expect(
        service.confirmImage(ORG, 'sp1', { key: `${OTHER}/store/xx/robada.jpg` }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.head).not.toHaveBeenCalled();
      expect(prisma.storeImage.create).not.toHaveBeenCalled();
    });

    it('rechaza si el objeto no llegó al almacenamiento', async () => {
      const { storage, prisma, service } = makeDeps();
      storage.head.mockResolvedValue(null);
      await expect(service.confirmImage(ORG, 'sp1', foto)).rejects.toThrow(BadRequestException);
      expect(prisma.storeImage.create).not.toHaveBeenCalled();
    });

    it('rechaza (y borra) un archivo que no es una imagen aceptada', async () => {
      const { storage, prisma, service } = makeDeps();
      storage.head.mockResolvedValue({ contentType: 'application/pdf', contentLength: 100 });
      await expect(service.confirmImage(ORG, 'sp1', foto)).rejects.toThrow(BadRequestException);
      expect(prisma.storeImage.create).not.toHaveBeenCalled();
      // No queda basura en el bucket.
      expect(storage.remove).toHaveBeenCalledWith(foto.key);
    });

    it('rechaza (y borra) un archivo por encima del tope', async () => {
      const { storage, prisma, service } = makeDeps();
      storage.head.mockResolvedValue({
        contentType: 'image/jpeg',
        contentLength: 6 * 1024 * 1024,
      });
      await expect(service.confirmImage(ORG, 'sp1', foto)).rejects.toThrow(BadRequestException);
      expect(prisma.storeImage.create).not.toHaveBeenCalled();
      expect(storage.remove).toHaveBeenCalledWith(foto.key);
    });

    it('registra la foto cuando el objeto es lo que dice ser', async () => {
      const { storage, prisma, service } = makeDeps();
      storage.head.mockResolvedValue({ contentType: 'image/jpeg', contentLength: 1024 });
      await service.confirmImage(ORG, 'sp1', { ...foto, alt: 'Llavero rojo' });
      expect(prisma.storeImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ key: foto.key, alt: 'Llavero rojo', position: 0 }),
        }),
      );
    });
  });

  describe('aislamiento por organización', () => {
    it('get filtra por { id, organizationId }', async () => {
      const { prisma, service } = makeDeps();
      prisma.storeProduct.findFirst.mockResolvedValue(null);
      await expect(service.get(ORG, 'sp1')).rejects.toThrow(NotFoundException);
      // (el mock devuelve null también para el slug, pero `get` ni llega ahí)
      expect(prisma.storeProduct.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sp1', organizationId: ORG } }),
      );
    });

    it('reorder ignora los ids que no son de la organización', async () => {
      const { prisma, service } = makeDeps();
      // `reorder` devuelve la lista al final, y la lista pasa por las fotos.
      prisma.storeProduct.findMany.mockResolvedValue([{ ...FICHA, id: 'mio' }]);
      await service.reorder(ORG, ['mio', 'ajeno']);
      expect(prisma.storeProduct.update).toHaveBeenCalledTimes(1);
      expect(prisma.storeProduct.update).toHaveBeenCalledWith({
        where: { id: 'mio' },
        data: { position: 0 },
      });
    });
  });
});
