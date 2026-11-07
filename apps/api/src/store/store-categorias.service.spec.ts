import { StoreService } from './store.service';

/**
 * Subcategorías: la madre se persiste de verdad (updateCategory escribía solo
 * { name, slug } y la madre desaparecía sin error), hay dos niveles como máximo,
 * no hay ciclos y no se borra una madre con hijas.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

type Cat = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  position: number;
  parentId: string | null;
};

const cat = (id: string, parentId: string | null = null, organizationId = ORG): Cat => ({
  id,
  organizationId,
  name: id,
  slug: id,
  position: 0,
  parentId,
});

/** Mock de Prisma que FILTRA sobre el array según el `where`. */
function makeDeps(seed: Cat[]) {
  const rows = [...seed];

  const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'not' in (v as object)) {
        return row[k] !== (v as { not: unknown }).not;
      }
      return row[k] === v;
    });

  const prisma = {
    storeCategory: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.find((r) => match(r, where)) ?? null),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.filter((r) => match(r, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `nueva-${rows.length + 1}`, ...data } as Cat;
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i >= 0) rows.splice(i, 1);
        return Promise.resolve({});
      }),
    },
  };

  const service = new StoreService(prisma as never, {} as never, {} as never);
  return { prisma, service, rows };
}

const fila = (rows: Cat[], id: string) => rows.find((r) => r.id === id);

describe('Categorías — la madre se persiste', () => {
  it('createCategory guarda el parentId que vino en el dto', async () => {
    const { service, rows } = makeDeps([cat('raiz')]);
    const creada = await service.createCategory(ORG, { name: 'Hija', parentId: 'raiz' });
    expect(fila(rows, creada.id)?.parentId).toBe('raiz');
  });

  it('⚠️ updateCategory guarda el parentId: antes escribía solo { name, slug }', async () => {
    const { service, rows } = makeDeps([cat('raiz'), cat('hoja')]);
    await service.updateCategory(ORG, 'hoja', { name: 'hoja', parentId: 'raiz' });
    expect(fila(rows, 'hoja')?.parentId).toBe('raiz');
  });

  it('updateCategory con parentId null mueve la categoría a la raíz', async () => {
    const { service, rows } = makeDeps([cat('raiz'), cat('hoja', 'raiz')]);
    await service.updateCategory(ORG, 'hoja', { name: 'hoja', parentId: null });
    expect(fila(rows, 'hoja')?.parentId).toBeNull();
  });

  it('updateCategory SIN parentId no toca la madre que ya tenía', async () => {
    const { service, rows } = makeDeps([cat('raiz'), cat('hoja', 'raiz')]);
    await service.updateCategory(ORG, 'hoja', { name: 'Otro nombre' });
    expect(fila(rows, 'hoja')?.parentId).toBe('raiz');
    expect(fila(rows, 'hoja')?.name).toBe('Otro nombre');
  });
});

describe('Categorías — dos niveles y nada de ciclos', () => {
  it('rechaza colgar una categoría de sí misma', async () => {
    const { service, rows } = makeDeps([cat('a')]);
    await expect(
      service.updateCategory(ORG, 'a', { name: 'a', parentId: 'a' }),
    ).rejects.toThrow('Una categoría no puede ser su propia madre');
    expect(fila(rows, 'a')?.parentId).toBeNull();
  });

  it('rechaza colgar una categoría de una que ya tiene madre (tercer nivel)', async () => {
    const { service, rows } = makeDeps([cat('raiz'), cat('hija', 'raiz'), cat('nieta')]);
    await expect(
      service.updateCategory(ORG, 'nieta', { name: 'nieta', parentId: 'hija' }),
    ).rejects.toThrow('solo se admiten dos niveles');
    expect(fila(rows, 'nieta')?.parentId).toBeNull();
  });

  it('rechaza darle madre a una categoría que ya tiene hijas', async () => {
    const { service, rows } = makeDeps([cat('otra'), cat('madre'), cat('hija', 'madre')]);
    await expect(
      service.updateCategory(ORG, 'madre', { name: 'madre', parentId: 'otra' }),
    ).rejects.toThrow('ya tiene subcategorías');
    expect(fila(rows, 'madre')?.parentId).toBeNull();
  });

  it('también rechaza crear una hija de una categoría que ya tiene madre', async () => {
    const { service } = makeDeps([cat('raiz'), cat('hija', 'raiz')]);
    await expect(
      service.createCategory(ORG, { name: 'Nieta', parentId: 'hija' }),
    ).rejects.toThrow('solo se admiten dos niveles');
  });

  it('acepta colgar una hoja de una raíz (hermano alcanzable)', async () => {
    const { service, rows } = makeDeps([cat('raiz'), cat('hoja')]);
    await service.updateCategory(ORG, 'hoja', { name: 'hoja', parentId: 'raiz' });
    expect(fila(rows, 'hoja')?.parentId).toBe('raiz');
  });
});

describe('Categorías — borrar', () => {
  it('rechaza borrar una categoría con hijas, nombrando cuántas son', async () => {
    const { service, rows } = makeDeps([cat('madre'), cat('h1', 'madre'), cat('h2', 'madre')]);
    await expect(service.removeCategory(ORG, 'madre')).rejects.toThrow('tiene 2 subcategorías');
    expect(fila(rows, 'madre')).toBeDefined();
  });

  it('borra una categoría sin hijas (hermano alcanzable)', async () => {
    const { service, rows } = makeDeps([cat('madre'), cat('hija', 'madre'), cat('sola')]);
    await service.removeCategory(ORG, 'sola');
    expect(fila(rows, 'sola')).toBeUndefined();
    // Borrar una hija tampoco está bloqueado.
    await service.removeCategory(ORG, 'hija');
    expect(fila(rows, 'hija')).toBeUndefined();
  });
});

describe('Categorías — aislamiento por organización', () => {
  it('rechaza una madre de OTRA organización', async () => {
    const { service, rows } = makeDeps([cat('hoja'), cat('ajena', null, OTHER)]);
    await expect(
      service.updateCategory(ORG, 'hoja', { name: 'hoja', parentId: 'ajena' }),
    ).rejects.toThrow('Categoría no encontrada');
    expect(fila(rows, 'hoja')?.parentId).toBeNull();
  });

  it('acepta una madre de la propia organización (hermano alcanzable)', async () => {
    const { service, rows } = makeDeps([cat('hoja'), cat('propia'), cat('ajena', null, OTHER)]);
    await service.updateCategory(ORG, 'hoja', { name: 'hoja', parentId: 'propia' });
    expect(fila(rows, 'hoja')?.parentId).toBe('propia');
  });
});
