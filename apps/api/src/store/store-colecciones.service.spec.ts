import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreCollectionUpsertSchema, type StoreCollectionUpsertDto } from '@calc3d/shared';
import { StoreColeccionesService } from './store-colecciones.service';

/**
 * Colecciones de la portada. Superficie de seguridad igual que los banners: lo que se
 * ata a una colección (categorías, productos, exclusiones) tiene que ser de ESTA
 * organización, y editar no puede borrar y recrear los items (ver `update`).
 *
 * Cada test de aislamiento va con su HERMANO ALCANZABLE: la fila propia SÍ se acepta.
 * Sin el hermano, un servicio que rechazara todo pasaría los de seguridad.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

type Row = Record<string, unknown> & { id: string };

function makeDeps(seed: {
  collections?: Row[];
  items?: Row[];
  exclusions?: Row[];
  categories?: Row[];
  products?: Row[];
} = {}) {
  const collections = [...(seed.collections ?? [])];
  const items = [...(seed.items ?? [])];
  const exclusions = [...(seed.exclusions ?? [])];
  const categories = [...(seed.categories ?? [])];
  const products = [...(seed.products ?? [])];
  let seq = 0;

  const match = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object)) return (v as { in: unknown[] }).in.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in (v as object)) return row[k] !== (v as { not: unknown }).not;
      return row[k] === v;
    });

  const byPosition = (rows: Row[]) => [...rows].sort((a, b) => (a.position as number) - (b.position as number));

  const prisma: Record<string, unknown> = {
    storeCollection: {
      findMany: jest.fn(({ where }) => Promise.resolve(collections.filter((c) => match(c, where)))),
      findFirst: jest.fn(({ where }) => Promise.resolve(collections.find((c) => match(c, where)) ?? null)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `col-${++seq}`, esPrincipal: false, ...data } as Row;
        collections.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = collections.find((c) => c.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      // Como Postgres: borrar la colección se lleva sus items y exclusiones (Cascade).
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const i = collections.findIndex((c) => c.id === where.id);
        if (i >= 0) collections.splice(i, 1);
        for (let j = items.length - 1; j >= 0; j--) if (items[j].collectionId === where.id) items.splice(j, 1);
        for (let j = exclusions.length - 1; j >= 0; j--) if (exclusions[j].collectionId === where.id) exclusions.splice(j, 1);
        return Promise.resolve({});
      }),
    },
    storeCollectionItem: {
      findMany: jest.fn(({ where }) => Promise.resolve(byPosition(items.filter((i) => match(i, where))))),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `it-${++seq}`, categoryId: null, productId: null, ...data } as Row;
        items.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = items.find((i) => i.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      deleteMany: jest.fn(({ where }) => {
        for (let j = items.length - 1; j >= 0; j--) if (match(items[j], where)) items.splice(j, 1);
        return Promise.resolve({});
      }),
    },
    storeCollectionExclusion: {
      findMany: jest.fn(({ where }) => Promise.resolve(exclusions.filter((e) => match(e, where)))),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ex-${++seq}`, ...data } as Row;
        exclusions.push(row);
        return Promise.resolve(row);
      }),
      deleteMany: jest.fn(({ where }) => {
        for (let j = exclusions.length - 1; j >= 0; j--) if (match(exclusions[j], where)) exclusions.splice(j, 1);
        return Promise.resolve({});
      }),
    },
    storeCategory: {
      findMany: jest.fn(({ where }) => Promise.resolve(categories.filter((c) => match(c, where)))),
      findFirst: jest.fn(({ where }) => Promise.resolve(categories.find((c) => match(c, where)) ?? null)),
    },
    storeProduct: {
      findMany: jest.fn(({ where }) => Promise.resolve(products.filter((p) => match(p, where)))),
    },
  };
  // La transacción interactiva le pasa al callback el mismo cliente.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(prisma));

  const service = new StoreColeccionesService(prisma as never);
  return { prisma, service, collections, items, exclusions };
}

/** Un mundo con dos categorías y tres productos propios, y uno de cada cosa ajena. */
const mundo = () => ({
  categories: [
    { id: 'cat-1', organizationId: ORG, slug: 'navidad' },
    { id: 'cat-2', organizationId: ORG, slug: 'llaveros' },
    { id: 'cat-x', organizationId: OTHER, slug: 'ajena' },
  ],
  products: [
    { id: 'p-1', organizationId: ORG },
    { id: 'p-2', organizationId: ORG },
    { id: 'p-3', organizationId: ORG },
    { id: 'p-x', organizationId: OTHER },
  ],
});

/** Pasa por el schema REAL: el test usa lo que el pipe le entregaría al servicio. */
const dto = (parcial: Record<string, unknown> = {}): StoreCollectionUpsertDto =>
  StoreCollectionUpsertSchema.parse({ nombre: 'Navidad', titulo: 'Colección Navidad 2026', ...parcial });

describe('StoreColeccionesService — crear', () => {
  it('crea una colección con sus categorías y productos sueltos', async () => {
    const { service, prisma } = makeDeps(mundo());
    const r = await service.create(
      ORG,
      dto({
        items: [
          { categoryId: 'cat-1', position: 0 },
          { productId: 'p-1', position: 1 },
        ],
        exclusiones: ['p-2'],
        startsAt: '2026-12-01',
        endsAt: '2026-12-31',
      }),
    );
    expect(r.nombre).toBe('Navidad');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual(expect.objectContaining({ categoryId: 'cat-1', productId: null, position: 0 }));
    expect(r.items[1]).toEqual(expect.objectContaining({ categoryId: null, productId: 'p-1', position: 1 }));
    expect(r.exclusiones).toEqual(['p-2']);
    // Fecha de NEGOCIO: se guarda a medianoche UTC y vuelve como el mismo día pelado.
    expect(r.startsAt).toBe('2026-12-01');
    expect(r.endsAt).toBe('2026-12-31');
    expect(prisma.storeCollection).toBeDefined();
  });

  it('la colección nace en la organización del token y NO nace como principal', async () => {
    const { service, collections } = makeDeps(mundo());
    await service.create(ORG, dto());
    expect(collections[0]).toEqual(expect.objectContaining({ organizationId: ORG, esPrincipal: false }));
  });

  it('una categoría de otra organización se rechaza con 404', async () => {
    const { service, collections } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ items: [{ categoryId: 'cat-x', position: 0 }] }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(collections).toHaveLength(0); // ni la colección a medias
  });

  it('…y la propia SÍ se acepta', async () => {
    const { service } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ items: [{ categoryId: 'cat-1', position: 0 }] }))).resolves.toBeDefined();
  });

  it('un producto de otra organización se rechaza con 404', async () => {
    const { service, collections } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ items: [{ productId: 'p-x', position: 0 }] }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(collections).toHaveLength(0);
  });

  it('…y el propio SÍ se acepta', async () => {
    const { service } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ items: [{ productId: 'p-1', position: 0 }] }))).resolves.toBeDefined();
  });

  it('una exclusión de un producto ajeno se rechaza con 404, y la propia SÍ se acepta', async () => {
    const { service } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ exclusiones: ['p-x'] }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(ORG, dto({ exclusiones: ['p-1'] }))).resolves.toBeDefined();
  });

  it('un «Ver todo» a una categoría que no es de esta organización se rechaza con 400, y la propia SÍ', async () => {
    const { service } = makeDeps(mundo());
    await expect(service.create(ORG, dto({ verTodoTipo: 'CATEGORIA', verTodoValor: 'ajena' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(ORG, dto({ verTodoTipo: 'CATEGORIA', verTodoValor: 'navidad' }))).resolves.toBeDefined();
  });

  it('nunca devuelve la fila cruda: no sale organizationId', async () => {
    const { service } = makeDeps(mundo());
    const r = await service.create(ORG, dto());
    expect(r).not.toHaveProperty('organizationId');
    expect(Object.keys(r).sort()).toEqual(
      ['endsAt', 'esPrincipal', 'exclusiones', 'id', 'items', 'nombre', 'slug', 'startsAt', 'subtitulo', 'titulo', 'verTodoTipo', 'verTodoValor', 'visible'].sort(),
    );
  });
});

describe('StoreColeccionesService — editar', () => {
  /** Crea una colección con 2 items y 1 exclusión y devuelve lo creado. */
  async function conDatos() {
    const deps = makeDeps(mundo());
    const creada = await deps.service.create(
      ORG,
      dto({
        items: [
          { categoryId: 'cat-1', position: 0 },
          { productId: 'p-1', position: 1 },
        ],
        exclusiones: ['p-2'],
      }),
    );
    return { ...deps, creada };
  }

  it('editar NO duplica los items: hace diff por id', async () => {
    const { service, prisma, items, creada } = await conDatos();
    const [a, b] = creada.items;
    (prisma.storeCollectionItem as { create: jest.Mock }).create.mockClear();

    // Reordena los dos que había y suma uno nuevo, sin tocar nada más.
    const r = await service.update(
      ORG,
      creada.id,
      dto({
        items: [
          { id: b.id, productId: 'p-1', position: 0 },
          { id: a.id, categoryId: 'cat-1', position: 1 },
          { categoryId: 'cat-2', position: 2 },
        ],
        exclusiones: ['p-2'],
      }),
    );

    expect(items).toHaveLength(3); // no se duplicó nada
    // Los dos que existían CONSERVAN su id (lo que borrar y recrear no puede dar).
    expect(r.items.map((i) => i.id).slice(0, 2)).toEqual([b.id, a.id]);
    expect(r.items.map((i) => i.position)).toEqual([0, 1, 2]);
    // Solo se creó el nuevo.
    expect((prisma.storeCollectionItem as { create: jest.Mock }).create).toHaveBeenCalledTimes(1);
    expect((prisma.storeCollectionItem as { deleteMany: jest.Mock }).deleteMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: expect.anything() }) }),
    );
  });

  it('editar sin tocar los items no los vuelve a crear ni a borrar', async () => {
    const { service, prisma, creada } = await conDatos();
    const itemApi = prisma.storeCollectionItem as { create: jest.Mock; deleteMany: jest.Mock };
    itemApi.create.mockClear();
    itemApi.deleteMany.mockClear();
    await service.update(
      ORG,
      creada.id,
      dto({
        titulo: 'Otro título',
        items: creada.items.map((i) => ({ id: i.id, categoryId: i.categoryId, productId: i.productId, position: i.position })),
        exclusiones: ['p-2'],
      }),
    );
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(itemApi.deleteMany).not.toHaveBeenCalled();
  });

  it('un item que ya no viene en el cuerpo se borra, y solo ese', async () => {
    const { service, items, creada } = await conDatos();
    const [a, b] = creada.items;
    const r = await service.update(
      ORG,
      creada.id,
      dto({ items: [{ id: a.id, categoryId: 'cat-1', position: 0 }], exclusiones: ['p-2'] }),
    );
    expect(r.items.map((i) => i.id)).toEqual([a.id]);
    expect(items.map((i) => i.id)).toEqual([a.id]);
    expect(items.find((i) => i.id === b.id)).toBeUndefined();
  });

  it('las exclusiones también van por diff: la que sigue conserva su fila', async () => {
    const { service, exclusions, creada } = await conDatos();
    const filaOriginal = exclusions[0].id;
    await service.update(ORG, creada.id, dto({ items: [], exclusiones: ['p-2', 'p-3'] }));
    expect(exclusions.map((e) => e.productId).sort()).toEqual(['p-2', 'p-3']);
    expect(exclusions.find((e) => e.productId === 'p-2')?.id).toBe(filaOriginal);
    await service.update(ORG, creada.id, dto({ items: [], exclusiones: ['p-3'] }));
    expect(exclusions.map((e) => e.productId)).toEqual(['p-3']);
  });

  it('un id de item de OTRA colección se rechaza con 404 y no escribe nada', async () => {
    const { service, prisma, items, collections } = await conDatos();
    const otra = await service.create(ORG, dto({ nombre: 'Otra', items: [{ categoryId: 'cat-2', position: 0 }] }));
    const itemAjeno = otra.items[0];
    const antes = items.length;
    await expect(
      service.update(ORG, collections[0].id, dto({ items: [{ id: itemAjeno.id, categoryId: 'cat-2', position: 0 }] })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(items).toHaveLength(antes);
    expect((prisma.storeCollectionItem as { deleteMany: jest.Mock }).deleteMany).not.toHaveBeenCalled();
  });

  it('editar con una categoría de otra organización se rechaza con 404 y no toca la colección', async () => {
    const { service, collections, creada } = await conDatos();
    await expect(
      service.update(ORG, creada.id, dto({ titulo: 'Cambiado', items: [{ categoryId: 'cat-x', position: 0 }] })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(collections[0].titulo).toBe('Colección Navidad 2026');
  });

  it('…y con la propia SÍ se edita', async () => {
    const { service, creada } = await conDatos();
    const r = await service.update(ORG, creada.id, dto({ titulo: 'Cambiado', items: [{ categoryId: 'cat-2', position: 0 }] }));
    expect(r.titulo).toBe('Cambiado');
  });

  it('editar NO cambia cuál es la principal', async () => {
    const { service, collections, creada } = await conDatos();
    collections[0].esPrincipal = true;
    const r = await service.update(ORG, creada.id, dto({ titulo: 'Otro' }));
    expect(r.esPrincipal).toBe(true);
  });

  it('una colección de otra organización da 404 al editar, y la propia SÍ se edita', async () => {
    const { service, creada } = await conDatos();
    await expect(service.update(OTHER, creada.id, dto())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(ORG, creada.id, dto())).resolves.toBeDefined();
  });
});

describe('StoreColeccionesService — leer y borrar', () => {
  it('list y get solo ven las de la organización, y get de una ajena da 404', async () => {
    const { service } = makeDeps(mundo());
    const mia = await service.create(ORG, dto({ nombre: 'Mía' }));
    await service.create(OTHER, dto({ nombre: 'Ajena' }));
    expect((await service.list(ORG)).map((c) => c.nombre)).toEqual(['Mía']);
    await expect(service.get(ORG, mia.id)).resolves.toEqual(expect.objectContaining({ nombre: 'Mía' }));
    await expect(service.get(OTHER, mia.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('borrar una colección de otra organización da 404 y no la borra; la propia SÍ', async () => {
    const { service, collections } = makeDeps(mundo());
    const mia = await service.create(ORG, dto({ items: [{ categoryId: 'cat-1', position: 0 }], exclusiones: ['p-1'] }));
    await expect(service.remove(OTHER, mia.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(collections).toHaveLength(1);
    await expect(service.remove(ORG, mia.id)).resolves.toEqual({ ok: true });
    expect(collections).toHaveLength(0);
  });

  it('borrar la colección se lleva sus items y exclusiones (cascada de la tabla)', async () => {
    const { service, items, exclusions } = makeDeps(mundo());
    const mia = await service.create(ORG, dto({ items: [{ categoryId: 'cat-1', position: 0 }], exclusiones: ['p-1'] }));
    await service.remove(ORG, mia.id);
    expect(items).toHaveLength(0);
    expect(exclusions).toHaveLength(0);
  });
});

describe('StoreColeccionesService — slug y «Ver todo»', () => {
  it('sin slug en el cuerpo se arma del nombre', async () => {
    const { service } = makeDeps(mundo());
    const r = await service.create(ORG, dto({ nombre: 'Navidad 2026' }));
    expect(r.slug).toBe('navidad-2026');
  });

  it('un slug repetido en la MISMA organización recibe sufijo; en otra organización no', async () => {
    const { service } = makeDeps(mundo());
    const a = await service.create(ORG, dto({ nombre: 'Navidad' }));
    const b = await service.create(ORG, dto({ nombre: 'Navidad' }));
    const c = await service.create(OTHER, dto({ nombre: 'Navidad' }));
    expect([a.slug, b.slug, c.slug]).toEqual(['navidad', 'navidad-2', 'navidad']);
  });

  it('editar sin slug CONSERVA el enlace aunque cambie el nombre; con slug lo cambia', async () => {
    const { service } = makeDeps(mundo());
    const c = await service.create(ORG, dto({ nombre: 'Navidad' }));
    expect((await service.update(ORG, c.id, dto({ nombre: 'Otro nombre' }))).slug).toBe('navidad');
    expect((await service.update(ORG, c.id, dto({ nombre: 'Otro nombre', slug: 'fiestas' }))).slug).toBe('fiestas');
  });

  it('conservar el propio slug al editar no se cuenta como choque consigo misma', async () => {
    const { service } = makeDeps(mundo());
    const c = await service.create(ORG, dto({ nombre: 'Navidad' }));
    expect((await service.update(ORG, c.id, dto({ slug: 'navidad' }))).slug).toBe('navidad');
  });

  it('«Ver todo» a una colección se guarda por SLUG; un id o un slug ajeno se rechaza con 400', async () => {
    const { service } = makeDeps(mundo());
    const destino = await service.create(ORG, dto({ nombre: 'Destino' }));
    await service.create(OTHER, dto({ nombre: 'Ajena' }));
    const ok = await service.create(ORG, dto({ nombre: 'Origen', verTodoTipo: 'COLECCION', verTodoValor: destino.slug }));
    expect(ok.verTodoValor).toBe('destino');
    // El id interno NO es un destino válido: este valor se publica.
    await expect(
      service.create(ORG, dto({ nombre: 'X', verTodoTipo: 'COLECCION', verTodoValor: destino.id })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(ORG, dto({ nombre: 'Y', verTodoTipo: 'COLECCION', verTodoValor: 'ajena' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StoreColeccionesService — choque de índice único', () => {
  const choque = (target: string) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: [target] } });

  it('un choque del único de items sale como 400 en español, no como 500', async () => {
    const { service, prisma } = makeDeps(mundo());
    const c = await service.create(ORG, dto({ items: [{ categoryId: 'cat-1', position: 0 }] }));
    (prisma.storeCollectionItem as { create: jest.Mock }).create.mockRejectedValueOnce(choque('collectionId,categoryId'));
    const e = await service.update(ORG, c.id, dto({ items: [{ categoryId: 'cat-1', position: 0 }, { categoryId: 'cat-2', position: 1 }] })).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/repetido/);
  });

  it('un choque del slug (carrera de dos altas) también sale como 400 y dice qué pasó', async () => {
    const { service, prisma } = makeDeps(mundo());
    (prisma.storeCollection as { create: jest.Mock }).create.mockRejectedValueOnce(choque('organizationId,slug'));
    const e = await service.create(ORG, dto()).catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/enlace/);
  });

  it('un error que NO es de índice único se propaga tal cual (no se disfraza de 400)', async () => {
    const { service, prisma } = makeDeps(mundo());
    (prisma.storeCollection as { create: jest.Mock }).create.mockRejectedValueOnce(new Error('se cayó la base'));
    await expect(service.create(ORG, dto())).rejects.toThrow('se cayó la base');
  });
});
