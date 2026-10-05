import { NotFoundException } from '@nestjs/common';
import {
  CashReconciliationUpsertSchema,
  OwnerMovementCreateSchema,
} from '@calc3d/shared';
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
  const base = {
    accountId: 'acc-1',
    date: '2026-10-05',
    totalAmount: 220,
    personalAmount: 120,
  };

  it('la organización y los campos CALCULADOS no viajan en el body', () => {
    const dto = CashReconciliationUpsertSchema.parse({
      ...base,
      organizationId: 'org-B',
      expectedUsd: 0,
      differenceUsd: 9999,
      totalUsd: 1,
      status: 'CONFIRMED',
      confirmedAt: '2026-01-01',
    });

    for (const prohibido of [
      'organizationId',
      'expectedUsd',
      'differenceUsd',
      'totalUsd',
      'status',
      'confirmedAt',
    ]) {
      expect(dto).not.toHaveProperty(prohibido);
    }
  });

  it('una moneda que no es USD exige tasa', () => {
    expect(
      CashReconciliationUpsertSchema.safeParse({ ...base, currency: 'VES' }).success,
    ).toBe(false);
    expect(
      CashReconciliationUpsertSchema.safeParse({ ...base, currency: 'VES', rate: 700 }).success,
    ).toBe(true);
  });

  it('rechaza montos negativos y fechas mal formadas', () => {
    expect(CashReconciliationUpsertSchema.safeParse({ ...base, totalAmount: -1 }).success).toBe(false);
    expect(CashReconciliationUpsertSchema.safeParse({ ...base, personalAmount: -1 }).success).toBe(false);
    expect(CashReconciliationUpsertSchema.safeParse({ ...base, date: '05/10/2026' }).success).toBe(false);
  });

  it('el movimiento no acepta montos negativos ni tipos inventados', () => {
    const m = { date: '2026-09-17', kind: 'WITHDRAWAL', amount: 10, concept: 'x' };

    expect(OwnerMovementCreateSchema.safeParse({ ...m, amount: -5 }).success).toBe(false);
    expect(OwnerMovementCreateSchema.safeParse({ ...m, kind: 'GIFT' }).success).toBe(false);
  });

  it('un aporte puede marcarse como capital; por defecto es reembolsable', () => {
    const m = { date: '2026-09-17', kind: 'CONTRIBUTION', amount: 500, concept: 'capital inicial' };

    expect(OwnerMovementCreateSchema.parse(m).refundable).toBe(true);
    expect(OwnerMovementCreateSchema.parse({ ...m, refundable: false }).refundable).toBe(false);
  });
});
