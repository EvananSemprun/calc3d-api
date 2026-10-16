import { campaignHealth } from '@calc3d/shared';
import { CampaignsService } from './campaigns.module';

/**
 * Lo vendido por una campaña. Desde "encargo = pedido" (2026-09-14) lo que trae
 * una campaña llega como PEDIDO, no como venta: si "vendido" solo sumara las
 * ventas, toda campaña daría $0 y el Dashboard avisaría que ninguna rinde
 * (pasó el 2026-10-02 con Identificadores: $15,83 invertidos, $90,02 en
 * encargos, ROAS 5,7×, marcada "en riesgo").
 */

const ORG = 'org-A';
const CAMPANA = {
  id: 'c1',
  organizationId: ORG,
  name: 'Identificadores de lapices',
  platform: 'INSTAGRAM',
  objective: 'MESSAGES',
  status: 'ACTIVE',
  startDate: new Date('2026-09-24T00:00:00Z'),
  endDate: null,
  budget: null,
  notes: null,
  reach: null,
  conversations: null,
  profileVisits: null,
  followers: null,
  createdAt: new Date('2026-09-24T00:00:00Z'),
};

const linea = (precio: number) => [{ description: 'x', quantity: 1, unit: 'Unidad', unitPrice: precio }];

function makePrisma(pedidos: { status: string; lines: unknown }[], ventas: { amount: number }[] = []) {
  return {
    campaign: { findMany: jest.fn().mockResolvedValue([CAMPANA]) },
    expense: { findMany: jest.fn().mockResolvedValue([{ campaignId: 'c1', amount: 15.83 }]) },
    sale: { findMany: jest.fn().mockResolvedValue(ventas.map((v) => ({ campaignId: 'c1', ...v }))) },
    // Respeta el filtro de estado de la consulta, como lo haría la base.
    order: {
      findMany: jest.fn(async ({ where }: { where: { status?: { not?: string; notIn?: string[] } } }) =>
        pedidos
          .filter((p) => {
            if (where.status?.notIn?.includes(p.status)) return false;
            if (where.status?.not != null && where.status.not === p.status) return false;
            return true;
          })
          .map((p) => ({ campaignId: 'c1', ...p })),
      ),
    },
  };
}

const stats = async (prisma: ReturnType<typeof makePrisma>) => {
  const [c] = await new CampaignsService(prisma as never).list(ORG);
  return c.stats;
};

describe('CampaignsService — lo vendido por una campaña', () => {
  it('suma los encargos atribuidos, no solo las ventas', async () => {
    const s = await stats(
      makePrisma([
        { status: 'DELIVERED', lines: linea(16.3) },
        { status: 'DELIVERED', lines: linea(4.78) },
        { status: 'DELIVERED', lines: linea(2.89) },
        { status: 'DELIVERED', lines: linea(66.05) },
      ]),
    );
    expect(s.revenue).toBe(90.02);
    expect(campaignHealth(s)).toBe('PROFITABLE');
  });

  it('suma ventas y encargos juntos', async () => {
    const s = await stats(makePrisma([{ status: 'CONFIRMED', lines: linea(10) }], [{ amount: 5 }]));
    expect(s.revenue).toBe(15);
  });

  it('una cotización o un encargo cancelado no son venta', async () => {
    const s = await stats(
      makePrisma([
        { status: 'QUOTED', lines: linea(100) },
        { status: 'CANCELLED', lines: linea(100) },
        { status: 'DELIVERED', lines: linea(15.46) },
      ]),
    );
    expect(s.revenue).toBe(15.46);
    // Stand Modular: $15,46 contra $19,58 — esa sí está en riesgo.
    expect(campaignHealth(s)).toBe('AT_RISK');
  });
});

/**
 * REGRESIÓN (2026-10-02): el detalle de campaña reventaba en TODAS las campañas
 * con "DecimalError: Invalid argument: undefined". El panel lee `stats.quotes`
 * desde siempre, pero la API dejó de calcularlo al eliminarse los presupuestos
 * (2026-09-07) y nadie lo notó: el tipo del front lo declara `number`, así que
 * TypeScript afirmaba que estaba. El contrato se verifica acá, no en el tipo.
 */
describe('CampaignsService — el contrato de stats no pierde campos', () => {
  const CAMPOS = [
    'invested',
    'revenue',
    'profit',
    'hasCost',
    'sales',
    'orders',
    'ordersTotal',
    'quotes',
  ] as const;

  it('devuelve TODOS los campos que el panel lee', async () => {
    const s = await stats(makePrisma([{ status: 'DELIVERED', lines: linea(30) }]));
    for (const campo of CAMPOS) {
      expect(s).toHaveProperty(campo);
      expect(s[campo]).toBeDefined();
    }
  });

  it('una campaña sin nada devuelve los mismos campos, en cero', async () => {
    const prisma = makePrisma([]);
    prisma.expense.findMany = jest.fn().mockResolvedValue([]);
    const s = await stats(prisma);
    for (const campo of CAMPOS) expect(s).toHaveProperty(campo);
    expect(s.quotes).toBe(0);
    expect(s.profit).toBe(0);
  });

  it('cuenta las cotizaciones aparte: interés generado, no venta', async () => {
    const s = await stats(
      makePrisma([
        { status: 'QUOTED', lines: linea(100) },
        { status: 'QUOTED', lines: linea(50) },
        { status: 'DELIVERED', lines: linea(30) },
      ]),
    );
    expect(s.quotes).toBe(2);
    // Lo cotizado NO infla lo vendido ni el conteo de encargos.
    expect(s.orders).toBe(1);
    expect(s.revenue).toBe(30);
    expect(s.ordersTotal).toBe(30);
  });

  it('un encargo cancelado no cuenta ni como cotización', async () => {
    const s = await stats(
      makePrisma([
        { status: 'CANCELLED', lines: linea(999) },
        { status: 'QUOTED', lines: linea(10) },
      ]),
    );
    expect(s.quotes).toBe(1);
    expect(s.orders).toBe(0);
    expect(s.revenue).toBe(0);
  });
});

/**
 * VENTA ATRIBUIDA DECLARADA (2026-10-04). La hoja "Publicidad" del Excel trae
 * una columna "Venta atribuida ($)": de lo que YA se vendió, cuánto se le
 * rastrea a la campaña. Como `Campaign` no tenía dónde guardarla, el 2026-10-02
 * se la metió como PEDIDOS falsos ("Varios (historico sin detalle)"), y esos
 * pedidos entraron al ingreso del negocio: la reposición de equipos pasó a
 * decir que las impresoras habían devuelto $431,08 cuando el Excel decía $0.
 *
 * Lo declarado suma a "vendido" (rendimiento) pero NO a `ordersTotal`, que es
 * lo que representa pedidos de verdad.
 */
describe('CampaignsService — venta atribuida declarada', () => {
  const conAtribucion = (declarada: number, pedidos: { status: string; lines: unknown }[] = []) => {
    const prisma = makePrisma(pedidos);
    prisma.campaign.findMany = jest
      .fn()
      .mockResolvedValue([{ ...CAMPANA, attributedSales: declarada }]);
    return prisma;
  };

  it('una campaña vieja sin pedidos vale lo declarado, sin inventar un pedido', async () => {
    // "Sientete todo un campeon": $120 en el Excel, abril 2026, sin desglose.
    const s = await stats(conAtribucion(120));
    expect(s.revenue).toBe(120);
    expect(s.orders).toBe(0);
    expect(s.ordersTotal).toBe(0);
  });

  it('suma lo declarado a los pedidos reales sin tocar ordersTotal', async () => {
    // "Materializa tu fanatismo": $74,50 = pedido de Amed ($30) + $44,50 suelto.
    const s = await stats(conAtribucion(44.5, [{ status: 'DELIVERED', lines: linea(30) }]));
    expect(s.revenue).toBe(74.5);
    expect(s.ordersTotal).toBe(30);
  });

  it('una campaña sin atribución declarada se comporta igual que antes', async () => {
    const s = await stats(conAtribucion(0, [{ status: 'DELIVERED', lines: linea(90.02) }]));
    expect(s.revenue).toBe(90.02);
  });
});

/**
 * EL GASTO QUE GESTIONA LA CAMPAÑA — "Lo que pagué" (2026-10-16). El campo
 * `paidUsd` crea/actualiza/borra UN solo `Expense` de Publicidad enlazado
 * (`managedExpenseId`), para que cuente como invertido sin duplicarse al editar.
 * El gastado real SIGUE derivándose de TODOS los Expense enlazados; esto es solo
 * el atajo que la ficha de la campaña usa para su propio gasto.
 *
 * El mock de Prisma guarda campañas y gastos EN MEMORIA y resuelve la
 * transacción aplicando las escrituras en el acto: así el test mide el efecto
 * real (cuántos gastos quedan, con qué monto), no la forma de las llamadas.
 */
describe('CampaignsService — el gasto que gestiona la campaña (paidUsd)', () => {
  const ORG = 'org-pago';

  type Fila = Record<string, unknown>;

  function makeStore() {
    let seq = 0;
    const id = (p: string) => `${p}-${++seq}`;
    const campaigns: Fila[] = [];
    const expenses: Fila[] = [];

    // Reproduce los `where` que usan el servicio y sus helpers: por organización,
    // por `campaignId: { not: null }` (statsByCampaign) y por `id: { in }` (paidByCampaign).
    const matchExpense = (e: Fila, where: Fila): boolean => {
      const w = where as {
        organizationId?: string;
        campaignId?: { not?: null };
        id?: string | { in?: string[] };
      };
      if (w.organizationId != null && e.organizationId !== w.organizationId) return false;
      if (w.campaignId?.not === null && e.campaignId == null) return false;
      if (typeof w.id === 'object' && w.id?.in && !w.id.in.includes(e.id as string)) return false;
      if (typeof w.id === 'string' && e.id !== w.id) return false;
      return true;
    };

    const tx = {
      campaign: {
        create: jest.fn(async ({ data }: { data: Fila }) => {
          // Prisma pone `createdAt` solo; el mock lo imita (serialize lo lee).
          const row: Fila = { id: id('c'), managedExpenseId: null, createdAt: new Date('2026-10-01T00:00:00Z'), ...data };
          campaigns.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Fila }) => {
          const row = campaigns.find((c) => c.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
      },
      expense: {
        findFirst: jest.fn(async ({ where }: { where: Fila }) =>
          expenses.find((e) => matchExpense(e, where)) ?? null,
        ),
        create: jest.fn(async ({ data }: { data: Fila }) => {
          const row: Fila = { id: id('e'), ...data };
          expenses.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Fila }) => {
          const row = expenses.find((e) => e.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        delete: jest.fn(async ({ where }: { where: { id: string } }) => {
          const i = expenses.findIndex((e) => e.id === where.id);
          return expenses.splice(i, 1)[0];
        }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
      campaign: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
          campaigns.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
        ),
        findMany: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
          campaigns.filter((c) => c.organizationId === where.organizationId),
        ),
        update: tx.campaign.update,
      },
      expense: {
        findMany: jest.fn(async ({ where }: { where: Fila }) =>
          expenses.filter((e) => matchExpense(e, where)),
        ),
      },
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };

    return { prisma, expenses };
  }

  const nueva = (paidUsd?: number | null) =>
    ({
      name: 'Promo llaveros',
      platform: 'INSTAGRAM',
      objective: null,
      status: 'ACTIVE',
      startDate: '2026-10-01',
      ...(paidUsd !== undefined && { paidUsd }),
    }) as never;

  const ads = (expenses: Fila[]) => expenses.filter((e) => e.category === 'ADVERTISING');

  it('crear con lo pagado > 0 deja UN gasto de Publicidad y lo cuenta como invertido', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    const creada = await svc.create(ORG, nueva(30));
    const gastos = ads(expenses);
    expect(gastos).toHaveLength(1);
    expect(gastos[0].amount).toBe(30);
    expect(gastos[0].category).toBe('ADVERTISING');
    expect(gastos[0].isInvestment).toBe(false);
    expect(gastos[0].campaignId).toBe(creada.id);
    expect(gastos[0].description).toBe('Campaña: Promo llaveros');

    const [vista] = await svc.list(ORG);
    expect(vista.paidUsd).toBe(30);
    expect(vista.stats.invested).toBe(30);
  });

  it('crear sin pagar nada no crea ningún gasto', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    await svc.create(ORG, nueva(0));
    const [a] = await svc.list(ORG);
    expect(ads(expenses)).toHaveLength(0);
    expect(a.paidUsd).toBe(0);
    expect(a.stats.invested).toBe(0);
  });

  it('editar lo pagado ACTUALIZA el mismo gasto, no crea otro', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    const creada = await svc.create(ORG, nueva(30));
    await svc.update(ORG, creada.id, { paidUsd: 50 } as never);

    const gastos = ads(expenses);
    expect(gastos).toHaveLength(1);
    expect(gastos[0].amount).toBe(50);

    const [vista] = await svc.list(ORG);
    expect(vista.paidUsd).toBe(50);
    expect(vista.stats.invested).toBe(50);
  });

  it('poner lo pagado en 0 BORRA el gasto gestionado', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    const creada = await svc.create(ORG, nueva(30));
    await svc.update(ORG, creada.id, { paidUsd: 0 } as never);

    expect(ads(expenses)).toHaveLength(0);
    const [vista] = await svc.list(ORG);
    expect(vista.paidUsd).toBe(0);
    expect(vista.stats.invested).toBe(0);
  });

  it('poner lo pagado en null BORRA el gasto gestionado', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    const creada = await svc.create(ORG, nueva(30));
    await svc.update(ORG, creada.id, { paidUsd: null } as never);

    expect(ads(expenses)).toHaveLength(0);
    const [vista] = await svc.list(ORG);
    expect(vista.paidUsd).toBe(0);
  });

  it('editar SIN mandar lo pagado deja el gasto como estaba', async () => {
    const { prisma, expenses } = makeStore();
    const svc = new CampaignsService(prisma as never);

    const creada = await svc.create(ORG, nueva(30));
    await svc.update(ORG, creada.id, { name: 'Otro nombre' } as never);

    const gastos = ads(expenses);
    expect(gastos).toHaveLength(1);
    expect(gastos[0].amount).toBe(30);
    const [vista] = await svc.list(ORG);
    expect(vista.paidUsd).toBe(30);
  });
});
