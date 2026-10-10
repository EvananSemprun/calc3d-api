import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PurchaseInvoiceLineSchema,
  PurchaseInvoiceUpsertSchema,
  businessCash,
  purchaseCostPerRoll,
  type CashLedger,
} from '@calc3d/shared';
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

/**
 * …y ORDENA como la base: por las claves del `orderBy`, en ese orden. Sin esto,
 * "la última recepción" se probaría leyendo la forma del `orderBy` en vez de
 * comprobar que se borra la fila correcta — la propiedad equivocada.
 */
const ordenar = (filas: Record<string, unknown>[], orderBy: unknown) => {
  const claves = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[];
  return [...filas].sort((a, b) => {
    for (const o of claves) {
      const [k, dir] = Object.entries(o)[0];
      const av = a[k] as never;
      const bv = b[k] as never;
      if (av < bv) return dir === 'desc' ? 1 : -1;
      if (av > bv) return dir === 'desc' ? -1 : 1;
    }
    return 0;
  });
};

/** Lo que recibe una consulta del mock. Tiparlo evita un `any` por llamada. */
type Consulta = { where: Record<string, unknown>; orderBy?: unknown };

/**
 * `otras` son las DEMÁS facturas del mock, las que no se está tocando. Hacen
 * falta desde el saldo a favor: para saber cuánto tiene a favor un proveedor hay
 * que mirar TODAS sus facturas, y la de otra organización tiene que no estar.
 */
function makePrisma(
  factura?: Record<string, unknown>,
  gastos: Record<string, unknown>[] = [],
  otras: Record<string, unknown>[] = [],
) {
  const todas = [...(factura ? [factura] : []), ...otras];
  const tabla = (filas: Record<string, unknown>[]) => ({
    findFirst: jest.fn(({ where }: any) => Promise.resolve(filas.find((f) => coincide(f, where)) ?? null)),
  });
  return {
    client: tabla(FILAS.client),
    printer: {
      ...tabla(FILAS.printer),
      create: jest.fn(() => Promise.resolve({ id: 'imp-nueva' })) as jest.Mock,
      // Para poder AFIRMAR que deshacer una recepción no borra la ficha.
      delete: jest.fn() as jest.Mock,
    },
    counterparty: tabla(FILAS.counterparty),
    cashAccount: tabla(FILAS.cashAccount),
    purchaseInvoice: {
      // ⚠️ Filtra por el `where` como el resto: una factura de OTRA
      // organización no se alcanza. Devolverla siempre hacía pasar los tests de
      // aislamiento con y sin el filtro por organización.
      findFirst: jest.fn(({ where }: Consulta) =>
        Promise.resolve(todas.find((f) => coincide(f, where)) ?? null),
      ),
      findMany: jest.fn(({ where }: Consulta) =>
        Promise.resolve(todas.filter((f) => coincide(f, where))),
      ),
      create: jest.fn(({ data }: any) =>
        Promise.resolve({
          ...FACTURA_VACIA,
          ...data,
          // Las líneas vuelven con `expenses` porque el `include` las trae: una
          // factura recién creada no tiene ninguna recepción todavía.
          lines: (data.lines?.create ?? []).map((l: Record<string, unknown>) => ({
            expenses: [],
            ...l,
          })),
          payments: [],
        }),
      ),
      update: jest.fn(() => Promise.resolve(FACTURA_VACIA)),
      delete: jest.fn(() => Promise.resolve({})),
    },
    purchaseInvoiceLine: { deleteMany: jest.fn(), update: jest.fn() },
    material: {
      ...tabla(FILAS.material),
      create: jest.fn(() => Promise.resolve({ id: 'mat-nuevo' })) as jest.Mock,
      delete: jest.fn() as jest.Mock,
    },
    /**
     * Los gastos son la tabla que deshacer una recepción TOCA, así que el mock
     * escribe de verdad: `delete` saca la fila del array. Así el saldo de la
     * caja se puede medir sobre el estado que dejó el servicio y no sobre uno
     * escrito a mano al lado.
     */
    expense: {
      findFirst: jest.fn(({ where, orderBy }: Consulta) =>
        Promise.resolve(ordenar(gastos.filter((g) => coincide(g, where)), orderBy)[0] ?? null),
      ),
      create: jest.fn(),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const i = gastos.findIndex((g) => g.id === where.id);
        if (i >= 0) gastos.splice(i, 1);
        return Promise.resolve({});
      }),
    },
    purchaseInvoicePayment: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(),
      update: jest.fn(),
      /**
       * ⚠️ Los abonos salen de las MISMAS facturas del mock, no de una lista
       * escrita al lado: así no pueden contradecirse, igual que en la base. Y
       * modela los filtros del servicio, incluido el anidado
       * (`invoice: { voidedAt: null }`), porque son reglas: la factura de destino
       * anulada devuelve el saldo.
       *
       * ⚠️ El abono ANULADO **sí sale** de acá, con su `voidedAt`: esa regla la
       * decide el motor, no el `where`. Filtrarlo en los dos lados dejaba la
       * guarda del motor sin efecto.
       */
      findMany: jest.fn(({ where }: Consulta) =>
        Promise.resolve(
          todas
            .flatMap((f) =>
              ((f.payments ?? []) as Record<string, unknown>[]).map(
                (p): Record<string, unknown> => ({ ...p, factura: f }),
              ),
            )
            .filter((p) => {
              const f = p.factura as Record<string, unknown>;
              if (where.organizationId && (p.organizationId ?? f.organizationId) !== where.organizationId)
                return false;
              if (where.voidedAt === null && p.voidedAt != null) return false;
              if (where.tomadoDeFacturaId && p.tomadoDeFacturaId == null) return false;
              if ((where.invoice as { voidedAt?: null } | undefined)?.voidedAt === null && f.voidedAt != null)
                return false;
              return true;
            }),
        ),
      ),
    },
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
  nuevoTipo: null,
  quantity: 2,
  unitPrice: 25,
  received: 0,
  material: { id: 'mat-mio', name: 'PLA Negro' },
  printer: null,
  /**
   * ⚠️ **Las recepciones de la línea SON sus gastos.** Cada recepción creó uno,
   * con su cantidad y su monto: ahí está guardado lo que COSTÓ. El `include`
   * los trae y `serializar` deriva de ellos el precio real de cada entrega.
   */
  expenses: [] as Record<string, unknown>[],
  ...over,
});

/** Una recepción, como la devuelve el `include`: su cantidad y lo que costó. */
const recepcion = (quantity: number, unitPrice: number, over: Record<string, unknown> = {}) => ({
  id: `g-${quantity}x${unitPrice}`,
  date: new Date('2026-10-10'),
  quantity,
  amount: Math.round(quantity * unitPrice * 10000) / 10000,
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
    // ⚠️ Algo nuevo SIN decir qué es: así se encargaba una impresora y nacía un
    // rollo. El contrato completo está en `shared/schemas/purchase-invoice.spec.ts`.
    ['algo nuevo sin decir qué es', { nombreNuevo: 'Impresora A2', quantity: 1, unitPrice: 300 }],
  ])('%s → se rechaza', (_, linea) => {
    expect(PurchaseInvoiceLineSchema.safeParse(linea).success).toBe(false);
  });

  // El hermano alcanzable: sin esto, lo de arriba pasaría con un schema que
  // rechazara TODO.
  it.each([
    ['un filamento', { materialId: 'm', quantity: 1, unitPrice: 1 }],
    ['una impresora', { printerId: 'p', quantity: 1, unitPrice: 1 }],
    [
      'un filamento nuevo con su nombre',
      { nombreNuevo: 'PLA Turquesa', nuevoTipo: 'MATERIAL', quantity: 1, unitPrice: 1 },
    ],
    [
      'una impresora nueva con su nombre',
      { nombreNuevo: 'Impresora A2', nuevoTipo: 'PRINTER', quantity: 1, unitPrice: 300 },
    ],
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
  it('una línea con filamento nuevo CREA la ficha y le enlaza el gasto', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [
        linea({
          materialId: null,
          material: null,
          nombreNuevo: 'PLA Turquesa',
          nuevoTipo: 'MATERIAL',
          quantity: 2,
          unitPrice: 19,
        }),
      ],
    });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 2 } as never);

    expect((p.material.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      organizationId: ORG,
      name: 'PLA Turquesa',
      rollPrice: 19,
    });
    expect(p.expense.create.mock.calls[0][0].data.materialId).toBe('mat-nuevo');
    // ⚠️ Las DOS tablas: mirar solo la que esperás es cómo pasó desapercibido
    // el bug simétrico (una impresora que nacía como rollo).
    expect(p.printer.create).not.toHaveBeenCalled();
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

/**
 * QUE LA FACTURA REFLEJE LO QUE TE COBRARON (fase 2).
 *
 * Pediste 10 rollos a $7 y el proveedor te factura $7,50. **La línea guarda lo
 * que PEDISTE y cada recepción lo que COSTÓ.** Hasta acá había que corregir la
 * línea antes de recibir, y con algo ya recibido no se podía por ninguna puerta.
 *
 * ⚠️ **La recepción no estrena tabla: su registro ES el gasto** que ya creaba.
 * Ahí viven la cantidad y el monto, o sea el precio real. Guardarlo otra vez al
 * lado sería una segunda verdad sobre la misma entrega, y el día que una de las
 * dos cambie la factura y el gasto dirían cosas distintas de la misma compra.
 */
describe('PurchaseInvoicesService — recibir al precio que te cobraron', () => {
  const conLinea = (over: Record<string, unknown> = {}) =>
    makePrisma({
      ...FACTURA_VACIA,
      supplierId: 'prov-mio',
      lines: [linea({ quantity: 10, unitPrice: 7, ...over })],
    });

  it('6 a $7,50 informados crean el gasto por 45, no por los 42 de la línea', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 6, unitPrice: 7.5 } as never);

    const gasto = p.expense.create.mock.calls[0][0].data;
    expect(gasto.amount).toBe(45);
    expect(gasto.quantity).toBe(6);
  });

  /** El caso normal: no informas nada y vale lo pactado. */
  it('sin precio informado se usa el de la línea: 6 × $7 = 42', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 6 } as never);

    expect(p.expense.create.mock.calls[0][0].data.amount).toBe(42);
  });

  /** Un rollo regalado es un dato verdadero, y 0 no es "no informó nada". */
  it('un precio informado de 0 se respeta: el gasto es 0, no el de la línea', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 2, unitPrice: 0 } as never);

    expect(p.expense.create.mock.calls[0][0].data.amount).toBe(0);
  });

  /**
   * ⚠️ **La línea NO se reescribe.** Es el pedido: lo que acordaste a $7 sigue
   * siendo $7, y por eso lo que falta llegar se sigue valuando a ese precio.
   * Pisarla dejaría la factura sin memoria de lo pactado.
   */
  it('informar otro precio no toca el precio PEDIDO de la línea', async () => {
    const p = conLinea();

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 6, unitPrice: 7.5 } as never);

    const escrituras = p.purchaseInvoiceLine.update.mock.calls.map(
      ([c]: [{ data: unknown }]) => c.data,
    );
    expect(escrituras).toEqual([{ received: 6 }]);
  });

  /**
   * ⚠️ **El precio de cotización sigue al precio REAL.** Lo fija
   * `recalcularPrecioDelRollo` leyendo el MONTO de la última compra, así que
   * informar $7,50 tiene que dejar $7,50 y no los $7 que pediste: si no, la
   * calculadora cotizaría con un precio que nadie pagó.
   */
  it('el monto del gasto ÷ sus rollos da el precio real: 45 ÷ 6 = 7,50', async () => {
    const p = conLinea();
    const exp = expensesFalso();

    await servicio(p, exp).receive(ORG, 'f1', 'l1', { quantity: 6, unitPrice: 7.5 } as never);

    const gasto = p.expense.create.mock.calls[0][0].data;
    expect(purchaseCostPerRoll(gasto.amount, gasto.quantity)).toBe(7.5);
    expect(exp.recalcularPrecioDelRollo).toHaveBeenCalledWith(ORG, 'mat-mio');
  });

  /** La ficha que nace al recibir nace con lo que COSTÓ, no con lo pedido. */
  it('un filamento nuevo nace con el precio informado, no con el de la línea', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [
        linea({
          materialId: null,
          material: null,
          nombreNuevo: 'PLA Turquesa',
          nuevoTipo: 'MATERIAL',
          quantity: 2,
          unitPrice: 19,
        }),
      ],
    });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 2, unitPrice: 21.5 } as never);

    const ficha = (p.material.create.mock.calls[0][0] as { data: { rollPrice: number } }).data;
    expect(ficha.rollPrice).toBe(21.5);
    expect(p.printer.create).not.toHaveBeenCalled();
  });

  it('una impresora nueva también nace con el precio informado', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [
        linea({
          materialId: null,
          material: null,
          nombreNuevo: 'Impresora A2',
          nuevoTipo: 'PRINTER',
          quantity: 1,
          unitPrice: 300,
        }),
      ],
    });

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1, unitPrice: 325 } as never);

    const maquina = (p.printer.create.mock.calls[0][0] as { data: { price: number } }).data;
    expect(maquina.price).toBe(325);
    expect(p.material.create).not.toHaveBeenCalled();
  });

  it('el precio informado no habilita recibir más de lo que falta', async () => {
    const p = conLinea({ received: 8 });

    await expect(
      servicio(p).receive(ORG, 'f1', 'l1', { quantity: 3, unitPrice: 7.5 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(p.expense.create).not.toHaveBeenCalled();
  });
});

/**
 * EL TOTAL DE LA FACTURA, con lo recibido a su precio real.
 *
 * ⚠️ Los números están **clavados**: 6 recibidos a $7,50 más 4 pendientes a $7
 * son **73**. No 70 (ignorar lo que te cobraron) ni 75 (cobrarle el precio real
 * a mercadería que todavía no llegó).
 */
describe('PurchaseInvoicesService — el total con el precio real', () => {
  const conRecepciones = (
    recepciones: Record<string, unknown>[],
    over: Record<string, unknown> = {},
    payments: Record<string, unknown>[] = [],
  ) =>
    makePrisma({
      ...FACTURA_VACIA,
      lines: [linea({ quantity: 10, unitPrice: 7, received: 6, expenses: recepciones, ...over })],
      payments,
    });

  it('6 a $7,50 + 4 pendientes a $7 = 73', async () => {
    const f = await servicio(conRecepciones([recepcion(6, 7.5)])).get(ORG, 'f1');

    expect(f.total).toBe(73);
    expect(f.pedido).toBe(10);
    expect(f.recibido).toBe(6);
    expect(f.porRecibir).toBe(4);
  });

  it('abonados 70 sobre una factura de 73: faltan 3', async () => {
    const f = await servicio(
      conRecepciones([recepcion(6, 7.5)], {}, [
        {
          id: 'ab1',
          date: new Date('2026-10-05'),
          amount: 70,
          counterpartyId: null,
          counterparty: null,
          accountId: null,
          note: null,
          voidedAt: null,
          voidReason: null,
        },
      ]),
    ).get(ORG, 'f1');

    expect(f.total).toBe(73);
    expect(f.saldo).toBe(3);
    expect(f.aFavor).toBe(0);
    expect(f.status.pago).toBe('PARCIAL');
  });

  /** Sin recepciones registradas (toda la base de antes) el total no se mueve. */
  it('una línea recibida sin recepciones sigue dando 70', async () => {
    const f = await servicio(conRecepciones([])).get(ORG, 'f1');

    expect(f.total).toBe(70);
  });

  /** Dos entregas a precios distintos, cada una con el suyo. */
  it('3 a $7,50 + 3 a $8 + 4 pendientes a $7 = 74,50', async () => {
    const f = await servicio(conRecepciones([recepcion(3, 7.5), recepcion(3, 8)])).get(ORG, 'f1');

    expect(f.total).toBe(74.5);
  });

  /**
   * ⚠️ La pantalla tiene que poder AVISAR, así que la recepción viaja con su
   * precio. Un total que cambia sin decir por qué es un número que miente de la
   * peor manera: la que no se nota.
   */
  it('cada línea viaja con sus recepciones y el precio de cada una', async () => {
    const f = await servicio(conRecepciones([recepcion(6, 7.5)])).get(ORG, 'f1');

    expect(f.lines[0].recepciones).toEqual([
      { id: 'g-6x7.5', date: '2026-10-10T00:00:00.000Z', quantity: 6, unitPrice: 7.5 },
    ]);
  });

  /**
   * Un gasto sin cantidad no dice a cuánto salió la unidad: sus unidades valen
   * lo pedido en vez de valer 0, que haría desaparecer plata del total.
   */
  it('una recepción sin cantidad no vale 0: esas unidades valen lo pedido', async () => {
    const f = await servicio(
      conRecepciones([recepcion(6, 7.5, { quantity: null, amount: 45 })]),
    ).get(ORG, 'f1');

    expect(f.total).toBe(70);
  });
});

/**
 * DESHACER UNA RECEPCIÓN QUE TENÍA SU PROPIO PRECIO.
 *
 * ⚠️ Con dos entregas a precios distintos, deshacer tiene que revertir **la que
 * corresponde** —la última— y no una cualquiera: borrar la barata dejaría la
 * factura cobrando la cara por mercadería que se fue.
 */
describe('PurchaseInvoicesService — deshacer con precios distintos por recepción', () => {
  const gastoDe = (id: string, quantity: number, unitPrice: number, date: string) => ({
    id,
    organizationId: ORG,
    purchaseInvoiceLineId: 'l1',
    date: new Date(date),
    createdAt: new Date(date + 'T10:00:00Z'),
    quantity,
    amount: Math.round(quantity * unitPrice * 10000) / 10000,
    materialId: 'mat-mio',
    printerId: null,
  });

  it('borra la ÚLTIMA entrega (4 a $8) y no la primera (6 a $7,50)', async () => {
    const gastos = [
      gastoDe('g-barata', 6, 7.5, '2026-10-05'),
      gastoDe('g-cara', 4, 8, '2026-10-09'),
    ];
    const p = makePrisma(
      {
        ...FACTURA_VACIA,
        lines: [linea({ quantity: 10, unitPrice: 7, received: 10, expenses: gastos })],
      },
      gastos,
    );

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.expense.delete).toHaveBeenCalledWith({ where: { id: 'g-cara' } });
    expect(p.expense.delete).not.toHaveBeenCalledWith({ where: { id: 'g-barata' } });
    // 10 recibidos − los 4 de ESA entrega.
    expect(p.purchaseInvoiceLine.update.mock.calls[0][0].data.received).toBe(6);
  });

  /**
   * El número CLAVADO del total después de deshacer: se va la entrega de 4 a $8
   * (32) y queda 6 a $7,50 + 4 pendientes a $7 = **73**. Se mide sobre el
   * estado que dejó el servicio, no sobre uno escrito a mano al lado.
   */
  it('el total vuelve a 73: lo que quedó, a su precio, y lo pendiente al pedido', async () => {
    const gastos = [
      gastoDe('g-barata', 6, 7.5, '2026-10-05'),
      gastoDe('g-cara', 4, 8, '2026-10-09'),
    ];
    const lineas = [linea({ quantity: 10, unitPrice: 7, received: 10, expenses: gastos })];
    const p = makePrisma({ ...FACTURA_VACIA, lines: lineas }, gastos);

    // 6×7,5 + 4×8 = 77 antes de deshacer.
    expect((await servicio(p).get(ORG, 'f1')).total).toBe(77);

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    // El mock no reescribe la factura leída: se la deja como la dejó el
    // servicio (un gasto menos, 6 recibidos) y se vuelve a preguntar.
    lineas[0].received = 6;
    expect((await servicio(p).get(ORG, 'f1')).total).toBe(73);
  });
});

/**
 * ⚠️ **EL PRECIO REAL NO MUEVE LA CAJA.** El gasto que nace al recibir lleva su
 * marca de factura: su plata ya se contó al abonar. Que el monto cambie porque
 * te cobraron otra cosa **no puede** mover el saldo — si lo moviera, volvería la
 * doble carga que la factura vino a evitar, ahora por una cifra distinta.
 *
 * El número está **CLAVADO**: $30,00 antes y después.
 */
describe('PurchaseInvoicesService — el precio real tampoco mueve la caja', () => {
  const caja = (gastos: Record<string, unknown>[]): CashLedger => ({
    sales: [{ id: 'v1', date: '2026-10-02', amount: 100 }],
    orderPayments: [],
    expenses: gastos.map((g) => ({
      id: g.id as string,
      date: '2026-10-10',
      amount: Number(g.amount),
      payer: null,
      isInvestment: false,
      isFilament: true,
      refundable: true,
      fromInvoice: g.purchaseInvoiceLineId != null,
    })),
    // ESTO es lo que movió la plata: los $70 abonados.
    purchasePayments: [
      { id: 'ab1', date: '2026-10-05', amount: 70, payer: null, refundable: true, filamentShare: 1 },
    ],
    loanPayments: [],
    movements: [],
  });

  const gastoReal = {
    id: 'g-real',
    organizationId: ORG,
    purchaseInvoiceLineId: 'l1',
    date: new Date('2026-10-10'),
    createdAt: new Date('2026-10-10T10:00:00Z'),
    quantity: 6,
    // 6 × $7,50: el precio que te cobraron, no los $42 que pediste.
    amount: 45,
    materialId: 'mat-mio',
    printerId: null,
  };

  it('el saldo queda IDÉNTICO antes y después de deshacer: $30,00', async () => {
    const gastos = [{ ...gastoReal }];
    const p = makePrisma(
      {
        ...FACTURA_VACIA,
        lines: [linea({ quantity: 10, unitPrice: 7, received: 6, expenses: gastos })],
      },
      gastos,
    );

    expect(businessCash(caja(gastos)).balance).toBe(30); // 100 cobrados − 70 abonados

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(gastos).toHaveLength(0);
    expect(businessCash(caja(gastos)).balance).toBe(30);
  });

  /**
   * El contrafáctico, para que el 30 tenga dientes: sin la marca, ese gasto de
   * $45 —el precio REAL, no los $42 del pedido— sí movería la caja.
   */
  it('si se perdiera la marca, el saldo bajaría los 45 REALES: −15', () => {
    const sinMarca = caja([{ id: 'g-real', amount: 45, purchaseInvoiceLineId: null }]);

    expect(businessCash(sinMarca).balance).toBe(-15); // 100 − 70 − 45
  });
});

/**
 * ENCARGAR UNA IMPRESORA QUE TODAVÍA NO TENÉS.
 *
 * ⚠️ Hasta acá "algo que todavía no tenés" creaba **siempre** una ficha de
 * filamento: encargar una impresora nueva te dejaba un rollo llamado "Impresora
 * A2". Y una impresora nueva es, por definición, la que no está en el catálogo:
 * es el caso normal al comprar una máquina, no el raro.
 *
 * Cada test afirma sobre **las DOS tablas**. Mirar solo la que esperás es
 * exactamente cómo este bug pasó desapercibido.
 */
describe('PurchaseInvoicesService — recibir algo que todavía no tenés', () => {
  const conNueva = (over: Record<string, unknown>) =>
    makePrisma({
      ...FACTURA_VACIA,
      supplierId: 'prov-mio',
      lines: [linea({ materialId: null, material: null, printerId: null, printer: null, ...over })],
    });

  const IMPRESORA = { nombreNuevo: 'Impresora A2', nuevoTipo: 'PRINTER', quantity: 1, unitPrice: 300 };

  it('recibir una impresora nueva CREA la impresora y NO un filamento', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    expect((p.printer.create.mock.calls[0][0] as { data: unknown }).data).toMatchObject({
      organizationId: ORG,
      name: 'Impresora A2',
      price: 300,
    });
    expect(p.material.create).not.toHaveBeenCalled();
  });

  it('la línea queda repuntada a la impresora recién creada', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    expect(p.purchaseInvoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { printerId: 'imp-nueva' },
    });
  });

  /**
   * ⚠️ El gasto distingue EQUIPMENT/CONSUMABLE e `isInvestment` por el
   * `printerId`. Una impresora que naciera sin repuntar la línea caería como
   * consumible y quedaría fuera de la reposición de equipos.
   */
  it('el gasto de la impresora nueva es inversión en equipo, no consumible', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    const gasto = p.expense.create.mock.calls[0][0].data;
    expect(gasto.category).toBe('EQUIPMENT');
    expect(gasto.isInvestment).toBe(true);
    expect(gasto.printerId).toBe('imp-nueva');
    expect(gasto.materialId).toBeNull();
  });

  /** Horas de vida y consumo quedan en el default: se corrigen desde el catálogo. */
  it('la impresora nace solo con el precio de la compra', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    const data = (p.printer.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(['name', 'organizationId', 'price']);
  });

  /** Una impresora no tiene gramos de rollo: mandarlos no puede inventar nada. */
  it('los gramos del rollo no se cuelan en una impresora', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1, rollGrams: 1000 } as never);

    expect(p.material.create).not.toHaveBeenCalled();
    expect(
      (p.printer.create.mock.calls[0][0] as { data: Record<string, unknown> }).data.rollGrams,
    ).toBeUndefined();
  });

  /**
   * ⚠️ El schema Zod ya lo frena al cargar la factura, pero una fila vieja (o
   * un script) puede tener `nombreNuevo` sin tipo. Adivinar es lo que producía
   * el bug: mejor 400 que un rollo llamado "Impresora A2".
   */
  it('algo nuevo SIN tipo → 400 y no crea ninguna de las dos fichas', async () => {
    const p = conNueva({ nombreNuevo: 'Impresora A2', nuevoTipo: null, quantity: 1, unitPrice: 300 });

    await expect(servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(p.material.create).not.toHaveBeenCalled();
    expect(p.printer.create).not.toHaveBeenCalled();
    expect(p.expense.create).not.toHaveBeenCalled();
  });

  // El hermano alcanzable: la MISMA línea con su tipo sí se recibe.
  it('…y con el tipo puesto sí se recibe', async () => {
    const p = conNueva(IMPRESORA);

    await servicio(p).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    expect(p.printer.create).toHaveBeenCalled();
    expect(p.expense.create).toHaveBeenCalled();
  });

  /** El precio del rollo no existe para una impresora: no hay nada que recalcular. */
  it('recibir una impresora no toca el precio de ningún rollo', async () => {
    const p = conNueva(IMPRESORA);
    const exp = expensesFalso();

    await servicio(p, exp).receive(ORG, 'f1', 'l1', { quantity: 1 } as never);

    // Se llama igual (es un no-op sin ficha): lo que no puede pasar es que
    // llegue con el id de un filamento, porque eso sería un rollo inventado.
    expect(exp.recalcularPrecioDelRollo).not.toHaveBeenCalledWith(ORG, expect.any(String));
  });
});

/** Lo que la línea declara tiene que SOBREVIVIR al guardado y a la lectura. */
describe('PurchaseInvoicesService — nuevoTipo viaja hasta la base y vuelve', () => {
  it('create guarda el tipo de lo nuevo', async () => {
    const p = makePrisma();

    await servicio(p).create(ORG, {
      date: '2026-10-11',
      lines: [{ nombreNuevo: 'Impresora A2', nuevoTipo: 'PRINTER', quantity: 1, unitPrice: 300 }],
    } as never);

    expect(p.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0]).toMatchObject({
      nombreNuevo: 'Impresora A2',
      nuevoTipo: 'PRINTER',
    });
  });

  it('una línea del catálogo lo guarda en null', async () => {
    const p = makePrisma();

    await servicio(p).create(ORG, ALTA as never);

    expect(p.purchaseInvoice.create.mock.calls[0][0].data.lines.create[0].nuevoTipo).toBeNull();
  });

  /** Sin esto la pantalla no puede decir qué va a nacer ni pedir los gramos. */
  it('la factura que lee la pantalla trae el tipo de lo nuevo', async () => {
    const p = makePrisma({
      ...FACTURA_VACIA,
      lines: [
        linea({ materialId: null, material: null, nombreNuevo: 'Impresora A2', nuevoTipo: 'PRINTER' }),
      ],
    });

    const f = await servicio(p).get(ORG, 'f1');

    expect(f.lines[0].nuevoTipo).toBe('PRINTER');
  });
});

/**
 * DESHACER UNA RECEPCIÓN — la salida del callejón.
 *
 * ⚠️ Con el gasto de factura intocable desde Gastos, una línea YA RECIBIDA no
 * se podía corregir por NINGUNA puerta: los cuatro mensajes se mandaban unos a
 * otros en círculo. Esto es el inverso exacto de `receive()`: cada recepción
 * creó UN gasto con su cantidad, y deshacerla borra **ese** gasto y baja
 * `received` en esa misma cantidad. No es un borrado libre.
 */
describe('PurchaseInvoicesService — deshacer una recepción', () => {
  /** Un gasto de recepción, el espejo de `receive()`. */
  const gasto = (over: Record<string, unknown> = {}) => ({
    id: 'g1',
    organizationId: ORG,
    purchaseInvoiceLineId: 'l1',
    date: new Date('2026-10-10'),
    createdAt: new Date('2026-10-10T10:00:00Z'),
    quantity: 6,
    amount: 42,
    materialId: 'mat-mio',
    printerId: null,
    ...over,
  });

  const conRecibido = (
    over: Record<string, unknown> = {},
    gastos: Record<string, unknown>[] = [gasto()],
  ) =>
    makePrisma(
      {
        ...FACTURA_VACIA,
        supplierId: 'prov-mio',
        lines: [linea({ quantity: 10, unitPrice: 7, received: 6, ...over })],
      },
      gastos,
    );

  it('borra el gasto de la recepción y baja lo recibido en SU cantidad', async () => {
    const p = conRecibido();

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.expense.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    expect(p.purchaseInvoiceLine.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { received: 0 }, // 6 recibidos − los 6 de ese gasto
    });
  });

  /** Dos recepciones parciales: se deshace la ÚLTIMA, no cualquiera. */
  it('deshace la última recepción por fecha, no cualquiera', async () => {
    const p = conRecibido({ received: 10 }, [
      gasto({ id: 'g-vieja', date: new Date('2026-10-05'), quantity: 6 }),
      gasto({ id: 'g-ultima', date: new Date('2026-10-09'), quantity: 4 }),
    ]);

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.expense.delete).toHaveBeenCalledWith({ where: { id: 'g-ultima' } });
    expect(p.purchaseInvoiceLine.update.mock.calls[0][0].data.received).toBe(6);
  });

  /** Mismo día, dos recepciones: desempata por `createdAt`. */
  it('con la misma fecha desempata por createdAt', async () => {
    const p = conRecibido({ received: 10 }, [
      gasto({ id: 'g-manana', createdAt: new Date('2026-10-10T09:00:00Z'), quantity: 6 }),
      gasto({ id: 'g-tarde', createdAt: new Date('2026-10-10T17:00:00Z'), quantity: 4 }),
    ]);

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.expense.delete).toHaveBeenCalledWith({ where: { id: 'g-tarde' } });
  });

  /**
   * ⚠️ El precio del rollo tiene que volver al de la compra ANTERIOR, no
   * quedarse en el de una compra que ya no existe. Y el recálculo va DESPUÉS de
   * borrar: lee la última compra, así que correrlo antes devolvería justo la
   * que se está borrando.
   */
  it('el precio del rollo se recalcula, y después de borrar el gasto', async () => {
    const p = conRecibido();
    const exp = expensesFalso();

    await servicio(p, exp).unreceive(ORG, 'f1', 'l1');

    expect(exp.recalcularPrecioDelRollo).toHaveBeenCalledWith(ORG, 'mat-mio');
    expect(exp.recalcularPrecioDelRollo.mock.invocationCallOrder[0]).toBeGreaterThan(
      p.expense.delete.mock.invocationCallOrder[0],
    );
  });

  /**
   * ⚠️ Afirma **el mensaje**, no solo el 400. Con el `BadRequestException`
   * pelado el test pasaba igual al quitar esta guarda: el caso caía en la
   * siguiente ("las cuentas no cierran") y daba 400 por otro motivo. La
   * mutación lo destapó — había que medir CUÁL guarda saltó.
   */
  it('una línea sin nada recibido → 400 y no borra ningún gasto', async () => {
    const p = conRecibido({ received: 0 });

    await expect(servicio(p).unreceive(ORG, 'f1', 'l1')).rejects.toThrow(
      /no llegó nada todavía/,
    );
    expect(p.expense.delete).not.toHaveBeenCalled();
    expect(p.purchaseInvoiceLine.update).not.toHaveBeenCalled();
  });

  it('una factura anulada no deshace nada', async () => {
    const p = makePrisma(
      { ...FACTURA_VACIA, voidedAt: new Date(), lines: [linea({ received: 2 })] },
      [gasto({ quantity: 2 })],
    );

    await expect(servicio(p).unreceive(ORG, 'f1', 'l1')).rejects.toBeInstanceOf(BadRequestException);
    expect(p.expense.delete).not.toHaveBeenCalled();
  });

  it('una línea que no es de esta factura → 404', async () => {
    const p = conRecibido();
    await expect(servicio(p).unreceive(ORG, 'f1', 'l-ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(p.expense.delete).not.toHaveBeenCalled();
  });

  /** El aislamiento: con el id de OTRA organización no se toca nada. */
  it('con el id de otra organización no se deshace nada', async () => {
    const p = conRecibido();

    await expect(servicio(p).unreceive(OTRA, 'f1', 'l1')).rejects.toBeInstanceOf(NotFoundException);
    expect(p.expense.delete).not.toHaveBeenCalled();
    expect(p.purchaseInvoiceLine.update).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ El gasto se busca filtrando por organización, como todo el resto del
   * módulo. Hoy llegar acá con una línea ajena ya es imposible (`mia` filtra la
   * factura), así que es defensa en profundidad — pero sin este test el filtro
   * es código que nada sostiene, y el día que alguien lo saque "porque es
   * redundante" no se entera nadie. La mutación lo confirmó: quitarlo no
   * rompía ningún test.
   */
  it('busca el gasto dentro de la organización: no borra el de otro negocio', async () => {
    const p = conRecibido({ received: 10 }, [
      gasto({ id: 'g-mio', date: new Date('2026-10-05'), quantity: 6 }),
      // Más nuevo, misma línea, OTRA organización: se filtra, no se borra.
      gasto({ id: 'g-ajeno', organizationId: OTRA, date: new Date('2026-10-09'), quantity: 4 }),
    ]);

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.expense.delete).toHaveBeenCalledWith({ where: { id: 'g-mio' } });
    expect(p.expense.delete).not.toHaveBeenCalledWith({ where: { id: 'g-ajeno' } });
  });

  /**
   * ⚠️ **Sin gasto que borrar no se baja `received` a ciegas.** Bajarlo igual
   * dejaría la línea pidiendo de nuevo mercadería que sí llegó, y volver a
   * recibirla cargaría el filamento dos veces: el descuadre que la factura
   * vino a evitar, entrando al revés.
   */
  it('sin gasto de recepción → 400 y no baja lo recibido', async () => {
    const p = conRecibido({}, []);

    await expect(servicio(p).unreceive(ORG, 'f1', 'l1')).rejects.toBeInstanceOf(BadRequestException);
    expect(p.purchaseInvoiceLine.update).not.toHaveBeenCalled();
  });

  /** Un gasto que dice más de lo que la línea tiene recibido dejaría `received` negativo. */
  it('un gasto con más cantidad que lo recibido → 400 y no deja lo recibido en negativo', async () => {
    const p = conRecibido({ received: 2 }, [gasto({ quantity: 6 })]);

    await expect(servicio(p).unreceive(ORG, 'f1', 'l1')).rejects.toBeInstanceOf(BadRequestException);
    expect(p.expense.delete).not.toHaveBeenCalled();
    expect(p.purchaseInvoiceLine.update).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **LA FICHA QUE NACIÓ AL RECIBIR NO SE BORRA.** Puede estar ya en una
   * cotización o en un pedido. Lo que vuelve atrás es la compra, no el
   * catálogo. Y la línea CONSERVA su enlace a la ficha: desenlazarla haría que
   * volver a recibirla creara una ficha duplicada.
   */
  it('la ficha no se borra y la línea sigue enlazada a ella', async () => {
    const p = conRecibido();

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.material.delete).not.toHaveBeenCalled();
    expect(p.printer.delete).not.toHaveBeenCalled();
    // La única escritura sobre la línea es bajar lo recibido.
    expect(p.purchaseInvoiceLine.update).toHaveBeenCalledTimes(1);
    expect(p.purchaseInvoiceLine.update.mock.calls[0][0].data).toEqual({ received: 0 });
  });

  it('una impresora recibida tampoco se borra al deshacer', async () => {
    const p = conRecibido(
      {
        materialId: null,
        material: null,
        printerId: 'imp-mia',
        printer: { id: 'imp-mia', name: 'A1' },
        received: 1,
      },
      [gasto({ quantity: 1, materialId: null, printerId: 'imp-mia' })],
    );

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(p.printer.delete).not.toHaveBeenCalled();
    expect(p.expense.delete).toHaveBeenCalled();
  });
});

/**
 * ⚠️ **DESHACER UNA RECEPCIÓN NO MUEVE LA CAJA.** El gasto nació de una
 * factura, así que **nunca movió plata** (la plata son los abonos): borrarlo
 * tampoco puede moverla. Si el saldo cambiara, se habría roto la invariante de
 * no contar dos veces, que es la regla central del módulo.
 *
 * El caso es el del Cyan de producción: factura de $25, abonados $15, 1 rollo
 * recibido. El número está **CLAVADO** y el saldo se mide sobre el estado que
 * dejó el servicio, no sobre uno escrito a mano al lado.
 */
describe('PurchaseInvoicesService — deshacer no mueve la caja', () => {
  /** Lo que la base deja: los gastos que queden, más la plata que sí salió. */
  const caja = (gastos: Record<string, unknown>[]): CashLedger => ({
    sales: [{ id: 'v1', date: '2026-10-02', amount: 40 }],
    orderPayments: [],
    expenses: gastos.map((g) => ({
      id: g.id as string,
      date: '2026-10-10',
      amount: Number(g.amount),
      payer: null,
      isInvestment: false,
      isFilament: true,
      refundable: true,
      // La marca que dice que su plata ya se contó por el lado de los abonos.
      fromInvoice: g.purchaseInvoiceLineId != null,
    })),
    // ESTO es lo que mueve la plata: el abono de $15.
    purchasePayments: [
      { id: 'ab1', date: '2026-10-05', amount: 15, payer: null, refundable: true, filamentShare: 1 },
    ],
    loanPayments: [],
    movements: [],
  });

  it('el saldo queda IDÉNTICO antes y después: $25,00', async () => {
    const gastos = [
      {
        id: 'g-cyan',
        organizationId: ORG,
        purchaseInvoiceLineId: 'l1',
        date: new Date('2026-10-10'),
        createdAt: new Date('2026-10-10T10:00:00Z'),
        quantity: 1,
        amount: 25,
        materialId: 'mat-mio',
        printerId: null,
      },
    ];
    const p = makePrisma(
      { ...FACTURA_VACIA, lines: [linea({ quantity: 1, unitPrice: 25, received: 1 })] },
      gastos,
    );

    // 40 cobrados − 15 abonados a la factura. Los $25 del gasto NO entran.
    expect(businessCash(caja(gastos)).balance).toBe(25);

    await servicio(p).unreceive(ORG, 'f1', 'l1');

    expect(gastos).toHaveLength(0); // el gasto se fue de verdad
    expect(businessCash(caja(gastos)).balance).toBe(25); // y el saldo no se movió
  });

  /**
   * El contrafáctico, para que el 25 de arriba no sea un número vacío: SIN la
   * marca de factura, ese mismo gasto SÍ movería la caja y el saldo daría $0.
   * Por eso el test de arriba tiene dientes.
   */
  it('si se perdiera la marca de factura, el saldo sí cambiaría', () => {
    const conMarca = caja([{ id: 'g-cyan', amount: 25, purchaseInvoiceLineId: 'l1' }]);
    const sinMarca = caja([{ id: 'g-cyan', amount: 25, purchaseInvoiceLineId: null }]);

    expect(businessCash(conMarca).balance).toBe(25);
    expect(businessCash(sinMarca).balance).toBe(0); // 40 − 15 − 25
  });
});

/**
 * SALDO A FAVOR CON EL PROVEEDOR, DE PUNTA A PUNTA.
 *
 * Pagaste $100 de una factura de $85. Esos $15 **no son un costo de esa
 * compra**: son plata tuya que el proveedor te debe, y se usan descontándolos
 * del próximo pedido.
 *
 * ⚠️ **El saldo se DERIVA: Σ pagado de más − Σ aplicado.** Lo único que se
 * guarda es de qué factura sale cada abono que lo usa. Por eso ninguno de estos
 * tests lee un total almacenado: todos preguntan de nuevo.
 */
describe('PurchaseInvoicesService — el saldo a favor', () => {
  /** La vieja: pedido de $85 y abonos por $100. Deja $15 a favor. */
  const vieja = (abonos: Record<string, unknown>[] = [], over: Record<string, unknown> = {}) => ({
    ...FACTURA_VACIA,
    id: 'f-vieja',
    supplier: { id: 'prov-mio', name: 'StratoFill' },
    supplierId: 'prov-mio',
    lines: [linea({ id: 'l-vieja', quantity: 1, unitPrice: 85 })],
    payments: [
      {
        id: 'ab-real',
        organizationId: ORG,
        date: new Date('2026-10-05'),
        amount: 100,
        counterpartyId: null,
        counterparty: null,
        accountId: null,
        note: null,
        tomadoDeFacturaId: null,
        voidedAt: null,
        voidReason: null,
      },
      ...abonos,
    ],
    ...over,
  });

  /** La nueva, del MISMO proveedor: $40 y sin abonar. */
  const nueva = (abonos: Record<string, unknown>[] = [], over: Record<string, unknown> = {}) => ({
    ...FACTURA_VACIA,
    id: 'f-nueva',
    supplier: { id: 'prov-mio', name: 'StratoFill' },
    supplierId: 'prov-mio',
    lines: [linea({ id: 'l-nueva', quantity: 1, unitPrice: 40 })],
    payments: abonos,
    ...over,
  });

  /** Un abono tomado del saldo a favor de `origen`. */
  const deSaldo = (amount: number, origen: string, over: Record<string, unknown> = {}) => ({
    id: `ab-saldo-${amount}`,
    organizationId: ORG,
    date: new Date('2026-10-08'),
    amount,
    counterpartyId: null,
    counterparty: null,
    accountId: null,
    note: null,
    tomadoDeFacturaId: origen,
    voidedAt: null,
    voidReason: null,
    ...over,
  });

  it('pagar $100 una factura de $85 deja $15 a favor, enteros', async () => {
    const f = await servicio(makePrisma(vieja(), [], [nueva()])).get(ORG, 'f-vieja');

    expect(f.total).toBe(85);
    expect(f.pagado).toBe(100);
    expect(f.saldo).toBe(0);
    expect(f.aFavor).toBe(15);
    expect(f.aFavorDisponible).toBe(15);
  });

  it('usar $6 en la factura nueva deja $9 disponibles y el sobrepago sigue en $15', async () => {
    const p = makePrisma(vieja(), [], [nueva([deSaldo(6, 'f-vieja')])]);

    const v = await servicio(p).get(ORG, 'f-vieja');
    expect(v.aFavor).toBe(15); // el HECHO no se mueve
    expect(v.aFavorDisponible).toBe(9);

    // Y en la nueva ese abono SÍ cuenta como pagado: el proveedor lo reconoce.
    const n2 = await servicio(makePrisma(nueva([deSaldo(6, 'f-vieja')]), [], [vieja()])).get(
      ORG,
      'f-nueva',
    );
    expect(n2.pagado).toBe(6);
    expect(n2.saldo).toBe(34);
  });

  /** ⚠️ Anular el abono DEVUELVE el saldo: si no, la plata queda atrapada. */
  it('anular el abono devuelve el saldo: vuelve a haber $15', async () => {
    const p = makePrisma(
      vieja(),
      [],
      [nueva([deSaldo(6, 'f-vieja', { voidedAt: new Date('2026-10-09') })])],
    );

    expect((await servicio(p).get(ORG, 'f-vieja')).aFavorDisponible).toBe(15);
  });

  /**
   * ⚠️ Y anular la factura de DESTINO también lo devuelve: sus abonos dejan de
   * contar en todas partes (en Caja, en Deuda), así que ese saldo no se gastó.
   * Es la guarda que se escapa si el filtro mira solo el abono.
   */
  it('anular la factura de destino también devuelve el saldo', async () => {
    const p = makePrisma(
      vieja(),
      [],
      [nueva([deSaldo(6, 'f-vieja')], { voidedAt: new Date('2026-10-09') })],
    );

    expect((await servicio(p).get(ORG, 'f-vieja')).aFavorDisponible).toBe(15);
  });

  it('el saldo gastado entero deja la factura en 0 disponible', async () => {
    const p = makePrisma(vieja(), [], [nueva([deSaldo(15, 'f-vieja')])]);

    expect((await servicio(p).get(ORG, 'f-vieja')).aFavorDisponible).toBe(0);
  });

  // ---------- usarlo ----------

  const abono = { date: '2026-10-10', amount: 10 };

  it('abonar tomando del saldo guarda de qué factura sale', async () => {
    const p = makePrisma(nueva(), [], [vieja()]);

    await servicio(p).addPayment(ORG, 'f-nueva', {
      ...abono,
      tomadoDeFacturaId: 'f-vieja',
    } as never);

    expect(p.purchaseInvoicePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tomadoDeFacturaId: 'f-vieja' }) }),
    );
  });

  it('un abono normal sigue entrando sin decir nada del saldo', async () => {
    const p = makePrisma(nueva(), [], [vieja()]);

    await servicio(p).addPayment(ORG, 'f-nueva', abono as never);

    expect(p.purchaseInvoicePayment.create.mock.calls[0][0].data.tomadoDeFacturaId).toBeNull();
  });

  /**
   * ⚠️ **Los mensajes se afirman uno por uno.** Un
   * `rejects.toBeInstanceOf(BadRequestException)` pelado no distingue qué guarda
   * saltó: quitar una dejaría el test verde porque el caso cae en la siguiente y
   * da 400 por otro motivo. Ya pasó en este módulo.
   */
  it('NO se puede usar más saldo del que hay, y el error dice cuánto hay', async () => {
    const p = makePrisma(nueva(), [], [vieja()]);

    await expect(
      servicio(p).addPayment(ORG, 'f-nueva', {
        ...abono,
        amount: 15.01,
        tomadoDeFacturaId: 'f-vieja',
      } as never),
    ).rejects.toThrow(/saldo a favor.*15/i);
    expect(p.purchaseInvoicePayment.create).not.toHaveBeenCalled();
  });

  it('…y tomarlo EXACTO sí se puede: el límite es inclusivo', async () => {
    const p = makePrisma(nueva(), [], [vieja()]);

    await servicio(p).addPayment(ORG, 'f-nueva', {
      ...abono,
      amount: 15,
      tomadoDeFacturaId: 'f-vieja',
    } as never);

    expect(p.purchaseInvoicePayment.create).toHaveBeenCalled();
  });

  it('el saldo ya gastado no se puede reusar', async () => {
    const p = makePrisma(nueva([deSaldo(9, 'f-vieja')]), [], [vieja()]);

    await expect(
      servicio(p).addPayment(ORG, 'f-nueva', {
        ...abono,
        amount: 6.01,
        tomadoDeFacturaId: 'f-vieja',
      } as never),
    ).rejects.toThrow(/saldo a favor.*6/i);
  });

  it('NO se puede usar el saldo de OTRO proveedor', async () => {
    const deOtro = vieja([], {
      id: 'f-de-otro',
      supplier: { id: 'prov-otro', name: 'Filaven' },
      supplierId: 'prov-otro',
    });
    const p = makePrisma(nueva(), [], [deOtro]);

    await expect(
      servicio(p).addPayment(ORG, 'f-nueva', { ...abono, tomadoDeFacturaId: 'f-de-otro' } as never),
    ).rejects.toThrow(/otro proveedor/i);
    expect(p.purchaseInvoicePayment.create).not.toHaveBeenCalled();
  });

  it('una factura SIN proveedor anotado no puede dar ni recibir saldo', async () => {
    const anonima = vieja([], { id: 'f-anonima', supplier: null, supplierId: null });

    await expect(
      servicio(makePrisma(nueva(), [], [anonima])).addPayment(ORG, 'f-nueva', {
        ...abono,
        tomadoDeFacturaId: 'f-anonima',
      } as never),
    ).rejects.toThrow(/proveedor anotado/i);

    const sinProveedor = nueva([], { id: 'f-nueva', supplier: null, supplierId: null });
    await expect(
      servicio(makePrisma(sinProveedor, [], [vieja()])).addPayment(ORG, 'f-nueva', {
        ...abono,
        tomadoDeFacturaId: 'f-vieja',
      } as never),
    ).rejects.toThrow(/proveedor anotado/i);
  });

  it('una factura ANULADA no presta su saldo', async () => {
    const anulada = vieja([], { voidedAt: new Date('2026-10-06'), voidReason: 'mal cargada' });
    const p = makePrisma(nueva(), [], [anulada]);

    await expect(
      servicio(p).addPayment(ORG, 'f-nueva', { ...abono, tomadoDeFacturaId: 'f-vieja' } as never),
    ).rejects.toThrow(/anulada/i);
  });

  it('una factura no se paga con su propio saldo a favor', async () => {
    const p = makePrisma(vieja(), [], [nueva()]);

    await expect(
      servicio(p).addPayment(ORG, 'f-vieja', {
        ...abono,
        amount: 5,
        tomadoDeFacturaId: 'f-vieja',
      } as never),
    ).rejects.toThrow(/su propio saldo/i);
  });

  /**
   * AISLAMIENTO. El id de la factura de origen viaja en el body: con el de otro
   * negocio, su sobrepago financiaría un abono de acá — plata inventada, y el
   * nombre de su proveedor saldría a la vista.
   *
   * ⚠️ La pertenencia se cierra **por construcción**: el origen tiene que estar
   * en la lista de la organización. Consultarlo por id contra la base reabriría
   * el IDOR.
   */
  it('el saldo a favor de OTRA organización no existe para esta', async () => {
    const ajena = vieja([], { id: 'f-ajena', organizationId: OTRA });
    const p = makePrisma(nueva(), [], [ajena]);

    await expect(
      servicio(p).addPayment(ORG, 'f-nueva', { ...abono, tomadoDeFacturaId: 'f-ajena' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(p.purchaseInvoicePayment.create).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ EL HERMANO ALCANZABLE. Sin esto, el test de arriba pasaría igual con un
   * servicio que rechazara TODO saldo a favor, o con un mock que no devolviera
   * ninguna factura.
   */
  it('…y la MISMA factura, pedida desde SU organización, sí presta su saldo', async () => {
    const ajena = vieja([], { id: 'f-ajena', organizationId: OTRA });
    const destinoAjeno = nueva([], { id: 'f-nueva', organizationId: OTRA });
    const p = makePrisma(destinoAjeno, [], [ajena]);

    await servicio(p).addPayment(OTRA, 'f-nueva', {
      ...abono,
      tomadoDeFacturaId: 'f-ajena',
    } as never);

    expect(p.purchaseInvoicePayment.create).toHaveBeenCalled();
  });

  it('la consulta de los abonos tomados va con el organizationId', async () => {
    const p = makePrisma(vieja(), [], [nueva()]);
    await servicio(p).get(ORG, 'f-vieja');

    expect(p.purchaseInvoicePayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
    );
  });
});
