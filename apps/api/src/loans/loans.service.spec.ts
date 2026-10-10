import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LoanCreateSchema, LoanPaymentCreateSchema, LoanPaymentVoidSchema } from '@calc3d/shared';
import { LoansService } from './loans.module';
import { PurchaseInvoicesService } from '../purchase-invoices/purchase-invoices.module';
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

/**
 * Las facturas llegan por la `PurchaseInvoicesService` **de verdad**, no por un
 * mock que devuelva saldos escritos a mano.
 *
 * ⚠️ Es la diferencia entre probar el agrupador y probar la pantalla: el saldo
 * de una factura y la regla del abono anulado viven en `invoiceTotals`, y un
 * mock con `saldo: 40` ya adentro pasaría igual si alguien rompiera esa regla
 * en el camino. Así, un abono anulado contado como pagado tumba un test.
 */
const facturasFalsas = (facturas: Record<string, unknown>[] = []) =>
  new PurchaseInvoicesService(
    {
      purchaseInvoice: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            facturas.filter((f) =>
              Object.entries(where).every(([k, v]) => (f as Record<string, unknown>)[k] === v),
            ),
          ),
        ),
      },
    } as never,
    {} as never,
  );

const service = (p: unknown, c: unknown = cashFalso(), f: unknown = facturasFalsas()) =>
  new LoansService(p as never, c as never, f as never);

/** Una factura cruda, como sale de Prisma: sin cuentas hechas. */
const FACTURA_CRUDA = {
  id: 'f1',
  organizationId: ORG,
  date: d('2026-10-09'),
  expectedAt: null,
  reference: null,
  notes: null,
  supplier: { id: 'prov-a', name: 'StratoFill' },
  voidedAt: null,
  voidReason: null,
  source: 'MANUAL',
  lines: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
};

const lineaCruda = (quantity: number, unitPrice: number) => ({
  id: `linea-${quantity}x${unitPrice}`,
  materialId: null,
  material: null,
  printerId: null,
  printer: null,
  nombreNuevo: null,
  nuevoTipo: null,
  quantity,
  unitPrice,
  received: 0,
  /**
   * Las recepciones de la línea: sus gastos, que el `include` de Compras trae.
   * Acá siempre vacías porque nada llegó todavía — y una línea sin recibir vale
   * lo PEDIDO, que es lo único que mira la deuda con el proveedor.
   */
  expenses: [] as Record<string, unknown>[],
});

const abonoCrudo = (amount: number, voidedAt: Date | null = null) => ({
  id: `abono-${amount}`,
  date: d('2026-10-09'),
  amount,
  counterpartyId: null,
  counterparty: null,
  accountId: null,
  note: null,
  voidedAt,
  voidReason: null,
});

const facturaCruda = (over: Record<string, unknown> = {}) => ({ ...FACTURA_CRUDA, ...over });

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
  counterpartyId: null,
  counterparty: null,
  accountId: null,
  refundable: true,
  source: 'MANUAL',
  voidedAt: null,
  voidReason: null,
  ...over,
});

const NUEVO_PAGO = { date: '2026-09-01', amount: 100, generatesDebt: true };

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
      service(p).addPayment(ORG, 'l1', LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, counterpartyId: 'cp-ajena' })),
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
      LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, counterpartyId: 'cp1', generatesDebt: false }),
    );

    expect(p._tablas.loanPayment[0].refundable).toBe(false);
  });

  it('si lo puso una persona y se indica que SÍ, genera deuda', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], counterparties: [{ id: 'cp1', organizationId: ORG }] });

    await service(p).addPayment(
      ORG,
      'l1',
      LoanPaymentCreateSchema.parse({ ...NUEVO_PAGO, counterpartyId: 'cp1', generatesDebt: true }),
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

describe('LoansService — las tres deudas', () => {
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

  /**
   * ⚠️ **EL TOTAL DE LA PANTALLA ES LA SUMA DE SUS TRES BLOQUES.** Números a
   * mano: un total que no cuadra con las partes que tiene debajo es peor que no
   * tener total, porque se lee como la verdad y nadie va a sumar a ojo.
   */
  it('el total es la suma de los tres bloques, al centavo', async () => {
    // Prestamista: capital 1000 − un pago de 250 = 750.
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 250 })] });
    // Propietario: 100 (lo que devuelve el CashService falso).
    // Proveedores: una factura de 2 × 12.50 = 25, con un abono de 10 → 15.
    const facturas = facturasFalsas([
      facturaCruda({ lines: [lineaCruda(2, 12.5)], payments: [abonoCrudo(10)] }),
    ]);

    const r = await service(p, cashFalso(), facturas).overview(ORG);

    expect(r.totals.prestamista).toBe(750);
    expect(r.totals.propietario).toBe(100);
    expect(r.totals.proveedores).toBe(15);
    // 750 + 100 + 15 = 865.
    expect(r.totals.total).toBe(865);
    expect(r.totals.total).toBe(
      r.totals.prestamista + r.totals.propietario + r.totals.proveedores,
    );
  });

  it('el bloque de proveedores sale de las facturas, proveedor por proveedor', async () => {
    const facturas = facturasFalsas([
      facturaCruda({ id: 'f1', lines: [lineaCruda(1, 40)], payments: [] }),
      facturaCruda({
        id: 'f2',
        supplier: { id: 'prov-b', name: 'Filamentos del Sur' },
        lines: [lineaCruda(1, 60)],
        payments: [abonoCrudo(20)],
      }),
    ]);

    const r = await service(baseFalsa(), cashFalso(), facturas).overview(ORG);

    // 40 a StratoFill, 40 (60 − 20) a Filamentos del Sur.
    expect(r.suppliers.total).toBe(80);
    expect(r.suppliers.groups).toHaveLength(2);
    expect(r.suppliers.groups.map((g) => g.supplierName).sort()).toEqual([
      'Filamentos del Sur',
      'StratoFill',
    ]);
  });

  it('sin facturas pendientes el bloque queda vacío y el total no se mueve', async () => {
    const p = baseFalsa({ loans: [PRESTAMO], payments: [pago({ amount: 250 })] });

    const r = await service(p).overview(ORG);

    expect(r.suppliers.groups).toHaveLength(0);
    expect(r.suppliers.total).toBe(0);
    expect(r.totals.total).toBe(850);
  });
});

describe('LoansService — las dos formas de que el número mienta', () => {
  it('una factura ANULADA no se debe: no entra en el bloque ni en el total', async () => {
    const facturas = facturasFalsas([
      facturaCruda({ id: 'f1', lines: [lineaCruda(1, 40)] }),
      facturaCruda({
        id: 'f2',
        lines: [lineaCruda(1, 1000)],
        voidedAt: d('2026-10-09'),
        voidReason: 'cargada dos veces',
      }),
    ]);

    const r = await service(baseFalsa(), cashFalso(), facturas).overview(ORG);

    // Los $1000 anulados no existen: le debés 40.
    expect(r.suppliers.total).toBe(40);
    expect(r.totals.proveedores).toBe(40);
    expect(r.totals.total).toBe(140);
  });

  /**
   * ⚠️ Pasa por `invoiceTotals` de verdad: contar un abono anulado como pagado
   * tumba este test. Es la otra forma de que el número mienta, y al revés que la
   * anterior — acá la deuda tiene que VOLVER.
   */
  it('un abono ANULADO sí se vuelve a deber', async () => {
    const vigente = facturasFalsas([
      facturaCruda({ lines: [lineaCruda(1, 50)], payments: [abonoCrudo(30)] }),
    ]);
    const anulado = facturasFalsas([
      facturaCruda({ lines: [lineaCruda(1, 50)], payments: [abonoCrudo(30, d('2026-10-10'))] }),
    ]);

    const conAbono = await service(baseFalsa(), cashFalso(), vigente).overview(ORG);
    const sinAbono = await service(baseFalsa(), cashFalso(), anulado).overview(ORG);

    expect(conAbono.suppliers.total).toBe(20);
    // Anulado el abono, los 30 vuelven a deberse: 50 enteros.
    expect(sinAbono.suppliers.total).toBe(50);
    expect(sinAbono.totals.total).toBe(150);
  });

  /**
   * ⚠️ **Lo pagado DE MÁS no es deuda negativa.** No resta de lo que debés en
   * otra factura ni baja el total de la pantalla: se muestra aparte.
   */
  it('lo pagado de más se muestra aparte y NO compensa', async () => {
    const facturas = facturasFalsas([
      facturaCruda({ id: 'f1', lines: [lineaCruda(1, 50)] }),
      facturaCruda({ id: 'f2', lines: [lineaCruda(1, 10)], payments: [abonoCrudo(30)] }),
    ]);

    const r = await service(baseFalsa(), cashFalso(), facturas).overview(ORG);

    // Debe 50 y pagó 20 de más en otra factura: NO se netean a 30.
    expect(r.suppliers.total).toBe(50);
    expect(r.suppliers.aFavor).toBe(20);
    expect(r.totals.proveedores).toBe(50);
    expect(r.totals.total).toBe(150);
  });
});

describe('LoansService — el tercer bloque es de ESTA organización', () => {
  it('las facturas de otra organización no entran en la deuda', async () => {
    const facturas = facturasFalsas([
      facturaCruda({ id: 'f-ajena', organizationId: OTRA, lines: [lineaCruda(1, 999)] }),
    ]);

    const r = await service(baseFalsa(), cashFalso(), facturas).overview(ORG);

    expect(r.suppliers.total).toBe(0);
    expect(r.suppliers.groups).toHaveLength(0);
  });

  it('y esa MISMA factura sí se ve desde su propia organización', async () => {
    // Sin este hermano, el test de arriba pasaría aunque el bloque devolviera
    // siempre vacío — o sea, con y sin el filtro por organización.
    const facturas = facturasFalsas([
      facturaCruda({ id: 'f-ajena', organizationId: OTRA, lines: [lineaCruda(1, 999)] }),
    ]);

    const r = await service(baseFalsa(), cashFalso(), facturas).overview(OTRA);

    expect(r.suppliers.total).toBe(999);
  });
});
