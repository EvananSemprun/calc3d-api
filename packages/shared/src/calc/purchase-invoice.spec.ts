import { invoiceStatus, invoiceTotals } from './purchase-invoice';

/**
 * ⚠️ Los números esperados están **puestos a mano**, no calculados con el
 * mismo motor: un test que escribe `expect(total).toBe(l.quantity * l.price)`
 * compara dos caras de la misma cuenta y pasa aunque la cuenta esté mal.
 */
describe('invoiceTotals', () => {
  it('suma las líneas y los abonos: 2×18 + 1×24 = 60, abonado 20, falta 40', () => {
    const t = invoiceTotals(
      [
        { quantity: 2, unitPrice: 18 },
        { quantity: 1, unitPrice: 24 },
      ],
      [{ amount: 20 }],
    );

    expect(t.total).toBe(60);
    expect(t.pagado).toBe(20);
    expect(t.saldo).toBe(40);
    expect(t.aFavor).toBe(0);
  });

  it('un abono anulado no cuenta, pero no desaparece del cálculo del resto', () => {
    const t = invoiceTotals([{ quantity: 1, unitPrice: 50 }], [
      { amount: 30 },
      { amount: 20, voided: true },
    ]);

    expect(t.pagado).toBe(30);
    expect(t.saldo).toBe(20);
  });

  /**
   * ⚠️ Pagar de más es plata que SALIÓ de la caja. Si se restara del saldo,
   * quedaría un saldo negativo que se lee como "la factura te debe a vos".
   */
  it('pagar de más deja saldo 0 y lo de más aparte, no un saldo negativo', () => {
    const t = invoiceTotals([{ quantity: 1, unitPrice: 40 }], [{ amount: 55 }]);

    expect(t.saldo).toBe(0);
    expect(t.aFavor).toBe(15);
  });

  it('las unidades no se mezclan con la plata: 10 pedidos, 6 recibidos, faltan 4', () => {
    const t = invoiceTotals([{ quantity: 10, unitPrice: 5, received: 6 }], []);

    expect(t.pedido).toBe(10);
    expect(t.recibido).toBe(6);
    expect(t.porRecibir).toBe(4);
    expect(t.total).toBe(50); // el total NO baja porque falte llegar
  });

  it('no se puede haber recibido más de lo pedido', () => {
    const t = invoiceTotals([{ quantity: 3, unitPrice: 10, received: 99 }], []);

    expect(t.recibido).toBe(3);
    expect(t.porRecibir).toBe(0);
  });

  /** Una factura no es el lugar para una devolución. */
  it('una línea negativa no resta del total', () => {
    const t = invoiceTotals(
      [
        { quantity: 2, unitPrice: 10 },
        { quantity: -5, unitPrice: 10 },
      ],
      [],
    );

    expect(t.total).toBe(20);
  });

  /** Tres rollos a 19.99 son 59.97, no 59.969999999999999. */
  it('la plata se redondea al centavo, sin basura de coma flotante', () => {
    const t = invoiceTotals([{ quantity: 3, unitPrice: 19.99 }], [{ amount: 0.1 }, { amount: 0.2 }]);

    expect(t.total).toBe(59.97);
    expect(t.pagado).toBe(0.3);
    expect(t.saldo).toBe(59.67);
  });

  it('una factura vacía no rompe', () => {
    expect(invoiceTotals([], [])).toEqual({
      total: 0,
      pagado: 0,
      saldo: 0,
      aFavor: 0,
      pedido: 0,
      recibido: 0,
      porRecibir: 0,
    });
  });
});

/**
 * ⚠️ El estado son DOS ejes. Una factura pagada entera y sin recibir existe y
 * es lo normal cuando encargás algo: un solo "estado" tendría que elegir cuál
 * de las dos verdades contar.
 */
describe('invoiceStatus', () => {
  const estado = (l: Parameters<typeof invoiceTotals>[0], p: Parameters<typeof invoiceTotals>[1]) =>
    invoiceStatus(invoiceTotals(l, p));

  it('pagada entera y todavía sin llegar', () => {
    expect(estado([{ quantity: 2, unitPrice: 10 }], [{ amount: 20 }])).toEqual({
      pago: 'PAGADA',
      mercaderia: 'SIN_RECIBIR',
    });
  });

  it('recibida entera y todavía sin pagar', () => {
    expect(estado([{ quantity: 2, unitPrice: 10, received: 2 }], [])).toEqual({
      pago: 'SIN_PAGAR',
      mercaderia: 'RECIBIDA',
    });
  });

  it('abonada a medias y llegada a medias', () => {
    expect(estado([{ quantity: 4, unitPrice: 10, received: 1 }], [{ amount: 15 }])).toEqual({
      pago: 'PARCIAL',
      mercaderia: 'PARCIAL',
    });
  });

  it('pagada de más se dice, no se esconde como pagada', () => {
    expect(estado([{ quantity: 1, unitPrice: 10 }], [{ amount: 12 }]).pago).toBe('PAGADA_DE_MAS');
  });

  /** Sin líneas no hay nada que recibir: decir "parcial" sería mentira. */
  it('una factura sin líneas no está a medio recibir', () => {
    expect(estado([], []).mercaderia).toBe('SIN_RECIBIR');
  });
});
