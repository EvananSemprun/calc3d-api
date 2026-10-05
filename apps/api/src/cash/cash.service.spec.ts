import { ConflictException, NotFoundException } from '@nestjs/common';
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
      findFirst: jest.fn().mockResolvedValue(null),
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
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([
        // Los 30 del retiro fueron contra el equipo, la deuda más antigua.
        { paymentId: 'mv1', expenseId: 'g2', loanPaymentId: null, obligationMovementId: null, amount: '30' },
      ]),
    },
    cashReconciliation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
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
    /** La transacción real es un requisito; el mock corre el callback tal cual. */
    $transaction: jest.fn(),
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

/** Prisma con una conciliación en BORRADOR lista para confirmar. */
function prismaConBorrador(overrides: { account?: Record<string, unknown> } = {}) {
  const p = makePrisma();
  p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({
    id: 'r2',
    organizationId: ORG,
    accountId: 'acc1',
    date: new Date('2026-10-05T00:00:00Z'),
    status: 'DRAFT',
    totalAmount: '220',
    personalAmount: '120',
    currency: 'USD',
    rate: null,
    account: {
      id: 'acc1',
      currency: 'USD',
      shared: true,
      sharedWithId: 'cp1',
      autoAttributeShortfall: true,
      ...overrides.account,
    },
  });
  p.cashReconciliation.update = jest.fn().mockResolvedValue({});
  p.cashReconciliation.create = jest.fn().mockResolvedValue({});
  p.ownerMovement.create = jest.fn().mockResolvedValue({ id: 'ajuste1' });
  p.debtApplication.createMany = jest.fn().mockResolvedValue({ count: 1 });
  (p as Record<string, unknown>).$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(p));
  return p;
}

describe('CashService.confirm', () => {
  /**
   * Con el mock base el esperado da 70 y el real 220−120 = 100: eso es
   * diferencia A FAVOR y no genera ajuste. Para probar el faltante hay que
   * subir el esperado a 150, y la venta extra de 80 hace exactamente eso.
   */
  const conFaltante = () => {
    const p = prismaConBorrador();
    p.sale.findMany = jest.fn().mockResolvedValue([
      { date: new Date('2026-09-01'), amount: '100' },
      { date: new Date('2026-09-02'), amount: '80' },
    ]);
    return p;
  };

  it('registra el faltante como salida a la contraparte, vinculada a la conciliación', async () => {
    const p = conFaltante();

    await service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1');

    // esperado 150, real 100 → faltan 50.
    expect(p.ownerMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'WITHDRAWAL',
          amount: 50,
          counterpartyId: 'cp1',
          source: 'RECONCILIATION',
          cashReconciliationId: 'r2',
        }),
      }),
    );
  });

  it('aplica el faltante a la deuda MÁS ANTIGUA (el equipo del 02/01)', async () => {
    const p = conFaltante();

    await service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1');

    expect(p.debtApplication.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ paymentId: 'ajuste1', expenseId: 'g2', amount: 50 })],
    });
  });

  it('congela los importes y marca CONFIRMED', async () => {
    const p = conFaltante();

    await service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1');

    expect(p.cashReconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r2' },
        data: expect.objectContaining({
          status: 'CONFIRMED',
          expectedUsd: 150,
          totalUsd: 220,
          personalUsd: 120,
          differenceUsd: -50,
          confirmedByUserId: 'user-1',
        }),
      }),
    );
  });

  it('una diferencia A FAVOR no genera NADA', async () => {
    // El mock base da esperado 70 contra real 100: +30 a favor.
    const p = prismaConBorrador();

    await service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1');

    expect(p.ownerMovement.create).not.toHaveBeenCalled();
    expect(p.cashReconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
    );
  });

  it('confirmar dos veces NO duplica el ajuste: 409', async () => {
    const p = conFaltante();
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({
      id: 'r2',
      organizationId: ORG,
      status: 'CONFIRMED',
      account: { currency: 'USD', shared: true, autoAttributeShortfall: true },
    });

    await expect(
      service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1'),
    ).rejects.toThrow(ConflictException);
    expect(p.ownerMovement.create).not.toHaveBeenCalled();
  });

  it('con la atribución APAGADA en la cuenta, no crea ningún movimiento', async () => {
    const p = conFaltante();
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({
      id: 'r2',
      organizationId: ORG,
      accountId: 'acc1',
      date: new Date('2026-10-05T00:00:00Z'),
      status: 'DRAFT',
      totalAmount: '220',
      personalAmount: '120',
      currency: 'USD',
      rate: null,
      account: {
        id: 'acc1',
        currency: 'USD',
        shared: true,
        sharedWithId: 'cp1',
        autoAttributeShortfall: false,
      },
    });

    await service(p).confirm(ORG, 'r2', { attributeShortfall: true }, 'user-1');

    expect(p.ownerMovement.create).not.toHaveBeenCalled();
  });

  it('el dueño puede explicar el descuadre en vez de atribuirlo', async () => {
    const p = conFaltante();

    await service(p).confirm(
      ORG,
      'r2',
      { attributeShortfall: false, explanation: 'Falta cargar la compra del lunes' },
      'user-1',
    );

    expect(p.ownerMovement.create).not.toHaveBeenCalled();
    expect(p.cashReconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanation: 'Falta cargar la compra del lunes' }),
      }),
    );
  });

  it('una conciliación de otra organización no se confirma: 404', async () => {
    const p = conFaltante();
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      service(p).confirm(ORG, 'r-ajena', { attributeShortfall: true }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(p.cashReconciliation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r-ajena', organizationId: ORG } }),
    );
  });
});

describe('CashService.voidReconciliation', () => {
  it('anular borra el ajuste y marca VOID, conservando la fila', async () => {
    const p = prismaConBorrador();
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({
      id: 'r2',
      organizationId: ORG,
      status: 'CONFIRMED',
      adjustment: { id: 'ajuste1' },
    });
    p.ownerMovement.deleteMany = jest.fn().mockResolvedValue({ count: 1 });

    await service(p).voidReconciliation(ORG, 'r2');

    expect(p.ownerMovement.deleteMany).toHaveBeenCalledWith({
      where: { id: 'ajuste1', organizationId: ORG },
    });
    expect(p.cashReconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'VOID' }) }),
    );
  });

  it('anular dos veces: 409', async () => {
    const p = prismaConBorrador();
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({
      id: 'r2',
      organizationId: ORG,
      status: 'VOID',
      adjustment: null,
    });

    await expect(service(p).voidReconciliation(ORG, 'r2')).rejects.toThrow(ConflictException);
  });
});

describe('CashService.saveReconciliation', () => {
  it('una cuenta de otra organización se rechaza: 404 (IDOR)', async () => {
    const p = prismaConBorrador();
    p.cashAccount.findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      service(p).saveReconciliation(ORG, {
        accountId: 'acc-ajena',
        date: '2026-10-05',
        totalAmount: 1,
        personalAmount: 0,
        currency: 'USD',
        rate: null,
        note: null,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(p.cashAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-ajena', organizationId: ORG },
    });
  });

  it('una conciliación ya CONFIRMADA no se edita: 409', async () => {
    const p = prismaConBorrador();
    p.cashAccount.findFirst = jest.fn().mockResolvedValue({ id: 'acc1', currency: 'USD' });
    p.cashReconciliation.findFirst = jest.fn().mockResolvedValue({ id: 'r2', status: 'CONFIRMED' });

    await expect(
      service(p).saveReconciliation(ORG, {
        accountId: 'acc1',
        date: '2026-10-05',
        totalAmount: 1,
        personalAmount: 0,
        currency: 'USD',
        rate: null,
        note: null,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

/**
 * El aviso de "esta conciliación quedó vieja" tiene que significar algo.
 *
 * `expectedUsd` se congela ANTES de crear el ajuste, y el ajuste se fecha ese
 * mismo día: al recalcular, el esperado de esa fecha ya viene con el faltante
 * descontado y difiere del congelado en exactamente el monto del ajuste. Sin
 * compensarlo, `stale` se encendía en TODA conciliación ajustada.
 */
describe('CashService.summary — el aviso de conciliación vieja', () => {
  /** Faltante de 50: esperado 150, real 100, ajuste de 50 fechado ese día. */
  function prismaConAjuste() {
    const p = makePrisma();
    p.sale.findMany = jest.fn().mockResolvedValue([
      { date: new Date('2026-09-01'), amount: '100' },
      { date: new Date('2026-09-02'), amount: '50' },
    ]);
    p.ownerMovement.findMany = jest.fn().mockResolvedValue([
      {
        id: 'ajuste1',
        date: new Date('2026-09-21'),
        kind: 'WITHDRAWAL',
        amount: '50',
        concept: 'Faltante de la conciliación del 2026-09-21',
        note: null,
        counterpartyId: 'cp1',
        refundable: true,
        source: 'RECONCILIATION',
        cashReconciliationId: 'r1',
      },
    ]);
    p.debtApplication.findMany = jest.fn().mockResolvedValue([]);
    p.cashReconciliation.findMany = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        accountId: 'acc1',
        date: new Date('2026-09-21T00:00:00Z'),
        status: 'CONFIRMED',
        totalAmount: '220',
        personalAmount: '120',
        currency: 'USD',
        rate: null,
        totalUsd: '220',
        personalUsd: '120',
        expectedUsd: '150',
        differenceUsd: '-50',
        explanation: null,
        note: null,
        source: 'MANUAL',
        confirmedAt: new Date('2026-09-21'),
        voidedAt: null,
        adjustment: { id: 'ajuste1', amount: '50', concept: 'Faltante' },
      },
    ]);
    return p;
  }

  it('el ajuste propio de la conciliación NO la marca como vieja', async () => {
    const r = await service(prismaConAjuste()).summary(ORG);

    // Ledger a esa fecha: 150 cobrado − 50 del ajuste = 100. Sumando el ajuste
    // de vuelta da 150, que es justo lo congelado.
    expect(r.reconciliations[0].expectedNow).toBe(150);
    expect(r.reconciliations[0].stale).toBe(false);
  });

  it('pero una venta vieja cargada DESPUÉS sí la marca como vieja', async () => {
    const p = prismaConAjuste();
    p.sale.findMany = jest.fn().mockResolvedValue([
      { date: new Date('2026-09-01'), amount: '100' },
      { date: new Date('2026-09-02'), amount: '50' },
      // Esta entró después de conciliar, con fecha anterior al conteo.
      { date: new Date('2026-09-15'), amount: '40' },
    ]);

    const r = await service(p).summary(ORG);

    expect(r.reconciliations[0].expectedNow).toBe(190);
    expect(r.reconciliations[0].stale).toBe(true);
  });
});
