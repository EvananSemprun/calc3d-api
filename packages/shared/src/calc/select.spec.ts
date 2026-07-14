import { pickSuggestedPrice, priceFinalPerUnit, priceJobTotal, priceHasSurcharges } from './select';
import type { PriceResult } from './types';

function price(over: Partial<PriceResult>): PriceResult {
  return {
    marginPct: 0.5,
    mode: 'MARKUP',
    price: 10,
    priceRounded: 10,
    profit: 5,
    realMarginOnPrice: 0.5,
    markupOnCost: 1,
    designPerUnit: 0,
    rushAmount: 0,
    finalPerUnit: 10,
    jobTotal: 100,
    hitMinimum: false,
    ...over,
  };
}

describe('helpers de selección de precio', () => {
  it('pickSuggestedPrice usa el tramo del medio por defecto', () => {
    const prices = [price({ marginPct: 0.3 }), price({ marginPct: 0.5 }), price({ marginPct: 1 })];
    expect(pickSuggestedPrice(prices)?.marginPct).toBe(0.5); // índice 1
  });

  it('pickSuggestedPrice respeta la ganancia elegida si existe', () => {
    const prices = [price({ marginPct: 0.3 }), price({ marginPct: 0.5 }), price({ marginPct: 1 })];
    expect(pickSuggestedPrice(prices, 1)?.marginPct).toBe(1);
  });

  it('pickSuggestedPrice con una sola opción usa el índice 0', () => {
    expect(pickSuggestedPrice([price({ marginPct: 0.3 })])?.marginPct).toBe(0.3);
  });

  it('pickSuggestedPrice con lista vacía devuelve undefined', () => {
    expect(pickSuggestedPrice([])).toBeUndefined();
  });

  it('priceJobTotal usa jobTotal (con extras/mínimo)', () => {
    expect(priceJobTotal(price({ jobTotal: 250 }), 10)).toBe(250);
  });

  it('priceJobTotal cae a priceRounded × cantidad en snapshots viejos', () => {
    const legacy = price({ jobTotal: undefined as unknown as number, priceRounded: 8 });
    expect(priceJobTotal(legacy, 10)).toBe(80);
  });

  it('priceFinalPerUnit cae a priceRounded en snapshots viejos', () => {
    const legacy = price({ finalPerUnit: undefined as unknown as number, priceRounded: 8 });
    expect(priceFinalPerUnit(legacy)).toBe(8);
  });

  it('priceHasSurcharges detecta diseño, urgencia o mínimo', () => {
    expect(priceHasSurcharges(price({}))).toBe(false);
    expect(priceHasSurcharges(price({ designPerUnit: 2 }))).toBe(true);
    expect(priceHasSurcharges(price({ rushAmount: 3 }))).toBe(true);
    expect(priceHasSurcharges(price({ hitMinimum: true }))).toBe(true);
  });
});
