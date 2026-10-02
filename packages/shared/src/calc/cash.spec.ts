import { businessCash, cashCountCheck, ownerFinancing, type CashLedger } from './cash';

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
      { date: '2026-09-03', amount: 20, paidBy: 'BUSINESS', isInvestment: false, isFilament: false },
      { date: '2026-09-03', amount: 25, paidBy: 'BUSINESS', isInvestment: false, isFilament: true },
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
      { date: '2026-09-23', amount: 20, paidBy: 'OWNER', isInvestment: false, isFilament: true },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(20);
    expect(c.contributions).toBe(20);
    expect(c.balance).toBe(50);
  });

  it('lo pagado con el préstamo no toca la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 917, paidBy: 'LOAN', isInvestment: true, isFilament: false },
    ];

    expect(businessCash(l).balance).toBe(0);
  });

  it('un equipo que pagó Vanan no entra en la caja (vive en el financiamiento)', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-01-02', amount: 615, paidBy: 'OWNER', isInvestment: true, isFilament: false },
    ];

    const c = businessCash(l);

    expect(c.contributions).toBe(0);
    expect(c.equipment).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un equipo que pagó el negocio SÍ sale de la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-10-01', amount: 300, paidBy: 'BUSINESS', isInvestment: true, isFilament: false },
    ];

    expect(businessCash(l).equipment).toBe(300);
    expect(businessCash(l).balance).toBe(-300);
  });

  it('las cuotas: solo resta la que pagó la caja', () => {
    const l = vacio();
    l.loanPayments = [
      { date: '2026-08-08', amount: 50, paidBy: 'OWNER' },
      { date: '2026-10-08', amount: 100, paidBy: 'BUSINESS' },
    ];

    const c = businessCash(l);

    expect(c.loanPayments).toBe(100);
    expect(c.balance).toBe(-100);
  });

  it('los movimientos de plata pura suman y restan', () => {
    const l = vacio();
    l.movements = [
      { date: '2026-09-17', amount: 475.14, kind: 'WITHDRAWAL' },
      { date: '2026-09-20', amount: 10, kind: 'CONTRIBUTION' },
    ];

    const c = businessCash(l);

    expect(c.withdrawals).toBe(475.14);
    expect(c.contributions).toBe(10);
    expect(c.balance).toBe(-465.14);
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

describe('cashCountCheck', () => {
  it('lo personal es el total de Binance menos lo que es del negocio', () => {
    const r = cashCountCheck(85, 8);

    expect(r.personal).toBe(77);
    expect(r.short).toBe(false);
  });

  it('si Binance tiene MENOS que el negocio, avisa cuánto falta', () => {
    const r = cashCountCheck(50, 80);

    expect(r.personal).toBe(-30);
    expect(r.short).toBe(true);
  });
});

describe('ownerFinancing', () => {
  // Los números de la hoja Inversion al 26/09/2026.
  const hoja = {
    designer: 685,
    purchases: 56,
    loanPayments: 250,
    equipment: 615,
    withdrawals: 475.14,
    lenderBalance: 750,
  };

  it('reparte lo que Vanan ya sacó en orden: diseñador, compras, cuotas, equipo', () => {
    const f = ownerFinancing(hoja);
    const [disenador, compras, cuotas, equipo] = f.rows;

    expect(disenador).toMatchObject({ key: 'designer', put: 685, recovered: 475.14, missing: 209.86 });
    expect(compras).toMatchObject({ key: 'purchases', put: 56, recovered: 0, missing: 56 });
    expect(cuotas).toMatchObject({ key: 'loanPayments', put: 250, recovered: 0, missing: 250 });
    expect(equipo).toMatchObject({ key: 'equipment', put: 615, recovered: 0, missing: 615 });
  });

  it('lo que se le debe a Vanan y al prestamista, y el total', () => {
    const f = ownerFinancing(hoja);

    expect(f.owedToOwner).toBe(1130.86);
    expect(f.owedToLender).toBe(750);
    expect(f.totalOwed).toBe(1880.86);
  });

  it('al prestamista no se le paga con la caja: los retiros de Vanan no lo tocan', () => {
    const f = ownerFinancing({ ...hoja, withdrawals: 5000 });

    expect(f.owedToOwner).toBe(0);
    expect(f.owedToLender).toBe(750);
  });

  it('lo retirado de más no se pierde: se informa como sobrante', () => {
    const f = ownerFinancing({ ...hoja, withdrawals: 1700 });

    expect(f.owedToOwner).toBe(0);
    expect(f.overWithdrawn).toBe(94);
  });

  it('cada cuota que paga Vanan sube su línea y baja la del prestamista: el total no sube', () => {
    const antes = ownerFinancing(hoja);
    const despues = ownerFinancing({ ...hoja, loanPayments: 300, lenderBalance: 700 });

    expect(despues.totalOwed).toBe(antes.totalOwed);
  });
});
