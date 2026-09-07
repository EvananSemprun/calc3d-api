import { goalProgress, goalsSummary } from './goal';

describe('goalProgress', () => {
  it('es la fracción cumplida de la meta', () => {
    // Septiembre real del Excel: $68,50 sobre una meta de $250.
    expect(goalProgress(68.5, 250)).toBeCloseTo(0.274, 3);
  });

  it('NO se recorta al superar la meta', () => {
    // A diferencia del punto de equilibrio: pasarse de la meta es información,
    // y un 100 % pelado escondería que se vendió el doble.
    expect(goalProgress(500, 250)).toBe(2);
  });

  it('sin meta no hay nada que cumplir', () => {
    expect(goalProgress(100, 0)).toBeNull();
  });

  it('sin nada vendido el avance es cero, no null', () => {
    expect(goalProgress(0, 250)).toBe(0);
  });
});

describe('goalsSummary', () => {
  const meses = [
    { salesTarget: 250, sales: 68.5, ordersTarget: 6, orders: 5, newClientsTarget: 4, newClients: 4 },
    { salesTarget: 325, sales: 0, ordersTarget: 8, orders: 0, newClientsTarget: 5, newClients: 0 },
  ];

  it('acumula las metas y lo real de todos los meses', () => {
    const t = goalsSummary(meses);

    expect(t.salesTarget).toBe(575);
    expect(t.sales).toBe(68.5);
    expect(t.ordersTarget).toBe(14);
    expect(t.orders).toBe(5);
    expect(t.newClientsTarget).toBe(9);
    expect(t.newClients).toBe(4);
  });

  it('el avance total sale del acumulado, no del promedio de los meses', () => {
    // Promediar 27 % y 0 % daría 13,7 %; lo correcto es 68,5 / 575.
    const t = goalsSummary(meses);

    expect(t.salesProgress).toBeCloseTo(0.119, 3);
  });

  it('sin meses no inventa números', () => {
    const t = goalsSummary([]);

    expect(t.salesTarget).toBe(0);
    expect(t.salesProgress).toBeNull();
  });
});
