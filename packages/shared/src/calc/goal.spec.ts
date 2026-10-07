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

// ───────────────────────────────────────────────────────────────────────────

import { GROWTH_LEVELS, seasonalCheck, suggestGoals, weightedBase, type HistoricMonth } from './goal';

const mes = (month: string, value: number, hasData = true): HistoricMonth => ({ month, value, hasData });

describe('weightedBase', () => {
  it('pondera: el mes más reciente pesa el triple que el más viejo', () => {
    // (300×3 + 200×2 + 100×1) / 6 = 233,33
    const b = weightedBase([mes('2026-07', 100), mes('2026-08', 200), mes('2026-09', 300)]);
    expect(b).toBeCloseTo(233.33, 2);
  });

  it('el orden lo decide la FECHA, no el orden del array', () => {
    const a = weightedBase([mes('2026-09', 300), mes('2026-07', 100), mes('2026-08', 200)]);
    expect(a).toBeCloseTo(233.33, 2);
  });

  it('un mes excepcional NO arrastra la sugerencia', () => {
    // El caso que motiva el recorte: septiembre vendió 1000 contra ~310 de
    // base. Sin recorte daría 653; con recorte, 393.
    const b = weightedBase([mes('2026-07', 320), mes('2026-08', 300), mes('2026-09', 1000)]);
    expect(b).toBeCloseTo(393.33, 2);
    expect(b!).toBeLessThan(500);
  });

  it('el recorte también contiene un mes excepcionalmente MALO', () => {
    const b = weightedBase([mes('2026-07', 300), mes('2026-08', 320), mes('2026-09', 10)]);
    // 10 se sube al piso 150 (mediana 300 × 0,5).
    expect(b).toBeCloseTo((150 * 3 + 320 * 2 + 300) / 6, 2);
  });

  it('con la mediana en cero NO se recorta: un mes bueno no se aplasta', () => {
    // Sin la guarda, [0, 0, 300] daría 0 y borraría el único mes con ventas.
    const b = weightedBase([mes('2026-07', 0), mes('2026-08', 0), mes('2026-09', 300)]);
    expect(b).toBeCloseTo(150, 2);
  });

  it('con 2 meses los pesos son 3/2, y con 1 es ese valor', () => {
    expect(weightedBase([mes('2026-08', 200), mes('2026-09', 300)])).toBeCloseTo((300 * 3 + 200 * 2) / 5, 2);
    expect(weightedBase([mes('2026-09', 300)])).toBe(300);
  });

  it('usa solo los 3 más recientes aunque le pasen más', () => {
    const b = weightedBase([mes('2026-06', 9999), mes('2026-07', 100), mes('2026-08', 200), mes('2026-09', 300)]);
    expect(b).toBeCloseTo(233.33, 2);
  });

  it('los meses SIN DATOS no entran', () => {
    // Agosto no tiene encargos: no es un 0, es que no existían.
    const b = weightedBase([mes('2026-08', 0, false), mes('2026-09', 5)]);
    expect(b).toBe(5);
  });

  it('sin ningún mes con datos devuelve null', () => {
    expect(weightedBase([mes('2026-08', 0, false)])).toBeNull();
    expect(weightedBase([])).toBeNull();
  });
});

describe('suggestGoals', () => {
  const tres = [mes('2026-07', 100), mes('2026-08', 200), mes('2026-09', 300)];

  it('sin crecimiento, la sugerencia es la base redondeada', () => {
    const s = suggestGoals({ sales: tres, orders: [], newClients: [] });
    expect(s.sales.value).toBe(233);
    expect(s.sales.base).toBeCloseTo(233.33, 2);
    expect(s.growth).toBe('CONSERVADOR');
  });

  it('informa QUÉ meses usó, no solo cuántos', () => {
    const s = suggestGoals({ sales: tres, orders: [], newClients: [] });
    // La pantalla los nombra: sugerir enero sobre jul-sep es defendible solo si se ve.
    expect(s.sales.monthsUsed).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(s.sales.previous).toBe(300);
  });

  it('una métrica sin datos devuelve null CON motivo, nunca 0', () => {
    const s = suggestGoals({ sales: tres, orders: [mes('2026-09', 0, false)], newClients: [] });
    expect(s.orders).toMatchObject({ value: null, reason: 'SIN_DATOS' });
    expect(s.newClients).toMatchObject({ value: null, reason: 'SIN_DATOS' });
    // Y no contagia: ventas sí se sugiere.
    expect(s.sales.value).toBe(233);
  });

  it('el crecimiento se aplica sobre la MISMA base, sin recalcularla', () => {
    const base = suggestGoals({ sales: tres, orders: [], newClients: [] }).sales.base!;
    for (const [nivel, pct] of Object.entries(GROWTH_LEVELS)) {
      const s = suggestGoals({ sales: tres, orders: [], newClients: [], growth: nivel as never });
      expect(s.sales.base).toBeCloseTo(base, 2);
      expect(s.sales.value).toBe(Math.round(base * (1 + pct)));
      expect(s.growthPct).toBe(pct);
    }
  });

  it('encargos y clientes nuevos salen enteros', () => {
    const s = suggestGoals({
      sales: [],
      orders: [mes('2026-08', 5), mes('2026-09', 4)],
      newClients: [mes('2026-08', 3), mes('2026-09', 2)],
      growth: 'AMBICIOSO',
    });
    expect(Number.isInteger(s.orders.value)).toBe(true);
    expect(Number.isInteger(s.newClients.value)).toBe(true);
  });
});

describe('seasonalCheck', () => {
  const baseAlta = [mes('2025-10', 300), mes('2025-11', 450), mes('2025-12', 600)];

  it('sin el mismo mes del año anterior, NO se pudo medir', () => {
    // Distinto de "está todo bien": hasta febrero 2027 no hay con qué comparar.
    expect(seasonalCheck(null, baseAlta)).toEqual({ status: 'SIN_HISTORIA' });
    expect(seasonalCheck(mes('2026-01', 350, false), baseAlta)).toEqual({ status: 'SIN_HISTORIA' });
  });

  it('enero cayó contra su base: avisa', () => {
    const r = seasonalCheck(mes('2026-01', 350), baseAlta);
    expect(r.status).toBe('ATIPICO');
    if (r.status === 'ATIPICO') {
      expect(r.month).toBe('2026-01');
      expect(r.deviationPct).toBeLessThan(-0.25);
    }
  });

  it('un mes parecido a su base es ESTABLE, que no es lo mismo que sin historia', () => {
    const r = seasonalCheck(mes('2026-01', 480), baseAlta);
    expect(r.status).toBe('ESTABLE');
  });

  it('sin base del año anterior tampoco se puede medir', () => {
    expect(seasonalCheck(mes('2026-01', 350), [])).toEqual({ status: 'SIN_HISTORIA' });
  });
});
