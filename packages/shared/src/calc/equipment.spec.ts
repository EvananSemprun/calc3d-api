import { equipmentRecovery } from './equipment';

/** Los dos equipos del Excel, en orden de compra. */
const EQUIPOS = [
  { id: 'a1', name: 'Impresora A1 + Envio', cost: 615 },
  { id: 'p2s', name: 'Impresora P2S + Envio', cost: 917 },
];

describe('equipmentRecovery', () => {
  it('con ganancia negativa no repone nada', () => {
    // El caso real del Excel hoy: resultado acumulado en rojo.
    const r = equipmentRecovery(-143.56, EQUIPOS);

    expect(r.rows.map((x) => x.recovered)).toEqual([0, 0]);
    expect(r.totalRecovered).toBe(0);
    expect(r.rows[0].missing).toBe(615);
    // El capital libre SÍ queda negativo: es la ganancia, no se recorta.
    expect(r.freeCapital).toBeCloseTo(-143.56, 2);
  });

  it('cubre la primera antes de tocar la segunda', () => {
    const r = equipmentRecovery(700, EQUIPOS);

    expect(r.rows[0]).toMatchObject({ recovered: 615, missing: 0, progress: 1 });
    expect(r.rows[1]).toMatchObject({ recovered: 85, missing: 832 });
    expect(r.totalRecovered).toBe(700);
    expect(r.freeCapital).toBe(0);
  });

  it('no repone más que el costo del equipo', () => {
    const r = equipmentRecovery(400, EQUIPOS);

    expect(r.rows[0].recovered).toBe(400);
    expect(r.rows[1].recovered).toBe(0);
  });

  it('con ganancia de sobra deja capital libre', () => {
    const r = equipmentRecovery(2000, EQUIPOS);

    expect(r.totalRecovered).toBe(1532);
    expect(r.freeCapital).toBe(468);
    expect(r.rows.every((x) => x.progress === 1)).toBe(true);
  });

  it('el avance por equipo es lo repuesto sobre su costo', () => {
    const r = equipmentRecovery(307.5, EQUIPOS);

    expect(r.rows[0].progress).toBeCloseTo(0.5, 4);
    expect(r.rows[1].progress).toBe(0);
  });

  it('un equipo de costo cero está cubierto y no traga capital', () => {
    const r = equipmentRecovery(100, [{ id: 'x', name: 'Regalada', cost: 0 }]);

    expect(r.rows[0]).toMatchObject({ recovered: 0, missing: 0, progress: 1 });
    expect(r.freeCapital).toBe(100);
  });

  it('sin equipos todo el capital queda libre', () => {
    const r = equipmentRecovery(500, []);

    expect(r.totalCost).toBe(0);
    expect(r.totalRecovered).toBe(0);
    expect(r.freeCapital).toBe(500);
  });
});
