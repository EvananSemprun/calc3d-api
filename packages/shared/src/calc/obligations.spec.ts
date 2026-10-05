import { obligationLedger, type ObligationInput } from './obligations';

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
