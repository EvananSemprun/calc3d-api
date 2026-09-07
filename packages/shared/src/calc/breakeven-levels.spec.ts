import { breakEvenLevels } from './breakeven';

/**
 * Los números de la hoja "Resumen" del Excel de Banano Lab (filas 69-82):
 * $118 de gasto fijo, 25 % de costo variable, $100 de cuota, $150 de reserva.
 */
const BANANO = {
  fixedMonthly: 118,
  marginPct: 0.75,
  loanPayment: 100,
  equipmentReserve: 150,
};

describe('breakEvenLevels', () => {
  it('da los tres niveles del Excel', () => {
    const n = breakEvenLevels(BANANO);

    expect(n.survive).toBeCloseTo(157.33, 2);
    expect(n.withDebt).toBeCloseTo(290.67, 2);
    expect(n.withReserve).toBeCloseTo(490.67, 2);
  });

  it('cada nivel exige más que el anterior', () => {
    const n = breakEvenLevels(BANANO);

    expect(n.withDebt!).toBeGreaterThan(n.survive!);
    expect(n.withReserve!).toBeGreaterThan(n.withDebt!);
  });

  it('sin deuda ni reserva los tres niveles son el mismo número', () => {
    const n = breakEvenLevels({ ...BANANO, loanPayment: 0, equipmentReserve: 0 });

    expect(n.survive).toBeCloseTo(157.33, 2);
    expect(n.withDebt).toBe(n.survive);
    expect(n.withReserve).toBe(n.survive);
  });

  it('sin margen de contribución no hay equilibrio posible', () => {
    const n = breakEvenLevels({ ...BANANO, marginPct: 0 });

    expect(n).toEqual({ survive: null, withDebt: null, withReserve: null });
  });

  it('el nivel 1 coincide con el punto de equilibrio de siempre', () => {
    // No puede divergir del que ya muestra el Dashboard.
    const n = breakEvenLevels({ ...BANANO, loanPayment: 0, equipmentReserve: 0 });

    expect(n.survive).toBeCloseTo(118 / 0.75, 6);
  });
});
