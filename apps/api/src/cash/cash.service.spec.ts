import { NotFoundException } from '@nestjs/common';
import {
  CashReconciliationUpsertSchema,
  OwnerMovementCreateSchema,
} from '@calc3d/shared';
import { CashService } from './cash.service';

const ORG = 'org-A';

function makePrisma() {
  const vacio = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    sale: { findMany: jest.fn().mockResolvedValue([{ date: new Date('2026-09-01'), amount: '100' }]) },
    payment: { ...vacio },
    expense: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'g1',
          date: new Date('2026-09-23'),
          amount: '20',
          paidBy: 'OWNER',
          isInvestment: false,
          category: 'CONSUMABLE',
          materialId: 'm1',
          refundable: true,
        },
        {
          id: 'g2',
          date: new Date('2026-01-02'),
          amount: '615',
          paidBy: 'OWNER',
          isInvestment: true,
          category: 'EQUIPMENT',
          materialId: null,
          refundable: true,
        },
      ]),
    },
    loanPayment: { ...vacio },
    loan: { ...vacio },
    counterparty: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cp1', name: 'Vanan', kind: 'OWNER' }),
    },
    cashAccount: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'acc1',
          name: 'Binance',
          currency: 'USD',
          shared: true,
          sharedWithId: 'cp1',
          autoAttributeShortfall: false,
          isDefault: true,
        },
      ]),
    },
    ownerMovement: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'mv1',
          date: new Date('2026-09-17'),
          kind: 'WITHDRAWAL',
          amount: '30',
          concept: 'x',
          note: null,
          counterpartyId: 'cp1',
          refundable: true,
          source: 'MANUAL',
          cashReconciliationId: null,
        },
      ]),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    debtApplication: {
      findMany: jest.fn().mockResolvedValue([
        // Los 30 del retiro fueron contra el equipo, la deuda más antigua.
        { paymentId: 'mv1', expenseId: 'g2', loanPaymentId: null, obligationMovementId: null, amount: '30' },
      ]),
    },
    cashReconciliation: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'r1',
          accountId: 'acc1',
          date: new Date('2026-09-21T00:00:00Z'),
          status: 'CONFIRMED',
          totalAmount: '85',
          personalAmount: '15',
          currency: 'USD',
          rate: null,
          totalUsd: '85',
          personalUsd: '15',
          expectedUsd: '70',
          differenceUsd: '0',
          explanation: null,
          note: null,
          source: 'MIGRATION',
          confirmedAt: new Date('2026-09-21'),
          voidedAt: null,
          adjustment: null,
        },
      ]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    settings: {
      findUnique: jest.fn().mockResolvedValue({ debtApplicationOrder: 'OLDEST_FIRST' }),
    },
  };
}

const service = (p: ReturnType<typeof makePrisma>) => new CashService(p as never);

describe('CashService.summary', () => {
  it('reconstruye el saldo: 100 cobrado − 20 filamento + 20 aporte − 30 pago', async () => {
    const r = await service(makePrisma()).summary(ORG);

    expect(r.balance.balance).toBe(70);
    expect(r.balance.contributionsRefundable).toBe(20);
    // El retiro se aplicó entero a una deuda: es devolución, no retiro puro.
    expect(r.balance.debtRepayments).toBe(30);
    expect(r.balance.ownerDraws).toBe(0);
  });

  it('la conciliación muestra las cuatro líneas, sin recalcular lo congelado', async () => {
    const r = await service(makePrisma()).summary(ORG);

    expect(r.reconciliations[0]).toMatchObject({
      expectedUsd: 70,
      totalUsd: 85,
      personalUsd: 15,
      businessActualUsd: 70,
      differenceUsd: 0,
      kind: 'SQUARE',
    });
  });

  it('el reparto es por FECHA: el retiro bajó el equipo (02/01), no el filamento (23/09)', async () => {
    const r = await service(makePrisma()).summary(ORG);
    const equipo = r.financing.rows.find((x) => x.key === 'equipment');

    expect(equipo).toMatchObject({ put: 615, recovered: 30, missing: 585 });
  });

  it('avisa cuando entraron movimientos con fecha anterior después de confirmar', async () => {
    // Lo congelado dice 70; con el ledger de hoy el esperado a esa fecha es
    // otro, así que la conciliación quedó vieja.
    const p = makePrisma();
    p.cashReconciliation.findMany = jest.fn().mockResolvedValue([
      {
        ...(await p.cashReconciliation.findMany())[0],
        expectedUsd: '999',
      },
    ]);

    const r = await service(p).summary(ORG);

    expect(r.reconciliations[0].expectedUsd).toBe(999);
    expect(r.reconciliations[0].stale).toBe(true);
  });

  it('expone la contraparte y las cuentas para que la UI no tenga nombres fijos', async () => {
    const r = await service(makePrisma()).summary(ORG);

    expect(r.counterparty).toMatchObject({ id: 'cp1', name: 'Vanan' });
    expect(r.accounts[0]).toMatchObject({ id: 'acc1', shared: true, autoAttributeShortfall: false });
    expect(r.applicationOrder).toBe('OLDEST_FIRST');
  });

  it('lee todo filtrando por la organización', async () => {
    const p = makePrisma();
    await service(p).summary(ORG);

    for (const m of [
      p.sale, p.payment, p.expense, p.loanPayment,
      p.ownerMovement, p.cashReconciliation, p.debtApplication, p.cashAccount,
    ]) {
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
});

describe('CashService.addMovement', () => {
  it('sin contraparte usa la del dueño, y el aporte es reembolsable por defecto', async () => {
    const p = makePrisma();

    await service(p).addMovement(ORG, {
      date: '2026-10-05',
      kind: 'CONTRIBUTION',
      amount: 50,
      concept: 'plata mía',
      refundable: true,
      note: null,
    } as never);

    expect(p.ownerMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG,
          counterpartyId: 'cp1',
          refundable: true,
          source: 'MANUAL',
        }),
      }),
    );
  });

  it('una contraparte de OTRA organización se rechaza: 404 (IDOR)', async () => {
    const p = makePrisma();
    // La contraparte pedida no pertenece a esta organización.
    p.counterparty.findFirst = jest.fn(({ where }: never) =>
      (where as { id?: string }).id === 'cp-ajena' ? null : { id: 'cp1', name: 'Vanan', kind: 'OWNER' },
    );

    await expect(
      service(p).addMovement(ORG, {
        date: '2026-10-05',
        kind: 'WITHDRAWAL',
        amount: 10,
        concept: 'x',
        counterpartyId: 'cp-ajena',
        refundable: true,
        note: null,
      } as never),
    ).rejects.toThrow(NotFoundException);
    expect(p.ownerMovement.create).not.toHaveBeenCalled();
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
