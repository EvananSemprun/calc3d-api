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
  counterpartyKind: null,
  invoice: null,
  ...over,
});

/**
 * Una factura por defecto **abonada por la caja**: $15 de $25, faltan $10. Es
 * el caso real de producción (el Cyan de StratoFill) y el que más se repite,
 * así que cada test solo escribe lo que lo hace distinto.
 */
const factura = (
  over: Partial<NonNullable<CompraParaPagador['invoice']>> = {},
): NonNullable<CompraParaPagador['invoice']> => {
  const base = { id: 'f1', saldo: 10, total: 25, lineas: 1, ...over };
  return {
    ...base,
    // Por defecto **lo abonado salió todo de la caja**, que es el caso normal
    // y lo que la app suponía de TODAS las facturas hasta shared 0.50.0. Un
    // test que quiera otro origen lo pasa explícito.
    abonado: over.abonado ?? abonado({ total: Math.max(base.total - base.saldo, 0) }),
    bolsillos: over.bolsillos ?? [],
  };
};

/** Lo abonado, diciendo de dónde salió cada parte. La caja es el resto. */
const abonado = (
  over: Partial<NonNullable<CompraParaPagador['invoice']>['abonado']> = {},
): NonNullable<CompraParaPagador['invoice']>['abonado'] => ({
  total: 0,
  bolsillo: 0,
  saldoAFavor: 0,
  prestamista: 0,
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
  counterpartyKind: null,
  invoice: null,
  ...over,
});

/** Quien puso la plata de su bolsillo, para no repetir las tres propiedades. */
const bolsillo = (nombre = 'Evanan'): Partial<GastoParaPagador> => ({
  counterpartyId: 'cp1',
  counterpartyName: nombre,
  counterpartyKind: 'OWNER',
});

/** Octubre de 2026 en producción: $142 la caja, $50 Evanan, $10 sin pagar. */
const OCTUBRE: GastoParaPagador[] = [
  gasto(142),
  gasto(25, bolsillo()),
  gasto(25, bolsillo()),
  gasto(25, { invoice: factura() }),
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

    expect(r).toEqual({
      total: 102.5,
      caja: 102.5,
      deBolsillo: 0,
      conSaldoAFavor: 0,
      delPrestamista: 0,
      sinPagar: 0,
      nombres: [],
    });
  });

  /**
   * ⚠️ UNA FACTURA CUENTA UNA VEZ. Fila por fila, esta factura de cuatro
   * líneas sumaría su saldo cuatro veces ($160 sin pagar de un total de $100)
   * y el pie diría un disparate.
   */
  it('una factura de varias líneas no suma su saldo una vez por línea', () => {
    const f = factura({ id: 'f9', saldo: 40, total: 100, lineas: 4, abonado: abonado({ total: 60 }) });
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
      gasto(25, { invoice: factura({ id: 'f9', saldo: 40, total: 100, lineas: 4 }) }),
    ]);

    expect(r.sinPagar).toBe(10);
    expect(r.caja).toBe(15);
  });

  it('una factura saldada no deja nada sin pagar', () => {
    const r = repartoDePagadores([
      gasto(25, { invoice: factura({ id: 'f2', saldo: 0, total: 25, lineas: 1 }) }),
    ]);

    expect(r.sinPagar).toBe(0);
    expect(r.caja).toBe(25);
  });

  it('una factura con el total en cero no inventa una fracción', () => {
    const r = repartoDePagadores([
      gasto(25, { invoice: factura({ id: 'f3', saldo: 5, total: 0, lineas: 1 }) }),
    ]);

    expect(r.sinPagar).toBe(0);
    expect(r.caja).toBe(25);
  });

  it('con factura Y contraparte gana la factura, igual que la nota', () => {
    const r = repartoDePagadores([
      gasto(25, {
        counterpartyId: 'cp1',
        counterpartyName: 'Evanan',
        invoice: factura({ id: 'f1', saldo: 25, total: 25, lineas: 1 }),
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
      conSaldoAFavor: 0,
      delPrestamista: 0,
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
          gasto(25, { invoice: factura({ id: 'f9', saldo: 40, total: 100, lineas: 4 }) }),
        ),
      ],
      [
        'dos facturas distintas, una saldada',
        [
          gasto(25, { invoice: factura({ id: 'f1', saldo: 10, total: 25, lineas: 1 }) }),
          gasto(30, { invoice: factura({ id: 'f2', saldo: 0, total: 30, lineas: 1 }) }),
        ],
      ],
      [
        'todo mezclado, con centavos feos',
        [
          gasto(19.02),
          gasto(25.94, { counterpartyId: 'cp1', counterpartyName: 'Evanan' }),
          gasto(7.77, { counterpartyId: 'cp2', counterpartyName: 'Socio' }),
          gasto(13.33, { invoice: factura({ id: 'f1', saldo: 7.77, total: 13.33, lineas: 1 }) }),
          gasto(0.01, { invoice: factura({ id: 'f2', saldo: 0.01, total: 0.03, lineas: 3 }) }),
          gasto(66.66),
        ],
      ],
      [
        'una factura que no se pagó nada',
        [gasto(80, { invoice: factura({ id: 'f7', saldo: 80, total: 80, lineas: 2 }) })],
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
      gasto(25, { invoice: factura({ id: 'f1', saldo: 10, total: 25, lineas: 1 }) }),
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

/**
 * DE DÓNDE SALIÓ LA PLATA DE LOS ABONOS (2026-10-11, shared 0.51.0).
 *
 * Hasta shared 0.50.0 todo lo abonado a una factura se contaba como "de la
 * caja". El diálogo de Abonar deja elegir otra cosa desde que existe, así que
 * bastaba un abono de bolsillo para que el pie del KPI dijera que esa plata
 * había salido del negocio.
 *
 * ⚠️ **ESTOS TESTS SON LA ÚNICA EVIDENCIA DE QUE ESTO ANDA.** Medido en
 * producción el día que se escribieron: hay UNA factura y UN abono, pagado por
 * la caja. Cero de bolsillo, cero con saldo a favor, cero del prestamista,
 * cero facturas de varias líneas. No hay pantalla donde ir a mirarlo.
 */
describe('de dónde salió la plata de los abonos', () => {
  /** Una factura saldada, pero la pagó alguien de su bolsillo. */
  const saldadaDeBolsillo = factura({
    saldo: 0,
    total: 25,
    abonado: abonado({ total: 25, bolsillo: 25 }),
    bolsillos: ['Evanan'],
  });

  describe('notaDePagador', () => {
    /**
     * ⚠️ El caso que destapó el hueco: antes esto devolvía `null` —la factura
     * está saldada, no falta plata— y la fila se callaba justo cuando más
     * tenía para contar. Que no falte plata no quiere decir que la haya puesto
     * el negocio.
     */
    it('una factura SALDADA de bolsillo igual dice quién la puso', () => {
      expect(notaDePagador(compra({ invoice: saldadaDeBolsillo }), money)).toBe(
        '$25.00 lo puso Evanan',
      );
    });

    it('con saldo Y bolsillo dice las dos cosas', () => {
      const nota = notaDePagador(
        compra({
          invoice: factura({
            saldo: 10,
            total: 25,
            abonado: abonado({ total: 15, bolsillo: 15 }),
            bolsillos: ['Evanan'],
          }),
        }),
        money,
      );
      expect(nota).toBe('Faltan $10.00 de esta factura · $15.00 lo puso Evanan');
    });

    it('lo tomado del saldo a favor se dice como tal: no es plata que salga hoy', () => {
      const nota = notaDePagador(
        compra({
          invoice: factura({
            saldo: 0,
            total: 25,
            abonado: abonado({ total: 25, saldoAFavor: 25 }),
          }),
        }),
        money,
      );
      expect(nota).toBe('$25.00 con saldo a favor');
    });

    it('lo que puso el prestamista lo nombra a él', () => {
      const nota = notaDePagador(
        compra({
          invoice: factura({
            saldo: 0,
            total: 25,
            abonado: abonado({ total: 25, prestamista: 25 }),
          }),
        }),
        money,
      );
      expect(nota).toBe('$25.00 lo puso el prestamista');
    });

    /**
     * ⚠️ Con VARIOS orígenes se dice el total y no el detalle: esta frase vive
     * en una celda de tabla y el detalle la parte en tres renglones. Lo que
     * importa acá es que esa plata no salió de la caja.
     */
    it('con varios orígenes dice el total, no el detalle', () => {
      const nota = notaDePagador(
        compra({
          invoice: factura({
            saldo: 0,
            total: 30,
            abonado: abonado({ total: 30, bolsillo: 18, saldoAFavor: 12 }),
            bolsillos: ['Evanan'],
          }),
        }),
        money,
      );
      expect(nota).toBe('$30.00 no salió de la caja');
    });

    it('con varios bolsillos no los nombra a todos', () => {
      const nota = notaDePagador(
        compra({
          invoice: factura({
            saldo: 0,
            total: 20,
            abonado: abonado({ total: 20, bolsillo: 20 }),
            bolsillos: ['Evanan', 'Socio'],
          }),
        }),
        money,
      );
      expect(nota).toBe('$20.00 de bolsillo');
    });

    /** Lo abonado por la caja sigue sin decir nada: es el caso normal. */
    it('una factura saldada por la caja sigue callada', () => {
      expect(notaDePagador(compra({ invoice: factura({ saldo: 0 }) }), money)).toBeNull();
    });

    /**
     * ⚠️ Un gasto directo del prestamista **no lleva "el negocio se lo debe"**:
     * esa deuda ya vive en el saldo del préstamo, y prometerla también acá la
     * cuenta dos veces.
     */
    it('un gasto directo del prestamista no promete una deuda que ya existe', () => {
      const nota = notaDePagador(
        compra({
          counterpartyId: 'cp9',
          counterpartyName: 'Prestamista',
          counterpartyKind: 'EXTERNAL_LENDER',
        }),
        money,
      );
      expect(nota).toBe('Lo puso el prestamista');
    });

    it('un socio sí genera deuda, igual que el propietario', () => {
      const nota = notaDePagador(
        compra({ counterpartyId: 'cp2', counterpartyName: 'Socio', counterpartyKind: 'PARTNER' }),
        money,
      );
      expect(nota).toBe('Lo puso Socio · el negocio se lo debe');
    });
  });

  describe('repartoDePagadores', () => {
    it('un abono de bolsillo NO se cuenta como caja', () => {
      const r = repartoDePagadores([gasto(25, { invoice: saldadaDeBolsillo })]);

      expect(r.total).toBe(25);
      expect(r.deBolsillo).toBe(25);
      expect(r.caja).toBe(0);
      expect(r.nombres).toEqual(['Evanan']);
    });

    it('lo tomado del saldo a favor va a su propio pedazo', () => {
      const r = repartoDePagadores([
        gasto(25, {
          invoice: factura({
            saldo: 0,
            total: 25,
            abonado: abonado({ total: 25, saldoAFavor: 25 }),
          }),
        }),
      ]);

      expect(r.conSaldoAFavor).toBe(25);
      expect(r.caja).toBe(0);
      // No es de nadie: el saldo a favor no es el bolsillo de una persona.
      expect(r.nombres).toEqual([]);
    });

    it('lo del prestamista va a su propio pedazo y no al bolsillo', () => {
      const r = repartoDePagadores([
        gasto(25, {
          invoice: factura({
            saldo: 0,
            total: 25,
            abonado: abonado({ total: 25, prestamista: 25 }),
          }),
        }),
      ]);

      expect(r.delPrestamista).toBe(25);
      expect(r.deBolsillo).toBe(0);
      expect(r.caja).toBe(0);
    });

    /**
     * ⚠️ **Un gasto DIRECTO del prestamista tampoco es bolsillo.** Es el mismo
     * criterio que `generaObligacion` en `cash.ts`: lo del prestamista no es
     * un aporte que el negocio le devuelva por este lado.
     */
    it('un gasto directo del prestamista no engorda el bolsillo', () => {
      const r = repartoDePagadores([
        gasto(100),
        gasto(40, {
          counterpartyId: 'cp9',
          counterpartyName: 'Prestamista',
          counterpartyKind: 'EXTERNAL_LENDER',
        }),
      ]);

      expect(r.delPrestamista).toBe(40);
      expect(r.deBolsillo).toBe(0);
      expect(r.caja).toBe(100);
      expect(r.nombres).toEqual([]);
    });

    /** Una factura abonada por dos lados: el gasto se parte a prorrata. */
    it('reparte un gasto entre los orígenes de su factura', () => {
      const r = repartoDePagadores([
        gasto(100, {
          invoice: factura({
            saldo: 20,
            total: 100,
            abonado: abonado({ total: 80, bolsillo: 60, saldoAFavor: 20 }),
            bolsillos: ['Evanan'],
          }),
        }),
      ]);

      expect(r.sinPagar).toBe(20);
      expect(r.deBolsillo).toBe(60);
      expect(r.conSaldoAFavor).toBe(20);
      expect(r.caja).toBe(0);
    });

    /**
     * ⚠️ **PAGADA DE MÁS.** `invoiceTotals` recorta el saldo en 0 y el
     * excedente sale por `aFavor`, así que lo abonado ($120) es más que la
     * factura ($100). Al gasto se le imputa su monto y nada más, y los
     * orígenes se reparten en la proporción en que abonaron: contar los $120
     * pondría en el pie plata que esta factura no costó.
     */
    it('una factura pagada de más no infla el reparto', () => {
      const r = repartoDePagadores([
        gasto(100, {
          invoice: factura({
            saldo: 0,
            total: 100,
            abonado: abonado({ total: 120, bolsillo: 60 }),
            bolsillos: ['Evanan'],
          }),
        }),
      ]);

      expect(r.total).toBe(100);
      expect(r.deBolsillo).toBe(50); // 60/120 de los $100
      expect(r.caja).toBe(50);
      expect(r.sinPagar).toBe(0);
    });

    /** Solo una línea de la factura cae en el periodo: se prorratea todo. */
    it('prorratea también los orígenes cuando cae solo parte de la factura', () => {
      const f = factura({
        saldo: 40,
        total: 100,
        lineas: 4,
        abonado: abonado({ total: 60, bolsillo: 30, prestamista: 30 }),
        bolsillos: ['Evanan'],
      });
      const r = repartoDePagadores([gasto(25, { invoice: f })]);

      expect(r.total).toBe(25);
      expect(r.sinPagar).toBe(10); // 40 % de $25
      expect(r.deBolsillo).toBe(7.5); // la mitad del 60 % restante
      expect(r.delPrestamista).toBe(7.5);
      expect(r.caja).toBe(0);
    });

    it('el mismo nombre no se repite aunque abone dos facturas', () => {
      const deEvanan = (id: string) =>
        factura({
          id,
          saldo: 0,
          total: 10,
          abonado: abonado({ total: 10, bolsillo: 10 }),
          bolsillos: ['Evanan'],
        });
      const r = repartoDePagadores([
        gasto(10, { invoice: deEvanan('f1') }),
        gasto(10, { invoice: deEvanan('f2') }),
        gasto(5, bolsillo()),
      ]);

      expect(r.nombres).toEqual(['Evanan']);
      expect(r.deBolsillo).toBe(25);
    });
  });

  describe('textoDeReparto', () => {
    it('escribe los cinco pedazos cuando los hay', () => {
      const r = repartoDePagadores([
        gasto(100),
        gasto(50, bolsillo()),
        gasto(30, {
          counterpartyId: 'cp9',
          counterpartyName: 'Prestamista',
          counterpartyKind: 'EXTERNAL_LENDER',
        }),
        gasto(25, {
          invoice: factura({
            saldo: 10,
            total: 25,
            abonado: abonado({ total: 15, saldoAFavor: 15 }),
          }),
        }),
      ]);

      expect(textoDeReparto(r, money)).toBe(
        '$100.00 de la caja · $50.00 lo puso Evanan · $15.00 con saldo a favor · ' +
          '$30.00 lo puso el prestamista · $10.00 sin pagar',
      );
    });

    /**
     * ⚠️ La caja también se omite si es cero. El mes que el dueño no haya
     * puesto un peso del negocio, "$0.00 de la caja" sería lo primero que se
     * lee en el pie de su KPI de gastos.
     */
    it('no dice "$0.00 de la caja" cuando el negocio no puso nada', () => {
      const r = repartoDePagadores([gasto(25, { invoice: saldadaDeBolsillo })]);
      expect(textoDeReparto(r, money)).toBe('$25.00 lo puso Evanan');
    });

    it('la caja sola sigue sin decir nada', () => {
      const r = repartoDePagadores([gasto(100), gasto(25, { invoice: factura({ saldo: 0 }) })]);
      expect(textoDeReparto(r, money)).toBeNull();
    });
  });
});
