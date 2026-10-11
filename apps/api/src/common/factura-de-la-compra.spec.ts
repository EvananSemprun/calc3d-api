import { facturaDeLaCompra, type FacturaCruda } from './factura-de-la-compra';

/**
 * DE DÓNDE SALIÓ LA PLATA DE CADA ABONO (2026-10-11).
 *
 * Esta es la mitad que clasifica; la otra —la que reparte y escribe— vive en
 * `shared/calc/pagador.ts` con sus propios tests.
 *
 * ⚠️ **LA PRECEDENCIA ES LO QUE SE PROTEGE ACÁ.** No se eligió en este
 * archivo: es la de `cashEntries` (`shared/calc/cash.ts`), que es quien mueve
 * la caja de verdad. Primero el saldo a favor, después el prestamista, después
 * la contraparte. Si alguien la invierte, Caja y el Dashboard contarían el
 * mismo abono de dos maneras y la diferencia no se vería hasta ser grande.
 *
 * ⚠️ En producción, el día que se escribió esto, había UNA factura con UN
 * abono pagado por la caja: todo lo de abajo son casos que todavía no
 * ocurrieron, y estos tests son la única evidencia de que funcionan.
 */

/** Una línea de $25 ya recibida, que es lo que arma una factura mínima. */
const linea = (unitPrice = 25) => ({
  quantity: 1,
  unitPrice,
  received: 1,
  expenses: [{ quantity: 1, amount: unitPrice }],
});

const abono = (
  amount: number,
  over: Partial<FacturaCruda['payments'][number]> = {},
): FacturaCruda['payments'][number] => ({
  amount,
  voidedAt: null,
  tomadoDeFacturaId: null,
  counterparty: null,
  ...over,
});

const EVANAN = { name: 'Evanan', kind: 'OWNER' };
const SOCIO = { name: 'Socio', kind: 'PARTNER' };
const PRESTAMISTA = { name: 'Prestamista', kind: 'EXTERNAL_LENDER' };

const factura = (payments: FacturaCruda['payments'], lines = [linea()]): FacturaCruda => ({
  id: 'f1',
  lines,
  payments,
});

describe('facturaDeLaCompra · de dónde salió cada abono', () => {
  it('lo normal: la caja lo pagó y no hay ningún origen aparte', () => {
    const f = facturaDeLaCompra(factura([abono(15)]));

    expect(f?.abonado).toEqual({ total: 15, bolsillo: 0, saldoAFavor: 0, prestamista: 0 });
    expect(f?.bolsillos).toEqual([]);
    expect(f?.saldo).toBe(10);
  });

  it('un abono de bolsillo queda apartado, con el nombre de quien lo puso', () => {
    const f = facturaDeLaCompra(factura([abono(15, { counterparty: EVANAN })]));

    expect(f?.abonado.bolsillo).toBe(15);
    expect(f?.bolsillos).toEqual(['Evanan']);
  });

  it('un socio cuenta como bolsillo, igual que el propietario', () => {
    const f = facturaDeLaCompra(factura([abono(10, { counterparty: SOCIO })]));

    expect(f?.abonado.bolsillo).toBe(10);
    expect(f?.bolsillos).toEqual(['Socio']);
  });

  /**
   * ⚠️ El prestamista NO es bolsillo: su deuda ya vive en el saldo del
   * préstamo, y sumarla como aporte la contaría dos veces. Mismo criterio que
   * `generaObligacion` en `cash.ts`.
   */
  it('lo del prestamista no se mezcla con el bolsillo', () => {
    const f = facturaDeLaCompra(factura([abono(15, { counterparty: PRESTAMISTA })]));

    expect(f?.abonado.prestamista).toBe(15);
    expect(f?.abonado.bolsillo).toBe(0);
    expect(f?.bolsillos).toEqual([]);
  });

  it('lo tomado del saldo a favor va a su propio pedazo', () => {
    const f = facturaDeLaCompra(factura([abono(15, { tomadoDeFacturaId: 'otra' })]));

    expect(f?.abonado.saldoAFavor).toBe(15);
    expect(f?.abonado.bolsillo).toBe(0);
  });

  /**
   * ⚠️ **LA PRECEDENCIA.** Un abono tomado del saldo a favor que ADEMÁS trae
   * contraparte es **saldo a favor**: esa plata ya había salido, y quien
   * figure como pagador no puso nada esta vez. `cashEntries` lo resuelve con
   * un `continue` por `fromCredit` antes de mirar nada más.
   */
  it('el saldo a favor gana sobre la contraparte, como en cashEntries', () => {
    const f = facturaDeLaCompra(
      factura([abono(15, { tomadoDeFacturaId: 'otra', counterparty: EVANAN })]),
    );

    expect(f?.abonado.saldoAFavor).toBe(15);
    expect(f?.abonado.bolsillo).toBe(0);
    // Y no se le promete una devolución a alguien que no puso plata.
    expect(f?.bolsillos).toEqual([]);
  });

  it('el saldo a favor gana también sobre el prestamista', () => {
    const f = facturaDeLaCompra(
      factura([abono(15, { tomadoDeFacturaId: 'otra', counterparty: PRESTAMISTA })]),
    );

    expect(f?.abonado.saldoAFavor).toBe(15);
    expect(f?.abonado.prestamista).toBe(0);
  });

  /**
   * ⚠️ **Los anulados quedan fuera con el MISMO criterio que `invoiceTotals`.**
   * Si uno de los dos los contara, `abonado.total` y `total − saldo` dejarían
   * de ser el mismo número y el prorrateo del pie repartiría plata que nadie
   * puso.
   */
  it('un abono anulado no cuenta, ni en el total ni en su origen', () => {
    const f = facturaDeLaCompra(
      factura([
        abono(15, { counterparty: EVANAN, voidedAt: new Date('2026-10-10') }),
        abono(5),
      ]),
    );

    expect(f?.abonado).toEqual({ total: 5, bolsillo: 0, saldoAFavor: 0, prestamista: 0 });
    expect(f?.bolsillos).toEqual([]);
    expect(f?.saldo).toBe(20);
  });

  it('lo abonado y lo que falta son el mismo hecho visto de los dos lados', () => {
    const f = facturaDeLaCompra(
      factura([abono(10, { counterparty: EVANAN }), abono(5, { tomadoDeFacturaId: 'otra' })]),
    );

    expect(f?.abonado.total).toBe(15);
    expect(f!.total - f!.saldo).toBe(f!.abonado.total);
  });

  it('varios bolsillos se listan sin repetir', () => {
    const f = facturaDeLaCompra(
      factura(
        [
          abono(5, { counterparty: EVANAN }),
          abono(5, { counterparty: SOCIO }),
          abono(5, { counterparty: EVANAN }),
        ],
        [linea(15)],
      ),
    );

    expect(f?.abonado.bolsillo).toBe(15);
    expect(f?.bolsillos).toEqual(['Evanan', 'Socio']);
  });

  it('sin factura no hay nada que decir', () => {
    expect(facturaDeLaCompra(null)).toBeNull();
  });
});
