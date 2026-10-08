import {
  loanBalance,
  loanPaid,
  loanProgress,
  monthsToPayOff,
  monthlyLoanPayments,
} from './loan';

describe('loanPaid / loanBalance', () => {
  it('suma los abonos y descuenta del capital', () => {
    const abonos = [{ amount: 50 }, { amount: 50 }, { amount: 100 }, { amount: 50 }];

    expect(loanPaid(abonos)).toBe(250);
    expect(loanBalance(1000, abonos)).toBe(750);
  });

  it('un préstamo sin abonos debe todo el capital', () => {
    expect(loanBalance(1000, [])).toBe(1000);
  });

  it('no deja el saldo en negativo si se pagó de más', () => {
    expect(loanBalance(100, [{ amount: 150 }])).toBe(0);
  });
});

describe('loanProgress', () => {
  it('es la fracción del capital ya devuelta', () => {
    expect(loanProgress(1000, [{ amount: 250 }])).toBeCloseTo(0.25);
  });

  it('llega a 1 cuando está pagado', () => {
    expect(loanProgress(1000, [{ amount: 1000 }])).toBe(1);
  });

  it('un capital de cero está pagado, no dividido por cero', () => {
    expect(loanProgress(0, [])).toBe(1);
  });
});

describe('monthlyLoanPayments', () => {
  it('suma la cuota de los préstamos abiertos', () => {
    const total = monthlyLoanPayments([
      { monthlyPayment: 100, closedAt: null },
      { monthlyPayment: 40, closedAt: null },
    ]);

    expect(total).toBe(140);
  });

  it('ignora los que ya se terminaron de pagar', () => {
    const total = monthlyLoanPayments([
      { monthlyPayment: 100, closedAt: null },
      { monthlyPayment: 40, closedAt: '2026-08-31' },
    ]);

    expect(total).toBe(100);
  });

  it('sin préstamos no hay cuota', () => {
    expect(monthlyLoanPayments([])).toBe(0);
  });
});

describe('monthsToPayOff', () => {
  it('redondea hacia arriba: un mes a medias es un mes más', () => {
    expect(monthsToPayOff(750, 100)).toBe(8);
  });

  it('sin saldo no falta ningún mes', () => {
    expect(monthsToPayOff(0, 100)).toBe(0);
  });

  it('sin cuota no se puede saber cuándo termina', () => {
    expect(monthsToPayOff(750, 0)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────

import { aMensual, payOffEstimate } from './loan';

describe('aMensual', () => {
  it('una cuota semanal de $50 son $217 al mes, no $50', () => {
    // Sin esto el punto de equilibrio pediria facturar menos de lo que hace
    // falta para pagar la cuota.
    expect(aMensual(50, 'WEEKLY')).toBeCloseTo(217.4, 1);
    expect(aMensual(50, 'BIWEEKLY')).toBeCloseTo(108.7, 1);
    expect(aMensual(50, 'MONTHLY')).toBe(50);
  });
});

describe('monthlyLoanPayments con frecuencias', () => {
  it('normaliza antes de sumar', () => {
    const total = monthlyLoanPayments([
      { monthlyPayment: 100, paymentFrequency: 'MONTHLY' },
      { monthlyPayment: 50, paymentFrequency: 'WEEKLY' },
    ]);
    expect(total).toBeCloseTo(100 + 217.4, 1);
  });

  it('sin frecuencia asume mensual: los prestamos viejos no cambian', () => {
    expect(monthlyLoanPayments([{ monthlyPayment: 100 }])).toBe(100);
  });
});

describe('payOffEstimate', () => {
  // El prestamo real: $1.000 de capital, cuota objetivo $100/mes desde el
  // 14/07, y pagos irregulares de 50, 50, 100 y 50.
  const REALES = [{ amount: 50 }, { amount: 50 }, { amount: 100 }, { amount: 50 }];
  const COMUN = {
    balance: 750,
    installment: 100,
    payments: REALES,
    startDate: '2026-07-14',
    now: new Date('2026-10-07T12:00:00.000Z'),
  } as const;

  it('da DOS lecturas, y la real es peor que el objetivo cuando se paga de menos', () => {
    const e = payOffEstimate(COMUN);
    // Al objetivo: 750 / 100 = 8 meses.
    expect(e.atTarget).toBe(8);
    // Al ritmo real: $250 en ~2,8 meses son ~$90/mes -> 9 meses.
    expect(e.atActualPace).toBe(9);
    expect(e.actualPace).toBeGreaterThan(80);
    expect(e.actualPace).toBeLessThan(100);
    expect(e.unit).toBe('MONTHLY');
  });

  it('sin cuota objetivo valida NO se estima: null, no cero', () => {
    // Un 0 ahi se leeria como "ya esta pagado".
    const e = payOffEstimate({ ...COMUN, installment: 0 });
    expect(e.atTarget).toBeNull();
    expect(e.atActualPace).toBe(9);
  });

  it('sin pagos no se puede medir el ritmo real', () => {
    const e = payOffEstimate({ ...COMUN, payments: [] });
    expect(e.atTarget).toBe(8);
    expect(e.atActualPace).toBeNull();
  });

  it('con menos de un periodo transcurrido tampoco: dividir por 0,2 mentiria', () => {
    const e = payOffEstimate({ ...COMUN, now: new Date('2026-07-20T00:00:00.000Z') });
    expect(e.atActualPace).toBeNull();
  });

  it('el ritmo real se mide contra el CALENDARIO, no por cantidad de pagos', () => {
    // Los mismos cuatro pagos, pero repartidos en el triple de tiempo: el ritmo
    // real tiene que ser peor. Promediar por pago diria que es el mismo.
    const lento = payOffEstimate({ ...COMUN, now: new Date('2027-01-07T12:00:00.000Z') });
    const rapido = payOffEstimate(COMUN);
    expect(lento.actualPace!).toBeLessThan(rapido.actualPace!);
    expect(lento.atActualPace!).toBeGreaterThan(rapido.atActualPace!);
  });

  it('un prestamo saldado da 0 en las dos lecturas', () => {
    const e = payOffEstimate({ ...COMUN, balance: 0 });
    expect(e.atTarget).toBe(0);
    expect(e.atActualPace).toBe(0);
  });

  it('la unidad sigue a la frecuencia', () => {
    const e = payOffEstimate({ ...COMUN, frequency: 'WEEKLY', installment: 25 });
    expect(e.unit).toBe('WEEKLY');
    // 750 / 25 = 30 semanas.
    expect(e.atTarget).toBe(30);
  });
});
