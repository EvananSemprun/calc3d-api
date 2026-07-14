import { productMarkup, costDeltaPct, productStatus } from './product';

describe('productMarkup', () => {
  it('markup sobre el costo = ganancia / costo', () => {
    // Precio 13, costo 10 → 30 % de markup.
    expect(productMarkup(13, 10)).toBe(0.3);
  });

  it('es 0 cuando el costo es 0 o negativo (no divide entre 0)', () => {
    expect(productMarkup(10, 0)).toBe(0);
    expect(productMarkup(10, -5)).toBe(0);
  });

  it('puede ser negativo si el precio quedó por debajo del costo', () => {
    // Precio 8, costo 10 → −20 %.
    expect(productMarkup(8, 10)).toBe(-0.2);
  });
});

describe('costDeltaPct', () => {
  it('mide cuánto subió el costo respecto al guardado', () => {
    // De 10 a 11.8 → +18 %.
    expect(costDeltaPct(10, 11.8)).toBe(0.18);
  });

  it('es 0 si no había costo base', () => {
    expect(costDeltaPct(0, 5)).toBe(0);
  });
});

describe('productStatus', () => {
  it('sin cambio de costo: markup de hoy = markup al guardar, sin alerta', () => {
    const s = productStatus(13, 10, 10, 0.15);
    expect(s.markupAtSave).toBe(0.3);
    expect(s.markupNow).toBe(0.3);
    expect(s.costDeltaPct).toBe(0);
    expect(s.belowMin).toBe(false);
  });

  it('el costo subió y el margen cayó por debajo del mínimo → alerta', () => {
    // Fijaste precio 13 con costo 10 (30 %). El PLA subió: costo hoy 12 →
    // markup real (13−12)/12 ≈ 8.3 %, por debajo del piso de 15 %.
    const s = productStatus(13, 10, 12, 0.15);
    expect(s.markupNow).toBeCloseTo(0.0833, 3);
    expect(s.costDeltaPct).toBe(0.2);
    expect(s.belowMin).toBe(true);
  });

  it('el costo subió pero el margen sigue sobre el mínimo → sin alerta', () => {
    // Precio 20, costo hoy 15 → 33 %, sobre el piso de 15 %.
    const s = productStatus(20, 10, 15, 0.15);
    expect(s.belowMin).toBe(false);
  });

  it('vender por debajo del costo dispara la alerta (markup negativo)', () => {
    const s = productStatus(9, 10, 12, 0.15);
    expect(s.markupNow).toBeLessThan(0);
    expect(s.belowMin).toBe(true);
  });

  it('no alerta cuando el costo de hoy es 0 (no hay dato real que comparar)', () => {
    const s = productStatus(13, 10, 0, 0.15);
    expect(s.belowMin).toBe(false);
  });
});
