import { hoursThisMonth, latestReading, lifeUsed } from './production';

describe('latestReading', () => {
  const lecturas = [
    { month: '2026-07', hours: 120 },
    { month: '2026-09', hours: 260 },
    { month: '2026-08', hours: 190 },
  ];

  it('toma la lectura más reciente, sin importar el orden', () => {
    expect(latestReading(lecturas)).toMatchObject({ month: '2026-09', hours: 260 });
  });

  it('sin lecturas devuelve null: la máquina no tiene horas conocidas', () => {
    // Cero horas es un dato (nunca imprimió); "sin lectura" es no saber.
    expect(latestReading([])).toBeNull();
  });
});

describe('hoursThisMonth', () => {
  const lecturas = [
    { month: '2026-07', hours: 120 },
    { month: '2026-08', hours: 190 },
    { month: '2026-09', hours: 260 },
  ];

  it('son las horas que subió el contador entre dos meses', () => {
    expect(hoursThisMonth(lecturas, '2026-09')).toBe(70);
  });

  it('sin la lectura del mes anterior no inventa el consumo', () => {
    expect(hoursThisMonth(lecturas, '2026-07')).toBeNull();
  });

  it('sin la lectura del mes pedido tampoco', () => {
    expect(hoursThisMonth(lecturas, '2026-10')).toBeNull();
  });

  it('un contador que baja no da horas negativas', () => {
    // Pasa si se cambió la placa o se anotó mal: se recorta en cero.
    const raras = [
      { month: '2026-08', hours: 190 },
      { month: '2026-09', hours: 150 },
    ];

    expect(hoursThisMonth(raras, '2026-09')).toBe(0);
  });
});

describe('lifeUsed con la lectura del contador', () => {
  it('usa la lectura acumulada, no la suma de los trabajos', () => {
    // 260 h en el contador de una máquina de 4800 h.
    expect(lifeUsed(260, 4800)).toBeCloseTo(0.0542, 4);
  });
});
