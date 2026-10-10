import { breakEvenLevels, equilibrioYCompromiso } from './breakeven';

/**
 * LA REGLA CENTRAL: lo comprometido en facturas NO entra en el punto de
 * equilibrio.
 *
 * Una factura se paga UNA vez. Meterla entre los costos fijos haría saltar el
 * equilibrio mes a mes —arriba el mes que llega una compra grande, abajo el
 * siguiente— y lo volvería inútil justo para lo que sirve: decidir precios.
 * Por eso va AL LADO del número, nunca adentro.
 *
 * Los mismos números del Excel de Banano Lab que fija `breakeven-levels.spec.ts`,
 * para que las dos pantallas no puedan divergir.
 */
const BANANO = {
  fixedMonthly: 118,
  marginPct: 0.75,
  loanPayment: 100,
  equipmentReserve: 150,
};

/** Lo que se le debe a los proveedores en el momento de mirar la pantalla. */
const FACTURAS_PENDIENTES = 900;

describe('equilibrioYCompromiso', () => {
  it('el equilibrio con facturas pendientes da EXACTAMENTE el mismo número que sin ellas', () => {
    const sin = equilibrioYCompromiso({ ...BANANO, compromiso: 0 });
    const con = equilibrioYCompromiso({ ...BANANO, compromiso: FACTURAS_PENDIENTES, facturas: 3 });

    // Los TRES niveles, no solo el primero: lo comprometido tampoco puede
    // colarse por la cuota ni por la reserva.
    expect(con.niveles).toEqual(sin.niveles);
    expect(con.niveles).toEqual(breakEvenLevels(BANANO));
  });

  it('lo comprometido no se suma a los costos fijos', () => {
    const con = equilibrioYCompromiso({ ...BANANO, compromiso: FACTURAS_PENDIENTES });

    // 118 / 0.75 = 157,33. Si las facturas entraran serían (118 + 900) / 0.75
    // = 1357,33: el equilibrio se multiplicaría por nueve por una compra que
    // se paga una sola vez.
    expect(con.niveles.survive).toBeCloseTo(157.33, 2);
    expect(con.niveles.withDebt).toBeCloseTo(290.67, 2);
    expect(con.niveles.withReserve).toBeCloseTo(490.67, 2);
  });

  it('devuelve lo comprometido al lado, con cuántas facturas lo componen', () => {
    const con = equilibrioYCompromiso({ ...BANANO, compromiso: FACTURAS_PENDIENTES, facturas: 3 });

    expect(con.compromiso).toBe(900);
    expect(con.facturas).toBe(3);
    expect(con.mostrar).toBe(true);
  });

  it('sin facturas pendientes no hay nada que avisar al lado', () => {
    const sin = equilibrioYCompromiso({ ...BANANO });

    expect(sin.compromiso).toBe(0);
    expect(sin.facturas).toBe(0);
    expect(sin.mostrar).toBe(false);
  });

  it('un compromiso negativo o inválido no se muestra ni mueve el equilibrio', () => {
    // No es deuda negativa: lo pagado de más se muestra aparte y NO compensa
    // (decisión de la Tarea 3). Acá tampoco puede entrar restando.
    const negativo = equilibrioYCompromiso({ ...BANANO, compromiso: -50 });
    const invalido = equilibrioYCompromiso({ ...BANANO, compromiso: Number.NaN, facturas: -2 });

    expect(negativo.compromiso).toBe(0);
    expect(negativo.mostrar).toBe(false);
    expect(negativo.niveles).toEqual(breakEvenLevels(BANANO));
    expect(invalido.compromiso).toBe(0);
    expect(invalido.facturas).toBe(0);
    expect(invalido.niveles).toEqual(breakEvenLevels(BANANO));
  });

  it('sin margen de contribución no hay equilibrio, pero las facturas se siguen debiendo', () => {
    const con = equilibrioYCompromiso({
      ...BANANO,
      marginPct: 0,
      compromiso: FACTURAS_PENDIENTES,
      facturas: 3,
    });

    expect(con.niveles).toEqual({ survive: null, withDebt: null, withReserve: null });
    expect(con.compromiso).toBe(900);
    expect(con.mostrar).toBe(true);
  });
});
