import { NotFoundException } from '@nestjs/common';
import { FilamentService } from './filament.service';

/**
 * Los dos controles de filamento del Excel: las compras y el conteo físico
 * mensual. Lo que se fija acá:
 *
 * - El conteo es de la organización: no se cuenta el rollo de otra.
 * - Un mes sin contar dice "sin dato"; no se inventa un consumo.
 * - Un color descontinuado no entra en la lista de reposición aunque esté en
 *   cero (regla 3 de la hoja).
 */

const ORG = 'org-A';
const OTHER = 'org-B';

const MATERIALES = [
  { id: 'm1', name: 'PLA Creality Amarillo', type: 'PLA', brand: 'Creality', color: 'Amarillo', rollGrams: 1000, rollPrice: '20', status: 'ACTIVE' },
  { id: 'm2', name: 'PLA Bambu Blanco', type: 'PLA', brand: 'Bambu Lab', color: 'Blanco', rollGrams: 1000, rollPrice: '22', status: 'ACTIVE' },
  { id: 'm3', name: 'PLA Sunlu Biege', type: 'PLA', brand: 'Sunlu', color: 'Biege', rollGrams: 1000, rollPrice: '20', status: 'DISCONTINUED' },
];

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    material: {
      findMany: jest.fn().mockResolvedValue(MATERIALES),
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          where.organizationId === ORG ? MATERIALES.find((m) => m.id === where.id) ?? null : null,
        ),
      ),
    },
    stockCount: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'sc1' }),
    },
    expense: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new FilamentService(prisma as never);

describe('Conteo de stock', () => {
  it('trae TODOS los materiales, contados o no', async () => {
    const prisma = makePrisma();
    const filas = await service(prisma).stock(ORG, '2026-08');

    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.total === 0)).toBe(true);
    // Sin conteo cargado, la fila existe pero avisa que no se contó.
    expect(filas.every((f) => f.counted === false)).toBe(true);
  });

  it('mezcla el conteo guardado con los materiales', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 2, inUse: 1, running: 0, needsBrandCheck: false },
    ]);

    const filas = await service(prisma).stock(ORG, '2026-08');
    const m1 = filas.find((f) => f.materialId === 'm1')!;

    expect(m1.total).toBe(3);
    expect(m1.counted).toBe(true);
    expect(filas.find((f) => f.materialId === 'm2')!.counted).toBe(false);
  });

  it('lee el mes como el primer día en UTC', async () => {
    const prisma = makePrisma();
    await service(prisma).stock(ORG, '2026-08');

    const where = prisma.stockCount.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect((where.month as Date).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('guarda el conteo de un material del mes', async () => {
    const prisma = makePrisma();
    await service(prisma).saveCount(ORG, {
      materialId: 'm1',
      month: '2026-08',
      sealed: 1,
      inUse: 2,
      running: 3,
    });

    const args = prisma.stockCount.upsert.mock.calls[0][0];
    expect(args.where.materialId_month.materialId).toBe('m1');
    expect(args.where.materialId_month.month.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(args.update).toMatchObject({ sealed: 1, inUse: 2, running: 3 });
  });

  /** Contar el rollo de otra organización sería ver su inventario. */
  it('no cuenta el material de otra organización', async () => {
    const prisma = makePrisma();
    await expect(
      service(prisma).saveCount(OTHER, { materialId: 'm1', month: '2026-08', sealed: 1, inUse: 0, running: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
  });

  /** Identificar la marca de un rollo importado apaga el aviso. */
  it('al guardar a mano deja de estar pendiente de identificar', async () => {
    const prisma = makePrisma();
    await service(prisma).saveCount(ORG, {
      materialId: 'm1',
      month: '2026-08',
      sealed: 1,
      inUse: 0,
      running: 0,
    });
    expect(prisma.stockCount.upsert.mock.calls[0][0].update.needsBrandCheck).toBe(false);
  });
});

describe('Resumen del mes', () => {
  it('suma los rollos y los que están por acabarse', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 2, inUse: 1, running: 1, needsBrandCheck: false, month: new Date('2026-08-01T00:00:00Z') },
      { materialId: 'm2', sealed: 0, inUse: 0, running: 2, needsBrandCheck: false, month: new Date('2026-08-01T00:00:00Z') },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.totalRolls).toBe(6);
    expect(r.running).toBe(3);
  });

  it('sin el conteo del mes anterior, el consumo queda sin dato', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockImplementation(({ where }: { where: { month: Date } }) =>
      Promise.resolve(
        where.month.getUTCMonth() === 7 // agosto
          ? [{ materialId: 'm1', sealed: 3, inUse: 0, running: 0, needsBrandCheck: false }]
          : [],
      ),
    );

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.consumption).toBeNull();
  });

  it('con los dos conteos calcula el consumo, contando lo comprado', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockImplementation(({ where }: { where: { month: Date } }) =>
      Promise.resolve(
        where.month.getUTCMonth() === 8 // septiembre: quedan 12
          ? [{ materialId: 'm1', sealed: 12, inUse: 0, running: 0, needsBrandCheck: false }]
          : [{ materialId: 'm1', sealed: 10, inUse: 0, running: 0, needsBrandCheck: false }], // agosto: había 10
      ),
    );
    // En septiembre compró 5 rollos.
    prisma.expense.findMany.mockResolvedValue([{ quantity: 5 }]);

    const r = await service(prisma).summary(ORG, '2026-09');
    // 10 + 5 − 12 = 3. La hoja diría "−2".
    expect(r.consumption).toBe(3);
  });

  it('la reposición lista los que están en cero y los que se acaban', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 0, inUse: 0, running: 0, needsBrandCheck: false },
      { materialId: 'm2', sealed: 0, inUse: 1, running: 1, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    const ids = r.restock.map((x) => x.materialId);
    expect(ids).toContain('m1'); // en cero
    expect(ids).toContain('m2'); // por acabarse
    expect(r.restock.find((x) => x.materialId === 'm1')!.status).toBe('OUT');
    expect(r.restock.find((x) => x.materialId === 'm2')!.status).toBe('LOW');
  });

  /** Regla 3 de la hoja. */
  it('un color descontinuado nunca entra en la reposición', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm3', sealed: 0, inUse: 0, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.restock.map((x) => x.materialId)).not.toContain('m3');
  });

  /**
   * Contar 3 fichas de 57 y tomar ese total como el stock del mes hace que el
   * consumo salga disparatado ("consumiste 28 rollos" sin haber contado). La
   * hoja tiene el mismo defecto; acá al menos se avisa.
   */
  it('dice cuántas fichas se contaron de cuántas hay', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 1, inUse: 0, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.countedMaterials).toBe(1);
    expect(r.totalMaterials).toBe(3);
    expect(r.complete).toBe(false);
  });

  it('el conteo está completo cuando se contaron todas las fichas', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue(
      MATERIALES.map((m) => ({ materialId: m.id, sealed: 1, inUse: 0, running: 0, needsBrandCheck: false })),
    );

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.countedMaterials).toBe(3);
    expect(r.complete).toBe(true);
  });

  it('cuenta los rollos que quedaron pendientes de identificar', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 0, inUse: 1, running: 0, needsBrandCheck: true },
      { materialId: 'm2', sealed: 0, inUse: 1, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.pendingBrandCheck).toBe(1);
  });
});

describe('Compras de filamento', () => {
  it('deriva el costo por rollo y por gramo con los gramos REALES', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      {
        id: 'e1',
        date: new Date('2026-08-31T00:00:00Z'),
        amount: '40',
        quantity: 2,
        description: 'Compra PLA',
        rate: null,
        currencyCode: null,
        material: { id: 'm1', name: 'PLA Creality Amarillo', rollGrams: 1000 },
        provider: null,
      },
    ]);

    const [c] = await service(prisma).purchases(ORG);
    expect(c.costPerRoll).toBe(20);
    expect(c.costPerGram).toBe(0.02);
  });

  it('un rollo que no es de 1 kg no se calcula como si lo fuera', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      {
        id: 'e2',
        date: new Date('2026-08-31T00:00:00Z'),
        amount: '20',
        quantity: 1,
        description: 'Compra muestra',
        rate: null,
        currencyCode: null,
        material: { id: 'm9', name: 'PLA muestra 250 g', rollGrams: 250 },
        provider: null,
      },
    ]);

    const [c] = await service(prisma).purchases(ORG);
    // La hoja daría 0.02 dividiendo entre 1000; el rollo es de 250 g.
    expect(c.costPerGram).toBe(0.08);
  });

  it('solo trae los gastos ligados a un filamento, de la organización', async () => {
    const prisma = makePrisma();
    await service(prisma).purchases(ORG, '2026-08-01', '2026-08-31');

    const where = prisma.expense.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.materialId).toEqual({ not: null });
    expect(where.date.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(where.date.lte.toISOString()).toBe('2026-08-31T23:59:59.999Z');
  });
});
