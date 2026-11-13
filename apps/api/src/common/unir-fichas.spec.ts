import { renombrarEnCosteo } from './unir-fichas';

/**
 * El recosteo de una ficha de la tienda busca cada línea del costeo POR NOMBRE.
 * Unir borra la ficha de origen, así que su línea se renombra a la destino; si
 * no, quedaría «sin encontrar» y conservaría un precio viejo para siempre.
 */
describe('renombrarEnCosteo', () => {
  const costeo = {
    filament: { name: 'PLA Negro', rollPrice: 20, rollGrams: 1000, grams: 10 },
    supplies: [
      { name: 'Argollas', unitCost: 0.5, quantity: 1 },
      { name: 'Cinta', unitCost: 0.1, quantity: 2 },
    ],
  };

  it('insumo: renombra solo la línea de origen y no toca su costo congelado', () => {
    const { input, cambios } = renombrarEnCosteo(costeo, 'insumo', 'Argollas', 'Argolla llavero');

    expect(cambios).toBe(1);
    expect((input as typeof costeo).supplies).toEqual([
      { name: 'Argolla llavero', unitCost: 0.5, quantity: 1 },
      { name: 'Cinta', unitCost: 0.1, quantity: 2 },
    ]);
    expect(costeo.supplies[0].name).toBe('Argollas'); // no muta el original
  });

  it('material: renombra el filamento y no toca su precio ni sus gramos', () => {
    const { input, cambios } = renombrarEnCosteo(costeo, 'material', 'pla negro ', 'PLA Negro Eryone');

    expect(cambios).toBe(1);
    expect((input as typeof costeo).filament).toEqual({ name: 'PLA Negro Eryone', rollPrice: 20, rollGrams: 1000, grams: 10 });
  });

  it('un costeo que no usa la ficha queda igual (el mismo objeto)', () => {
    const r = renombrarEnCosteo(costeo, 'insumo', 'Tornillos', 'Otro');

    expect(r.cambios).toBe(0);
    expect(r.input).toBe(costeo);
  });

  it('un insumo de origen no toca el filamento, ni al revés', () => {
    expect(renombrarEnCosteo(costeo, 'material', 'Argollas', 'X').cambios).toBe(0);
    expect(renombrarEnCosteo(costeo, 'insumo', 'PLA Negro', 'X').cambios).toBe(0);
  });

  it('sin costeo (servicio o ficha a mano) no hace nada ni falla', () => {
    expect(renombrarEnCosteo(null, 'insumo', 'A', 'B')).toEqual({ input: null, cambios: 0 });
  });

  it('si las dos fichas se llaman igual no hay nada que renombrar', () => {
    expect(renombrarEnCosteo(costeo, 'insumo', 'argollas', 'ARGOLLAS ').cambios).toBe(0);
  });
});
