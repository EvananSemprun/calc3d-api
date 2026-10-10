import { repartoPorCanal } from './channels';

/**
 * Los números de "octubre real" son los medidos en producción el 2026-10-10:
 * mostrador $26.75 y 4 abonos por $114.05. La dona decía 100 % mostrador.
 */
describe('repartoPorCanal', () => {
  it('suma los abonos del periodo al canal de encargos (octubre real)', () => {
    const r = repartoPorCanal(
      [{ kind: 'COUNTER', amount: 26.75 }],
      [{ amount: 40 }, { amount: 34.05 }, { amount: 20 }, { amount: 20 }],
    );

    expect(r.mostrador).toBe(26.75);
    expect(r.encargos).toBe(114.05);
    expect(r.total).toBe(140.8);
    // El 81 % que la dona no mostraba. Clavado: es el número que mintió.
    expect(r.tramos).toEqual([
      { kind: 'COUNTER', value: 26.75, share: 0.189986 },
      { kind: 'ENCARGO', value: 114.05, share: 0.810014 },
    ]);
  });

  it('un mes SOLO con abonos no puede dar 100 % mostrador', () => {
    const r = repartoPorCanal([], [{ amount: 30 }, { amount: 20 }]);

    expect(r.mostrador).toBe(0);
    expect(r.encargos).toBe(50);
    expect(r.total).toBe(50);
    expect(r.tramos).toEqual([{ kind: 'ENCARGO', value: 50, share: 1 }]);
  });

  it('las ventas ENCARGO del Excel y los abonos van al MISMO canal', () => {
    // Las 25 ventas ENCARGO son totales semanales importados (se cortan el
    // 2026-08-24); un rango que las abarque y además tenga abonos suma las dos
    // cosas en "encargos", no en dos tramos distintos.
    const r = repartoPorCanal(
      [
        { kind: 'COUNTER', amount: 10 },
        { kind: 'ENCARGO', amount: 53 },
      ],
      [{ amount: 7 }],
    );

    expect(r.encargos).toBe(60);
    expect(r.tramos).toEqual([
      { kind: 'COUNTER', value: 10, share: 0.142857 },
      { kind: 'ENCARGO', value: 60, share: 0.857143 },
    ]);
  });

  it('el total es exactamente ventas + abonos: ni cuenta de menos ni dos veces', () => {
    // El doble conteo es el error que la app evita a propósito: un abono NO es
    // una venta. 100 de ventas + 25 de abonos tiene que dar 125, nunca 150.
    const r = repartoPorCanal(
      [
        { kind: 'COUNTER', amount: 60 },
        { kind: 'ENCARGO', amount: 40 },
      ],
      [{ amount: 25 }],
    );

    expect(r.total).toBe(125);
    expect(r.mostrador + r.encargos).toBe(125);
  });

  it('el mostrador son SOLO las ventas COUNTER', () => {
    const r = repartoPorCanal(
      [
        { kind: 'COUNTER', amount: 15 },
        { kind: 'ENCARGO', amount: 85 },
      ],
      [{ amount: 100 }],
    );

    expect(r.mostrador).toBe(15);
    expect(r.encargos).toBe(185);
  });

  it('un periodo sin nada no devuelve NaN ni tramos vacíos', () => {
    const r = repartoPorCanal([], []);

    expect(r).toEqual({ mostrador: 0, encargos: 0, total: 0, tramos: [] });
  });

  it('un canal en cero no aporta tramo a la dona', () => {
    const r = repartoPorCanal([{ kind: 'COUNTER', amount: 26.75 }], []);

    expect(r.tramos).toEqual([{ kind: 'COUNTER', value: 26.75, share: 1 }]);
  });

  it('suma al centavo (sin artefactos de coma flotante)', () => {
    const r = repartoPorCanal([{ kind: 'COUNTER', amount: 0.1 }], [{ amount: 0.2 }]);

    expect(r.total).toBe(0.3);
    expect(r.encargos).toBe(0.2);
  });
});
