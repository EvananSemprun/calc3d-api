import {
  notaDePagador,
  repartoDePagadores,
  textoDeReparto,
  type CompraParaPagador,
  type GastoParaPagador,
} from './pagador';

/**
 * QUIÉN PUSO LA PLATA (2026-10-11, shared 0.49.0).
 *
 * El caso real de producción: la pantalla listaba $202 de compras y la caja
 * solo había soltado $142. Lo que se fija acá es que el texto **no invente un
 * hecho**: el saldo que se muestra es el de la FACTURA, y con varias líneas lo
 * dice, porque repartirlo entre las líneas sería una convención escrita como si
 * fuera un dato del rollo.
 */

/** Dinero como lo escribe el panel: así el test compara el texto COMPLETO. */
const money = (n: number) => `$${n.toFixed(2)}`;

const compra = (over: Partial<CompraParaPagador> = {}): CompraParaPagador => ({
  counterpartyId: null,
  counterpartyName: null,
  invoice: null,
  ...over,
});

const factura = (over: Partial<NonNullable<CompraParaPagador['invoice']>> = {}) => ({
  id: 'f1',
  saldo: 10,
  total: 25,
  lineas: 1,
  ...over,
});

describe('notaDePagador', () => {
  /**
   * ⚠️ El caso normal es el SILENCIO. Con una etiqueta en cada fila, ninguna se
   * ve: es la única razón por la que las excepciones de abajo avisan de algo.
   */
  it('la pagó la caja y no hay nada que decir: no dice nada', () => {
    expect(notaDePagador(compra(), money)).toBeNull();
  });

  it('la puso una persona de su bolsillo: lo dice y dice que se le debe', () => {
    const nota = notaDePagador(
      compra({ counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
      money,
    );
    expect(nota).toBe('Lo puso Evanan · el negocio se lo debe');
  });

  it('sin el nombre de la contraparte, igual avisa que no fue la caja', () => {
    expect(notaDePagador(compra({ counterpartyId: 'cp1' }), money)).toBe(
      'Lo puso otra persona · el negocio se lo debe',
    );
  });

  it('una factura SALDADA no dice que falta plata', () => {
    expect(notaDePagador(compra({ invoice: factura({ saldo: 0 }) }), money)).toBeNull();
  });

  /**
   * Pagado de MÁS: `invoiceTotals` recorta el saldo en 0 y el sobrepago sale
   * por `aFavor`, pero si algún día llegara un número al revés tampoco puede
   * leerse como "faltan −$5".
   */
  it('un saldo que no es positivo nunca se anuncia', () => {
    expect(notaDePagador(compra({ invoice: factura({ saldo: -5 }) }), money)).toBeNull();
  });

  it('una factura de UNA línea abonada a medias: faltan $10 de la factura', () => {
    expect(notaDePagador(compra({ invoice: factura({ saldo: 10 }) }), money)).toBe(
      'Faltan $10.00 de esta factura',
    );
  });

  /**
   * ⚠️ EL PUNTO DE TODO ESTO. $40 de una factura de cuatro líneas NO son $40
   * de este rollo, y el texto tiene que ser verdad igual: nombra la factura
   * ENTERA y dice cuántas líneas tiene.
   */
  it('una factura de VARIAS líneas dice que el saldo es de la factura entera', () => {
    const nota = notaDePagador(compra({ invoice: factura({ saldo: 40, lineas: 4 }) }), money);
    expect(nota).toBe(
      'Faltan $40.00 de la factura entera (4 líneas)',
    );
    // Y no puede leerse como si los $40 fueran de este renglón.
    expect(nota).toContain('la factura entera');
  });

  /** Con las dos cosas, la plata la movieron los abonos de la factura. */
  it('la factura gana sobre la contraparte', () => {
    expect(
      notaDePagador(
        compra({ counterpartyId: 'cp1', counterpartyName: 'Evanan', invoice: factura() }),
        money,
      ),
    ).toBe('Faltan $10.00 de esta factura');
  });

  /** El monto lo escribe quien llama: la moneda del dueño no se decide acá. */
  it('usa el formato de monto que le pasan', () => {
    expect(
      notaDePagador(compra({ invoice: factura({ saldo: 10 }) }), (n) => `Bs ${n * 2}`),
    ).toBe('Faltan Bs 20 de esta factura');
  });
});

/**
 * EL PIE DEL KPI DE GASTOS (2026-10-11, shared 0.50.0).
 *
 * El dueño leyó «GASTOS $202.00» y creyó que la caja había soltado $202. Soltó
 * $142. Lo que se fija acá es, sobre todo, que **las tres partes sumen el
 * total**: parado al lado del KPI, un desglose que no cuadra destruye la
 * confianza en los dos números.
 */

const gasto = (amount: number, over: Partial<GastoParaPagador> = {}): GastoParaPagador => ({
  amount,
  counterpartyId: null,
  counterpartyName: null,
  invoice: null,
  ...over,
});

/** Octubre de 2026 en producción: $142 la caja, $50 Evanan, $10 sin pagar. */
const OCTUBRE: GastoParaPagador[] = [
  gasto(142),
  gasto(25, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
  gasto(25, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
  gasto(25, { invoice: { id: 'f1', saldo: 10, total: 25, lineas: 1 } }),
];

describe('repartoDePagadores', () => {
  it('parte el total de octubre en los tres pedazos del dueño', () => {
    const r = repartoDePagadores(OCTUBRE);

    expect(r.total).toBe(217);
    expect(r.deBolsillo).toBe(50);
    expect(r.sinPagar).toBe(10);
    // $142 de gasto puro + los $15 que la caja SÍ abonó del Cyan.
    expect(r.caja).toBe(157);
    expect(r.nombres).toEqual(['Evanan']);
  });

  it('sin nada raro, todo es de la caja', () => {
    const r = repartoDePagadores([gasto(100), gasto(2.5)]);

    expect(r).toEqual({ total: 102.5, caja: 102.5, deBolsillo: 0, sinPagar: 0, nombres: [] });
  });

  /**
   * ⚠️ UNA FACTURA CUENTA UNA VEZ. Fila por fila, esta factura de cuatro
   * líneas sumaría su saldo cuatro veces ($160 sin pagar de un total de $100)
   * y el pie diría un disparate.
   */
  it('una factura de varias líneas no suma su saldo una vez por línea', () => {
    const f = { id: 'f9', saldo: 40, total: 100, lineas: 4 };
    const r = repartoDePagadores([
      gasto(25, { invoice: f }),
      gasto(25, { invoice: f }),
      gasto(25, { invoice: f }),
      gasto(25, { invoice: f }),
    ]);

    expect(r.total).toBe(100);
    expect(r.sinPagar).toBe(40);
    expect(r.caja).toBe(60);
  });

  /**
   * EL PRORRATEO, que es una CONVENCIÓN. De la factura de $100 con $40 sin
   * pagar, solo una línea de $25 cae en el periodo: le toca el 40 % de esos
   * $25, o sea $10. El resto del saldo es de las líneas que quedaron afuera.
   */
  it('prorratea el saldo cuando solo parte de la factura cae en el periodo', () => {
    const r = repartoDePagadores([
      gasto(25, { invoice: { id: 'f9', saldo: 40, total: 100, lineas: 4 } }),
    ]);

    expect(r.sinPagar).toBe(10);
    expect(r.caja).toBe(15);
  });

  it('una factura saldada no deja nada sin pagar', () => {
    const r = repartoDePagadores([
      gasto(25, { invoice: { id: 'f2', saldo: 0, total: 25, lineas: 1 } }),
    ]);

    expect(r.sinPagar).toBe(0);
    expect(r.caja).toBe(25);
  });

  it('una factura con el total en cero no inventa una fracción', () => {
    const r = repartoDePagadores([
      gasto(25, { invoice: { id: 'f3', saldo: 5, total: 0, lineas: 1 } }),
    ]);

    expect(r.sinPagar).toBe(0);
    expect(r.caja).toBe(25);
  });

  it('con factura Y contraparte gana la factura, igual que la nota', () => {
    const r = repartoDePagadores([
      gasto(25, {
        counterpartyId: 'cp1',
        counterpartyName: 'Evanan',
        invoice: { id: 'f1', saldo: 25, total: 25, lineas: 1 },
      }),
    ]);

    expect(r.deBolsillo).toBe(0);
    expect(r.sinPagar).toBe(25);
    expect(r.nombres).toEqual([]);
  });

  it('junta a cada persona una sola vez, aunque haya puesto varias veces', () => {
    const r = repartoDePagadores([
      gasto(10, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
      gasto(10, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
      gasto(10, { counterpartyId: 'cp2', counterpartyName: 'Socio' }),
    ]);

    expect(r.nombres).toEqual(['Evanan', 'Socio']);
    expect(r.deBolsillo).toBe(30);
  });

  it('sin gastos devuelve todo en cero, no NaN', () => {
    expect(repartoDePagadores([])).toEqual({
      total: 0,
      caja: 0,
      deBolsillo: 0,
      sinPagar: 0,
      nombres: [],
    });
  });

  /**
   * ⚠️ **LA PROPIEDAD QUE SOSTIENE AL PIE**: las tres partes suman el total,
   * en todos los escenarios y no en uno. Va con varios mezclados a propósito —
   * con uno solo, una cuenta mal prorrateada puede cuadrar de casualidad.
   */
  describe('las partes SIEMPRE suman el total', () => {
    const escenarios: [string, GastoParaPagador[]][] = [
      ['octubre de producción', OCTUBRE],
      ['nada raro', [gasto(100), gasto(2.5)]],
      ['solo de bolsillo', [gasto(50, { counterpartyId: 'cp1', counterpartyName: 'Evanan' })]],
      [
        'una factura repetida en cuatro líneas',
        [1, 2, 3, 4].map(() =>
          gasto(25, { invoice: { id: 'f9', saldo: 40, total: 100, lineas: 4 } }),
        ),
      ],
      [
        'dos facturas distintas, una saldada',
        [
          gasto(25, { invoice: { id: 'f1', saldo: 10, total: 25, lineas: 1 } }),
          gasto(30, { invoice: { id: 'f2', saldo: 0, total: 30, lineas: 1 } }),
        ],
      ],
      [
        'todo mezclado, con centavos feos',
        [
          gasto(19.02),
          gasto(25.94, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
          gasto(7.77, { counterpartyId: 'cp2', counterpartyName: 'Socio' }),
          gasto(13.33, { invoice: { id: 'f1', saldo: 7.77, total: 13.33, lineas: 1 } }),
          gasto(0.01, { invoice: { id: 'f2', saldo: 0.01, total: 0.03, lineas: 3 } }),
          gasto(66.66),
        ],
      ],
      [
        'una factura que no se pagó nada',
        [gasto(80, { invoice: { id: 'f7', saldo: 80, total: 80, lineas: 2 } })],
      ],
    ];

    it.each(escenarios)('%s', (_nombre, gastos) => {
      const r = repartoDePagadores(gastos);

      expect(r.caja + r.deBolsillo + r.sinPagar).toBeCloseTo(r.total, 10);
      expect(r.caja).toBeGreaterThanOrEqual(0);
      expect(r.deBolsillo).toBeGreaterThanOrEqual(0);
      expect(r.sinPagar).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('textoDeReparto', () => {
  const money = (n: number) => `$${n.toFixed(2)}`;

  it('la caja pagó todo: no hay nada que agregar y el renglón se queda como estaba', () => {
    expect(textoDeReparto(repartoDePagadores([gasto(100)]), money)).toBeNull();
  });

  it('los tres pedazos de octubre, y se puede verificar que suman', () => {
    expect(textoDeReparto(repartoDePagadores(OCTUBRE), money)).toBe(
      '$157.00 de la caja · $50.00 lo puso Evanan · $10.00 sin pagar',
    );
  });

  it('omite el pedazo que es cero en vez de decir que nadie puso $0', () => {
    const soloSinPagar = repartoDePagadores([
      gasto(142),
      gasto(25, { invoice: { id: 'f1', saldo: 10, total: 25, lineas: 1 } }),
    ]);
    expect(textoDeReparto(soloSinPagar, money)).toBe('$157.00 de la caja · $10.00 sin pagar');

    const soloBolsillo = repartoDePagadores([
      gasto(142),
      gasto(50, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
    ]);
    expect(textoDeReparto(soloBolsillo, money)).toBe('$142.00 de la caja · $50.00 lo puso Evanan');
  });

  /** Tres nombres en el pie de un KPI no entran, y no es ahí donde se leen. */
  it('con varios bolsillos no los nombra a todos', () => {
    const r = repartoDePagadores([
      gasto(100),
      gasto(10, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
      gasto(10, { counterpartyId: 'cp2', counterpartyName: 'Socio' }),
    ]);
    expect(textoDeReparto(r, money)).toBe('$100.00 de la caja · $20.00 de bolsillo');
  });
});
