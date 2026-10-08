import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LoanCreateSchema, LoanPaymentCreateSchema, LoanPaymentVoidSchema } from '@calc3d/shared';
import { LoansService } from './loans.module';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const ORG = 'org-A';
const OTRA = 'org-B';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Un mock que MODELA la base: filtra por TODAS las claves del `where` y escribe
 * de verdad en sus tablas.
 *
 * ⚠️ Si devolviera lo mismo pase lo que pase, un test de aislamiento pasaría con
 * y sin el scope — es lo que arruinó los specs de la fase 2 de Caja. Por eso
 * cada test de aislamiento tiene su HERMANO que comprueba que la fila sí es
 * alcanzable cuando se pide legítimamente.
 */
function baseFalsa({
  loans = [] as Record<string, unknown>[],
  payments = [] as Record<string, unknown>[],
  counterparties = [] as Record<string, unknown>[],
} = {}) {
  const tablas = { loan: loans, loanPayment: payments, counterparty: counterparties };
  const coincide = (fila: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => fila[k] === v);

  const delegado = (nombre: keyof typeof tablas) => ({
    findMany: jest.fn(({ where }: never = {} as never) =>
      Promise.resolve(tablas[nombre].filter((f) => coincide(f, where)).map((f) => ({ ...f, payments: payments.filter((p) => p.loanId === f.id) }))),
    ),
    findFirst: jest.fn(({ where }: never = {} as never) => {
      const f = tablas[nombre].find((x) => coincide(x, where));
      return Promise.resolve(f ? { ...f, payments: payments.filter((p) => p.loanId === f.id) } : null);
    }),
    create: jest.fn(({ data }: never) => {
      const fila = { id: `${nombre}-nuevo`, payments: [], ...(data as object) } as Record<string, unknown>;
      tablas[nombre].push(fila);
      return Promise.resolve(fila);
    }),
    update: jest.fn(({ where, data }: never) => {
      const f = tablas[nombre].find((x) => coincide(x, where as never));
      if (f) Object.assign(f, data);
      return Promise.resolve({ ...f, payments: [] });
    }),
    delete: jest.fn(({ where }: never) => {
      const i = tablas[nombre].findIndex((x) => coincide(x, where as never));
      if (i >= 0) tablas[nombre].splice(i, 1);
      return Promise.resolve({});
    }),
  });

  return { loan: delegado('loan'), loanPayment: delegado('loanPayment'), counterparty: delegado('counterparty'), _tablas: tablas };
}

const cashFalso = () => ({
  summary: jest.fn().mockResolvedValue({
    counterparty: { id: 'cp-owner', name: 'Propietario', kind: 'OWNER' },
    obligations: [{ source: 'EXPENSE', sourceId: 'g1', outstanding: 100 }],
    financing: { owedToOwner: 100 },
    applicationOrder: 'OLDEST_FIRST',
  }),
});

const service = (p: unknown, c: unknown = cashFalso()) => new LoansService(p as never, c as never);

const PRESTAMO = {
  id: 'l1',
  organizationId: ORG,
  name: 'Deuda impresora',
  principal: 1000,
  monthlyPayment: 100,
  paymentFrequency: 'MONTHLY',
  concept: null,
  nextDueDate: null,
  startDate: d('2026-07-14'),
  closedAt: null,
  notes: null,
  printerId: null,
  printer: null,
  counterparty: null,
};
const pago = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  organizationId: ORG,
  loanId: 'l1',
  date: d('2026-08-01'),
  amount: 250,
  reference: null,
  paidBy: 'OWNER',
  counterpartyId: null,
  accountId: null,
  refundable: true,
  source: 'MANUAL',
  voidedAt: null,
  voidReason: null,
  ...over,
});

const NUEVO_PAGO = { date: '2026-09-01', amount: 100, paidBy: 'BUSINESS' as const, generatesDebt: true };

describe('LoansService — seguridad', () => {
  it('un acreedor de OTRA organización se rechaza', async () => {
    const p = baseFalsa({ counterparties: [{ id: 'cp-ajena', organizationId: OTRA, name: 'Ajena' }] });

    await expect(
      service(p).create(ORG, LoanCreateSchema.parse({ name: 'X', principal: 100, counterpartyId: 'cp-ajena' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Y no quedó un préstamo a medio crear.
    expect(p._tablas.loan).toHaveLength(0);
  });

  it('el mock modela la base: esa misma contraparte SÍ sirve para su propio negocio', async () => {
    // Sin este hermano, el test de arriba pasaría aunque el mock devolviera
    // null siempre — o sea, con y sin el scope.
    const p = baseFalsa({ counterparties: [{ id: 'cp-ajena', organizationId: OTRA, name: 'Ajena' }] });

    const l = await service(p).create(OTRA, LoanCreateSchema.parse({ name: 'X', principal: 100, counterpartyId: 'cp-ajena' }));

    expect(l.id).toBeDefined();
    expect(p._tablas.loan).toHaveLength(1);
  });

  it('quien aporta un pago también se valida contra la organización', async () => {
    const p = baseFalsa({
      loans: [PRESTAMO],
      counterparties: [{ id: 'cp-ajena', organizationId: OTRA, name: 'Ajena' }],
    });

    await expect(
      service(p).addPayment(ORG, 'l1', LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, paidBy: 'OWNER', counterpartyId: 'cp-ajena' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(p._tablas.loanPayment).toHaveLength(0);
  });

  it('anular un pago de otra organización se rechaza', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ organizationId: OTRA })] });

    await expect(
      service(p).voidPayment(ORG, 'l1', 'p1', { reason: 'me equivoqué' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(p._tablas.loanPayment[0].voidedAt).toBeNull();
  });

  it('y ese mismo pago SÍ se puede anular desde su propia organización', async () => {
    const p = baseFalsa({ loans: [{ ...PRESTAMO, organizationId: OTRA }], payments: [pago({ organizationId: OTRA })] });

    await service(p).voidPayment(OTRA, 'l1', 'p1', { reason: 'me equivoqué' });

    expect(p._tablas.loanPayment[0].voidedAt).not.toBeNull();
  });
});

describe('LoansService — el saldo no se puede romper', () => {
  it('un pago mayor que el saldo es 400 y NO escribe nada', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 900 })] });

    // Saldo 100; intento pagar 500.
    await expect(
      service(p).addPayment(ORG, 'l1', LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, amount: 500 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(p._tablas.loanPayment).toHaveLength(1);
  });

  it('pagar exactamente el saldo sí se puede', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 900 })] });

    const l = await service(p).addPayment(ORG, 'l1', LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, amount: 100 }));

    expect(l.balance).toBe(0);
    expect(l.status).toBe('PAGADO');
  });

  it('anular NO borra: el pago queda en el historial y el saldo sube', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 250 })] });

    const l = await service(p).voidPayment(ORG, 'l1', 'p1', { reason: 'cargado dos veces' });

    expect(p._tablas.loanPayment).toHaveLength(1);
    expect(l.payments).toHaveLength(1);
    expect(l.payments[0].voidReason).toBe('cargado dos veces');
    expect(l.balance).toBe(1000);
  });

  it('anular dos veces no mueve el saldo dos veces: 409', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 250 })] });
    await service(p).voidPayment(ORG, 'l1', 'p1', { reason: 'una vez' });

    await expect(
      service(p).voidPayment(ORG, 'l1', 'p1', { reason: 'otra vez' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('LoansService — que un pago genere deuda se PREGUNTA', () => {
  it('si lo pagó la caja, no genera deuda con nadie', async () => {
    const p = baseFalsa({ loans: [PRESTAMO] });

    await service(p).addPayment(ORG, 'l1', LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, generatesDebt: true }));

    // `generatesDebt: true` no alcanza: sin contraparte no hay a quién deberle.
    expect(p._tablas.loanPayment[0].refundable).toBe(false);
  });

  it('si lo puso una persona y se indica que NO, no genera deuda', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], counterparties: [{ id: 'cp1', organizationId: ORG }] });

    await service(p).addPayment(
      ORG,
      'l1',
      LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, paidBy: 'OWNER', counterpartyId: 'cp1', generatesDebt: false }),
    );

    expect(p._tablas.loanPayment[0].refundable).toBe(false);
  });

  it('si lo puso una persona y se indica que SÍ, genera deuda', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], counterparties: [{ id: 'cp1', organizationId: ORG }] });

    await service(p).addPayment(
      ORG,
      'l1',
      LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, paidBy: 'OWNER', counterpartyId: 'cp1', generatesDebt: true }),
    );

    expect(p._tablas.loanPayment[0].refundable).toBe(true);
  });
});

describe('LoansService — mass-assignment', () => {
  // Contra el pipe REAL, no un mock: es el que corre en producción.
  const pipeLoan = new ZodValidationPipe(LoanCreateSchema);
  const pipePago = new ZodValidationPipe(LoanPaymentCreateSchema);

  it('el saldo, el estado y la organización NO se pueden mandar en el body', () => {
    const dto = pipeLoan.transform(
      { name: 'X', principal: 100, balance: 0, status: 'PAGADO', organizationId: OTRA, paid: 999 },
    ) as Record<string, unknown>;

    for (const campo of ['balance', 'status', 'organizationId', 'paid']) {
      expect(dto[campo]).toBeUndefined();
    }
  });

  it('un pago tampoco puede traer su propio estado de anulación', () => {
    const dto = pipePago.transform(
      { date: '2026-09-01', amount: 10, voidedAt: '2020-01-01', refundable: true, source: 'EXCEL_IMPORT' },
    ) as Record<string, unknown>;

    for (const campo of ['voidedAt', 'refundable', 'source']) {
      expect(dto[campo]).toBeUndefined();
    }
  });

  it('anular exige un motivo', () => {
    expect(LoanPaymentVoidSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(LoanPaymentVoidSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(LoanPaymentVoidSchema.safeParse({ reason: 'duplicado' }).success).toBe(true);
  });
});

describe('LoansService — las dos deudas', () => {
  it('overview reusa CashService en vez de recalcular las obligaciones', async () => {
    const p = baseFalsa({ loans: [PRESTAMO] });
    const cash = cashFalso();

    const r = await service(p, cash).overview(ORG);

    // ⚠️ Si algún día esto recalcula por su cuenta, Caja y Préstamos van a
    // decir cosas distintas sobre la misma deuda.
    expect(cash.summary).toHaveBeenCalledWith(ORG);
    expect(r.owner.total).toBe(100);
    expect(r.owner.obligations).toHaveLength(1);
    expect(r.loans).toHaveLength(1);
  });
});
