import type { FilamentPurchase } from '../schemas/stock';
import { UNSPECIFIED, groupPurchases } from './filament-analytics';

/** Una compra con lo mínimo que mira el análisis. */
function compra(p: Partial<FilamentPurchase>): FilamentPurchase {
  return {
    id: 'x',
    date: '2026-08-01T00:00:00.000Z',
    materialId: 'm',
    materialName: 'PLA Negro',
    brand: null,
    type: null,
    color: null,
    quantity: 1,
    amount: 20,
    costPerRoll: 20,
    costPerGram: 0.02,
    providerName: null,
    note: null,
    rate: null,
    currencyCode: null,
    ...p,
  };
}

describe('groupPurchases', () => {
  it('suma los rollos y lo invertido de cada marca', () => {
    const g = groupPurchases(
      [
        compra({ brand: 'Filaven', quantity: 2, amount: 40 }),
        compra({ brand: 'Filaven', quantity: 3, amount: 55 }),
        compra({ brand: 'Sunlu', quantity: 1, amount: 18 }),
      ],
      'brand',
    );

    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ key: 'Filaven', rolls: 5, invested: 95, purchases: 2 });
    expect(g[1]).toMatchObject({ key: 'Sunlu', rolls: 1, invested: 18, purchases: 1 });
  });

  it('ordena de más a menos rollos', () => {
    const g = groupPurchases(
      [
        compra({ brand: 'Sunlu', quantity: 1 }),
        compra({ brand: 'Filaven', quantity: 9 }),
        compra({ brand: 'eSun', quantity: 4 }),
      ],
      'brand',
    );

    expect(g.map((x) => x.key)).toEqual(['Filaven', 'eSun', 'Sunlu']);
  });

  it('junta bajo "Sin especificar" lo que no tiene marca', () => {
    const g = groupPurchases(
      [
        compra({ brand: null, quantity: 2 }),
        compra({ brand: '  ', quantity: 1 }),
        compra({ brand: 'Filaven', quantity: 1 }),
      ],
      'brand',
    );

    expect(g.find((x) => x.key === UNSPECIFIED)).toMatchObject({ rolls: 3, purchases: 2 });
  });

  it('reparte la participación sobre el total invertido', () => {
    const g = groupPurchases(
      [
        compra({ brand: 'Filaven', amount: 75 }),
        compra({ brand: 'Sunlu', amount: 25 }),
      ],
      'brand',
    );

    expect(g[0].share).toBeCloseTo(0.75);
    expect(g[1].share).toBeCloseTo(0.25);
  });

  it('no divide entre cero cuando no se invirtió nada', () => {
    const g = groupPurchases([compra({ brand: 'Regalo', amount: 0 })], 'brand');

    expect(g[0].share).toBe(0);
  });

  it('agrupa por color con la misma cuenta', () => {
    const g = groupPurchases(
      [
        compra({ color: 'Negro', quantity: 4, amount: 80 }),
        compra({ color: 'Blanco', quantity: 2, amount: 36 }),
        compra({ color: 'Negro', quantity: 1, amount: 20 }),
      ],
      'color',
    );

    expect(g[0]).toMatchObject({ key: 'Negro', rolls: 5, invested: 100 });
    expect(g[1]).toMatchObject({ key: 'Blanco', rolls: 2, invested: 36 });
  });

  it('devuelve una lista vacía sin compras', () => {
    expect(groupPurchases([], 'brand')).toEqual([]);
  });
});
