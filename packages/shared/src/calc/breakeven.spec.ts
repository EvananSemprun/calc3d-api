import { fixedCostsTotal, breakEvenRevenue, breakEvenProgress } from './breakeven';

describe('punto de equilibrio', () => {
  it('fixedCostsTotal suma los montos mensuales', () => {
    expect(
      fixedCostsTotal([
        { concept: 'Alquiler', monthlyAmount: 300 },
        { concept: 'Internet', monthlyAmount: 50 },
        { concept: 'Luz base', monthlyAmount: 150 },
      ]),
    ).toBe(500);
  });

  it('fixedCostsTotal de lista vacía es 0', () => {
    expect(fixedCostsTotal([])).toBe(0);
  });

  it('breakEvenRevenue = fijos / margen', () => {
    expect(breakEvenRevenue(500, 0.4)).toBe(1250); // 500 / 0.40
  });

  it('breakEvenRevenue con margen 0 devuelve null (equilibrio infinito)', () => {
    expect(breakEvenRevenue(500, 0)).toBeNull();
  });

  it('breakEvenProgress recorta a [0,1]', () => {
    expect(breakEvenProgress(625, 1250)).toBe(0.5);
    expect(breakEvenProgress(2000, 1250)).toBe(1); // supera el equilibrio → 100 %
    expect(breakEvenProgress(-10, 1250)).toBe(0);
  });

  it('breakEvenProgress es null sin equilibrio finito', () => {
    expect(breakEvenProgress(100, null)).toBeNull();
    expect(breakEvenProgress(100, 0)).toBeNull();
  });
});
