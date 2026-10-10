import {
  businessCash,
  cashChain,
  cashChainCuts,
  cashEntries,
  CASH_SIGN,
  type CashCategory,
  type CashLedger,
} from './cash';

/** Lo mínimo para que cada test solo escriba lo que le importa. */
const vacio = (): CashLedger => ({
  sales: [],
  orderPayments: [],
  expenses: [],
  loanPayments: [],
  purchasePayments: [],
  movements: [],
});

describe('businessCash', () => {
  it('suma lo cobrado y resta lo que pagó el negocio', () => {
    const l = vacio();
    l.sales = [{ date: '2026-09-01', amount: 100 }];
    l.orderPayments = [{ date: '2026-09-02', amount: 30 }];
    l.expenses = [
      { date: '2026-09-03', amount: 20, payer: null, isInvestment: false, isFilament: false, refundable: true },
      { date: '2026-09-03', amount: 25, payer: null, isInvestment: false, isFilament: true, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.collected).toBe(130);
    expect(c.expenses).toBe(20);
    expect(c.filament).toBe(25);
    expect(c.balance).toBe(85);
  });

  it('una compra que pagó el propietario se ve como gasto Y como aporte: no mueve la caja', () => {
    // Igual que la hoja: el gasto resta en "Gastos" y suma en "Aportes".
    const l = vacio();
    l.sales = [{ date: '2026-09-01', amount: 50 }];
    l.expenses = [
      { date: '2026-09-23', amount: 20, payer: 'OWNER', isInvestment: false, isFilament: true, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(20);
    expect(c.contributionsRefundable).toBe(20);
    expect(c.balance).toBe(50);
  });

  it('lo pagado con el préstamo no toca la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 917, payer: 'EXTERNAL_LENDER', isInvestment: true, isFilament: false, refundable: true },
    ];

    expect(businessCash(l).balance).toBe(0);
  });

  it('un equipo que pagó el propietario no entra en la caja (vive en el financiamiento)', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-01-02', amount: 615, payer: 'OWNER', isInvestment: true, isFilament: false, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.contributionsRefundable).toBe(0);
    expect(c.equipment).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un equipo que pagó el negocio SÍ sale de la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-10-01', amount: 300, payer: null, isInvestment: true, isFilament: false, refundable: true },
    ];

    expect(businessCash(l).equipment).toBe(300);
    expect(businessCash(l).balance).toBe(-300);
  });

  it('las cuotas: solo resta la que pagó la caja', () => {
    const l = vacio();
    l.loanPayments = [
      { date: '2026-08-08', amount: 50, payer: 'OWNER', refundable: true },
      { date: '2026-10-08', amount: 100, payer: null, refundable: true },
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

/**
 * Un ledger con las NUEVE categorías pobladas y todas distintas de cero, para
 * que el invariante "el detalle suma la línea" tenga algo que comparar en cada
 * una. Los montos están elegidos para que ninguna coincida con otra: si el
 * refactor mezclara dos categorías, los números lo dirían.
 */
const completo = (): CashLedger => ({
  sales: [{ id: 'venta-1', date: '2026-09-01', amount: 100 }],
  orderPayments: [{ id: 'abono-1', date: '2026-09-02', amount: 30.55 }],
  expenses: [
    { id: 'gasto-1', date: '2026-09-03', amount: 20, payer: null, isInvestment: false, isFilament: false, refundable: true },
    { id: 'gasto-2', date: '2026-09-04', amount: 25.25, payer: null, isInvestment: false, isFilament: true, refundable: true },
    { id: 'gasto-3', date: '2026-09-05', amount: 300, payer: null, isInvestment: true, isFilament: false, refundable: true },
    // Filamento que pagó la contraparte y se le devuelve: gasto Y aporte reembolsable.
    { id: 'gasto-4', date: '2026-09-06', amount: 40, payer: 'OWNER', isInvestment: false, isFilament: true, refundable: true },
    // Gasto general que puso la contraparte a fondo perdido: gasto Y capital.
    { id: 'gasto-5', date: '2026-09-07', amount: 15, payer: 'OWNER', isInvestment: false, isFilament: false, refundable: false },
    // Pagado con el préstamo: no toca la caja por ninguna de las nueve líneas.
    { id: 'gasto-6', date: '2026-09-07', amount: 917, payer: 'EXTERNAL_LENDER', isInvestment: false, isFilament: false, refundable: true },
  ],
  loanPayments: [
    { id: 'cuota-1', date: '2026-09-08', amount: 50, payer: null, refundable: true },
    { id: 'cuota-2', date: '2026-09-09', amount: 60, payer: 'OWNER', refundable: true },
  ],
  purchasePayments: [],
  movements: [
    { id: 'mov-1', date: '2026-09-10', amount: 200, kind: 'CONTRIBUTION', refundable: true },
    { id: 'mov-2', date: '2026-09-11', amount: 500, kind: 'CONTRIBUTION', refundable: false },
    { id: 'mov-3', date: '2026-09-12', amount: 100, kind: 'WITHDRAWAL', refundable: true, applied: 70 },
  ],
});

const redondear = (n: number) => Math.round(n * 100) / 100;
const sumaDe = (l: CashLedger, k: CashCategory, until?: string) =>
  redondear(
    cashEntries(l, until)
      .filter((e) => e.category === k)
      .reduce((s, e) => s + e.amount, 0),
  );

const CATEGORIAS = Object.keys(CASH_SIGN) as CashCategory[];

describe('cashEntries', () => {
  /**
   * ⚠️ El invariante "el detalle suma la línea" NO alcanza solo: desde que
   * `businessCash` suma `cashEntries`, los dos lados salen del MISMO código y
   * el invariante se cumple aunque la clasificación esté mal. Verificado por
   * mutación: romper `operativo` deja el invariante en verde.
   *
   * Por eso las nueve líneas van clavadas a mano contra el ledger de arriba.
   * Esto es lo que de verdad caza un filtro cambiado.
   */
  it('las nueve líneas dan estos números y no otros', () => {
    expect(businessCash(completo())).toEqual({
      collected: 130.55, // 100 de venta + 30,55 de abono
      expenses: 35, // 20 de la caja + 15 de la contraparte (el de 917 es del préstamo)
      filament: 65.25, // 25,25 de la caja + 40 de la contraparte
      equipment: 300, // solo el que pagó la caja
      contributionsRefundable: 240, // 40 en filamento + 200 de plata pura
      contributionsCapital: 515, // 15 en gasto + 500 de plata pura
      debtRepayments: 70,
      ownerDraws: 30,
      loanPayments: 50, // la cuota que pagó la contraparte no sale de la caja
      balance: 335.3, // 130,55 − 35 − 65,25 − 300 + 240 + 515 − 70 − 30 − 50
    });
  });

  it('el detalle de cada categoría suma exactamente la línea del saldo', () => {
    const l = completo();
    const b = businessCash(l);

    for (const k of CATEGORIAS) {
      // Si alguna diera 0, el invariante pasaría sin probar nada en esa línea.
      expect(b[k]).not.toBe(0);
      expect(sumaDe(l, k)).toBe(b[k]);
    }
  });

  it('el saldo es la suma firmada de todos los asientos', () => {
    const l = completo();
    const firmada = cashEntries(l).reduce((s, e) => s + CASH_SIGN[e.category] * e.amount, 0);

    expect(redondear(firmada)).toBe(businessCash(l).balance);
  });

  it('no clasifica nada fuera de las nueve categorías', () => {
    for (const e of cashEntries(completo())) expect(CATEGORIAS).toContain(e.category);
  });

  it('los montos son siempre positivos: el signo lo pone la categoría', () => {
    for (const e of cashEntries(completo())) expect(e.amount).toBeGreaterThan(0);
  });

  it('un gasto operativo de la contraparte emite DOS asientos: gasto y aporte', () => {
    // Es la regla que evita la doble carga de la hoja; si emitiera uno solo,
    // el saldo cambiaría.
    const l = vacio();
    l.expenses = [
      { id: 'g', date: '2026-09-06', amount: 40, payer: 'OWNER', isInvestment: false, isFilament: true, refundable: true },
    ];

    expect(cashEntries(l)).toEqual([
      { category: 'filament', date: '2026-09-06', amount: 40, id: 'g' },
      { category: 'contributionsRefundable', date: '2026-09-06', amount: 40, id: 'g' },
    ]);
    expect(businessCash(l).balance).toBe(0);
  });

  it('un retiro parcialmente aplicado emite devolución Y retiro, con el mismo id', () => {
    const l = vacio();
    l.movements = [{ id: 'mov-3', date: '2026-09-17', amount: 100, kind: 'WITHDRAWAL', refundable: true, applied: 70 }];

    expect(cashEntries(l)).toEqual([
      { category: 'debtRepayments', date: '2026-09-17', amount: 70, id: 'mov-3' },
      { category: 'ownerDraws', date: '2026-09-17', amount: 30, id: 'mov-3' },
    ]);
  });

  it('un retiro totalmente aplicado NO emite un retiro de cero', () => {
    const l = vacio();
    l.movements = [{ id: 'mov-4', date: '2026-09-17', amount: 80, kind: 'WITHDRAWAL', refundable: true, applied: 80 }];

    expect(cashEntries(l)).toEqual([{ category: 'debtRepayments', date: '2026-09-17', amount: 80, id: 'mov-4' }]);
  });

  it('un retiro sin aplicaciones NO emite una devolución de cero', () => {
    const l = vacio();
    l.movements = [{ id: 'mov-5', date: '2026-09-17', amount: 40, kind: 'WITHDRAWAL', refundable: true }];

    expect(cashEntries(l)).toEqual([{ category: 'ownerDraws', date: '2026-09-17', amount: 40, id: 'mov-5' }]);
  });

  it('`until` recorta los asientos igual que recorta el saldo', () => {
    const l = completo();
    const corte = '2026-09-06';
    const b = businessCash(l, corte);

    for (const k of CATEGORIAS) expect(sumaDe(l, k, corte)).toBe(b[k]);
    // Y recortó de verdad: lo de después del corte no está.
    expect(cashEntries(l, corte).every((e) => e.date <= corte)).toBe(true);
    expect(cashEntries(l, corte).length).toBeLessThan(cashEntries(l).length);
  });

  it('cada asiento conserva el id que trajo el ledger', () => {
    const porCategoria = new Map(cashEntries(completo()).map((e) => [`${e.category}:${e.id}`, e]));

    expect(porCategoria.has('collected:venta-1')).toBe(true);
    expect(porCategoria.has('collected:abono-1')).toBe(true);
    expect(porCategoria.has('expenses:gasto-1')).toBe(true);
    expect(porCategoria.has('filament:gasto-2')).toBe(true);
    expect(porCategoria.has('equipment:gasto-3')).toBe(true);
    expect(porCategoria.has('contributionsRefundable:gasto-4')).toBe(true);
    expect(porCategoria.has('contributionsCapital:gasto-5')).toBe(true);
    expect(porCategoria.has('loanPayments:cuota-1')).toBe(true);
    expect(porCategoria.has('contributionsRefundable:mov-1')).toBe(true);
    expect(porCategoria.has('contributionsCapital:mov-2')).toBe(true);
    expect(porCategoria.has('debtRepayments:mov-3')).toBe(true);
    expect(porCategoria.has('ownerDraws:mov-3')).toBe(true);
  });

  it('un ledger sin ids no rompe nada (el motor no los necesita)', () => {
    const l = vacio();
    l.sales = [{ date: '2026-09-01', amount: 10 }];

    expect(cashEntries(l)).toEqual([{ category: 'collected', date: '2026-09-01', amount: 10, id: undefined }]);
  });
});

/**
 * La red que faltaba: hasta este refactor, la clasificación solo estaba cubierta
 * por los casos de `businessCash` de arriba, y entre ellos NO había un gasto
 * CORRIENTE pagado con el préstamo (el único que hay es una inversión, que ya
 * queda afuera por `isInvestment`). Sacarle el filtro del prestamista
 * `operativo` no ponía rojo ni un test. Estos lo tapan.
 */
describe('businessCash — los filtros que nadie estaba mirando', () => {
  it('un gasto CORRIENTE pagado con el préstamo tampoco toca la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 917, payer: 'EXTERNAL_LENDER', isInvestment: false, isFilament: false, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.expenses).toBe(0);
    expect(c.contributionsRefundable).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un filamento pagado con el préstamo tampoco toca la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 120, payer: 'EXTERNAL_LENDER', isInvestment: false, isFilament: true, refundable: true },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un aporte de capital en especie: el gasto de la contraparte NO reembolsable', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-09-07', amount: 15, payer: 'OWNER', isInvestment: false, isFilament: false, refundable: false },
    ];

    const c = businessCash(l);

    expect(c.expenses).toBe(15);
    expect(c.contributionsCapital).toBe(15);
    expect(c.contributionsRefundable).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('un equipo pagado con el préstamo no entra como equipo de la caja', () => {
    const l = vacio();
    l.expenses = [
      { date: '2026-07-27', amount: 917, payer: 'EXTERNAL_LENDER', isInvestment: true, isFilament: false, refundable: true },
    ];

    expect(businessCash(l).equipment).toBe(0);
  });

  it('una cuota pagada con el préstamo no sale de la caja', () => {
    const l = vacio();
    l.loanPayments = [{ date: '2026-08-08', amount: 50, payer: 'EXTERNAL_LENDER', refundable: true }];

    expect(businessCash(l).loanPayments).toBe(0);
    expect(businessCash(l).balance).toBe(0);
  });

  it('un retiro con más aplicado que monto no inventa un retiro negativo', () => {
    const l = vacio();
    l.movements = [{ date: '2026-09-17', amount: 50, kind: 'WITHDRAWAL', refundable: true, applied: 80 }];

    const c = businessCash(l);

    expect(c.debtRepayments).toBe(50);
    expect(c.ownerDraws).toBe(0);
    expect(c.balance).toBe(-50);
  });
});

/**
 * ⚠️ **LA INVARIANTE DE LAS FACTURAS DE COMPRA.**
 *
 * Los abonos son la PLATA; la recepción es la MERCADERÍA. Si las dos movieran
 * la caja, abonar $50 y después recibir esa misma compra bajaría el saldo
 * $100: la doble carga que descuadraba la hoja del Excel.
 *
 * Los números van PUESTOS A MANO. Derivarlos del mismo motor haría pasar el
 * test con y sin la protección.
 */
describe('facturas de compra: la plata se cuenta UNA vez', () => {
  it('abonar $50 baja el saldo $50', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 200 }];
    l.purchasePayments = [
      { date: '2026-10-02', amount: 50, payer: null, refundable: true, filamentShare: 1 },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(50);
    expect(c.balance).toBe(150);
  });

  it('…y recibir después esa compra NO lo vuelve a bajar: sigue en 150', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 200 }];
    l.purchasePayments = [
      { date: '2026-10-02', amount: 50, payer: null, refundable: true, filamentShare: 1 },
    ];
    // La mercadería llega: nace el gasto, marcado como nacido de la factura.
    l.expenses = [
      {
        date: '2026-10-09',
        amount: 50,
        payer: null,
        isInvestment: false,
        isFilament: true,
        refundable: true,
        fromInvoice: true,
      },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(50); // el abono, no el abono + el gasto
    expect(c.balance).toBe(150); // ⚠️ si fueran 100, es la doble carga
  });

  // El hermano alcanzable: el MISMO gasto sin la marca sí mueve la caja, que es
  // lo que pasa con una compra cargada directo.
  it('el mismo gasto SIN venir de una factura sí baja el saldo', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 200 }];
    l.expenses = [
      { date: '2026-10-09', amount: 50, payer: null, isInvestment: false, isFilament: true, refundable: true },
    ];

    expect(businessCash(l).balance).toBe(150);
  });

  it('una impresora recibida por factura tampoco se cuenta dos veces', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 900 }];
    l.purchasePayments = [
      { date: '2026-10-02', amount: 400, payer: null, refundable: true, filamentShare: 0 },
    ];
    l.expenses = [
      {
        date: '2026-10-09',
        amount: 400,
        payer: null,
        isInvestment: true,
        isFilament: false,
        refundable: true,
        fromInvoice: true,
      },
    ];

    const c = businessCash(l);

    expect(c.equipment).toBe(400);
    expect(c.balance).toBe(500);
  });

  /** Mitad filamento y mitad impresora: el prorrateo parte el abono. */
  it('una factura mixta reparte el abono entre filamento y equipo', () => {
    const l = vacio();
    l.purchasePayments = [
      { date: '2026-10-02', amount: 100, payer: null, refundable: true, filamentShare: 0.25 },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(25);
    expect(c.equipment).toBe(75);
    expect(c.balance).toBe(-100);
  });

  /**
   * Un abono que puso el dueño de su bolsillo no baja la caja: es gasto Y
   * aporte a la vez, igual que una compra suya. Lo que deja es la deuda.
   */
  it('un abono que puso el propietario no mueve el saldo, pero sí la deuda', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 200 }];
    l.purchasePayments = [
      { date: '2026-10-02', amount: 50, payer: 'OWNER', refundable: true, filamentShare: 1 },
    ];

    const c = businessCash(l);

    expect(c.filament).toBe(50);
    expect(c.contributionsRefundable).toBe(50);
    expect(c.balance).toBe(200);
  });

  it('lo que abona el prestamista no toca la caja', () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 200 }];
    l.purchasePayments = [
      { date: '2026-10-02', amount: 50, payer: 'EXTERNAL_LENDER', refundable: true, filamentShare: 1 },
    ];

    expect(businessCash(l).balance).toBe(200);
  });

  it('el desglose de una línea suma lo mismo que la línea', () => {
    const l = vacio();
    l.purchasePayments = [
      { date: '2026-10-02', amount: 30, payer: null, refundable: true, filamentShare: 1, id: 'ab-1' },
    ];

    const detalle = cashEntries(l).filter((e) => e.category === 'filament');

    expect(detalle.map((e) => e.amount)).toEqual([30]);
    expect(detalle[0].id).toBe('ab-1');
  });
});

/**
 * UN ABONO TOMADO DEL SALDO A FAVOR **NO MUEVE LA CAJA**.
 *
 * Pagaste $100 de una factura de $85: los $15 de más **ya salieron de la caja**
 * ese día, con el abono de $100. Usarlos después en otra factura no es plata que
 * sale otra vez — es la misma plata, reconocida por el proveedor. Contarla de
 * nuevo es exactamente la misma clase de doble carga que el gasto nacido de una
 * factura, por la otra puerta.
 *
 * Números PUESTOS A MANO, con su contrafáctico: sin la marca el saldo daría
 * otro número, para que el $75 no sea un número vacío.
 */
describe('saldo a favor: la plata ya salió, no sale dos veces', () => {
  const conSobrepago = () => {
    const l = vacio();
    l.sales = [{ date: '2026-10-01', amount: 175 }];
    // El abono que pagó $100 por una factura de $85: la plata salió ACÁ.
    l.purchasePayments = [
      { date: '2026-10-02', amount: 100, payer: null, refundable: true, filamentShare: 1 },
    ];
    return l;
  };

  it('el sobrepago salió de la caja una vez: 175 − 100 = 75', () => {
    expect(businessCash(conSobrepago()).balance).toBe(75);
  });

  it('usar esos $15 en otra factura NO vuelve a bajar el saldo: sigue en 75', () => {
    const l = conSobrepago();
    l.purchasePayments.push({
      date: '2026-10-08',
      amount: 15,
      payer: null,
      refundable: true,
      filamentShare: 1,
      // ⚠️ Esto es lo que le dice a la caja que esa plata ya se contó.
      fromCredit: true,
    });

    const c = businessCash(l);

    expect(c.filament).toBe(100); // el abono de verdad, no 115
    expect(c.balance).toBe(75); // ⚠️ si fueran 60, es la doble carga
  });

  /**
   * EL CONTRAFÁCTICO: el MISMO abono sin la marca sí baja la caja, que es lo
   * que pasa con un abono de verdad. Sin este test, un `businessCash` que
   * ignorara todos los abonos pasaría el de arriba.
   */
  it('el mismo abono SIN la marca sí baja el saldo a 60', () => {
    const l = conSobrepago();
    l.purchasePayments.push({
      date: '2026-10-08',
      amount: 15,
      payer: null,
      refundable: true,
      filamentShare: 1,
    });

    expect(businessCash(l).balance).toBe(60);
  });

  /**
   * ⚠️ Y tampoco emite el aporte. Si el abono del saldo lo "pone" una
   * contraparte, no puso nada: el doble asiento gasto+aporte dejaría una deuda
   * con ella por plata que nunca salió de su bolsillo.
   */
  it('ni genera aporte ni deuda, aunque venga con contraparte', () => {
    const l = vacio();
    l.purchasePayments = [
      {
        date: '2026-10-08',
        amount: 15,
        payer: 'OWNER',
        refundable: true,
        filamentShare: 1,
        fromCredit: true,
      },
    ];

    const c = businessCash(l);

    expect(c.contributionsRefundable).toBe(0);
    expect(c.filament).toBe(0);
    expect(c.balance).toBe(0);
  });

  it('no deja ningún asiento en el desglose: no es un movimiento de plata', () => {
    const l = vacio();
    l.purchasePayments = [
      {
        date: '2026-10-08',
        amount: 15,
        payer: null,
        refundable: true,
        filamentShare: 1,
        fromCredit: true,
        id: 'ab-saldo',
      },
    ];

    expect(cashEntries(l).filter((e) => e.id === 'ab-saldo')).toEqual([]);
  });
});

/**
 * LA CADENA DE CAJA: "venías con $X · este mes $Y · te queda $Z".
 *
 * Nació de un bug con nombre y apellido (2026-10-10): el Dashboard mostraba
 * juntas "Resultado de caja −61.20" y "Saldo en caja 102.83". El −61.20 era
 * cobrado del mes menos gastos del mes —tres definiciones distintas de
 * "octubre" en una pantalla— y el dueño lo leyó como un saldo. Según la caja de
 * verdad, octubre fue −30.39: venía con 133.22 y le quedaban 102.83.
 *
 * ⚠️ Por eso el del MEDIO se DERIVA de los otros dos. Calcularlo por su propio
 * camino es exactamente cómo nació el bug: dos caminos no cierran entre sí el
 * día que uno cambia, y una pantalla de dinero que se contradice es peor que no
 * tener la cadena.
 */
describe('cashChain', () => {
  it('el del medio sale de los otros dos, y los tres cierran', () => {
    const c = cashChain(133.22, 102.83);

    expect(c).toEqual({ before: 133.22, delta: -30.39, after: 102.83 });
    expect(c!.before + c!.delta).toBeCloseTo(c!.after, 10);
  });

  it('un periodo que SUMA plata da un medio positivo', () => {
    expect(cashChain(100, 250)).toEqual({ before: 100, delta: 150, after: 250 });
  });

  it('un periodo sin movimientos deja el medio en cero', () => {
    expect(cashChain(102.83, 102.83)).toEqual({ before: 102.83, delta: 0, after: 102.83 });
  });

  it('arrancar de cero no es un caso especial', () => {
    expect(cashChain(0, 45.5)).toEqual({ before: 0, delta: 45.5, after: 45.5 });
  });

  /**
   * Los dos extremos se redondean ANTES de restar, no después: redondeando el
   * resultado de la resta, `before + delta` puede dar un centavo más que
   * `after` (0.125 y 0.25 lo hacen) y la cadena deja de cerrar en pantalla.
   */
  it('redondea los extremos antes de restar, así la cadena cierra al centavo', () => {
    const c = cashChain(0.125, 0.25)!;

    expect(c.before + c.delta).toBeCloseTo(c.after, 10);
    expect(c).toEqual({ before: 0.13, delta: 0.12, after: 0.25 });
  });

  it('la resta no arrastra ruido de coma flotante', () => {
    expect(cashChain(0.3, 0.1)!.delta).toBe(-0.2);
  });

  /**
   * ⚠️ Con el filtro en "Todo" —o con un rango sin inicio— NO hay un "antes":
   * la cadena no significa nada y la pantalla muestra solo el saldo. Devolver
   * `before: 0` sería afirmar que el negocio arrancó en cero justo ahí.
   */
  it('sin un "antes" no hay cadena', () => {
    expect(cashChain(null, 102.83)).toBeNull();
  });
});

/**
 * EL TRAMO DEL MEDIO NO SE COME LO QUE VINO DESPUÉS (2026-10-10, Tarea 8.1).
 *
 * La cadena pedía el saldo de **HOY** como extremo derecho, siempre. Con el mes
 * en curso eso está bien; con un rango ya cerrado miente: elegías septiembre y
 * la pantalla decía "venías con $X al 31/8 · en el rango $Y", pero ese Y traía
 * octubre entero adentro.
 *
 * La razón que se había dado para no arreglarlo —"Z tiene que ser el mismo
 * número que la tarjeta Saldo en caja"— no se sostiene: el saldo al final del
 * rango no es otra definición, es el MISMO `businessCash` con otra fecha de
 * corte. Y la tarjeta sigue siendo el saldo de hoy a propósito: son dos
 * números distintos, y cada uno dice cuál es.
 *
 * `cashChainCuts` es la pieza que decide QUÉ saldos pedir y si el periodo ya
 * cerró. Vive acá, en una función pura, porque es la decisión que estaba mal:
 * dejarla en el JSX del Dashboard la volvía a dejar sin test.
 */
describe('cashChainCuts', () => {
  const HOY = '2026-10-10';

  it('un rango YA CERRADO corta en su propio fin, no en hoy', () => {
    const cortes = cashChainCuts('2026-09-01', '2026-09-30', HOY);

    expect(cortes).toEqual({ before: '2026-08-31', end: '2026-09-30', closed: true });
  });

  it('el rango EN CURSO se mide contra hoy: el mismo número que la tarjeta de saldo', () => {
    // "Este mes" va hasta el 31, que todavía no llegó. Pedir el saldo "al 31"
    // sería pedir el futuro; el saldo de hoy ES el cierre provisorio.
    expect(cashChainCuts('2026-10-01', '2026-10-31', HOY)).toEqual({
      before: '2026-09-30',
      end: null,
      closed: false,
    });
  });

  it('un rango que termina HOY todavía no cerró: queda abierto hasta la medianoche', () => {
    expect(cashChainCuts('2026-10-01', HOY, HOY)).toEqual({
      before: '2026-09-30',
      end: null,
      closed: false,
    });
  });

  it('"ayer" es un periodo cerrado: con eso se quedó al cierre, no es lo que tiene hoy', () => {
    expect(cashChainCuts('2026-10-09', '2026-10-09', HOY)).toEqual({
      before: '2026-10-08',
      end: '2026-10-09',
      closed: true,
    });
  });

  it('un rango sin fin llega hasta hoy', () => {
    expect(cashChainCuts('2026-09-01', undefined, HOY)).toEqual({
      before: '2026-08-31',
      end: null,
      closed: false,
    });
  });

  /**
   * Con el filtro en "Todo" no hay un "antes" y la cadena no se dibuja; el
   * `before: null` es lo que `cashChain` convierte en `null`.
   */
  it('sin inicio no hay cadena', () => {
    for (const sin of [undefined, null, '']) {
      expect(cashChainCuts(sin, '2026-09-30', HOY)).toEqual({
        before: null,
        end: null,
        closed: false,
      });
    }
  });

  /**
   * Red de seguridad: el rango sale de un `<input type="date">`, así que
   * siempre es un día real, pero `previousDay` LANZA con un día inventado y acá
   * eso sería una pantalla en blanco en vez de una cadena menos.
   */
  it('un día que no existe no revienta la pantalla: no hay cadena', () => {
    expect(cashChainCuts('2026-02-30', '2026-02-28', HOY)).toEqual({
      before: null,
      end: null,
      closed: false,
    });
  });

  it('un fin inventado se trata como "sin fin": se mide contra hoy', () => {
    expect(cashChainCuts('2026-09-01', '2026-09-31', HOY)).toEqual({
      before: '2026-08-31',
      end: null,
      closed: false,
    });
  });
});

/**
 * LA CADENA ARMADA DE PUNTA A PUNTA, con números puestos a mano.
 *
 * Es el test con dientes: un libro con movimientos en agosto, septiembre y
 * octubre, y la cadena de **septiembre** tiene que decir lo que pasó en
 * septiembre. Con el extremo derecho en "el saldo de hoy" —como estaba— el
 * tramo del medio se comía los −40 de octubre.
 */
describe('la cadena de un rango pasado no absorbe lo posterior', () => {
  const HOY = '2026-10-10';

  /** 100 en agosto, +50 en septiembre, −40 en octubre. */
  const libro = (): CashLedger => {
    const l = vacio();
    l.sales = [
      { date: '2026-08-15', amount: 100 },
      { date: '2026-09-10', amount: 50 },
    ];
    l.expenses = [
      { date: '2026-10-05', amount: 40, payer: null, isInvestment: false, isFilament: false, refundable: true },
    ];
    return l;
  };

  it('septiembre es +50, no +10', () => {
    const l = libro();
    const cortes = cashChainCuts('2026-09-01', '2026-09-30', HOY);

    const antes = businessCash(l, cortes.before!).balance;
    const alFinal = businessCash(l, cortes.end!).balance;
    const c = cashChain(antes, alFinal)!;

    expect(c.before).toBe(100); // lo de agosto
    expect(c.delta).toBe(50); // SOLO septiembre
    expect(c.after).toBe(150); // el cierre de septiembre
    expect(c.before + c.delta).toBe(c.after);

    // Y el saldo de HOY es otro número, a propósito: la tarjeta sigue siendo éste.
    expect(businessCash(l).balance).toBe(110);
    expect(c.after).not.toBe(businessCash(l).balance);
  });

  it('el mes en curso sí cierra en el saldo de hoy', () => {
    const l = libro();
    const cortes = cashChainCuts('2026-10-01', '2026-10-31', HOY);

    expect(cortes.end).toBeNull(); // = el saldo de hoy, el de la tarjeta
    const c = cashChain(businessCash(l, cortes.before!).balance, businessCash(l).balance)!;

    expect(c).toEqual({ before: 150, delta: -40, after: 110 });
  });
});
