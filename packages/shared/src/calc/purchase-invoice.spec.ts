import { facturasAtrasadas, invoiceStatus, invoiceTotals, type FacturaParaAtraso } from './purchase-invoice';

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
/**
 * QUE LA FACTURA REFLEJE LO QUE TE COBRARON.
 *
 * Pediste 10 rollos a $7 y el proveedor te factura $7,50. La línea guarda **lo
 * que pediste**; cada recepción guarda **lo que costó**. El total usa el precio
 * REAL de lo que ya llegó y el PEDIDO para lo que falta.
 *
 * ⚠️ Los números están puestos a mano y son los tres que importan: 6 a $7,50
 * más 4 pendientes a $7 son **73**, no 70 (ignorar el precio informado) ni 75
 * (aplicarle el precio real a toda la línea, incluso a lo que no llegó).
 */
describe('invoiceTotals — el precio que te cobraron al recibir', () => {
  /** La línea del caso: 10 pedidos a $7, 6 llegados y facturados a $7,50. */
  const mixta = () =>
    invoiceTotals(
      [
        {
          quantity: 10,
          unitPrice: 7,
          received: 6,
          recepciones: [{ quantity: 6, unitPrice: 7.5 }],
        },
      ],
      [],
    );

  it('6 recibidos a $7,50 + 4 pendientes a $7 = 73', () => {
    expect(mixta().total).toBe(73);
  });

  it('…y NO es 70: el precio informado no se puede ignorar', () => {
    expect(mixta().total).not.toBe(70);
  });

  it('…ni 75: el precio real no se le aplica a lo que todavía no llegó', () => {
    expect(mixta().total).not.toBe(75);
  });

  /** Las unidades no son plata: el precio distinto no mueve el conteo. */
  it('las unidades siguen siendo 10 pedidas, 6 recibidas, 4 por llegar', () => {
    const t = mixta();
    expect(t.pedido).toBe(10);
    expect(t.recibido).toBe(6);
    expect(t.porRecibir).toBe(4);
  });

  /** El saldo y lo pagado de más salen del total NUEVO, no del viejo. */
  it('abonaste 70 y la factura quedó en 73: faltan 3, y no hay nada a favor', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 6, recepciones: [{ quantity: 6, unitPrice: 7.5 }] }],
      [{ amount: 70 }],
    );

    expect(t.total).toBe(73);
    expect(t.saldo).toBe(3);
    expect(t.aFavor).toBe(0);
  });

  it('si te salió más BARATO el saldo baja: 6 a $6,50 + 4 a $7 = 67', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 6, recepciones: [{ quantity: 6, unitPrice: 6.5 }] }],
      [{ amount: 70 }],
    );

    expect(t.total).toBe(67);
    expect(t.saldo).toBe(0);
    expect(t.aFavor).toBe(3); // 70 abonados sobre 67: pagaste de más
  });

  /** Dos entregas, dos precios: cada una vale lo suyo. */
  it('3 a $7,50 + 3 a $8 + 4 pendientes a $7 = 74,50', () => {
    const t = invoiceTotals(
      [
        {
          quantity: 10,
          unitPrice: 7,
          received: 6,
          recepciones: [
            { quantity: 3, unitPrice: 7.5 },
            { quantity: 3, unitPrice: 8 },
          ],
        },
      ],
      [],
    );

    expect(t.total).toBe(74.5); // 22,50 + 24 + 28
  });

  /** El caso normal: llegó a lo pactado y el total es el de siempre. */
  it('una recepción al precio pedido no cambia nada: 10 × $7 = 70', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 10, recepciones: [{ quantity: 10, unitPrice: 7 }] }],
      [],
    );

    expect(t.total).toBe(70);
  });

  /**
   * ⚠️ **Retrocompatible**: una línea recibida SIN recepciones registradas es
   * todo lo que hay en la base de antes de esto. Vale el precio pedido, que es
   * exactamente lo que valía ayer: si cambiara, cada factura vieja del negocio
   * pasaría a decir otro número de un día para el otro.
   */
  it('lo recibido sin recepción registrada vale el precio PEDIDO: 70', () => {
    expect(invoiceTotals([{ quantity: 10, unitPrice: 7, received: 6 }], []).total).toBe(70);
  });

  /**
   * ⚠️ `received` sigue siendo la ÚNICA definición de cuántos llegaron. Una
   * recepción que diga más unidades de las recibidas se recorta: si no, el
   * precio real se aplicaría a mercadería que la línea considera pendiente.
   */
  it('una recepción que dice más de lo recibido se recorta: 2 a $7,50 + 8 a $7 = 71', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 2, recepciones: [{ quantity: 6, unitPrice: 7.5 }] }],
      [],
    );

    expect(t.total).toBe(71); // 15 + 56
  });

  /** Y lo que la recepción no cubre no se queda sin precio. */
  it('lo recibido que la recepción no cubre vale lo pedido: 4×7,50 + 6×7 = 72', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 6, recepciones: [{ quantity: 4, unitPrice: 7.5 }] }],
      [],
    );

    expect(t.total).toBe(72); // 30 + 42
  });

  /** Igual que una línea negativa: una recepción negativa no resta del total. */
  it('un precio de recepción negativo se trata como 0, no resta', () => {
    const t = invoiceTotals(
      [{ quantity: 10, unitPrice: 7, received: 2, recepciones: [{ quantity: 2, unitPrice: -5 }] }],
      [],
    );

    expect(t.total).toBe(56); // 0 + 8×7
  });

  it('una recepción de cero unidades no se come el lugar de la siguiente', () => {
    const t = invoiceTotals(
      [
        {
          quantity: 4,
          unitPrice: 7,
          received: 2,
          recepciones: [
            { quantity: 0, unitPrice: 99 },
            { quantity: 2, unitPrice: 7.5 },
          ],
        },
      ],
      [],
    );

    expect(t.total).toBe(29); // 15 + 2×7
  });

  /** Tres rollos a 19,99 son 59,97, también viniendo de una recepción. */
  it('el precio real también se redondea al centavo', () => {
    const t = invoiceTotals(
      [{ quantity: 3, unitPrice: 18, received: 3, recepciones: [{ quantity: 3, unitPrice: 19.99 }] }],
      [],
    );

    expect(t.total).toBe(59.97);
  });

  /** Varias líneas: cada una con su propio precio real. */
  it('dos líneas, una con precio real y otra sin: 73 + 24 = 97', () => {
    const t = invoiceTotals(
      [
        { quantity: 10, unitPrice: 7, received: 6, recepciones: [{ quantity: 6, unitPrice: 7.5 }] },
        { quantity: 2, unitPrice: 12 },
      ],
      [],
    );

    expect(t.total).toBe(97);
  });
});

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

// ----- Lo que no llegó -----

/**
 * ⚠️ **"Hoy" es una CONSTANTE del test, no `new Date()`.** Un test que leyera
 * el reloj pasaría hoy y fallaría solo algún martes, y el que lo viera fallar
 * no tendría forma de saber por qué.
 */
const HOY = '2026-10-10';

/** Una factura por 2 rollos prometidos para el 5, sin nada recibido. */
const factura = (cambios: Partial<FacturaParaAtraso> = {}): FacturaParaAtraso => ({
  id: 'f1',
  expectedAt: '2026-10-05',
  voidedAt: null,
  lines: [{ quantity: 2, unitPrice: 10, received: 0 }],
  ...cambios,
});

const ids = (fs: FacturaParaAtraso[], hoy = HOY) => facturasAtrasadas(fs, hoy).map((f) => f.id);

describe('facturasAtrasadas', () => {
  it('prometida para el 5 y hoy es el 10: atrasada hace 5 días, faltan 2 rollos', () => {
    expect(facturasAtrasadas([factura()], HOY)).toEqual([
      { id: 'f1', expectedAt: '2026-10-05', diasDeAtraso: 5, porRecibir: 2 },
    ]);
  });

  /**
   * ⚠️ Es la prueba de que el "hoy" ENTRA: las mismas facturas, dos días
   * distintos, dos respuestas distintas. Si la función leyera el reloj, el
   * segundo caso daría lo mismo que el primero.
   */
  it('el "hoy" lo decide quien pregunta: el 6 está atrasada hace 1 día, el 5 no', () => {
    expect(facturasAtrasadas([factura()], '2026-10-06')[0]?.diasDeAtraso).toBe(1);
    expect(facturasAtrasadas([factura()], '2026-10-05')).toEqual([]);
  });

  // --- Las cuatro formas de que el aviso mienta. Cada una con su HERMANA
  // ALCANZABLE: sin ella, una función que devolviera siempre vacío pasaría los
  // cuatro tests sin hacer nada.

  it('una factura ANULADA nunca está atrasada; su hermana viva sí', () => {
    expect(
      ids([
        factura({ id: 'anulada', voidedAt: '2026-10-07T12:00:00.000Z' }),
        factura({ id: 'viva' }),
      ]),
    ).toEqual(['viva']);
  });

  it('una factura YA RECIBIDA ENTERA no está atrasada; una recibida a medias sí', () => {
    expect(
      ids([
        factura({ id: 'llego-todo', lines: [{ quantity: 2, unitPrice: 10, received: 2 }] }),
        factura({ id: 'llego-parte', lines: [{ quantity: 2, unitPrice: 10, received: 1 }] }),
      ]),
    ).toEqual(['llego-parte']);
  });

  it('SIN fecha esperada no hay promesa que incumplir; con fecha pasada sí', () => {
    expect(ids([factura({ id: 'sin-fecha', expectedAt: null }), factura({ id: 'con-fecha' })])).toEqual(
      ['con-fecha'],
    );
  });

  it('la fecha esperada de HOY todavía no es atraso; la de ayer sí', () => {
    expect(
      ids([
        factura({ id: 'llega-hoy', expectedAt: HOY }),
        factura({ id: 'era-ayer', expectedAt: '2026-10-09' }),
      ]),
    ).toEqual(['era-ayer']);
  });

  // --- Los bordes que no son "formas de mentir" pero igual se pueden romper.

  it('una fecha futura no está atrasada; una pasada sí', () => {
    expect(
      ids([factura({ id: 'futura', expectedAt: '2026-11-02' }), factura({ id: 'pasada' })]),
    ).toEqual(['pasada']);
  });

  /**
   * Sin líneas no se espera nada: un aviso de 0 unidades es ruido. Y una
   * factura con líneas en CERO es el mismo caso escrito distinto.
   */
  it('una factura sin NADA PEDIDO no está atrasada; una con algo pedido sí', () => {
    expect(
      ids([
        factura({ id: 'vacia', lines: [] }),
        factura({ id: 'en-cero', lines: [{ quantity: 0, unitPrice: 10 }] }),
        factura({ id: 'con-lineas' }),
      ]),
    ).toEqual(['con-lineas']);
  });

  /**
   * ⚠️ `expectedAt` se guarda a **medianoche UTC** y llega como instante ISO.
   * Leerlo en la zona local, al oeste de UTC, lo corre al día ANTERIOR: la
   * factura que llega hoy aparecería atrasada hace un día.
   */
  it('un instante de medianoche UTC se lee como ESE día, no como el anterior', () => {
    expect(facturasAtrasadas([factura({ expectedAt: `${HOY}T00:00:00.000Z` })], HOY)).toEqual([]);
    expect(
      facturasAtrasadas([factura({ expectedAt: new Date('2026-10-09T00:00:00.000Z') })], HOY)[0]
        ?.diasDeAtraso,
    ).toBe(1);
  });

  it('la más atrasada va primero', () => {
    expect(
      ids([
        factura({ id: 'tres-dias', expectedAt: '2026-10-07' }),
        factura({ id: 'treinta-dias', expectedAt: '2026-09-10' }),
        factura({ id: 'un-dia', expectedAt: '2026-10-09' }),
      ]),
    ).toEqual(['treinta-dias', 'tres-dias', 'un-dia']);
  });

  /** Un "hoy" inventado haría que TODO (o nada) se vea atrasado, sin avisar. */
  it('un "hoy" que no existe en el calendario lanza', () => {
    expect(() => facturasAtrasadas([factura()], '2026-02-30')).toThrow(/2026-02-30/);
    expect(() => facturasAtrasadas([factura()], 'ayer')).toThrow(/ayer/);
  });

  it('sin facturas no hay atraso', () => {
    expect(facturasAtrasadas([], HOY)).toEqual([]);
  });
});
