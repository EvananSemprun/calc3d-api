import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreBannersService } from './store-banners.service';

/**
 * El banner es superficie de seguridad: imagen a R2 verificada, destino que no
 * puede apuntar a otra organización (IDOR), y aislamiento por organización.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

type Row = Record<string, unknown> & { id: string; organizationId: string };

/** Mock de Prisma que FILTRA sobre arrays por `where` — permite probar
 *  aislamiento (otra org → no se encuentra) y su hermano alcanzable. */
function makeDeps(seed: {
  banners?: Row[];
  categories?: { organizationId: string; slug: string }[];
  products?: { organizationId: string; slug: string; visible: boolean }[];
} = {}) {
  const banners = [...(seed.banners ?? [])];
  const categories = [...(seed.categories ?? [])];
  const products = [...(seed.products ?? [])];

  const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) {
        return (v as { in: unknown[] }).in.includes(row[k]);
      }
      return row[k] === v;
    });

  const prisma = {
    storeBanner: {
      findFirst: jest.fn(({ where }) => Promise.resolve(banners.find((b) => match(b, where)) ?? null)),
      findMany: jest.fn(({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { position: 'asc' | 'desc' } }) => {
        let rows = banners.filter((b) => match(b, where));
        if (orderBy?.position) {
          rows = [...rows].sort((a, b) =>
            orderBy.position === 'asc'
              ? (a.position as number) - (b.position as number)
              : (b.position as number) - (a.position as number),
          );
        }
        return Promise.resolve(rows);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `b-${banners.length + 1}`, ...data } as Row;
        banners.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = banners.find((b) => b.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const i = banners.findIndex((b) => b.id === where.id);
        if (i >= 0) banners.splice(i, 1);
        return Promise.resolve({});
      }),
    },
    storeCategory: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(categories.find((c) => match(c, where)) ?? null),
      ),
    },
    storeProduct: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(products.find((p) => match(p, where)) ?? null),
      ),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const storage = {
    publicUrl: (k: string) => `https://cdn.example/${k}`,
    createUploadUrl: jest.fn().mockResolvedValue({ key: 'k', url: 'https://firmada', headers: {} }),
    head: jest.fn().mockResolvedValue({ contentType: 'image/png', contentLength: 1000 }),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const service = new StoreBannersService(prisma as never, storage as never);
  return { prisma, storage, service, banners };
}

const goodKey = `${ORG}/store/banners/x.png`;

describe('StoreBannersService — imagen', () => {
  it('rechaza una imagen cuyo prefijo es de otra organización y no la consulta ni crea', async () => {
    const { service, storage, prisma } = makeDeps();
    await expect(
      service.create(ORG, { title: 'T', imageKey: `${OTHER}/store/banners/x.png`, linkType: 'NONE', visible: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.head).not.toHaveBeenCalled();
    expect(prisma.storeBanner.create).not.toHaveBeenCalled();
  });

  it('rechaza si la imagen no llegó al almacenamiento', async () => {
    const { service, storage } = makeDeps();
    storage.head.mockResolvedValueOnce(null);
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'NONE', visible: true }),
    ).rejects.toThrow('no llegó');
  });

  it('rechaza un MIME no permitido y borra el objeto', async () => {
    const { service, storage } = makeDeps();
    storage.head.mockResolvedValueOnce({ contentType: 'application/pdf', contentLength: 1000 });
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'NONE', visible: true }),
    ).rejects.toThrow('PNG, JPEG o WebP');
    expect(storage.remove).toHaveBeenCalledWith(goodKey);
  });

  it('rechaza una imagen que pasa el tope de tamaño y la borra', async () => {
    const { service, storage } = makeDeps();
    storage.head.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 6 * 1024 * 1024 });
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'NONE', visible: true }),
    ).rejects.toThrow('5 MB');
    expect(storage.remove).toHaveBeenCalledWith(goodKey);
  });

  it('crea el banner con la imagen válida y position correlativa', async () => {
    const { service, prisma } = makeDeps({
      banners: [{ id: 'b-0', organizationId: ORG, position: 0, imageKey: 'k', title: 'x' }],
    });
    await service.create(ORG, { title: 'Nuevo', imageKey: goodKey, linkType: 'NONE', visible: true });
    expect(prisma.storeBanner.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG, imageKey: goodKey, position: 1, title: 'Nuevo' }) }),
    );
  });
});

describe('StoreBannersService — destino (IDOR)', () => {
  it('rechaza CATEGORY con slug inexistente', async () => {
    const { service } = makeDeps();
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'CATEGORY', linkValue: 'fantasma', visible: true }),
    ).rejects.toThrow('categoría');
  });

  it('rechaza CATEGORY cuyo slug existe pero en OTRA organización', async () => {
    const { service } = makeDeps({ categories: [{ organizationId: OTHER, slug: 'llaveros' }] });
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'CATEGORY', linkValue: 'llaveros', visible: true }),
    ).rejects.toThrow('categoría');
  });

  it('acepta CATEGORY cuyo slug existe en la propia organización (hermano alcanzable)', async () => {
    const { service, prisma } = makeDeps({ categories: [{ organizationId: ORG, slug: 'llaveros' }] });
    await service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'CATEGORY', linkValue: 'llaveros', visible: true });
    expect(prisma.storeBanner.create).toHaveBeenCalled();
  });

  it('rechaza PRODUCT que existe pero no está visible', async () => {
    const { service } = makeDeps({ products: [{ organizationId: ORG, slug: 'oculto', visible: false }] });
    await expect(
      service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'PRODUCT', linkValue: 'oculto', visible: true }),
    ).rejects.toThrow('producto');
  });

  it('acepta PRODUCT visible de la propia organización', async () => {
    const { service, prisma } = makeDeps({ products: [{ organizationId: ORG, slug: 'llavero', visible: true }] });
    await service.create(ORG, { title: 'T', imageKey: goodKey, linkType: 'PRODUCT', linkValue: 'llavero', visible: true });
    expect(prisma.storeBanner.create).toHaveBeenCalled();
  });
});

describe('StoreBannersService — aislamiento por organización', () => {
  const seed = { banners: [{ id: 'b1', organizationId: ORG, position: 0, imageKey: goodKey, title: 'T', linkType: 'NONE', linkValue: null }] };

  it('get de otra organización no encuentra el banner', async () => {
    const { service } = makeDeps(seed);
    await expect(service.get(OTHER, 'b1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get de la organización dueña SÍ lo devuelve (hermano alcanzable)', async () => {
    const { service } = makeDeps(seed);
    const b = await service.get(ORG, 'b1');
    expect(b.id).toBe('b1');
    expect(b.imageUrl).toBe(`https://cdn.example/${goodKey}`);
  });

  it('remove de otra organización no borra', async () => {
    const { service } = makeDeps(seed);
    await expect(service.remove(OTHER, 'b1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reorder solo mueve los banners de la organización', async () => {
    const { service, prisma } = makeDeps({
      banners: [
        { id: 'mio', organizationId: ORG, position: 0, imageKey: goodKey, title: 'a' },
        { id: 'ajeno', organizationId: OTHER, position: 0, imageKey: goodKey, title: 'b' },
      ],
    });
    await service.reorder(ORG, ['mio', 'ajeno']);
    expect(prisma.storeBanner.update).toHaveBeenCalledTimes(1);
    expect(prisma.storeBanner.update).toHaveBeenCalledWith({ where: { id: 'mio' }, data: { position: 0 } });
  });
});
