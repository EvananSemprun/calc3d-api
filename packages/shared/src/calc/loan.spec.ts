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
