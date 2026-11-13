import { usdDesdeMoneda, saldoAFavorDelAbono, AbonoRedondeaACeroError } from './abono-en-moneda';

describe('usdDesdeMoneda', () => {
  it('DIVIDE entre la tasa, no multiplica', () => {
    // Bs 1.900 a 250 Bs por USD. Multiplicando darían 475.000.
    expect(usdDesdeMoneda(1900, 250)).toBe(7.6);
  });

  it('el caso de la captura del dueño: Bs 1.900 ÷ 250 = $7,60', () => {
    expect(usdDesdeMoneda(1900, 250)).toBeCloseTo(7.6, 10);
  });

  it('no arrastra basura de coma flotante', () => {
    // 0.1 + 0.2 del mundo del dinero: con números crudos da 7.599999999999999.
    expect(String(usdDesdeMoneda(1900, 250))).toBe('7.6');
  });

  it('redondea a 4 decimales, la precisión del motor', () => {
    expect(usdDesdeMoneda(100, 3)).toBe(33.3333);
  });

  it('una tasa en cero o negativa NO devuelve infinito: lanza', () => {
    expect(() => usdDesdeMoneda(1900, 0)).toThrow(/mayor que cero/);
    expect(() => usdDesdeMoneda(1900, -250)).toThrow(/mayor que cero/);
  });

  it('un monto en cero o negativo lanza', () => {
    expect(() => usdDesdeMoneda(0, 250)).toThrow(/mayor que cero/);
    expect(() => usdDesdeMoneda(-10, 250)).toThrow(/mayor que cero/);
  });

  it('un valor ilegible lanza en vez de producir NaN', () => {
    expect(() => usdDesdeMoneda(Number('x'), 250)).toThrow(/números/);
    expect(() => usdDesdeMoneda(1900, Number.POSITIVE_INFINITY)).toThrow(/números/);
  });
});

describe("usdDesdeMoneda: el resultado que redondea a cero", () => {
  it("Bs 0,001 a tasa 250 lanza el error CON NOMBRE y lleva el monto y la tasa", () => {
    let error: unknown;
    try {
      usdDesdeMoneda(0.001, 250);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AbonoRedondeaACeroError);
    const e = error as AbonoRedondeaACeroError;
    expect(e.name).toBe("AbonoRedondeaACeroError");
    expect(e.montoEnMoneda).toBe(0.001);
    expect(e.tasa).toBe(250);
  });

  it("hermano: 0,025 a 250 da justo 0,0001 y NO lanza", () => {
    expect(usdDesdeMoneda(0.025, 250)).toBe(0.0001);
  });

  it("las entradas inválidas siguen lanzando su Error de siempre, no este", () => {
    expect(() => usdDesdeMoneda(0, 250)).not.toThrow(AbonoRedondeaACeroError);
    expect(() => usdDesdeMoneda(0, 250)).toThrow(/mayor que cero/);
  });
});

describe('saldoAFavorDelAbono', () => {
  it('sin pasarse devuelve 0', () => {
    expect(saldoAFavorDelAbono(100, 60)).toBe(0);
    expect(saldoAFavorDelAbono(100, 100)).toBe(0);
  });

  it('pasándose devuelve la diferencia', () => {
    expect(saldoAFavorDelAbono(100, 100.4)).toBe(0.4);
  });

  /**
   * ⚠️ El que importa: dividir bolívares deja residuos de cuatro decimales que
   * no son plata de nadie. Sin el recorte al centavo, un abono EXACTO sacaría
   * el aviso de "queda a favor" y el dueño aprendería a ignorarlo.
   */
  it('un residuo de la división NO cuenta como saldo a favor', () => {
    const usd = usdDesdeMoneda(1900, 250.0001); // 7.5999...
    expect(saldoAFavorDelAbono(7.5999, usd)).toBe(0);
  });

  it('con el saldo en cero, todo el abono queda a favor', () => {
    expect(saldoAFavorDelAbono(0, 7.6)).toBe(7.6);
  });
});
