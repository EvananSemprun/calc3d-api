import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseInvoiceLineSchema, PurchaseInvoiceUpsertSchema } from '@calc3d/shared';
import { PurchaseInvoicesService } from './purchase-invoices.module';

const ORG = 'org-A';
const OTRA = 'org-B';

/** Las fichas y contactos de las DOS organizaciones, en una sola tabla. */
const FILAS = {
  client: [
    { id: 'prov-mio', organizationId: ORG, name: 'StratoFill', type: 'SUPPLIER' },
    { id: 'cliente-mio', organizationId: ORG, name: 'Daelis', type: 'CLIENT' },
    { id: 'prov-ajeno', organizationId: OTRA, name: 'Ajeno', type: 'SUPPLIER' },
  ],
  material: [
    { id: 'mat-mio', organizationId: ORG },
    { id: 'mat-ajeno', organizationId: OTRA },
  ],
  printer: [{ id: 'imp-mia', organizationId: ORG }],
  counterparty: [
    { id: 'cp-mia', organizationId: ORG },
    { id: 'cp-ajena', organizationId: OTRA },
  ],
  cashAccount: [{ id: 'acc-mia', organizationId: ORG }],
};

/**
 * ⚠️ El mock MODELA la base: filtra por TODAS las claves del `where`. Uno que
 * devolviera siempre la fila pedida haría pasar los tests de aislamiento con y
 * sin el filtro por organización — el error de la fase 2.
 */
const coincide = (fila: Record<string, unknown>, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => fila[k] === v);

function makePrisma(factura?: Record<string, unknown>) {
  const tabla = (filas: Record<string, unknown>[]) => ({
    findFirst: jest.fn(({ where }: any) => Promise.resolve(filas.find((f) => coincide(f, where)) ?? null)),
  });
  return {
    client: tabla(FILAS.client),
    printer: tabla(FILAS.printer),
    counterparty: tabla(FILAS.counterparty),
    cashAccount: tabla(FILAS.cashAccount),
    purchaseInvoice: {
      findFirst: jest.fn(() => Promise.resolve(factura ?? null)),
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(({ data }: any) =>
        Promise.resolve({ ...FACTURA_VACIA, ...data, lines: data.lines?.create ?? [], payments: [] }),
      ),
      update: jest.fn(() => Promise.resolve(FACTURA_VACIA)),
      delete: jest.fn(() => Promise.resolve({})),
    },
    purchaseInvoiceLine: { deleteMany: jest.fn(), update: jest.fn() },
    material: {
      ...tabla(FILAS.material),
      create: jest.fn(() => Promise.resolve({ id: 'mat-nuevo' })) as jest.Mock,
    },
    expense: { create: jest.fn() },
    purchaseInvoicePayment: { findFirst: jest.fn(() => Promise.resolve(null)), create: jest.fn(), update: jest.fn() },
  };
}

/** La transacción corre el callback contra el MISMO mock, como en Caja. */
function conTransaccion(base: ReturnType<typeof makePrisma>) {
  return { ...base, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(base)) };
}

const FACTURA_VACIA = {
  id: 'f1',
  organizationId: ORG,
  date: new Date('2026-10-09'),
  expectedAt: null,
  reference: null,
  notes: null,
  supplier: null,
  voidedAt: null,
  voidReason: null,
  source: 'MANUAL',
  lines: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
};

const linea = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  materialId: 'mat-mio',
  printerId: null,
  nombreNuevo: null,
  quantity: 2,
  unitPrice: 25,
  received: 0,
  material: { id: 'mat-mio', name: 'PLA Negro' },
  printer: null,
  ...over,
});

/** El recálculo del precio del rollo: lo suyo se prueba en Gastos. */
const expensesFalso = () => ({ recalcularPrecioDelRollo: jest.fn() });

const servicio = (p: ReturnType<typeof makePrisma>, exp = expensesFalso()) =>
  new PurchaseInvoicesService(conTransaccion(p) as never, exp as never);
const ALTA = { date: '2026-10-09', lines: [{ materialId: 'mat-mio', quantity: 2, unitPrice: 25 }] };

/**
 * ⚠️ Una línea es UNA cosa. Dos haría una línea que es dos; ninguna, una que
 * al recibirla no sabría qué meter al inventario.
 */
describe('PurchaseInvoiceLineSchema', () => {
  it.each([
    ['dos cosas a la vez', { materialId: 'm', printerId: 'p', quantity: 1, unitPrice: 1 }],
    ['ninguna cosa', { quantity: 1, unitPrice: 1 }],
    ['una ficha y un nombre nuevo', { materialId: 'm', nombreNuevo: 'Otro', quantity: 1, unitPrice: 1 }],
  ])('%s → se rechaza', (_, linea) => {
    expect(PurchaseInvoiceLineSchema.safeParse(linea).success).toBe(false);
  });

  // El hermano alcanzable: sin esto, lo de arriba pasaría con un schema que
  // rechazara TODO.
  it.each([
    ['un filamento', { materialId: 'm', quantity: 1, unitPrice: 1 }],
    ['una impresora', { printerId: 'p', quantity: 1, unitPrice: 1 }],
    ['algo nuevo con su nombre', { nombreNuevo: 'PLA Turquesa', quantity: 1, unitPrice: 1 }],
  ])('%s → se acepta', (_, linea) => {
    expect(PurchaseInvoiceLineSchema.safeParse(linea).success).toBe(true);
  });

  it('una factura sin líneas no compra nada', () => {
    expect(PurchaseInvoiceUpsertSchema.safeParse({ date: '2026-10-09', lines: [] }).success).toBe(false);
  });

  it('pedir cero no es pedir', () => {
    expect(
      PurchaseInvoiceLineSchema.safeParse({ materialId: 'm', quantity: 0, unitPrice: 1 }).success,
    ).toBe(false);
  });
});

/**
 * REGRESIONES DE AISLAMIENTO: el proveedor, la ficha, la contraparte y la
 * cuenta viajan en el body. Con el id de otro negocio, su nombre saldría a la
 * vista y la factura quedaría atada a algo de afuera.
 */
describe('PurchaseInvoicesService — lo que viaja en el body', () => {
  it('un proveedor de OTRA organización → 404 y no escribe', async () => {
    const p = makePrisma();
    await expect(servicio(p).create(ORG, { ...ALTA, supplierId: 'prov-ajeno' } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(p.purchaseInvoice.create).not.toHaveBeenCalled();
  });

  it('…y el MÍO sí se guarda', async () => {
    const p = makePrisma();
    await servicio(p).create(ORG, { ...ALTA, supplierId: 'prov-mio' } as never);
    expect(p.purchaseInvoice.create.mock.calls[0][0].data.supplierId).toBe('prov-mio');
  });

  it('un contacto que NO es proveedor tampoco sirve', async () => {
    const p = makePrisma();
    await expect(
      servicio(p).create(ORG, { ...ALTA, supplierId: 'cliente-mio' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un filamento de OTRA organización → 404', async () => {
    const p = makePrisma();
    await expect(
      servicio(p).create(ORG, { date: '2026-10-09', lines: [{ materialId: 'mat-ajeno', quantity: 1, unitPrice: 5 }] } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('una contraparte de OTRA organización no puede abonar', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea()] });
    await expect(
      servicio(p).addPayment(ORG, 'f1', { date: '2026-10-09', amount: 10, counterpartyId: 'cp-ajena' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(p.purchaseInvoicePayment.create).not.toHaveBeenCalled();
  });

  it('…y la MÍA sí', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea()] });
    await servicio(p).addPayment(ORG, 'f1', { date: '2026-10-09', amount: 10, counterpartyId: 'cp-mia' } as never);
    expect(p.purchaseInvoicePayment.create.mock.calls[0][0].data.counterpartyId).toBe('cp-mia');
  });
});

/**
 * ⚠️ **La guarda que evita la doble carga por la puerta de atrás.** Una línea
 * con algo recibido ya creó un gasto; rehacerla lo dejaría apuntando a una
 * línea borrada y el `ON DELETE SET NULL` lo volvería un gasto normal — que SÍ
 * mueve la caja.
 */
describe('PurchaseInvoicesService — lo ya recibido no se toca', () => {
  it('corregir una factura con mercadería recibida → 400 y no borra líneas', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea({ received: 1 })] });

    await expect(servicio(p).update(ORG, 'f1', ALTA as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(p.purchaseInvoiceLine.deleteMany).not.toHaveBeenCalled();
  });

  // El hermano: la MISMA factura sin nada recibido sí se corrige.
  it('…sin nada recibido sí se corrige', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea({ received: 0 })] });

    await servicio(p).update(ORG, 'f1', ALTA as never);

    expect(p.purchaseInvoiceLine.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'f1' } });
  });

  it('anular una factura con mercadería recibida → 400', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea({ received: 2 })] });
    await expect(servicio(p).void(ORG, 'f1', { reason: 'me equivoqué' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('borrar una factura con abonos → 400: se anula, no se borra', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, payments: [{ id: 'ab1', amount: 10 }] });
    await expect(servicio(p).remove(ORG, 'f1')).rejects.toBeInstanceOf(BadRequestException);
    expect(p.purchaseInvoice.delete).not.toHaveBeenCalled();
  });

  it('…una sin abonos ni recepciones sí se borra', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea()] });
    await servicio(p).remove(ORG, 'f1');
    expect(p.purchaseInvoice.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });

  it('una factura anulada no acepta abonos', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, voidedAt: new Date(), lines: [linea()] });
    await expect(
      servicio(p).addPayment(ORG, 'f1', { date: '2026-10-09', amount: 10 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('anular dos veces el mismo abono es 400, no un segundo registro', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, lines: [linea()] });
    p.purchaseInvoicePayment.findFirst.mockResolvedValue({ id: 'ab1', voidedAt: new Date() } as never);

    await expect(servicio(p).voidPayment(ORG, 'f1', 'ab1', { reason: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(p.purchaseInvoicePayment.update).not.toHaveBeenCalled();
  });
});

describe('PurchaseInvoicesService — las cuentas que devuelve', () => {
  it('deriva total, pagado y saldo de las líneas y los abonos', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [linea({ quantity: 2, unitPrice: 25 }), linea({ id: 'l2', quantity: 1, unitPrice: 10 })],
      payments: [
        { id: 'ab1', date: new Date('2026-10-09'), amount: 20, counterpartyId: null, counterparty: null, accountId: null, note: null, voidedAt: null, voidReason: null },
        { id: 'ab2', date: new Date('2026-10-09'), amount: 100, counterpartyId: null, counterparty: null, accountId: null, note: null, voidedAt: new Date(), voidReason: 'mal cargado' },
      ],
    });

    const f = await servicio(p).get(ORG, 'f1');

    expect(f.total).toBe(60); // 2×25 + 1×10
    expect(f.pagado).toBe(20); // el anulado no cuenta
    expect(f.saldo).toBe(40);
    expect(f.status).toEqual({ pago: 'PARCIAL', mercaderia: 'SIN_RECIBIR' });
  });
});

/**
 * RECIBIR: la mercadería entra al inventario. El dueño pidió **recepción
 * parcial** (pedís 10, llegan 6), así que una línea se recibe de a tandas.
 */
describe('PurchaseInvoicesService — recibir', () => {
  const conLinea = (over: Record<string, unknown> = {}) =>
    makePrisma({ ...FACTURA_VACIA, supplierId: 'prov-mio', lines: [linea({ quantity: 10, unitPrice: 7, ...over })] });

  it('recibir 6 de 10 crea el gasto por 42 y sube lo recibido a 6', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 6, date: '2026-10-09' } as never);

    const gasto = p.expense.create.mock.calls[0][0].data;
    expect(gasto.amount).toBe(42); // 6 × 7, NO los 70 de la línea entera
    expect(gasto.quantity).toBe(6);
    expect(gasto.materialId).toBe('mat-mio');
    expect(p.purchaseInvoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { received: 6 },
    });
  });

  /**
   * ⚠️ **La marca que impide la doble carga.** Sin ella, el gasto movería la
   * caja además de los abonos.
   */
  it('el gasto nace MARCADO con su línea de factura', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    expect(p.expense.create.mock.calls[0][0].data.purchaseInvoiceLineId).toBe('l1');
  });

  it('recibir más de lo que falta → 400 y no escribe nada', async () => {
    const p = conLinea({ received: 8 });

    await expect(servicio(p).receive(ORG, 'f1', 'l1', { quantity: 3 } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(p.expense.create).not.toHaveBeenCalled();
  });

  // El hermano: lo que SÍ falta se recibe.
  it('…y recibir exactamente lo que falta sí se puede', async () => {
    const p = conLinea({ received: 8 });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 2 } as never);

    expect(p.purchaseInvoiceLine.update.mock.calls[0][0].data.received).toBe(10);
  });

  it('una línea ya completa no se recibe otra vez', async () => {
    const p = conLinea({ received: 10 });
    await expect(servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('una línea de OTRA factura → 404', async () => {
    const p = conLinea();
    await expect(servicio(p).receive(ORG, 'f1', 'l-ajena', { quantity: 1 } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una factura anulada no recibe', async () => {
    const p = makePrisma({ ...FACTURA_VACIA, voidedAt: new Date(), lines: [linea()] });
    await expect(servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /** Un color que nunca compraste no tiene ficha hasta que llega. */
  it('una línea con nombre nuevo CREA la ficha y le enlaza el gasto', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [linea({ materialId: null, material: null, nombreNuevo: 'PLA Turquesa', quantity: 2, unitPrice: 19 })],
    });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 2 } as never);

    expect((p.material.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      organizationId: ORG,
      name: 'PLA Turquesa',
      rollPrice: 19,
    });
    expect(p.expense.create.mock.calls[0][0].data.materialId).toBe('mat-nuevo');
  });

  it('una impresora recibida es inversión, no consumible', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [linea({ materialId: null, material: null, printerId: 'imp-mia', printer: { id: 'imp-mia', name: 'A1' }, quantity: 1, unitPrice: 400 })],
    });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    const gasto = p.expense.create.mock.calls[0][0].data;
    expect(gasto.isInvestment).toBe(true);
    expect(gasto.category).toBe('EQUIPMENT');
    expect(gasto.printerId).toBe('imp-mia');
  });

  /** La misma regla que una compra directa: dos verdades serían una de más. */
  it('el precio del rollo lo recalcula el servicio de Gastos, no este', async () => {
    const p = conLinea();
    const exp = expensesFalso();

    await servicio(p, exp).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    expect(exp.recalcularPrecioDelRollo).toHaveBeenCalledWith(ORG, 'mat-mio');
  });

  it('el proveedor de la factura queda en el gasto', async () => {
    const p = conLinea();
    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);
    expect(p.expense.create.mock.calls[0][0].data.providerId).toBe('prov-mio');
  });
});
