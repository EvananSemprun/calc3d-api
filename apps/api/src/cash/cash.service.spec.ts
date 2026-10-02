import { NotFoundException } from '@nestjs/common';
import { CashCountUpsertSchema, OwnerMovementCreateSchema } from '@calc3d/shared';
import { CashService } from './cash.module';

const ORG = 'org-A';

function makePrisma() {
  const vacio = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    sale: { findMany: jest.fn().mockResolvedValue([{ date: new Date('2026-09-01'), amount: '100' }]) },
    payment: { ...vacio },
    expense: {
      findMany: jest.fn().mockResolvedValue([
        // Una compra que pagó Vanan: gasto y aporte a la vez, no mueve la caja.
        {
          date: new Date('2026-09-23'),
          amount: '20',
          paidBy: 'OWNER',
          isInvestment: false,
          category: 'CONSUMABLE',
          materialId: 'm1',
        },
        // La A1: la pagó Vanan, vive en el financiamiento y no en la caja.
        {
          date: new Date('2026-01-02'),
          amount: '615',
          paidBy: 'OWNER',
          isInvestment: true,
          category: 'EQUIPMENT',
          materialId: null,
        },
      ]),
    },
    loanPayment: { ...vacio },
    loan: { ...vacio },
    ownerMovement: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'mv1', date: new Date('2026-09-17'), kind: 'WITHDRAWAL', amount: '30', concept: 'x', note: null },
      ]),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    cashCount: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', date: new Date('2026-09-21T00:00:00Z'), total: '85', note: null },
      ]),
      upsert: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

const service = (p: ReturnType<typeof makePrisma>) => new CashService(p as never);

describe('CashService.summary', () => {
  it('reconstruye el saldo y compara cada conteo con lo del negocio ESE día', async () => {
    const r = await service(makePrisma()).summary(ORG);

    // 100 cobrado − 20 filamento + 20 aporte − 30 retiro.
    expect(r.balance.balance).toBe(70);
    expect(r.counts[0]).toMatchObject({ total: 85, business: 70, personal: 15, short: false });
    // La A1 es lo que el negocio le debe a Vanan por equipos.
    expect(r.financing.rows.find((x) => x.key === 'equipment')?.put).toBe(615);
  });

  it('lee todo filtrando por la organización', async () => {
    const p = makePrisma();
    await service(p).summary(ORG);

    for (const m of [p.sale, p.payment, p.expense, p.loanPayment, p.ownerMovement, p.cashCount]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
      );
    }
  });
});

describe('CashService — borrar algo ajeno (IDOR)', () => {
  it('un movimiento de otra organización no se borra: 404', async () => {
    const p = makePrisma();

    await expect(service(p).removeMovement(ORG, 'mv-ajeno')).rejects.toThrow(NotFoundException);
    expect(p.ownerMovement.deleteMany).toHaveBeenCalledWith({
      where: { id: 'mv-ajeno', organizationId: ORG },
    });
  });

  it('un conteo de otra organización no se borra: 404', async () => {
    const p = makePrisma();

    await expect(service(p).removeCount(ORG, 'c-ajeno')).rejects.toThrow(NotFoundException);
    expect(p.cashCount.deleteMany).toHaveBeenCalledWith({
      where: { id: 'c-ajeno', organizationId: ORG },
    });
  });
});

describe('Contratos de Caja', () => {
  it('la organización no viaja en el body: el pipe la descarta', () => {
    const dto = OwnerMovementCreateSchema.parse({
      date: '2026-09-17',
      kind: 'WITHDRAWAL',
      amount: 10,
      concept: 'x',
      organizationId: 'org-B',
    });

    expect(dto).not.toHaveProperty('organizationId');
  });

  it('no acepta montos negativos ni tipos inventados', () => {
    const base = { date: '2026-09-17', kind: 'WITHDRAWAL', amount: 10, concept: 'x' };

    expect(OwnerMovementCreateSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
    expect(OwnerMovementCreateSchema.safeParse({ ...base, kind: 'GIFT' }).success).toBe(false);
    expect(CashCountUpsertSchema.safeParse({ date: '2026-09-21', total: -1 }).success).toBe(false);
  });
});
