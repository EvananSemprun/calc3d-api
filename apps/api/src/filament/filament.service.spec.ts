import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FilamentService } from './filament.service';

/**
 * Los dos controles de filamento del Excel: las compras y el conteo físico
 * mensual. Lo que se fija acá:
 *
 * - El conteo es de la organización: no se cuenta el rollo de otra.
 * - Un mes abierto dice "sin dato"; no se inventa un consumo.
 * - Un color descontinuado no entra en la lista de reposición aunque esté en
 *   cero (regla 3 de la hoja).
 */

const ORG = 'org-A';

const MATERIALES = [
  { id: 'm1', name: 'PLA Creality Amarillo', type: 'PLA', brand: 'Creality', color: 'Amarillo', rollGrams: 1000, rollPrice: '20', status: 'ACTIVE', _count: { expenses: 0, stockCounts: 0 } },
  { id: 'm2', name: 'PLA Bambu Blanco', type: 'PLA', brand: 'Bambu Lab', color: 'Blanco', rollGrams: 1000, rollPrice: '22', status: 'ACTIVE', _count: { expenses: 0, stockCounts: 0 } },
  { id: 'm3', name: 'PLA Sunlu Biege', type: 'PLA', brand: 'Sunlu', color: 'Biege', rollGrams: 1000, rollPrice: '20', status: 'DISCONTINUED', _count: { expenses: 0, stockCounts: 0 } },
];

/** Un mes cerrado, como lo guarda la tabla StockMonth. */
const CERRADO = { closedAt: new Date('2026-09-01T12:00:00Z'), reopenedAt: null as Date | null };

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    material: {
      findMany: jest.fn().mockResolvedValue(MATERIALES),
    },
    stockCount: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'sc1' }),
    },
    // Por defecto el mes está CERRADO: es el caso en que el resumen da números.
    stockMonth: {
      findUnique: jest.fn().mockResolvedValue(CERRADO as typeof CERRADO | null),
      findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    expense: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  // Transacción interactiva: el callback corre contra el mismo mock.
  const $transaction = jest.fn(async (cb: (tx: typeof base) => unknown) => cb(base));
  return Object.assign(base, { $transaction });
}

const service = (prisma: ReturnType<typeof makePrisma>) => new FilamentService(prisma as never);

describe('Conteo de stock', () => {
  it('trae TODOS los materiales, contados o no', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null); // mes abierto
    const filas = await service(prisma).stock(ORG, '2026-08');

    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.total === 0)).toBe(true);
    // El mes está abierto: la fila existe pero counted es false, sin importar el conteo guardado.
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
    // El mes está cerrado: la ficha que quedó sin marcar es CERO, como en el Excel.
    const m2 = filas.find((f) => f.materialId === 'm2')!;
    expect(m2.counted).toBe(true);
    expect(m2.total).toBe(0);
  });

  it('lee el mes como el primer día en UTC', async () => {
    const prisma = makePrisma();
    await service(prisma).stock(ORG, '2026-08');

    const where = prisma.stockCount.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect((where.month as Date).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('un mes con conteos pero ABIERTO no cuenta como contado', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null); // p. ej. reabierto
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 2, inUse: 1, running: 0, needsBrandCheck: false },
    ]);

    const filas = await service(prisma).stock(ORG, '2026-08');
    const m1 = filas.find((f) => f.materialId === 'm1')!;

    expect(m1.counted).toBe(false);
    // Los números guardados se muestran igual, para corregirlos.
    expect(m1.total).toBe(3);
  });

  it('solo se puede borrar una ficha sin compras ni conteos', async () => {
    const prisma = makePrisma();
    prisma.material.findMany.mockResolvedValue([
      { ...MATERIALES[0], _count: { expenses: 0, stockCounts: 0 } },
      { ...MATERIALES[1], _count: { expenses: 1, stockCounts: 0 } },
      { ...MATERIALES[2], _count: { expenses: 0, stockCounts: 2 } },
    ]);

    const filas = await service(prisma).stock(ORG, '2026-08');

    expect(Object.fromEntries(filas.map((f) => [f.materialId, f.canDelete]))).toEqual({
      m1: true,
      m2: false,
      m3: false,
    });
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({
      include: { _count: { select: { expenses: true, stockCounts: true } } },
    });
  });
});

describe('Conteo de stock — el último precio pagado', () => {
  /**
   * El precio con el que se propone reponer sale de `Material.rollPrice`, que
   * es lo que costó la ÚLTIMA compra. Una ficha que nunca se compró trae `null`
   * aunque la columna tenga un número: ese número no lo pagó nadie.
   */
  const conCompras = (ids: string[]) =>
    makePrisma({
      expense: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          // La consulta de "alguna vez se compró" es la que NO filtra por fecha.
          where.date
            ? Promise.resolve([])
            : Promise.resolve(ids.map((materialId) => ({ materialId }))),
        ),
      },
    });

  it('trae lo que costó el rollo la última vez', async () => {
    const filas = await service(conCompras(['m1'])).stock(ORG, '2026-08');

    expect(filas.find((f) => f.materialId === 'm1')!.lastRollPrice).toBe(20);
  });

  it('una ficha sin ninguna compra con rollos trae null, no el número de la columna', async () => {
    const filas = await service(conCompras(['m1'])).stock(ORG, '2026-08');

    // m2 tiene rollPrice '22' en la base y CERO compras: no hay precio que proponer.
    expect(filas.find((f) => f.materialId === 'm2')!.lastRollPrice).toBeNull();
  });

  it('solo mira las compras de SU organización y con rollos', async () => {
    const prisma = conCompras(['m1']);
    await service(prisma).stock(ORG, '2026-08');

    const wheres = prisma.expense.findMany.mock.calls.map((c) => c[0].where);
    const compras = wheres.find((w: Record<string, unknown>) => !w.date);
    expect(compras).toMatchObject({
      organizationId: ORG,
      materialId: { not: null },
      quantity: { gt: 0 },
    });
  });
});

describe('Conteo de stock — lo RECIBIDO en el mes se ofrece al contar', () => {
  /**
   * Las recepciones del mes (`Expense` con ficha y rollos, que es lo que crea
   * tanto recibir una línea de factura como cargar una compra a mano) se
   * devuelven en `received` para OFRECERLAS como punto de partida. Sugerir, no
   * escribir: la casilla la llena el dueño.
   */
  const conRecepciones = (recibidas: { materialId: string | null; quantity: number | null }[]) =>
    makePrisma({
      expense: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          // La del mes es la que filtra por fecha Y por rollos (`quantity`).
          where.date && where.quantity ? Promise.resolve(recibidas) : Promise.resolve([]),
        ),
      },
    });

  it('devuelve los rollos que entraron, sumados por ficha', async () => {
    const filas = await service(
      conRecepciones([
        { materialId: 'm1', quantity: 2 },
        { materialId: 'm1', quantity: 3 },
        { materialId: 'm2', quantity: 1 },
      ]),
    ).stock(ORG, '2026-08');

    expect(filas.find((f) => f.materialId === 'm1')!.received).toBe(5);
    expect(filas.find((f) => f.materialId === 'm2')!.received).toBe(1);
  });

  it('una ficha SIN recepciones ese mes trae null, no 0', async () => {
    // ⚠️ "No sé" y "cero" no son lo mismo: 0 es un conteo válido, y ofrecerlo
    // sería ofrecer una respuesta en vez de una referencia.
    const filas = await service(conRecepciones([{ materialId: 'm1', quantity: 2 }])).stock(
      ORG,
      '2026-08',
    );

    expect(filas.find((f) => f.materialId === 'm2')!.received).toBeNull();
    // HERMANO ALCANZABLE: la que sí recibió trae su número.
    expect(filas.find((f) => f.materialId === 'm1')!.received).toBe(2);
  });

  it('un gasto de filamento SIN rollos no sugiere nada', async () => {
    const filas = await service(
      conRecepciones([
        { materialId: 'm1', quantity: null },
        { materialId: 'm2', quantity: 0 },
      ]),
    ).stock(ORG, '2026-08');

    expect(filas.find((f) => f.materialId === 'm1')!.received).toBeNull();
    expect(filas.find((f) => f.materialId === 'm2')!.received).toBeNull();
  });

  /**
   * ⚠️ La MISMA consulta responde dos preguntas —cuánto entró y si la ficha se
   * compró en el mes (`exhausted`)—, así que las dos no pueden contestar
   * distinto. Antes eran dos viajes a la base con el mismo filtro.
   */
  it('pide las recepciones del mes UNA sola vez, de su organización y con rollos', async () => {
    const prisma = conRecepciones([{ materialId: 'm1', quantity: 2 }]);
    await service(prisma).stock(ORG, '2026-08');

    const delMes = prisma.expense.findMany.mock.calls
      .map((c) => c[0].where)
      .filter((w: Record<string, unknown>) => w.date && w.quantity);

    expect(delMes).toHaveLength(1);
    expect(delMes[0]).toMatchObject({
      organizationId: ORG,
      materialId: { not: null },
      quantity: { gt: 0 },
      date: { gte: new Date('2026-08-01T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') },
    });
  });
});

describe('Conteo de stock — fichas que se acabaron el mes anterior', () => {
  const SEPT = new Date('2026-09-01T00:00:00Z');
  const AGO = new Date('2026-08-01T00:00:00Z');

  /** Agosto CERRADO con m1 en 0 y m2 con un rollo; septiembre abierto. */
  function conAgostoCerrado(opts: { agostoCerrado?: boolean } = {}) {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockImplementation(async ({ where }: { where: { organizationId_month: { month: Date } } }) =>
      where.organizationId_month.month.getTime() === AGO.getTime() && opts.agostoCerrado !== false ? CERRADO : null,
    );
    prisma.stockCount.findMany.mockImplementation(async ({ where }: { where: { month: Date } }) =>
      where.month.getTime() === AGO.getTime()
        ? [
            { materialId: 'm1', sealed: 0, inUse: 0, running: 0, needsBrandCheck: false },
            { materialId: 'm2', sealed: 1, inUse: 0, running: 0, needsBrandCheck: false },
          ]
        : [],
    );
    return prisma;
  }
  const agotadas = (filas: { materialId: string; exhausted: boolean }[]) =>
    filas.filter((f) => f.exhausted).map((f) => f.materialId);

  it('marca la que cerró el mes anterior en 0 y no se compró en el mes', async () => {
    const filas = await service(conAgostoCerrado()).stock(ORG, '2026-09');
    // m3 ni siquiera estaba en el conteo de agosto: tampoco hay (decisión del
    // dueño, 2026-10-01 — solo salen las que había o las que se compraron).
    expect(agotadas(filas)).toEqual(['m1', 'm3']);
  });

  it('una ficha nueva comprada en el mes sale aunque no estuviera en el anterior', async () => {
    const prisma = conAgostoCerrado();
    prisma.expense.findMany.mockResolvedValue([{ materialId: 'm3', quantity: 1 }]);
    const filas = await service(prisma).stock(ORG, '2026-09');
    expect(agotadas(filas)).toEqual(['m1']);
  });

  it('si se compró durante el mes, vuelve a aparecer', async () => {
    const prisma = conAgostoCerrado();
    prisma.expense.findMany.mockResolvedValue([{ materialId: 'm1', quantity: 1 }]);

    const filas = await service(prisma).stock(ORG, '2026-09');

    expect(agotadas(filas)).toEqual(['m3']);
    // Solo las compras DEL MES, de esta organización y con ficha.
    expect(prisma.expense.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      materialId: { not: null },
      quantity: { gt: 0 },
      date: { gte: SEPT, lt: new Date('2026-10-01T00:00:00Z') },
    });
  });

  it('con el mes anterior sin cerrar no esconde nada (no hay dato final)', async () => {
    const filas = await service(conAgostoCerrado({ agostoCerrado: false })).stock(ORG, '2026-09');
    expect(agotadas(filas)).toEqual([]);
  });

  it('trae cómo cerró cada ficha el mes anterior', async () => {
    const filas = await service(conAgostoCerrado()).stock(ORG, '2026-09');
    const por = Object.fromEntries(filas.map((f) => [f.materialId, f.previous]));
    expect(por).toEqual({
      m1: { sealed: 0, inUse: 0, running: 0 },
      m2: { sealed: 1, inUse: 0, running: 0 },
      m3: null, // no estaba al cierre de agosto
    });
  });

  it('sin el mes anterior cerrado no hay referencia', async () => {
    const filas = await service(conAgostoCerrado({ agostoCerrado: false })).stock(ORG, '2026-09');
    expect(filas.every((f) => f.previous === null)).toBe(true);
  });

  it('no esconde una ficha que ya tiene rollos anotados este mes', async () => {
    const prisma = conAgostoCerrado();
    const agosto = await prisma.stockCount.findMany({ where: { month: AGO } });
    prisma.stockCount.findMany.mockImplementation(async ({ where }: { where: { month: Date } }) =>
      where.month.getTime() === AGO.getTime()
        ? agosto
        : [{ materialId: 'm1', sealed: 0, inUse: 1, running: 0, needsBrandCheck: false }],
    );

    const filas = await service(prisma).stock(ORG, '2026-09');
    expect(agotadas(filas)).toEqual(['m3']);
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

  it('con el mes anterior abierto, el consumo queda sin dato', async () => {
    const prisma = makePrisma();
    // Agosto cerrado; julio nunca se cerró.
    prisma.stockMonth.findUnique.mockImplementation(
      ({ where }: { where: { organizationId_month: { month: Date } } }) =>
        Promise.resolve(where.organizationId_month.month.getUTCMonth() === 7 ? CERRADO : null),
    );
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

  it('la reposición va por color: sin rollos y por acabarse', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 0, inUse: 0, running: 0, needsBrandCheck: false },
      { materialId: 'm2', sealed: 0, inUse: 1, running: 1, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.restock.find((g) => g.label === 'PLA Amarillo')!.status).toBe('OUT');
    expect(r.restock.find((g) => g.label === 'PLA Blanco')!.status).toBe('LOW');
  });

  /** Regla 3 de la hoja. */
  it('un color descontinuado nunca entra en la reposición', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm3', sealed: 0, inUse: 0, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.restock.map((g) => g.label)).not.toContain('PLA Biege');
  });

  /**
   * Como en el Excel: si el mes está cerrado, un color sin nada marcado es que
   * no hay (decisión del dueño, 2026-09-13). "Sin dato" queda solo para un mes
   * abierto.
   */
  it('un mes cerrado está completo: lo que no se marcó es cero', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 1, inUse: 0, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    // m3 está descontinuado: no es un color para contar.
    expect(r.countedColors).toBe(2);
    expect(r.totalColors).toBe(2);
    expect(r.complete).toBe(true);
    // Blanco (m2) no se marcó: no hay.
    expect(r.restock.find((g) => g.label === 'PLA Blanco')?.status).toBe('OUT');
  });

  it('un mes abierto no está completo ni pide reponer', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.countedColors).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.restock).toEqual([]);
  });

  it('los colores se cuentan por tipo + color: dos marcas del mismo color son uno solo', async () => {
    const prisma = makePrisma();
    prisma.material.findMany.mockResolvedValue([
      ...MATERIALES,
      { id: 'm4', name: 'PLA Filavent Amarillo', type: 'PLA', brand: 'Filavent', color: 'Amarillo', rollGrams: 1000, rollPrice: '19', status: 'ACTIVE' },
    ]);
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 1, inUse: 0, running: 0, needsBrandCheck: false },
      { materialId: 'm2', sealed: 1, inUse: 0, running: 0, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.countedColors).toBe(2);
    expect(r.totalColors).toBe(2);
  });

  it('sugiere reponer los colores que más se compran si queda 1 rollo o menos', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 0, inUse: 1, running: 0, needsBrandCheck: false },
      { materialId: 'm2', sealed: 0, inUse: 1, running: 0, needsBrandCheck: false },
    ]);
    // Amarillo: 8 rollos comprados; Blanco: 1. Promedio 4,5.
    prisma.expense.findMany.mockResolvedValue([
      { materialId: 'm1', quantity: 8 },
      { materialId: 'm2', quantity: 1 },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.restock).toHaveLength(1);
    expect(r.restock[0]).toMatchObject({ label: 'PLA Amarillo', status: 'SUGGEST', purchased: 8 });
  });

  it('para saber qué se compra más, solo mira las compras hasta el cierre del mes', async () => {
    const prisma = makePrisma();

    await service(prisma).summary(ORG, '2026-08');

    const hastaElCierre = prisma.expense.findMany.mock.calls.some(
      ([arg]: [{ where: { date?: { lt?: Date; gte?: Date } } }]) =>
        arg.where.date?.lt?.toISOString() === '2026-09-01T00:00:00.000Z' && !arg.where.date?.gte,
    );
    expect(hastaElCierre).toBe(true);
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

  it('un mes con conteos pero ABIERTO no da números', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 3, inUse: 0, running: 1, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.totalRolls).toBe(0);
    expect(r.running).toBe(0);
    expect(r.consumption).toBeNull();
    expect(r.restock).toEqual([]);
    expect(r.countedColors).toBe(0);
    expect(r.totalColors).toBe(2);
    expect(r.complete).toBe(false);
  });

  it('el consumo exige que los DOS meses estén cerrados', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 5, inUse: 0, running: 0, needsBrandCheck: false },
    ]);
    // Septiembre cerrado; agosto reabierto.
    prisma.stockMonth.findUnique.mockImplementation(
      ({ where }: { where: { organizationId_month: { month: Date } } }) =>
        Promise.resolve(where.organizationId_month.month.getUTCMonth() === 8 ? CERRADO : null),
    );

    const r = await service(prisma).summary(ORG, '2026-09');
    expect(r.totalRolls).toBe(5);
    expect(r.consumption).toBeNull();
  });

  it('con el mes anterior cerrado y el actual abierto, el consumo queda sin dato', async () => {
    const prisma = makePrisma();
    // Agosto cerrado con 10 rollos; septiembre abierto, con 5 comprados.
    prisma.stockMonth.findUnique.mockImplementation(
      ({ where }: { where: { organizationId_month: { month: Date } } }) =>
        Promise.resolve(where.organizationId_month.month.getUTCMonth() === 7 ? CERRADO : null),
    );
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 10, inUse: 0, running: 0, needsBrandCheck: false },
    ]);
    prisma.expense.findMany.mockResolvedValue([{ quantity: 5 }]);

    const r = await service(prisma).summary(ORG, '2026-09');
    expect(r.consumption).toBeNull(); // sin el chequeo daría 10 + 5 − 0 = 15
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

  /**
   * La pantalla de Compras de filamento ofrece corregir y borrar, y las dos
   * cosas pegan a `/expenses`, que rechaza un gasto nacido de una factura. Sin
   * este campo la pantalla no puede saberlo y ofrece un lápiz que solo sabe
   * fallar. Van las DOS compras: con una sola, un `fromInvoice` clavado en true
   * (o en false) pasaría igual.
   */
  it('dice cuál compra entró por una factura y cuál se cargó a mano', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      {
        id: 'e-factura',
        date: new Date('2026-10-10T00:00:00Z'),
        amount: '25',
        quantity: 1,
        description: 'Compra PLA Cyan',
        rate: null,
        currencyCode: null,
        material: { id: 'm1', name: 'PLA Cyan', rollGrams: 1000 },
        provider: null,
        purchaseInvoiceLineId: 'linea-1',
      },
      {
        id: 'e-mano',
        date: new Date('2026-08-31T00:00:00Z'),
        amount: '40',
        quantity: 2,
        description: 'Compra PLA',
        rate: null,
        currencyCode: null,
        material: { id: 'm2', name: 'PLA Amarillo', rollGrams: 1000 },
        provider: null,
        purchaseInvoiceLineId: null,
      },
    ]);

    const [deFactura, aMano] = await service(prisma).purchases(ORG);
    expect(deFactura.fromInvoice).toBe(true);
    expect(aMano.fromInvoice).toBe(false);
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

/** 31/08 a las 11:00 en Caracas: ya se puede cerrar agosto. */
const DIA_DE_CIERRE = new Date('2026-08-31T15:00:00Z');
/** 30/08 a las 11:00 en Caracas: todavía no. */
const ANTES_DE_TIEMPO = new Date('2026-08-30T15:00:00Z');

/**
 * El cierre es la ÚNICA escritura de conteos, y el bloqueo vive en el servidor:
 * estos tests son la regresión de seguridad (un límite solo en el botón no
 * protege nada).
 */
describe('Cierre del mes', () => {
  it('escribe TODAS las fichas: las que no vinieron quedan en 0', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await service(prisma).closeMonth(
      ORG,
      { month: '2026-08', counts: [{ materialId: 'm1', sealed: 2, inUse: 1, running: 0 }] },
      DIA_DE_CIERRE,
    );

    const escritas = prisma.stockCount.upsert.mock.calls.map(([arg]) => arg.create);
    expect(escritas).toHaveLength(3);
    expect(escritas.find((c) => c.materialId === 'm1')).toMatchObject({ sealed: 2, inUse: 1, running: 0 });
    expect(escritas.find((c) => c.materialId === 'm2')).toMatchObject({ sealed: 0, inUse: 0, running: 0 });
    // Los descontinuados entran a propósito: el cierre es la foto completa del estante.
    expect(escritas.find((c) => c.materialId === 'm3')).toMatchObject({ sealed: 0, inUse: 0, running: 0 });
    // Cada fila lleva la organización que puso el SERVIDOR (`closeMonth`), nunca una del body.
    expect(escritas.every((c) => c.organizationId === ORG)).toBe(true);
    // El mes va como el primer día en UTC, igual que StockCount.month.
    expect(prisma.stockCount.upsert.mock.calls[0][0].where.materialId_month.month.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(prisma.stockMonth.upsert.mock.calls[0][0].update).toEqual({ closedAt: DIA_DE_CIERRE });
    // Sin fila previa, la base usa la rama `create` del upsert del mes.
    expect(prisma.stockMonth.upsert.mock.calls[0][0].create).toMatchObject({
      organizationId: ORG,
      closedAt: DIA_DE_CIERRE,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('al cerrar apaga el aviso de marca por identificar', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, DIA_DE_CIERRE);

    const updates = prisma.stockCount.upsert.mock.calls.map(([arg]) => arg.update);
    expect(updates).toHaveLength(3);
    expect(updates.every((u) => u.needsBrandCheck === false)).toBe(true);
  });

  it('antes del último día del mes no cierra ni escribe', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const intento = service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, ANTES_DE_TIEMPO);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('31/08/2026');
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
    // El chequeo de fecha va ANTES de tocar la base: ni siquiera abre la transacción.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stockMonth.findUnique).not.toHaveBeenCalled();
  });

  it('un mes cerrado no se vuelve a cerrar', async () => {
    const prisma = makePrisma(); // cerrado por defecto

    await expect(
      service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, DIA_DE_CIERRE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
  });

  /**
   * Regresión IDOR: el falso imita a la base (cada org ve solo sus fichas), no
   * un id inventado que ni siquiera existe. Si `closeMonth` dejara de filtrar
   * `material.findMany` por `organizationId`, este test debe fallar.
   */
  it('una ficha de otra organización no se escribe', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);
    // 'm-ajena' existe de verdad, pero en la organización B.
    prisma.material.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
      Promise.resolve(where.organizationId === ORG ? MATERIALES : [{ ...MATERIALES[0], id: 'm-ajena' }]),
    );

    await expect(
      service(prisma).closeMonth(
        ORG,
        { month: '2026-08', counts: [{ materialId: 'm-ajena', sealed: 5, inUse: 0, running: 0 }] },
        DIA_DE_CIERRE,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
  });

  it('una ficha repetida se rechaza con su nombre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);
    const fila = { materialId: 'm1', sealed: 1, inUse: 0, running: 0 };

    const intento = service(prisma).closeMonth(ORG, { month: '2026-08', counts: [fila, fila] }, DIA_DE_CIERRE);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('PLA Creality Amarillo');
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
  });
});

describe('Reabrir el mes', () => {
  it('lo deja abierto, anota cuándo y no toca los conteos', async () => {
    const prisma = makePrisma(); // cerrado por defecto

    await service(prisma).reopenMonth(ORG, { month: '2026-08' }, DIA_DE_CIERRE);

    expect(prisma.stockMonth.update.mock.calls[0][0].data).toEqual({ closedAt: null, reopenedAt: DIA_DE_CIERRE });
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
  });

  it('un mes abierto no se reabre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await expect(service(prisma).reopenMonth(ORG, { month: '2026-08' }, DIA_DE_CIERRE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.stockMonth.update).not.toHaveBeenCalled();
  });
});

describe('Estado del mes', () => {
  it('dice si está cerrado y desde cuándo se puede cerrar', async () => {
    const prisma = makePrisma();

    const s = await service(prisma).monthStatus(ORG, '2026-08', ANTES_DE_TIEMPO);

    expect(s).toEqual({
      month: '2026-08',
      closed: true,
      closedAt: '2026-09-01T12:00:00.000Z',
      reopenedAt: null,
      canClose: false,
      closableFrom: '2026-08-31',
    });
  });

  it('un mes sin fila está abierto', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const s = await service(prisma).monthStatus(ORG, '2026-08', DIA_DE_CIERRE);

    expect(s).toMatchObject({ closed: false, closedAt: null, canClose: true });
  });
});

describe('Último mes cerrado', () => {
  it('es el mes más reciente con cierre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: new Date('2026-08-01T00:00:00Z') });

    await expect(service(prisma).lastClosedMonth(ORG)).resolves.toBe('2026-08');
    expect(prisma.stockMonth.findFirst.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
  });

  it('sin meses cerrados es null', async () => {
    const prisma = makePrisma();

    await expect(service(prisma).lastClosedMonth(ORG)).resolves.toBeNull();
  });
});

/**
 * EL PRECIO DE CADA TIPO (2026-10-10) — lo que la calculadora ofrece por
 * defecto. El motor puro vive en `shared/calc/filament-type-price.ts` y tiene
 * sus propios tests con los números a mano; acá se fija la PARTE DEL SERVIDOR:
 * de dónde salen las compras, que sean de ESTA organización y que el promedio
 * se DERIVE de ellas en vez de leer un número guardado.
 */
describe('Precio por tipo de filamento', () => {
  /** Un gasto de filamento como lo devuelve Prisma: `amount` es string. */
  function gasto(p: {
    amount: string;
    quantity: number | null;
    type?: string | null;
    rollGrams?: number;
    /** Día de negocio, guardado a MEDIANOCHE UTC (así nacen `Expense.date`). */
    date?: string;
  }) {
    return {
      amount: p.amount,
      quantity: p.quantity,
      // Por defecto, dentro de la ventana de 6 meses de `AHORA`.
      date: new Date(`${p.date ?? '2026-08-31'}T00:00:00.000Z`),
      material: { type: p.type ?? 'PLA', rollGrams: p.rollGrams ?? 1000 },
    };
  }

  /**
   * El instante de los tests, SIEMPRE a mano. Mediodía de Caracas, así que la
   * fecha de negocio y la UTC coinciden y los tests que no hablan de husos no
   * tienen que pensar en eso.
   */
  const AHORA = new Date('2026-10-10T16:00:00.000Z');

  it('deriva el promedio de las COMPRAS, ponderado por rollos', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      gasto({ amount: '25', quantity: 1 }),
      gasto({ amount: '180', quantity: 9 }),
      gasto({ amount: '38', quantity: 2, type: 'PETG' }),
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ type: 'PLA', rolls: 10, purchases: 2, rollGrams: 1000 });
    expect(r[0].rollPrice).toBeCloseTo(20.5, 10);
    expect(r[1]).toMatchObject({ type: 'PETG', rolls: 2 });
    expect(r[1].rollPrice).toBeCloseTo(19, 10);
  });

  it('solo mira los gastos de ESTA organización que tienen ficha de material', async () => {
    const prisma = makePrisma();
    await service(prisma).typePrices(ORG, AHORA);

    expect(prisma.expense.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, materialId: { not: null } },
    });
  });

  /**
   * ⚠️ La regla central del dominio: **los precios no se persisten, se
   * derivan.** `Material.rollPrice` existe y es el de la ÚLTIMA compra; si el
   * promedio saliera de ahí, un tipo quedaría cotizado al precio de su último
   * color comprado y el promedio sería decorativo.
   */
  it('NO lee el precio guardado en la ficha: sale de lo que se pagó', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([gasto({ amount: '40', quantity: 2 })]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r[0].rollPrice).toBeCloseTo(20, 10);
    // La consulta no pide `rollPrice`: no hay por dónde colarse.
    expect(JSON.stringify(prisma.expense.findMany.mock.calls[0][0])).not.toContain('rollPrice');
    expect(prisma.material.findMany).not.toHaveBeenCalled();
  });

  it('un gasto sin rollos (`quantity` en null) no rompe ni cuenta', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      gasto({ amount: '20', quantity: null }),
      gasto({ amount: '40', quantity: 2, type: 'PETG' }),
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r.map((t) => t.type)).toEqual(['PETG']);
  });

  it('el rollo REGALADO no entra en el promedio', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      gasto({ amount: '80', quantity: 4 }),
      // `PLA Creality Azul oscuro`: se lo regalaron. Incluirlo daría 16.
      gasto({ amount: '0', quantity: 1 }),
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r[0].rollPrice).toBeCloseTo(20, 10);
    expect(r[0].rolls).toBe(4);
  });

  it('sin compras devuelve una lista vacía: no se ofrece ningún tipo en $0', async () => {
    const prisma = makePrisma();

    await expect(service(prisma).typePrices(ORG, AHORA)).resolves.toEqual([]);
  });

  /**
   * LA VENTANA DE 6 MESES (2026-10-10). El recorte lo hace `preciosPorTipo` en
   * shared y tiene sus propios tests; acá se fija EL CABLEADO, que es lo que
   * ningún test de función pura puede ver: que la consulta traiga la fecha, que
   * se lea como fecha de NEGOCIO y que el "hoy" salga de la hora de Venezuela.
   */
  it('trae la FECHA de la compra: sin ella no hay ventana que recortar', async () => {
    const prisma = makePrisma();
    await service(prisma).typePrices(ORG, AHORA);

    expect(prisma.expense.findMany.mock.calls[0][0]).toMatchObject({ select: { date: true } });
  });

  it('una compra de hace más de 6 meses no arrastra el promedio', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      // Hace un año, a $12 el rollo: con toda la historia el promedio daría
      // 17,33 y cada trabajo se cotizaría 13 % barato.
      gasto({ amount: '12', quantity: 1, date: '2025-10-01' }),
      gasto({ amount: '20', quantity: 1, date: '2026-09-01' }),
      gasto({ amount: '20', quantity: 1, date: '2026-10-01' }),
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r[0].rollPrice).toBeCloseTo(20, 10);
    expect(r[0].rolls).toBe(2);
    expect(r[0].stale).toBe(false);
  });

  it('un tipo sin compras recientes NO desaparece: sale con su última compra, marcado', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      gasto({ amount: '40', quantity: 2 }),
      gasto({ amount: '30', quantity: 2, type: 'ABS', date: '2026-01-15' }),
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    const abs = r.find((t) => t.type === 'ABS');
    expect(abs).toMatchObject({ rollPrice: 15, stale: true, lastPurchase: '2026-01-15' });
  });

  /**
   * ⚠️ **Las dos clases de fecha, y la mitad equivocada da el bug simétrico**
   * (ver "Fechas en UTC" en el CLAUDE.md):
   * - `Expense.date` es una fecha de NEGOCIO (medianoche UTC) y se lee con
   *   `toISOString()`. Pasarla por `businessDateKey` la corre un día ATRÁS.
   * - `now` es un INSTANTE y se lee con `businessDateKey`. Leerlo con
   *   `toISOString()` lo corre un día ADELANTE desde las 20:00 de Caracas.
   */
  it('"hoy" se decide en hora de VENEZUELA, no en UTC', async () => {
    const prisma = makePrisma();
    // 22:00 del 9 de octubre en Caracas, que en UTC ya es el 10.
    const anoche = new Date('2026-10-10T02:00:00.000Z');
    // La ventana arranca el 2026-04-09 (6 meses antes del 9), así que esta
    // compra entra. Leyendo "hoy" en UTC arrancaría el 10 y quedaría afuera:
    // el tipo saldría marcado como viejo teniendo una compra dentro.
    prisma.expense.findMany.mockResolvedValue([gasto({ amount: '20', quantity: 1, date: '2026-04-09' })]);

    const r = await service(prisma).typePrices(ORG, anoche);

    expect(r[0].stale).toBe(false);
  });

  it('la fecha de la COMPRA es de negocio: el día guardado es el que el dueño eligió', async () => {
    const prisma = makePrisma();
    // Primer día de la ventana (6 meses antes del 2026-10-10), justo en el
    // borde. Leída con `businessDateKey` se correría al 2026-04-09 y caería
    // afuera: el tipo saldría viejo por un día que nadie cambió.
    prisma.expense.findMany.mockResolvedValue([gasto({ amount: '20', quantity: 1, date: '2026-04-10' })]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r[0]).toMatchObject({ stale: false, lastPurchase: '2026-04-10' });
  });

  it('un gasto sin fecha no rompe: cuenta como la compra más vieja', async () => {
    const prisma = makePrisma();
    prisma.expense.findMany.mockResolvedValue([
      { amount: '20', quantity: 1, date: null, material: { type: 'PLA', rollGrams: 1000 } },
    ]);

    const r = await service(prisma).typePrices(ORG, AHORA);

    expect(r[0]).toMatchObject({ rollPrice: 20, stale: true, lastPurchase: null });
  });
});

