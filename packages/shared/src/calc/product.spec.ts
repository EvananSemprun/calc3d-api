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

describe('productStatus — el precio está en BCV y el costo en USDT', () => {
  // Las tasas medidas el 2026-11-08: el dólar BCV vale menos que el USDT.
  const tasas = { tasaBcv: 900, tasaUsdt: 1026 };

  it('el caso real: $1,50 BCV con costo $0,22 NO son 582 % de margen', () => {
    // 1.50 × 900 / 1026 = 1.32 USDT de verdad.
    const s = productStatus(1.5, 0.22, 0.22, 0.8, tasas);
    expect(s.priceUsdt).toBe(1.32);
    expect(s.converted).toBe(true);
    // El real: (1.32 − 0.22) / 0.22 = 5.0
    expect(s.markupNow).toBe(5);
    // El nominal, que es lo que la app decía antes: (1.50 − 0.22) / 0.22 = 5.8182
    expect(s.markupNominal).toBeCloseTo(5.8182, 4);
    expect(s.markupNow).toBeLessThan(s.markupNominal);
  });

  it('la ALERTA mira el margen en USDT, no el de etiqueta', () => {
    // Precio 1 BCV = 0.88 USDT, costo 0.80. Real: 10 %. Nominal: 25 %.
    // Con un piso de 15 %, el nominal NO alertaría y el real SÍ.
    const s = productStatus(1, 0.8, 0.8, 0.15, tasas);
    expect(s.markupNominal).toBe(0.25);
    expect(s.markupNow).toBeCloseTo(0.1, 2);
    expect(s.belowMin).toBe(true);
  });

  it('sin conversión se comporta como siempre: el nominal ES el de hoy', () => {
    const s = productStatus(13, 10, 10, 0.15);
    expect(s.converted).toBe(false);
    expect(s.priceUsdt).toBe(13);
    expect(s.markupNow).toBe(0.3);
    expect(s.markupNominal).toBe(0.3);
  });

  it('con una tasa en 0 NO inventa la conversión: avisa que no convirtió', () => {
    const s = productStatus(1.5, 0.22, 0.22, 0.8, { tasaBcv: 0, tasaUsdt: 1026 });
    expect(s.converted).toBe(false);
    expect(s.priceUsdt).toBe(1.5);
    // Cae al nominal, pero `converted` lo delata: la pantalla no puede llamarlo "real".
    expect(s.markupNow).toBe(s.markupNominal);
  });

  it('el markup al guardar también se mide en USDT (las dos cifras comparables)', () => {
    // Costo al guardar 0.22, hoy 0.30. El precio en USDT es el mismo para las dos.
    const s = productStatus(1.5, 0.22, 0.3, 0.8, tasas);
    expect(s.markupAtSave).toBe(5);
    expect(s.markupNow).toBeCloseTo(3.4, 4);
    expect(s.costDeltaPct).toBeCloseTo(0.3636, 4);
  });
});
