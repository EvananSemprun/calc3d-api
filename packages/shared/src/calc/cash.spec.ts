import { businessCash, type CashLedger } from './cash';

/** Lo mínimo para que cada test solo escriba lo que le importa. */
const vacio = (): CashLedger => ({
  sales: [],
  orderPayments: [],
  expenses: [],
  loanPayments: [],
  movements: [],
});

describe('businessCash', () => {
  it('suma lo cobrado y resta lo que pagó el negocio', () => {
    const l = vacio();
    l.sales = [{ date: '2026-09-01', amount: 100 }];
    l.orderPayments = [{ date: '2026-09-02', amount: 30 }];
    l.expenses = [
      { date: '2026-09-03', amount: 20, paidBy: 'BUSINESS', isInvestment: false, isFilament: false, refundable: true },
      { date: '2026-09-03', amount: 25, paidBy: 'BUSINESS', isInvestment: false, isFilament: true, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.collected).toBe(130);
    expect(c.expenses).toBe(20);
    expect(c.filament).toBe(25);
    expect(c.balance).toBe(85);
  });

  it('una compra que pagó Vanan se ve como gasto Y como aporte: no mueve la caja', () => {
    // Igual que la hoja: el gasto resta en "Gastos" y suma en "Aportes".
    const l = vacio();
    l.sales = [{ date: '2026-09-01', amount: 50 }];
    l.expenses = [
      { date: '2026-09-23', amount: 20, paidBy: 'OWNER', isInvestment: false, isFilament: true, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(20);
    expect(c.contributionsRefundable).toBe(20);
    expect(c.balance).toBe(50);
  });

  it('lo pagado con el préstamo no toca la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 917, paidBy: 'LOAN', isInvestment: true, isFilament: false, refundable: true },
    ];

    expect(businessCash(l).balance).toBe(0);
  });

  it('un equipo que pagó Vanan no entra en la caja (vive en el financiamiento)', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-01-02', amount: 615, paidBy: 'OWNER', isInvestment: true, isFilament: false, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.contributionsRefundable).toBe(0);
    expect(c.equipment).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un equipo que pagó el negocio SÍ sale de la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-10-01', amount: 300, paidBy: 'BUSINESS', isInvestment: true, isFilament: false, refundable: true },
    ];

    expect(businessCash(l).equipment).toBe(300);
    expect(businessCash(l).balance).toBe(-300);
  });

  it('las cuotas: solo resta la que pagó la caja', () => {
    const l = vacio();
    l.loanPayments = [
      { date: '2026-08-08', amount: 50, paidBy: 'OWNER', refundable: true },
      { date: '2026-10-08', amount: 100, paidBy: 'BUSINESS', refundable: true },
    ];

    const c = businessCash(l);

    expect(c.loanPayments).toBe(100);
    expect(c.balance).toBe(-100);
  });

  it('los movimientos de plata pura suman y restan', () => {
    const l = vacio();
    l.movements = [
      { date: '2026-09-17', amount: 475.14, kind: 'WITHDRAWAL', refundable: true },
      { date: '2026-09-20', amount: 10, kind: 'CONTRIBUTION', refundable: true },
    ];

    const c = businessCash(l);

    expect(c.ownerDraws).toBe(475.14);
    expect(c.contributionsRefundable).toBe(10);
    expect(c.balance).toBe(-465.14);
  });

  it('separa el aporte reembolsable del aporte de capital', () => {
    const l = vacio();
    l.movements = [
      { date: '2026-09-01', amount: 100, kind: 'CONTRIBUTION', refundable: true },
      { date: '2026-09-02', amount: 500, kind: 'CONTRIBUTION', refundable: false },
    ];

    const c = businessCash(l);

    expect(c.contributionsRefundable).toBe(100);
    expect(c.contributionsCapital).toBe(500);
    // Los dos suben la caja igual: un aporte NO es venta ni ganancia, pero es plata.
    expect(c.balance).toBe(600);
  });

  it('separa la devolución de deuda del retiro puro', () => {
    const l = vacio();
    l.movements = [
      // De los 100 que se le pagaron, 70 fueron contra deudas y 30 fue retiro.
      { date: '2026-09-17', amount: 100, kind: 'WITHDRAWAL', refundable: true, applied: 70 },
    ];

    const c = businessCash(l);

    expect(c.debtRepayments).toBe(70);
    expect(c.ownerDraws).toBe(30);
    // Ninguno es gasto operativo: no tocan `expenses`.
    expect(c.expenses).toBe(0);
    expect(c.balance).toBe(-100);
  });

  it('un retiro sin aplicaciones es retiro puro', () => {
    const l = vacio();
    l.movements = [{ date: '2026-09-17', amount: 40, kind: 'WITHDRAWAL', refundable: true }];

    const c = businessCash(l);

    expect(c.debtRepayments).toBe(0);
    expect(c.ownerDraws).toBe(40);
  });

  it('con fecha de corte solo cuenta lo anterior o del mismo día', () => {
    const l = vacio();
    l.sales = [
      { date: '2026-09-21', amount: 10 },
      { date: '2026-09-22', amount: 99 },
    ];

    expect(businessCash(l, '2026-09-21').balance).toBe(10);
    expect(businessCash(l).balance).toBe(109);
  });

  it('redondea al centavo (sin ruido de coma flotante)', () => {
    const l = vacio();
    l.sales = [
      { date: '2026-09-01', amount: 0.1 },
      { date: '2026-09-01', amount: 0.2 },
    ];

    expect(businessCash(l).balance).toBe(0.3);
  });
});
