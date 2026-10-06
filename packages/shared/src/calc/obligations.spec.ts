import {
  applyPayment,
  obligationLedger,
  obligationLedger as ledger,
  ownerFinancing,
  UnknownObligationError,
  type ObligationInput,
} from './obligations';

const o = (p: Partial<ObligationInput> & { sourceId: string; date: string }): ObligationInput => ({
  source: 'EXPENSE',
  category: 'PURCHASE',
  amount: 100,
  applied: 0,
  ...p,
});

describe('obligationLedger', () => {
  it('ordena de la más antigua a la más reciente', () => {
    const l = obligationLedger([
      o({ sourceId: 'b', date: '2026-09-10' }),
      o({ sourceId: 'a', date: '2026-08-01' }),
    ]);

    expect(l.map((x) => x.sourceId)).toEqual(['a', 'b']);
  });

  it('con la misma fecha, desempata por id: el reparto tiene que ser reproducible', () => {
    const l = obligationLedger([
      o({ sourceId: 'z', date: '2026-08-01' }),
      o({ sourceId: 'a', date: '2026-08-01' }),
    ]);

    expect(l.map((x) => x.sourceId)).toEqual(['a', 'z']);
  });

  it('el saldo es el monto menos lo ya aplicado', () => {
    const [x] = obligationLedger([o({ sourceId: 'a', date: '2026-08-01', amount: 100, applied: 30 })]);

    expect(x.outstanding).toBe(70);
  });

  it('una obligación sobrepagada queda en cero, nunca negativa', () => {
    const [x] = obligationLedger([o({ sourceId: 'a', date: '2026-08-01', amount: 100, applied: 140 })]);

    expect(x.outstanding).toBe(0);
  });

  it('redondea al centavo', () => {
    const [x] = obligationLedger([o({ sourceId: 'a', date: '2026-08-01', amount: 0.3, applied: 0.1 })]);

    expect(x.outstanding).toBe(0.2);
  });
});

describe('applyPayment', () => {
  const deudas = () =>
    ledger([
      o({ sourceId: 'vieja', date: '2026-08-01', amount: 30 }),
      o({ sourceId: 'nueva', date: '2026-09-02', amount: 20 }),
    ]);

  it('cancela exactamente, de la más antigua a la más reciente', () => {
    const p = applyPayment(deudas(), 50, 'OLDEST_FIRST');

    expect(p.applications).toEqual([
      { source: 'EXPENSE', sourceId: 'vieja', amount: 30 },
      { source: 'EXPENSE', sourceId: 'nueva', amount: 20 },
    ]);
    expect(p.leftover).toBe(0);
  });

  it('un pago parcial muerde la más antigua y no toca la otra', () => {
    const p = applyPayment(deudas(), 10, 'OLDEST_FIRST');

    expect(p.applications).toEqual([{ source: 'EXPENSE', sourceId: 'vieja', amount: 10 }]);
    expect(p.leftover).toBe(0);
  });

  it('el excedente NO genera deuda negativa: sale como leftover', () => {
    const p = applyPayment(deudas(), 80, 'OLDEST_FIRST');

    expect(p.applications.reduce((s, a) => s + a.amount, 0)).toBe(50);
    expect(p.leftover).toBe(30);
  });

  it('sin deuda, todo el importe es leftover', () => {
    const p = applyPayment([], 50, 'OLDEST_FIRST');

    expect(p.applications).toEqual([]);
    expect(p.leftover).toBe(50);
  });

  it('NEWEST_FIRST invierte el orden', () => {
    const p = applyPayment(deudas(), 25, 'NEWEST_FIRST');

    expect(p.applications).toEqual([
      { source: 'EXPENSE', sourceId: 'nueva', amount: 20 },
      { source: 'EXPENSE', sourceId: 'vieja', amount: 5 },
    ]);
  });

  it('salta las obligaciones ya canceladas', () => {
    const l = ledger([
      o({ sourceId: 'saldada', date: '2026-07-01', amount: 40, applied: 40 }),
      o({ sourceId: 'abierta', date: '2026-08-01', amount: 30 }),
    ]);

    const p = applyPayment(l, 10, 'OLDEST_FIRST');

    expect(p.applications).toEqual([{ source: 'EXPENSE', sourceId: 'abierta', amount: 10 }]);
  });

  it('un importe negativo o cero no aplica nada', () => {
    expect(applyPayment(deudas(), -5, 'OLDEST_FIRST')).toEqual({ applications: [], leftover: 0 });
    expect(applyPayment(deudas(), 0, 'OLDEST_FIRST')).toEqual({ applications: [], leftover: 0 });
  });
});

describe('ownerFinancing', () => {
  // Los números de la hoja Inversion al 26/09/2026, ahora como obligaciones.
  const hoja = () =>
    ledger([
      o({ sourceId: 'd1', date: '2026-03-01', category: 'DESIGN', amount: 685 }),
      o({ sourceId: 'c1', date: '2026-05-01', category: 'PURCHASE', amount: 56 }),
      o({ sourceId: 'p1', date: '2026-08-08', category: 'LOAN_PAYMENT', amount: 250, source: 'LOAN_PAYMENT' }),
      o({ sourceId: 'e1', date: '2026-01-02', category: 'EQUIPMENT', amount: 615 }),
    ]);

  /** El ledger después de aplicar un pago, como lo arma el servicio. */
  const conPago = (monto: number) => {
    const l = hoja();
    const plan = applyPayment(l, monto, 'OLDEST_FIRST');
    const aplicadas = new Map(plan.applications.map((a) => [a.sourceId, a.amount]));
    return ledger(l.map((x) => ({ ...x, applied: aplicadas.get(x.sourceId) ?? 0 })));
  };

  it('agrupa en las cuatro filas, siempre en el mismo orden', () => {
    const f = ownerFinancing({ obligations: hoja(), paymentsTotal: 0, lenderBalance: 750 });

    expect(f.rows.map((r) => r.key)).toEqual(['designer', 'purchases', 'loanPayments', 'equipment']);
    expect(f.rows.map((r) => r.put)).toEqual([685, 56, 250, 615]);
  });

  it('el total de la deuda es el mismo que daba la cascada', () => {
    const f = ownerFinancing({
      obligations: conPago(475.14),
      paymentsTotal: 475.14,
      lenderBalance: 750,
    });

    expect(f.owedToOwner).toBe(1130.86);
    expect(f.owedToLender).toBe(750);
    expect(f.totalOwed).toBe(1880.86);
  });

  it('pero el REPARTO cambia: el retiro va a la deuda más vieja (el equipo), no al diseñador', () => {
    const plan = applyPayment(hoja(), 475.14, 'OLDEST_FIRST');

    // El equipo es del 02/01, la deuda más antigua: se lleva los 475,14 enteros.
    expect(plan.applications).toEqual([{ source: 'EXPENSE', sourceId: 'e1', amount: 475.14 }]);
  });

  it('lo retirado de más se informa, no se esconde', () => {
    // 1700 contra 1606 de deuda: se cancela todo y sobran 94.
    const f = ownerFinancing({
      obligations: conPago(1700),
      paymentsTotal: 1700,
      lenderBalance: 750,
    });

    expect(f.owedToOwner).toBe(0);
    expect(f.overWithdrawn).toBe(94);
  });

  it('al prestamista no se le paga con los retiros', () => {
    const f = ownerFinancing({ obligations: [], paymentsTotal: 5000, lenderBalance: 750 });

    expect(f.owedToOwner).toBe(0);
    expect(f.owedToLender).toBe(750);
  });
});

/**
 * ELEGIR LA DEUDA DESTINO.
 *
 * El dueño puede decir "este faltante va contra ESTA deuda". La elegida cobra
 * primero —hasta su saldo, nunca más— y lo que sobre sigue el orden normal.
 */
describe('applyPayment — con una deuda destino elegida', () => {
  /** Tres deudas, una por cada origen, para que el `source` importe. */
  const tres = () =>
    ledger([
      o({ sourceId: 'vieja', date: '2026-08-01', amount: 30 }),
      o({ sourceId: 'media', date: '2026-09-02', amount: 20, source: 'LOAN_PAYMENT' }),
      o({ sourceId: 'nueva', date: '2026-10-03', amount: 25, source: 'MOVEMENT' }),
    ]);

  it('la elegida cobra primero y el remanente sigue el orden normal', () => {
    const p = applyPayment(tres(), 40, 'OLDEST_FIRST', {
      source: 'LOAN_PAYMENT',
      sourceId: 'media',
    });

    expect(p.applications).toEqual([
      { source: 'LOAN_PAYMENT', sourceId: 'media', amount: 20 },
      { source: 'EXPENSE', sourceId: 'vieja', amount: 20 },
    ]);
    expect(p.leftover).toBe(0);
  });

  it('si la elegida absorbe todo el importe, no toca ninguna otra', () => {
    const p = applyPayment(tres(), 25, 'OLDEST_FIRST', { source: 'MOVEMENT', sourceId: 'nueva' });

    expect(p.applications).toEqual([{ source: 'MOVEMENT', sourceId: 'nueva', amount: 25 }]);
    expect(p.leftover).toBe(0);
  });

  it('la elegida no cobra dos veces: su tope sigue siendo su saldo', () => {
    const p = applyPayment(tres(), 100, 'OLDEST_FIRST', {
      source: 'LOAN_PAYMENT',
      sourceId: 'media',
    });

    expect(p.applications.filter((a) => a.sourceId === 'media')).toEqual([
      { source: 'LOAN_PAYMENT', sourceId: 'media', amount: 20 },
    ]);
    // 100 − 75 de deuda total: el excedente sigue saliendo por leftover.
    expect(p.applications.reduce((s, a) => s + a.amount, 0)).toBe(75);
    expect(p.leftover).toBe(25);
  });

  it('el remanente respeta NEWEST_FIRST, no se cuelga del orden de la elegida', () => {
    const p = applyPayment(tres(), 60, 'NEWEST_FIRST', { source: 'EXPENSE', sourceId: 'vieja' });

    expect(p.applications).toEqual([
      { source: 'EXPENSE', sourceId: 'vieja', amount: 30 },
      { source: 'MOVEMENT', sourceId: 'nueva', amount: 25 },
      { source: 'LOAN_PAYMENT', sourceId: 'media', amount: 5 },
    ]);
  });

  it('una destino que NO está en la lista es un error del llamador, no un plan vacío', () => {
    expect(() =>
      applyPayment(tres(), 40, 'OLDEST_FIRST', { source: 'EXPENSE', sourceId: 'fantasma' }),
    ).toThrow(UnknownObligationError);
  });

  it('el `source` es parte de la identidad: el mismo id con otro origen no es la misma deuda', () => {
    expect(() =>
      applyPayment(tres(), 40, 'OLDEST_FIRST', { source: 'MOVEMENT', sourceId: 'vieja' }),
    ).toThrow(UnknownObligationError);
  });

  it('la destino se valida aunque no hubiera nada que aplicar', () => {
    // Con importe cero el reparto sería vacío igual: si no se validara antes,
    // una destino inventada pasaría sin que nadie se entere.
    expect(() =>
      applyPayment(tres(), 0, 'OLDEST_FIRST', { source: 'EXPENSE', sourceId: 'fantasma' }),
    ).toThrow(UnknownObligationError);
  });

  it('una destino YA saldada no es un error: el reparto sigue el orden normal', () => {
    const l = ledger([
      o({ sourceId: 'saldada', date: '2026-07-01', amount: 40, applied: 40 }),
      o({ sourceId: 'abierta', date: '2026-08-01', amount: 30 }),
    ]);

    const p = applyPayment(l, 10, 'OLDEST_FIRST', { source: 'EXPENSE', sourceId: 'saldada' });

    expect(p.applications).toEqual([{ source: 'EXPENSE', sourceId: 'abierta', amount: 10 }]);
  });

  it('sin destino el reparto es EXACTAMENTE el de siempre', () => {
    const conNull = applyPayment(tres(), 40, 'OLDEST_FIRST', null);
    const sinNada = applyPayment(tres(), 40, 'OLDEST_FIRST');

    expect(conNull).toEqual(sinNada);
    expect(sinNada.applications).toEqual([
      { source: 'EXPENSE', sourceId: 'vieja', amount: 30 },
      { source: 'LOAN_PAYMENT', sourceId: 'media', amount: 10 },
    ]);
  });

  it('el error dice CUÁL deuda no existe, para que la API pueda explicarlo', () => {
    try {
      applyPayment(tres(), 40, 'OLDEST_FIRST', { source: 'EXPENSE', sourceId: 'fantasma' });
      throw new Error('tendría que haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownObligationError);
      expect((e as UnknownObligationError).target).toEqual({
        source: 'EXPENSE',
        sourceId: 'fantasma',
      });
    }
  });
});
