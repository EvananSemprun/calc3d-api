import { notaDePagador, type CompraParaPagador } from './filament-payer';

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
