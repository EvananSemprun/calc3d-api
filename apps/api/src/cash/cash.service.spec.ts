import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  CASH_SIGN,
  CashAccountUpsertSchema,
  CashBalanceQuerySchema,
  CashCategorySchema,
  CashReconciliationConfirmSchema,
  CashReconciliationUpsertSchema,
  CashShortfallPlanQuerySchema,
  CounterpartyUpsertSchema,
  OwnerMovementCreateSchema,
  SettingsUpdateSchema,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CashController } from './cash.module';
import { CashService } from './cash.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const ORG = 'org-A';
/** La organización de al lado: nada suyo puede salir por el desplegable. */
const OTHER_ORG = 'org-B';

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
          counterpartyId: 'cp1',
          isInvestment: false,
          category: 'CONSUMABLE',
          materialId: 'm1',
          refundable: true,
        },
        {
          id: 'g2',
          date: new Date('2026-01-02'),
          amount: '615',
          counterpartyId: 'cp1',
          isInvestment: true,
          category: 'EQUIPMENT',
          materialId: null,
          refundable: true,
        },
      ]),
    },
    loanPayment: { ...vacio },
    loan: { ...vacio },
    // Sin facturas de compra: lo suyo se prueba en `purchase-invoice.spec.ts`
    // (el motor) y en el test de la doble carga de `cash.spec.ts`.
    purchaseInvoicePayment: { findMany: jest.fn().mockResolvedValue([]) },
    counterparty: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cp1', name: 'Dueño de prueba', kind: 'OWNER' }),
      // La lista completa: `idPagador` la necesita para saber a quién se le
      // debe una fila que todavía no tiene `counterpartyId`.
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'cp1', name: 'Dueño de prueba', kind: 'OWNER', isDefault: true }]),
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

    expect(r.counterparty).toMatchObject({ id: 'cp1', name: 'Dueño de prueba' });
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
      (where as { id?: string }).id === 'cp-ajena' ? null : { id: 'cp1', name: 'Dueño de prueba', kind: 'OWNER' },
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

/**
 * El saldo esperado, la diferencia y el estado los calcula el SERVIDOR. Si
 * alguno viajara en el cuerpo, cualquiera declararía su caja cuadrada y el
 * faltante se evaporaría sin dejar rastro.
 *
 * Se prueba contra el PIPE REAL (el mismo objeto que monta el controlador), no
 * contra el schema pelado: así el test caza también a quien cambie el pipe.
 */
describe('Mass-assignment en la conciliación (contra el pipe REAL)', () => {
  const pipe = new ZodValidationPipe(CashReconciliationUpsertSchema);

  it('el pipe descarta todo lo que calcula el servidor', () => {
    const dto = pipe.transform({
      accountId: 'acc1',
      date: '2026-10-05',
      totalAmount: 220,
      personalAmount: 120,
      expectedUsd: 0,
      differenceUsd: 0,
      totalUsd: 1,
      personalUsd: 1,
      status: 'CONFIRMED',
      confirmedAt: '2026-01-01',
      confirmedByUserId: 'otro',
      organizationId: 'org-B',
      source: 'MANUAL',
    }) as unknown as Record<string, unknown>;

    for (const prohibido of [
      'expectedUsd',
      'differenceUsd',
      'totalUsd',
      'personalUsd',
      'status',
      'confirmedAt',
      'confirmedByUserId',
      'organizationId',
      'source',
    ]) {
      expect(dto[prohibido]).toBeUndefined();
    }
    // Y lo que SÍ es del cliente sobrevive.
    expect(dto.totalAmount).toBe(220);
    expect(dto.personalAmount).toBe(120);
  });
});

/**
 * El reparto que la pantalla muestra ANTES de confirmar tiene que ser el que
 * el servidor va a hacer. Lo calcula el servidor por el mismo camino que
 * `confirm()`: el front no puede deducirlo de `obligations`, que viene sin
 * filtro de fecha y con la contraparte por defecto de la organización.
 */
describe('CashService.summary — el plan del borrador', () => {
  /** Borrador del 22/09, con la atribución automática encendida. */
  function prismaConBorradorCorto() {
    const p = makePrisma();
    p.cashAccount.findMany = jest.fn().mockResolvedValue([
      {
        id: 'acc1',
        name: 'Binance',
        currency: 'USD',
        shared: true,
        sharedWithId: 'cp1',
        autoAttributeShortfall: true,
        isDefault: true,
      },
    ]);
    p.cashReconciliation.findMany = jest.fn().mockResolvedValue([
      {
        id: 'r3',
        accountId: 'acc1',
        date: new Date('2026-09-22T00:00:00Z'),
        status: 'DRAFT',
        totalAmount: '100',
        personalAmount: '50',
        currency: 'USD',
        rate: null,
        totalUsd: null,
        personalUsd: null,
        expectedUsd: null,
        differenceUsd: null,
        explanation: null,
        note: null,
        source: 'MANUAL',
        confirmedAt: null,
        voidedAt: null,
        adjustment: null,
      },
    ]);
    return p;
  }

  it('el plan NO incluye deudas posteriores a la fecha de la conciliación', async () => {
    const r = await service(prismaConBorradorCorto()).summary(ORG);
    const c = r.reconciliations[0];

    // Esperado 70, real 100−50 = 50 → faltan 20.
    expect(c.kind).toBe('SHORT');
    expect(c.differenceUsd).toBe(-20);

    // El gasto g1 es del 23/09, POSTERIOR al conteo del 22/09: el servidor lo
    // va a ignorar al confirmar, así que el plan tampoco puede ofrecerlo.
    expect(c.plan?.applications).toEqual([
      expect.objectContaining({ sourceId: 'g2', amount: 20 }),
    ]);
    expect(c.plan?.leftover).toBe(0);

    // Y sin embargo SÍ está en la lista general de obligaciones: si el front
    // previsualizara con esa lista, mostraría un reparto que no va a ocurrir.
    expect(r.obligations.map((o) => o.sourceId)).toContain('g1');
  });

  it('sin atribución automática no hay plan que mostrar', async () => {
    const p = prismaConBorradorCorto();
    p.cashAccount.findMany = jest.fn().mockResolvedValue([
      {
        id: 'acc1',
        name: 'Binance',
        currency: 'USD',
        shared: true,
        sharedWithId: 'cp1',
        autoAttributeShortfall: false,
        isDefault: true,
      },
    ]);

    const r = await service(p).summary(ORG);

    expect(r.reconciliations[0].plan).toBeNull();
  });

  it('una conciliación ya confirmada no tiene plan pendiente', async () => {
    const r = await service(makePrisma()).summary(ORG);

    expect(r.reconciliations[0].status).toBe('CONFIRMED');
    expect(r.reconciliations[0].plan).toBeNull();
  });
});


describe('Contratos de contrapartes y cuentas', () => {
  it('la contraparte exige nombre y un tipo conocido', () => {
    expect(CounterpartyUpsertSchema.safeParse({ name: '  ', kind: 'OWNER' }).success).toBe(false);
    expect(CounterpartyUpsertSchema.safeParse({ name: 'Ana', kind: 'SOCIA' }).success).toBe(false);
    expect(CounterpartyUpsertSchema.parse({ name: '  Ana  ', kind: 'PARTNER' }).name).toBe('Ana');
  });

  it('la organización y el id no viajan en el body', () => {
    const dto = CounterpartyUpsertSchema.parse({
      name: 'Ana',
      kind: 'PARTNER',
      organizationId: 'org-B',
      id: 'cp-ajena',
    });

    expect(dto).not.toHaveProperty('organizationId');
    expect(dto).not.toHaveProperty('id');
  });

  it('una cuenta compartida exige con quién', () => {
    const base = { name: 'Binance', kind: 'EXCHANGE', currency: 'USD' };

    expect(CashAccountUpsertSchema.safeParse({ ...base, shared: true }).success).toBe(false);
    expect(
      CashAccountUpsertSchema.safeParse({ ...base, shared: true, sharedWithId: 'cp1' }).success,
    ).toBe(true);
    expect(CashAccountUpsertSchema.safeParse({ ...base, shared: false }).success).toBe(true);
  });

  it('la atribución automática no aplica a una cuenta que no se comparte', () => {
    const base = { name: 'Caja chica', kind: 'CASH', currency: 'USD', shared: false };

    expect(
      CashAccountUpsertSchema.safeParse({ ...base, autoAttributeShortfall: true }).success,
    ).toBe(false);
  });

  it('la moneda es un ISO de 3 letras, en mayúsculas', () => {
    const base = { name: 'Banco', kind: 'BANK', shared: false };

    expect(CashAccountUpsertSchema.safeParse({ ...base, currency: 'BOLIVARES' }).success).toBe(false);
    expect(CashAccountUpsertSchema.parse({ ...base, currency: 'ves' }).currency).toBe('VES');
  });

  it('la frecuencia de conciliación y el orden de aplicación son valores cerrados', () => {
    expect(SettingsUpdateSchema.safeParse({ reconciliationFrequency: 'CUANDO SEA' }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ reconciliationFrequency: 'WEEKLY' }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ reconciliationWeekday: 8 }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ reconciliationWeekday: 1 }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ debtApplicationOrder: 'RANDOM' }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ debtApplicationOrder: 'NEWEST_FIRST' }).success).toBe(true);
  });
});

// ===========================================================================
// GET /cash/breakdown/:category — el detalle de UNA línea del saldo.
// ===========================================================================

/**
 * Un Prisma de mentira que se comporta como la BASE DE VERDAD.
 *
 * Cada tabla es una lista de filas y `findMany({ where })` devuelve las que
 * coinciden con TODAS las claves del `where` que llegue. La parte que importa:
 * si el servicio NO manda `organizationId`, el `where` no lo filtra y las filas
 * de la otra organización **SALEN**, igual que en Postgres.
 *
 * ⚠️ Es el error exacto que arruinó los tests de la fase 2. Aquel mock devolvía
 * la fila solo cuando `organizationId === OTHER`: al quitarle el scope al
 * servicio devolvía `undefined`, el servicio tiraba 404 igual, y el test pasaba
 * CON y SIN la protección. Un test de aislamiento que no distingue "filtrado"
 * de "no encontrado" no prueba nada. Por eso acá un `where` inesperado NO
 * devuelve vacío: devuelve de más, que es el lado peligroso.
 */
function baseFalsa(tablas: Record<string, Record<string, unknown>[]>) {
  const coincide = (fila: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v === null || typeof v !== 'object') return fila[k] === v;
      const op = v as Record<string, unknown>;
      if ('not' in op) return fila[k] !== op.not;
      if ('in' in op) return (op.in as unknown[]).includes(fila[k]);
      // Un operador que este mock no modela NO filtra: preferimos devolver de
      // más y que el test se caiga, antes que esconder filas por accidente.
      return true;
    });

  /**
   * El `include: { account: true }` que usa `confirm()`. Es la ÚNICA relación
   * que este mock resuelve, y se resuelve de verdad —buscando la cuenta en su
   * tabla— en vez de clavarla en la fila: una cuenta que no existe tiene que
   * llegar como `null`, igual que en Postgres.
   */
  const conIncludes = (nombre: string, fila: Record<string, unknown> | null, include?: Record<string, unknown>) => {
    if (!fila || !include) return fila;
    if (nombre === 'cashReconciliation') {
      const extra: Record<string, unknown> = {};
      if (include.account) {
        extra.account = (tablas.cashAccount ?? []).find((a) => a.id === fila.accountId) ?? null;
      }
      if (include.adjustment) {
        extra.adjustment =
          (tablas.ownerMovement ?? []).find((m) => m.cashReconciliationId === fila.id) ?? null;
      }
      return { ...fila, ...extra };
    }
    return fila;
  };

  let secuencia = 0;

  const delegado = (nombre: string) => ({
    findMany: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve((tablas[nombre] ?? []).filter((f) => coincide(f, where))),
    ),
    findFirst: jest.fn(
      ({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> } = {}) =>
        Promise.resolve(
          conIncludes(nombre, (tablas[nombre] ?? []).find((f) => coincide(f, where)) ?? null, include),
        ),
    ),
    findUnique: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve((tablas[nombre] ?? []).find((f) => coincide(f, where)) ?? null),
    ),
    // Las escrituras también tocan las tablas: lo que se escribe se puede
    // volver a leer, como en la base. Si solo contaran llamadas, un test no
    // podría distinguir "se escribió mal" de "no se escribió".
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const fila = { id: `${nombre}-${++secuencia}`, ...data };
      (tablas[nombre] ??= []).push(fila);
      return Promise.resolve(fila);
    }),
    createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) (tablas[nombre] ??= []).push({ id: `${nombre}-${++secuencia}`, ...d });
      return Promise.resolve({ count: data.length });
    }),
    update: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const fila = (tablas[nombre] ?? []).find((f) => coincide(f, where));
      if (fila) Object.assign(fila, data);
      return Promise.resolve(fila ?? null);
    }),
    deleteMany: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => {
      const quedan = (tablas[nombre] ?? []).filter((f) => !coincide(f, where));
      const count = (tablas[nombre] ?? []).length - quedan.length;
      tablas[nombre] = quedan;
      return Promise.resolve({ count });
    }),
  });

  const base = {
    sale: delegado('sale'),
    payment: delegado('payment'),
    expense: delegado('expense'),
    loanPayment: delegado('loanPayment'),
    loan: delegado('loan'),
    ownerMovement: delegado('ownerMovement'),
    debtApplication: delegado('debtApplication'),
    cashAccount: delegado('cashAccount'),
    cashReconciliation: delegado('cashReconciliation'),
    counterparty: delegado('counterparty'),
    purchaseInvoicePayment: delegado('purchaseInvoicePayment'),
    settings: delegado('settings'),
  };

  /** La transacción corre el callback contra este mismo mock. */
  return { ...base, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(base)) };
}

type Tablas = Record<string, Record<string, unknown>[]>;

/** Un negocio con las NUEVE líneas del saldo pobladas. */
function tablasCompletas(org = ORG): Tablas {
  return {
    counterparty: [
      { id: 'cp1', organizationId: org, name: 'Propietario', kind: 'OWNER', active: true, isDefault: true },
    ],
    settings: [{ organizationId: org, debtApplicationOrder: 'OLDEST_FIRST' }],
    cashAccount: [
      {
        id: 'acc1', organizationId: org, name: 'Binance', currency: 'USD',
        shared: true, sharedWithId: 'cp1', autoAttributeShortfall: false, isDefault: true,
      },
    ],
    cashReconciliation: [],
    loan: [],
    sale: [
      // Sin `note`: la etiqueta sale del tipo de venta. Importada del Excel.
      { id: 'v1', organizationId: org, date: new Date('2026-09-01'), amount: '100', kind: 'COUNTER', note: null, source: 'EXCEL_IMPORT' },
      { id: 'v2', organizationId: org, date: new Date('2026-09-05'), amount: '50', kind: 'ENCARGO', note: 'Llaveros del evento', source: 'MANUAL' },
    ],
    payment: [
      { id: 'ab1', organizationId: org, date: new Date('2026-09-03'), amount: '30', note: null, source: 'MANUAL' },
    ],
    expense: [
      { id: 'g1', organizationId: org, date: new Date('2026-09-02'), amount: '10', counterpartyId: null, isInvestment: false, category: 'UTILITIES', materialId: null, refundable: false, description: 'Luz de agosto', source: 'MANUAL' },
      { id: 'g2', organizationId: org, date: new Date('2026-09-04'), amount: '25', counterpartyId: null, isInvestment: false, category: 'MATERIAL', materialId: 'm1', refundable: false, description: 'Rollo PLA negro', source: 'EXCEL_IMPORT' },
      { id: 'g3', organizationId: org, date: new Date('2026-09-06'), amount: '600', counterpartyId: null, isInvestment: true, category: 'EQUIPMENT', materialId: null, refundable: true, description: 'Impresora nueva', source: 'MANUAL' },
      // Lo pagó la contraparte: es gasto Y aporte a la vez (dos asientos).
      { id: 'g4', organizationId: org, date: new Date('2026-09-08'), amount: '40', counterpartyId: 'cp1', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Cinta y espátulas', source: 'MANUAL' },
    ],
    loanPayment: [
      { id: 'c1', organizationId: org, date: new Date('2026-09-09'), amount: '15', counterpartyId: null, refundable: false, reference: 'REF-0091', source: 'MANUAL' },
    ],
    ownerMovement: [
      { id: 'mv1', organizationId: org, date: new Date('2026-09-10'), kind: 'CONTRIBUTION', amount: '200', concept: 'Capital inicial', note: null, counterpartyId: 'cp1', refundable: false, source: 'MANUAL', cashReconciliationId: null },
      { id: 'mv2', organizationId: org, date: new Date('2026-09-12'), kind: 'WITHDRAWAL', amount: '70', concept: 'Retiro de septiembre', note: null, counterpartyId: 'cp1', refundable: true, source: 'MANUAL', cashReconciliationId: null },
    ],
    // De los 70 del retiro, 20 cancelaron la deuda del gasto g4.
    debtApplication: [
      { id: 'da1', organizationId: org, paymentId: 'mv2', expenseId: 'g4', loanPaymentId: null, obligationMovementId: null, amount: '20' },
    ],
  };
}

const servicioFalso = (t: Tablas) => new CashService(baseFalsa(t) as never);

/**
 * AISLAMIENTO. El desplegable expone PLATA fila por fila, con su etiqueta: es
 * la superficie donde un escape de scope no se nota como un total raro sino
 * que entrega el detalle del negocio ajeno, con sus conceptos.
 */
describe('CashService.breakdown — una organización ajena (IDOR)', () => {
  /** ORG está vacía; OTHER_ORG tiene una venta de 999. */
  const tablas = (): Tablas => ({
    counterparty: [
      { id: 'cp-A', organizationId: ORG, name: 'Propietario', kind: 'OWNER', active: true, isDefault: true },
    ],
    settings: [{ organizationId: ORG, debtApplicationOrder: 'OLDEST_FIRST' }],
    cashAccount: [], cashReconciliation: [], loan: [],
    expense: [], loanPayment: [], ownerMovement: [], debtApplication: [], payment: [],
    sale: [
      {
        id: 'v-ajena', organizationId: OTHER_ORG, date: new Date('2026-09-01'),
        amount: '999', kind: 'COUNTER', note: 'Venta del otro negocio', source: 'MANUAL',
      },
    ],
  });

  it('no devuelve ni un asiento de la otra organización', async () => {
    const r = await servicioFalso(tablas()).breakdown(ORG, 'collected');

    expect(r.entries).toEqual([]);
    expect(r.total).toBe(0);
  });

  /**
   * ⚠️ ESTE test es el que vuelve honesto al de arriba.
   *
   * Prueba que la fila ES ALCANZABLE en este mock: si el `where` la incluye,
   * sale. Sin esto, el `[]` de arriba podría significar "el mock no tiene nada
   * que devolver" en vez de "el scope la filtró", y pasaría igual con la
   * protección quitada — que es exactamente como se perdió la fase 2.
   */
  it('el mock modela la base: pedida COMO la otra organización, la venta SÍ aparece', async () => {
    const r = await servicioFalso(tablas()).breakdown(OTHER_ORG, 'collected');

    expect(r.total).toBe(999);
    expect(r.entries[0]).toMatchObject({ label: 'Venta del otro negocio' });
  });

  it('todas las lecturas del desglose van con el organizationId', async () => {
    const p = baseFalsa(tablas());
    await new CashService(p as never).breakdown(ORG, 'collected');

    for (const m of [p.sale, p.payment, p.expense, p.loanPayment, p.ownerMovement, p.debtApplication]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
      );
    }
  });
});

/**
 * Una categoría inventada tiene que morir en el PIPE, antes de llegar al
 * servicio. Se prueba contra el pipe REAL y, aparte, se fija por metadata de
 * Nest que la ruta lo tenga puesto: el pipe suelto no detecta a quien lo saque
 * del `@Param`.
 */
describe('GET /cash/breakdown/:category — la categoría es un valor cerrado', () => {
  const pipe = new ZodValidationPipe(CashCategorySchema);

  it('una categoría inventada es 400, no 500 ni un desplegable vacío', () => {
    for (const basura of ['../../etc', 'balance', '', 'COLLECTED', 'collected; drop']) {
      expect(() => pipe.transform(basura)).toThrow(BadRequestException);
    }
  });

  it('las nueve categorías de verdad pasan', () => {
    for (const k of Object.keys(CASH_SIGN)) expect(pipe.transform(k)).toBe(k);
  });

  it('la ruta valida el :category con ZodValidationPipe (metadata real de Nest)', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'breakdown') as
      | Record<string, { index: number; data?: string; pipes: unknown[] }>
      | undefined;
    const arg = Object.values(meta ?? {}).find((a) => a?.data === 'category');

    if (!arg) throw new Error("falta @Param('category', ...) en breakdown");
    expect(arg.pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
  });

  it('el desglose exige sesión (guard a nivel de clase)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CashController)).toContain(JwtAuthGuard);
  });
});

describe('CashService.breakdown', () => {
  /**
   * ⚠️ Este test NO verifica la clasificación. Los dos lados salen del MISMO
   * `cashEntries`, así que un filtro mal escrito movería el detalle y la línea
   * a la vez y el test seguiría verde — es el error que se cometió en la tarea
   * 1 al escribir un invariante creyendo que protegía el motor.
   *
   * Lo que sí verifica es la CAPA DE LA API: que el `.filter` por categoría, el
   * `.map` y el join `id → etiqueta` no pierdan ni dupliquen asientos. Un gasto
   * de la contraparte emite dos asientos con el MISMO id en categorías
   * distintas, y un retiro emite dos con el mismo id: un join por id mal hecho
   * (un `find` que se queda con el primero, un `Map` que pisa claves entre
   * tablas) rompe acá y en ningún otro lado.
   */
  it('el total de cada desplegable es igual a la línea de summary(), en las nueve', async () => {
    const t = tablasCompletas();
    const resumen = await servicioFalso(t).summary(ORG);

    for (const k of Object.keys(CASH_SIGN) as (keyof typeof CASH_SIGN)[]) {
      const d = await servicioFalso(t).breakdown(ORG, k);
      expect({ [k]: d.total }).toEqual({ [k]: resumen.balance[k] });
      // Y ninguna de las nueve viene vacía: el fixture las puebla a todas, así
      // que un desplegable sin filas sería un asiento perdido, no un cero real.
      expect(d.entries.length).toBeGreaterThan(0);
    }
  });

  it('un retiro parcialmente aplicado sale partido, con la misma etiqueta en las dos mitades', async () => {
    const t = tablasCompletas();
    const devoluciones = await servicioFalso(t).breakdown(ORG, 'debtRepayments');
    const retiros = await servicioFalso(t).breakdown(ORG, 'ownerDraws');

    expect(devoluciones.total).toBe(20);
    expect(retiros.total).toBe(50);
    // Las dos mitades suman el retiro entero: son el mismo movimiento visto
    // por sus dos caras, no dos retiros.
    expect(devoluciones.total + retiros.total).toBe(70);
    expect(devoluciones.entries[0].label).toBe('Retiro de septiembre');
    expect(retiros.entries[0].label).toBe('Retiro de septiembre');
  });

  it('un retiro totalmente aplicado no inventa un retiro de cero', async () => {
    const t = tablasCompletas();
    t.debtApplication = [
      { id: 'da1', organizationId: ORG, paymentId: 'mv2', expenseId: 'g4', loanPaymentId: null, obligationMovementId: null, amount: '70' },
    ];

    const retiros = await servicioFalso(t).breakdown(ORG, 'ownerDraws');

    expect(retiros.entries).toEqual([]);
    expect(retiros.total).toBe(0);
  });

  it('la etiqueta sale del origen de cada asiento, con su insignia', async () => {
    const t = tablasCompletas();

    const cobrado = await servicioFalso(t).breakdown(ORG, 'collected');
    expect(cobrado.entries).toEqual([
      // Más nuevo primero.
      { date: '2026-09-05', amount: 50, label: 'Llaveros del evento', source: 'MANUAL' },
      { date: '2026-09-03', amount: 30, label: 'Abono de pedido', source: 'MANUAL' },
      { date: '2026-09-01', amount: 100, label: 'Venta de mostrador', source: 'EXCEL_IMPORT' },
    ]);

    const filamento = await servicioFalso(t).breakdown(ORG, 'filament');
    expect(filamento.entries).toEqual([
      { date: '2026-09-04', amount: 25, label: 'Rollo PLA negro', source: 'EXCEL_IMPORT' },
    ]);

    const cuotas = await servicioFalso(t).breakdown(ORG, 'loanPayments');
    expect(cuotas.entries[0].label).toBe('REF-0091');

    const capital = await servicioFalso(t).breakdown(ORG, 'contributionsCapital');
    expect(capital.entries[0].label).toBe('Capital inicial');
  });

  it('una venta por encargo sin nota dice que es por encargo', async () => {
    const t = tablasCompletas();
    t.sale = [
      { id: 'v2', organizationId: ORG, date: new Date('2026-09-05'), amount: '50', kind: 'ENCARGO', note: null, source: 'MANUAL' },
    ];
    t.payment = [];

    const r = await servicioFalso(t).breakdown(ORG, 'collected');

    expect(r.entries[0].label).toBe('Venta por encargo');
  });

  /**
   * El `id` del asiento es OPCIONAL en el motor. Si alguna vez un `select` se
   * angosta y deja de traerlo, el desplegable tiene que seguir mostrando la
   * plata —sin etiqueta— en vez de romperse: el número es lo importante.
   */
  it('un asiento sin id no rompe el serializador: sale "Sin detalle"', async () => {
    const t = tablasCompletas();
    t.sale = [
      { id: undefined, organizationId: ORG, date: new Date('2026-09-01'), amount: '100', kind: 'COUNTER', note: null, source: 'MANUAL' },
    ];
    t.payment = [];

    const r = await servicioFalso(t).breakdown(ORG, 'collected');

    expect(r.entries).toEqual([
      { date: '2026-09-01', amount: 100, label: 'Sin detalle', source: 'MANUAL' },
    ]);
  });

  it('una categoría sin movimientos devuelve la lista vacía y total cero', async () => {
    const t = tablasCompletas();
    t.loanPayment = [];

    const r = await servicioFalso(t).breakdown(ORG, 'loanPayments');

    expect(r).toEqual({ category: 'loanPayments', total: 0, entries: [] });
  });
});

/**
 * ELEGIR LA DEUDA DESTINO DEL FALTANTE.
 *
 * El dueño puede decir "este faltante va contra ESTA deuda" en vez de dejar
 * que se reparta por el orden configurado. Toca plata y toca una deuda pedida
 * POR ID desde el cliente, así que es superficie de IDOR.
 *
 * ⚠️ La validación NO es una lista de chequeos sobre la deuda pedida: la
 * destino tiene que ser MIEMBRO de la lista que el servidor ya deriva (la
 * organización, la contraparte de la CUENTA, hasta la fecha del conteo). Lo
 * que prueba cada rechazo de abajo es que esa lista es la única puerta; por
 * eso cada uno viene con su test HERMANO que comprueba que la misma fila SÍ
 * es alcanzable cuando se la pide legítimamente. Sin el hermano, un `[]` por
 * "el mock no tenía la fila" se leería como "el scope la filtró" y el test
 * pasaría con y sin la protección.
 */
describe('Caja — la deuda destino del faltante', () => {
  /**
   * Dos negocios, dos contrapartes y deudas en tres posiciones distintas
   * (antes del conteo, después del conteo, de otra contraparte, de otra
   * organización). Los montos están elegidos para que el reparto con destino
   * y el reparto FIFO den listas DISTINTAS: si dieran lo mismo, el test no
   * distinguiría "se respetó la elección" de "se ignoró".
   */
  const tablas = (): Tablas => ({
    counterparty: [
      { id: 'cp1', organizationId: ORG, name: 'Propietario', kind: 'OWNER', active: true, isDefault: true },
      { id: 'cp2', organizationId: ORG, name: 'Socia', kind: 'PARTNER', active: true, isDefault: false },
      { id: 'cp-B', organizationId: OTHER_ORG, name: 'Dueño B', kind: 'OWNER', active: true, isDefault: true },
    ],
    settings: [
      { organizationId: ORG, debtApplicationOrder: 'OLDEST_FIRST' },
      { organizationId: OTHER_ORG, debtApplicationOrder: 'OLDEST_FIRST' },
    ],
    cashAccount: [
      { id: 'acc1', organizationId: ORG, name: 'Binance', currency: 'USD', shared: true, sharedWithId: 'cp1', autoAttributeShortfall: true, isDefault: true },
      { id: 'acc2', organizationId: ORG, name: 'Banco de la socia', currency: 'USD', shared: true, sharedWithId: 'cp2', autoAttributeShortfall: true, isDefault: false },
      { id: 'acc-B', organizationId: OTHER_ORG, name: 'Caja B', currency: 'USD', shared: true, sharedWithId: 'cp-B', autoAttributeShortfall: true, isDefault: true },
    ],
    loan: [],
    payment: [],
    loanPayment: [],
    debtApplication: [],
    sale: [
      { id: 'v1', organizationId: ORG, date: new Date('2026-09-01'), amount: '200', kind: 'COUNTER', note: null, source: 'MANUAL' },
      { id: 'v-B', organizationId: OTHER_ORG, date: new Date('2026-09-01'), amount: '100', kind: 'COUNTER', note: null, source: 'MANUAL' },
    ],
    expense: [
      { id: 'g-vieja', organizationId: ORG, date: new Date('2026-08-01'), amount: '30', counterpartyId: 'cp1', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Cinta', source: 'MANUAL' },
      { id: 'g-nueva', organizationId: ORG, date: new Date('2026-09-20'), amount: '50', counterpartyId: 'cp1', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Tornillos', source: 'MANUAL' },
      { id: 'g-futura', organizationId: ORG, date: new Date('2026-10-20'), amount: '70', counterpartyId: 'cp1', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Boquillas', source: 'MANUAL' },
      { id: 'g-ajena', organizationId: OTHER_ORG, date: new Date('2026-08-10'), amount: '40', counterpartyId: 'cp-B', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Gasto del otro negocio', source: 'MANUAL' },
      // Lo puso la SOCIA: es deuda con ella, no con el propietario.
      { id: 'g-socia', organizationId: ORG, date: new Date('2026-08-02'), amount: '40', counterpartyId: 'cp2', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Filtro', source: 'MANUAL' },
    ],
    ownerMovement: [
      { id: 'mv-cp2', organizationId: ORG, date: new Date('2026-08-05'), kind: 'CONTRIBUTION', amount: '100', concept: 'Aporte de la socia', note: null, counterpartyId: 'cp2', refundable: true, source: 'MANUAL', cashReconciliationId: null },
    ],
    cashReconciliation: [
      // Esperado 300 (200 de venta + 100 de aporte), real 280−60 = 220: faltan 80.
      { id: 'r1', organizationId: ORG, accountId: 'acc1', date: new Date('2026-09-30T00:00:00Z'), status: 'DRAFT', totalAmount: '280', personalAmount: '60', currency: 'USD', rate: null, totalUsd: null, personalUsd: null, expectedUsd: null, differenceUsd: null, explanation: null, note: null, source: 'MANUAL', confirmedAt: null, voidedAt: null, adjustment: null },
      // La misma plata, pero la cuenta se comparte con la SOCIA.
      { id: 'r2', organizationId: ORG, accountId: 'acc2', date: new Date('2026-09-30T00:00:00Z'), status: 'DRAFT', totalAmount: '280', personalAmount: '60', currency: 'USD', rate: null, totalUsd: null, personalUsd: null, expectedUsd: null, differenceUsd: null, explanation: null, note: null, source: 'MANUAL', confirmedAt: null, voidedAt: null, adjustment: null },
      // Conteo de fin de octubre: acá el gasto del 20/10 YA es una deuda válida.
      { id: 'r3', organizationId: ORG, accountId: 'acc1', date: new Date('2026-10-31T00:00:00Z'), status: 'DRAFT', totalAmount: '180', personalAmount: '0', currency: 'USD', rate: null, totalUsd: null, personalUsd: null, expectedUsd: null, differenceUsd: null, explanation: null, note: null, source: 'MANUAL', confirmedAt: null, voidedAt: null, adjustment: null },
      // Esperado 100, real 60: faltan 40, que es justo lo que puso el dueño B.
      { id: 'r-B', organizationId: OTHER_ORG, accountId: 'acc-B', date: new Date('2026-09-30T00:00:00Z'), status: 'DRAFT', totalAmount: '60', personalAmount: '0', currency: 'USD', rate: null, totalUsd: null, personalUsd: null, expectedUsd: null, differenceUsd: null, explanation: null, note: null, source: 'MANUAL', confirmedAt: null, voidedAt: null, adjustment: null },
    ],
  });

  const confirmar = (
    t: Tablas,
    org: string,
    id: string,
    target?: { targetSource: string; targetSourceId: string },
  ) =>
    servicioFalso(t).confirm(
      org,
      id,
      CashReconciliationConfirmSchema.parse({ attributeShortfall: true, ...target }),
      'user-1',
    );

  // ---------- rechazos: la destino no es miembro de la lista derivada ----------

  it('una deuda de OTRA organización se rechaza: 400', async () => {
    await expect(
      confirmar(tablas(), ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-ajena' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('…y su HERMANO: ese mismo gasto SÍ es alcanzable para su propio negocio', async () => {
    const t = tablas();
    await confirmar(t, OTHER_ORG, 'r-B', { targetSource: 'EXPENSE', targetSourceId: 'g-ajena' });

    expect(t.debtApplication).toEqual([
      expect.objectContaining({ organizationId: OTHER_ORG, expenseId: 'g-ajena', amount: 40 }),
    ]);
  });

  it('una deuda de OTRA contraparte se rechaza: 400', async () => {
    // El aporte es de la socia; la cuenta de r1 se comparte con el propietario.
    await expect(
      confirmar(tablas(), ORG, 'r1', { targetSource: 'MOVEMENT', targetSourceId: 'mv-cp2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('…y su HERMANO: en la cuenta que SÍ se comparte con ella, el aporte se aplica', async () => {
    const t = tablas();
    await confirmar(t, ORG, 'r2', { targetSource: 'MOVEMENT', targetSourceId: 'mv-cp2' });

    expect(t.debtApplication).toEqual([
      expect.objectContaining({ obligationMovementId: 'mv-cp2', amount: 80 }),
    ]);
  });

  it('una deuda POSTERIOR a la fecha del conteo se rechaza: 400', async () => {
    await expect(
      confirmar(tablas(), ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-futura' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('…y su HERMANO: en el conteo de fin de octubre esa misma deuda ya es elegible', async () => {
    const t = tablas();
    await confirmar(t, ORG, 'r3', { targetSource: 'EXPENSE', targetSourceId: 'g-futura' });

    // Faltan 120: la elegida se lleva sus 70 y el resto va de la más antigua.
    expect(t.debtApplication.map((a) => [a.expenseId, a.amount])).toEqual([
      ['g-futura', 70],
      ['g-vieja', 30],
      ['g-nueva', 20],
    ]);
  });

  it('un id inventado se rechaza: 400, y no escribe nada', async () => {
    const t = tablas();

    await expect(
      confirmar(t, ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'no-existe' }),
    ).rejects.toThrow(BadRequestException);

    expect(t.ownerMovement).toHaveLength(1); // solo el aporte de la socia
    expect(t.debtApplication).toEqual([]);
    expect(t.cashReconciliation.find((c) => c.id === 'r1')).toMatchObject({ status: 'DRAFT' });
  });

  it('el ORIGEN es parte de la identidad: el id de un gasto no pasa como movimiento', async () => {
    await expect(
      confirmar(tablas(), ORG, 'r1', { targetSource: 'MOVEMENT', targetSourceId: 'g-vieja' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('elegir destino en una conciliación que NO va a atribuir se rechaza en vez de ignorarse', async () => {
    const t = tablas();
    const cuenta = t.cashAccount.find((a) => a.id === 'acc1');
    if (cuenta) cuenta.autoAttributeShortfall = false;

    await expect(
      confirmar(t, ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-vieja' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ---------- el camino feliz ----------

  it('la elegida cobra primero y el remanente sigue el orden configurado', async () => {
    const t = tablas();
    await confirmar(t, ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-nueva' });

    expect(t.debtApplication.map((a) => [a.expenseId, a.amount])).toEqual([
      ['g-nueva', 50],
      ['g-vieja', 30],
    ]);
  });

  it('SIN destino el reparto es el de siempre: FIFO, de la más antigua', async () => {
    const t = tablas();
    await confirmar(t, ORG, 'r1');

    expect(t.debtApplication.map((a) => [a.expenseId, a.amount])).toEqual([
      ['g-vieja', 30],
      ['g-nueva', 50],
    ]);
  });

  it('con destino, confirmar sigue siendo idempotente: dos veces es 409 y un solo ajuste', async () => {
    const t = tablas();
    const destino = { targetSource: 'EXPENSE', targetSourceId: 'g-nueva' };

    await confirmar(t, ORG, 'r1', destino);
    await expect(confirmar(t, ORG, 'r1', destino)).rejects.toThrow(ConflictException);

    expect(t.ownerMovement.filter((m) => m.cashReconciliationId === 'r1')).toHaveLength(1);
    expect(t.debtApplication).toHaveLength(2);
  });

  it('anular revierte el ajuste elegido y deja la fila en el historial', async () => {
    const t = tablas();
    await confirmar(t, ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-nueva' });
    await servicioFalso(t).voidReconciliation(ORG, 'r1');

    expect(t.ownerMovement.filter((m) => m.cashReconciliationId === 'r1')).toEqual([]);
    expect(t.cashReconciliation.find((c) => c.id === 'r1')).toMatchObject({ status: 'VOID' });
  });

  // ---------- la previsualización, de solo lectura ----------

  describe('GET /cash/reconciliations/:id/plan', () => {
    const plan = (t: Tablas, org: string, id: string, q: Record<string, unknown> = {}) =>
      servicioFalso(t).shortfallPlan(org, id, CashShortfallPlanQuerySchema.parse(q));

    it('devuelve el reparto con la deuda elegida SIN escribir nada', async () => {
      const t = tablas();
      const r = await plan(t, ORG, 'r1', { targetSource: 'EXPENSE', targetSourceId: 'g-nueva' });

      expect(r.plan?.applications.map((a) => [a.sourceId, a.amount])).toEqual([
        ['g-nueva', 50],
        ['g-vieja', 30],
      ]);
      expect(r.plan?.leftover).toBe(0);
      expect(t.debtApplication).toEqual([]);
      expect(t.ownerMovement).toHaveLength(1);
      expect(t.cashReconciliation.find((c) => c.id === 'r1')).toMatchObject({ status: 'DRAFT' });
    });

    it('sin destino previsualiza el reparto por el orden configurado', async () => {
      const r = await plan(tablas(), ORG, 'r1');

      expect(r.plan?.applications.map((a) => a.sourceId)).toEqual(['g-vieja', 'g-nueva']);
    });

    it('la previsualización y lo que escribe confirmar son el MISMO reparto', async () => {
      const destino = { targetSource: 'EXPENSE', targetSourceId: 'g-futura' };
      const previo = await plan(tablas(), ORG, 'r3', destino);

      const t = tablas();
      await confirmar(t, ORG, 'r3', destino);

      expect(t.debtApplication.map((a) => [a.expenseId, a.amount])).toEqual(
        previo.plan?.applications.map((a) => [a.sourceId, a.amount]),
      );
    });

    it('ofrece las deudas ELEGIBLES, filtradas como las filtra confirmar', async () => {
      const r = await plan(tablas(), ORG, 'r1');

      // g-futura es posterior al conteo; mv-cp2 y g-socia son de la socia: el
      // servidor las va a ignorar, así que la pantalla tampoco puede ofrecerlas.
      // ⚠️ g-socia es la prueba de que el filtro mira la CONTRAPARTE: si
      // tomara cualquier gasto puesto por alguien, el faltante de la cuenta
      // del propietario se iría a cancelar deuda de ella.
      expect(r.obligations.map((o) => o.sourceId)).toEqual(['g-vieja', 'g-nueva']);
      expect(r.differenceUsd).toBe(-80);
      expect(r.kind).toBe('SHORT');
      expect(r.willAttribute).toBe(true);
    });

    it('una destino inválida es 400 también acá: la pantalla no promete lo imposible', async () => {
      for (const malo of [
        { targetSource: 'EXPENSE', targetSourceId: 'g-ajena' },
        { targetSource: 'EXPENSE', targetSourceId: 'g-futura' },
        { targetSource: 'MOVEMENT', targetSourceId: 'mv-cp2' },
        { targetSource: 'EXPENSE', targetSourceId: 'no-existe' },
      ]) {
        await expect(plan(tablas(), ORG, 'r1', malo)).rejects.toThrow(BadRequestException);
      }
    });

    it('una conciliación de otra organización no se previsualiza: 404', async () => {
      await expect(plan(tablas(), ORG, 'r-B')).rejects.toThrow(NotFoundException);
    });
  });
});

/**
 * La deuda destino llega por la red. Lo único que frena un origen inventado es
 * la validación en tiempo de ejecución, y se prueba contra el pipe REAL: un
 * mock del pipe probaría el mock.
 */
describe('La deuda destino muere en el PIPE, no en el servicio', () => {
  const pipeBody = new ZodValidationPipe(CashReconciliationConfirmSchema);
  const pipeQuery = new ZodValidationPipe(CashShortfallPlanQuerySchema);

  it('un targetSource fuera del enum es 400', () => {
    for (const malo of ['SALE', 'expense', '', 'EXPENSE; drop', 'PAYMENT']) {
      expect(() =>
        pipeBody.transform({ attributeShortfall: true, targetSource: malo, targetSourceId: 'g1' }),
      ).toThrow(BadRequestException);
      expect(() => pipeQuery.transform({ targetSource: malo, targetSourceId: 'g1' })).toThrow(
        BadRequestException,
      );
    }
  });

  it('medio destino tampoco pasa', () => {
    expect(() => pipeBody.transform({ targetSourceId: 'g1' })).toThrow(BadRequestException);
    expect(() => pipeQuery.transform({ targetSource: 'EXPENSE' })).toThrow(BadRequestException);
  });

  it('los tres orígenes de verdad pasan', () => {
    for (const bueno of ['EXPENSE', 'LOAN_PAYMENT', 'MOVEMENT']) {
      expect(pipeQuery.transform({ targetSource: bueno, targetSourceId: 'x' })).toMatchObject({
        targetSource: bueno,
      });
    }
  });

  it('confirmar valida el body con ZodValidationPipe (metadata real de Nest)', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'confirm') as
      | Record<string, { index: number; data?: string; pipes: unknown[] }>
      | undefined;
    const body = Object.entries(meta ?? {}).find(([clave]) => clave.startsWith('3:'));

    if (!body) throw new Error('falta @Body(new ZodValidationPipe(...)) en confirm');
    expect(body[1].pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
  });

  it('la previsualización valida la query con ZodValidationPipe (metadata real de Nest)', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'shortfallPlan') as
      | Record<string, { index: number; data?: string; pipes: unknown[] }>
      | undefined;
    const query = Object.entries(meta ?? {}).find(([clave]) => clave.startsWith('4:'));

    if (!query) throw new Error('falta @Query(new ZodValidationPipe(...)) en shortfallPlan');
    expect(query[1].pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
  });
});

/**
 * A QUIÉN se le debe cada gasto, no solo de qué tipo era quien lo pagó.
 *
 * Un filtro que solo mirara "lo puso una persona" no mira a QUIÉN se le está
 * preguntando: con un socio, los gastos de los dos se mezclan y cada uno ve
 * como propia la deuda del otro. Con una sola contraparte el error es
 * invisible — y la pantalla de Gastos ya deja elegir socio.
 */
describe('CashService — a quién se le debe', () => {
  const DUENO = { id: 'cp1', name: 'Dueño de prueba', kind: 'OWNER', isDefault: true };
  const SOCIA = { id: 'cp2', name: 'Socia', kind: 'PARTNER', isDefault: false };
  const EDWIN = { id: 'cp3', name: 'Señor Edwin', kind: 'EXTERNAL_LENDER', isDefault: false };

  const gasto = (id: string, counterpartyId: string | null) => ({
    id,
    date: new Date('2026-09-23'),
    amount: '50',
    counterpartyId,
    isInvestment: false,
    category: 'CONSUMABLE',
    materialId: null,
    refundable: true,
  });

  /** El mock base, con las tres contrapartes y los gastos que se le pasen. */
  const conGastos = (gastos: ReturnType<typeof gasto>[]) => {
    const p = makePrisma();
    p.counterparty.findMany.mockResolvedValue([DUENO, SOCIA, EDWIN]);
    p.expense.findMany.mockResolvedValue(gastos);
    return p;
  };
  const deudasDelDueno = async (gastos: ReturnType<typeof gasto>[]) =>
    (await service(conGastos(gastos)).summary(ORG)).obligations.map(
      (o: { sourceId: string }) => o.sourceId,
    );

  /**
   * ⚠️ El gasto de la socia NO se le cuenta al propietario (eso se prueba en
   * el arnés de conciliación, que pregunta por UNA contraparte) pero tampoco
   * puede desaparecer: `summary()` recorre todos los bolsillos. Antes se le
   * atribuía al propietario, que era mentira pero al menos se veía.
   */
  it('el gasto de la SOCIA sigue estando en la caja, no se pierde', async () => {
    expect(await deudasDelDueno([gasto('g-socia', SOCIA.id)])).toEqual(['g-socia']);
  });

  it('el gasto del PROPIETARIO también', async () => {
    expect(await deudasDelDueno([gasto('g-dueno', DUENO.id)])).toEqual(['g-dueno']);
  });

  it('un gasto que puso la CAJA no es deuda con nadie', async () => {
    expect(await deudasDelDueno([gasto('g-caja', null)])).toEqual([]);
  });

  it('lo que pagó el prestamista tampoco es deuda con el propietario', async () => {
    expect(await deudasDelDueno([gasto('g-edwin', EDWIN.id)])).toEqual([]);
  });

  /**
   * El saldo NO se mueve por esto: un gasto de la socia sale de la caja igual
   * que uno del propietario. Lo que cambia es a quién se le debe.
   */
  it('el saldo del negocio es el mismo lo haya puesto el dueño o la socia', async () => {
    const [conDueno, conSocia] = await Promise.all(
      [DUENO.id, SOCIA.id].map(async (cp) =>
        (await service(conGastos([gasto('g', cp)])).summary(ORG)).balance.balance,
      ),
    );

    expect(conSocia).toBe(conDueno);
  });
});

/**
 * EL SALDO HASTA UNA FECHA — lo que hace posible la cadena del Dashboard
 * ("venías con $X · este mes $Y · te queda $Z").
 *
 * El motor ya sabía recortar por fecha (`businessCash(ledger, hasta)`); lo que
 * faltaba era exponerlo. Antes de esto, el Dashboard calculaba el "este mes"
 * por su propio camino —cobrado del mes menos gastos del mes— y daba −61.20 al
 * lado de un saldo de 102.83: ignoraba los aportes del dueño, las devoluciones
 * y las compras a crédito. Dos definiciones de "octubre" en una pantalla.
 *
 * Los números son los de `tablasCompletas()`, a mano:
 *   hasta el 04/09 → 100 + 30 cobrado − 10 gasto − 25 filamento = 95
 *   hasta el 05/09 → entra la venta de 50 del día 5 = 145
 *   toda la historia = −340 (el resto de los asientos son del 06 al 12)
 */
describe('CashService.balanceAt — el saldo HASTA una fecha', () => {
  it('cuenta hasta ese día INCLUSIVE y no mira lo que viene después', async () => {
    const r = await servicioFalso(tablasCompletas()).balanceAt(ORG, '2026-09-05');

    expect(r.balance.balance).toBe(145);
  });

  /**
   * ⚠️ Este es el que le da dientes al de arriba: si `balanceAt` ignorara la
   * fecha devolvería −340 y los 145 serían una coincidencia imposible de notar.
   * Clavar los dos números deja ver que son distintos a propósito.
   */
  it('el saldo de TODA la historia es otro número: la fecha recorta de verdad', async () => {
    const t = tablasCompletas();
    const [hasta, todo] = await Promise.all([
      servicioFalso(t).balanceAt(ORG, '2026-09-05'),
      servicioFalso(t).summary(ORG),
    ]);

    expect(todo.balance.balance).toBe(-340);
    expect(hasta.balance.balance).not.toBe(todo.balance.balance);
  });

  it('un día más atrás deja afuera la venta de ese día', async () => {
    const r = await servicioFalso(tablasCompletas()).balanceAt(ORG, '2026-09-04');

    expect(r.balance.balance).toBe(95);
    expect(r.balance.collected).toBe(130);
    expect(r.balance.filament).toBe(25);
    // La impresora es del 06: todavía no salió de la caja.
    expect(r.balance.equipment).toBe(0);
  });

  it('antes del primer movimiento el negocio arranca en cero', async () => {
    const r = await servicioFalso(tablasCompletas()).balanceAt(ORG, '2026-08-31');

    expect(r.balance.balance).toBe(0);
  });

  it('devuelve la fecha que se pidió, para que la pantalla sepa de qué día habla', async () => {
    const r = await servicioFalso(tablasCompletas()).balanceAt(ORG, '2026-09-05');

    expect(r.at).toBe('2026-09-05');
  });

  /**
   * LA CADENA CIERRA de punta a punta: el saldo inicial que devuelve este
   * endpoint, más lo que el periodo movió, da el saldo final del resumen. Es la
   * invariante que la pantalla promete (`Z = X + Y`), medida sobre los dos
   * números que de verdad viajan por la red.
   */
  it('saldo inicial + lo del periodo = saldo final', async () => {
    const t = tablasCompletas();
    const antes = (await servicioFalso(t).balanceAt(ORG, '2026-09-04')).balance.balance;
    const final = (await servicioFalso(t).summary(ORG)).balance.balance;

    expect(antes).toBe(95);
    expect(final).toBe(-340);
    expect(antes + (final - antes)).toBe(final);
  });
});

/**
 * AISLAMIENTO. El saldo a una fecha arma el ledger entero del negocio: un
 * escape de scope acá no se nota como una fila de más sino como un número que
 * incluye la plata del negocio de al lado.
 */
describe('CashService.balanceAt — una organización ajena (IDOR)', () => {
  /** ORG está vacía; OTHER_ORG tiene una venta de 999. */
  const tablas = (): Tablas => ({
    counterparty: [
      { id: 'cp-A', organizationId: ORG, name: 'Propietario', kind: 'OWNER', active: true, isDefault: true },
      { id: 'cp-B', organizationId: OTHER_ORG, name: 'Dueño B', kind: 'OWNER', active: true, isDefault: true },
    ],
    settings: [{ organizationId: ORG, debtApplicationOrder: 'OLDEST_FIRST' }],
    cashAccount: [], cashReconciliation: [], loan: [],
    expense: [], loanPayment: [], ownerMovement: [], debtApplication: [], payment: [],
    sale: [
      {
        id: 'v-ajena', organizationId: OTHER_ORG, date: new Date('2026-09-01'),
        amount: '999', kind: 'COUNTER', note: 'Venta del otro negocio', source: 'MANUAL',
      },
    ],
  });

  it('el saldo de una organización no incluye la plata de la otra', async () => {
    const r = await servicioFalso(tablas()).balanceAt(ORG, '2026-09-30');

    expect(r.balance.balance).toBe(0);
    expect(r.balance.collected).toBe(0);
  });

  /**
   * ⚠️ EL HERMANO que vuelve honesto al de arriba: prueba que la venta ES
   * ALCANZABLE en este mock cuando el `where` la incluye. Sin él, el 0 podría
   * significar "no había nada que devolver" y pasaría igual con el filtro
   * quitado — que es como se perdió la fase 2.
   */
  it('el mock modela la base: pedido COMO la otra organización, el saldo SÍ es 999', async () => {
    const r = await servicioFalso(tablas()).balanceAt(OTHER_ORG, '2026-09-30');

    expect(r.balance.balance).toBe(999);
  });

  it('todas las lecturas del saldo van con el organizationId', async () => {
    const p = baseFalsa(tablas());
    await new CashService(p as never).balanceAt(ORG, '2026-09-30');

    for (const m of [p.sale, p.payment, p.expense, p.loanPayment, p.ownerMovement, p.debtApplication]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
      );
    }
  });
});

/**
 * LA FECHA LLEGA DEL CLIENTE, así que muere en el PIPE.
 *
 * ⚠️ Una fecha inválida NO puede devolver el saldo de toda la historia como si
 * nada: eso es peor que un error, porque el número que sale parece bueno. Y un
 * regex de AAAA-MM-DD a secas no alcanza — `2026-13-01` lo pasa y, como el
 * recorte compara TEXTO, deja entrar todo 2026 y el saldo "hasta esa fecha"
 * vuelve a ser el saldo entero. Por eso el día tiene que existir de verdad.
 */
describe('GET /cash/balance — la fecha es un día real o es 400', () => {
  const pipe = new ZodValidationPipe(CashBalanceQuerySchema);

  it('un día que no existe en el calendario es 400', () => {
    for (const basura of ['2026-13-01', '2026-00-10', '2026-02-30', '2026-10-32', '2026-02-29']) {
      expect(() => pipe.transform({ at: basura })).toThrow(BadRequestException);
    }
  });

  it('cualquier cosa que no sea AAAA-MM-DD es 400', () => {
    for (const basura of ['', 'hoy', '2026-10', '2026/10/10', '10-10-2026', '2026-10-10T00:00:00Z']) {
      expect(() => pipe.transform({ at: basura })).toThrow(BadRequestException);
    }
  });

  it('sin fecha es 400: faltarla no puede valer por "toda la historia"', () => {
    expect(() => pipe.transform({})).toThrow(BadRequestException);
    expect(() => pipe.transform({ at: null })).toThrow(BadRequestException);
  });

  it('un día real pasa, también el 29 de febrero de un año bisiesto', () => {
    expect(pipe.transform({ at: '2026-10-10' })).toMatchObject({ at: '2026-10-10' });
    expect(pipe.transform({ at: '2024-02-29' })).toMatchObject({ at: '2024-02-29' });
  });

  it('la ruta valida la query con ZodValidationPipe (metadata real de Nest)', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'balanceAt') as
      | Record<string, { index: number; data?: string; pipes: unknown[] }>
      | undefined;
    const args = Object.values(meta ?? {});

    if (!args.length) throw new Error('falta el método balanceAt en el controlador');
    expect(args.some((a) => a?.pipes?.some((pp) => pp instanceof ZodValidationPipe))).toBe(true);
  });
});

/**
 * EL 30 DE FEBRERO MUERE EN EL PIPE DE LAS PUERTAS DE ESCRITURA (Tarea 8.2).
 *
 * El regex de `FECHA` validaba la forma y no el calendario: `'2026-02-30'`
 * pasaba y Prisma lo guardaba **corrido al 2 de marzo**. Es dinero y es una
 * entrada del cliente, así que el test ejecuta el ataque por las DOS puertas de
 * escritura y, aparte, fija por metadata real de Nest que la ruta tenga el pipe
 * puesto: contra el schema pelado no se detecta a quien saque el pipe.
 *
 * ⚠️ Cada rechazo viene con su **hermano alcanzable**: el mismo cuerpo con un
 * día real tiene que seguir entrando, o una guarda que rechace todo pasaría.
 */
describe('Las puertas de escritura de caja rechazan un día que no existe', () => {
  const DIAS_INVENTADOS = ['2026-02-30', '2026-02-29', '2026-13-01', '2026-11-31', '2026-10-32'];

  describe('POST /cash/movements', () => {
    const pipe = new ZodValidationPipe(OwnerMovementCreateSchema);
    const cuerpo = (date: string) => ({
      date,
      kind: 'CONTRIBUTION',
      amount: 50,
      concept: 'Puso plata de su bolsillo',
    });

    it('un día inventado es 400', () => {
      for (const basura of DIAS_INVENTADOS) {
        expect(() => pipe.transform(cuerpo(basura))).toThrow(BadRequestException);
      }
    });

    it('el hermano alcanzable: con un día real el movimiento entra', () => {
      expect(pipe.transform(cuerpo('2026-10-10'))).toMatchObject({ date: '2026-10-10', amount: 50 });
      expect(pipe.transform(cuerpo('2024-02-29'))).toMatchObject({ date: '2024-02-29' });
    });

    it('la ruta valida el body con ZodValidationPipe (metadata real de Nest)', () => {
      const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'addMovement') as
        | Record<string, { index: number; data?: string; pipes: unknown[] }>
        | undefined;
      const args = Object.values(meta ?? {});

      if (!args.length) throw new Error('falta el método addMovement en el controlador');
      expect(args.some((a) => a?.pipes?.some((pp) => pp instanceof ZodValidationPipe))).toBe(true);
    });
  });

  describe('PUT /cash/reconciliations', () => {
    const pipe = new ZodValidationPipe(CashReconciliationUpsertSchema);
    const cuerpo = (date: string) => ({ accountId: 'acc-1', date, totalAmount: 120 });

    it('un día inventado es 400', () => {
      for (const basura of DIAS_INVENTADOS) {
        expect(() => pipe.transform(cuerpo(basura))).toThrow(BadRequestException);
      }
    });

    it('el hermano alcanzable: con un día real la conciliación entra', () => {
      expect(pipe.transform(cuerpo('2026-10-10'))).toMatchObject({
        date: '2026-10-10',
        totalAmount: 120,
      });
    });

    it('la ruta valida el body con ZodValidationPipe (metadata real de Nest)', () => {
      const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CashController, 'saveReconciliation') as
        | Record<string, { index: number; data?: string; pipes: unknown[] }>
        | undefined;
      const args = Object.values(meta ?? {});

      if (!args.length) throw new Error('falta el método saveReconciliation en el controlador');
      expect(args.some((a) => a?.pipes?.some((pp) => pp instanceof ZodValidationPipe))).toBe(true);
    });
  });
});
