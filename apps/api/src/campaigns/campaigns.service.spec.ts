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
