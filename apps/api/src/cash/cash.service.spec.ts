import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  CASH_SIGN,
  CashAccountUpsertSchema,
  CashCategorySchema,
  CashReconciliationUpsertSchema,
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

  const delegado = (nombre: string) => ({
    findMany: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve((tablas[nombre] ?? []).filter((f) => coincide(f, where))),
    ),
    findFirst: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve((tablas[nombre] ?? []).find((f) => coincide(f, where)) ?? null),
    ),
    findUnique: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve((tablas[nombre] ?? []).find((f) => coincide(f, where)) ?? null),
    ),
  });

  return {
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
    settings: delegado('settings'),
  };
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
      { id: 'g1', organizationId: org, date: new Date('2026-09-02'), amount: '10', paidBy: 'BUSINESS', isInvestment: false, category: 'UTILITIES', materialId: null, refundable: false, description: 'Luz de agosto', source: 'MANUAL' },
      { id: 'g2', organizationId: org, date: new Date('2026-09-04'), amount: '25', paidBy: 'BUSINESS', isInvestment: false, category: 'MATERIAL', materialId: 'm1', refundable: false, description: 'Rollo PLA negro', source: 'EXCEL_IMPORT' },
      { id: 'g3', organizationId: org, date: new Date('2026-09-06'), amount: '600', paidBy: 'BUSINESS', isInvestment: true, category: 'EQUIPMENT', materialId: null, refundable: true, description: 'Impresora nueva', source: 'MANUAL' },
      // Lo pagó la contraparte: es gasto Y aporte a la vez (dos asientos).
      { id: 'g4', organizationId: org, date: new Date('2026-09-08'), amount: '40', paidBy: 'OWNER', isInvestment: false, category: 'CONSUMABLE', materialId: null, refundable: true, description: 'Cinta y espátulas', source: 'MANUAL' },
    ],
    loanPayment: [
      { id: 'c1', organizationId: org, date: new Date('2026-09-09'), amount: '15', paidBy: 'BUSINESS', refundable: false, reference: 'REF-0091', source: 'MANUAL' },
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
