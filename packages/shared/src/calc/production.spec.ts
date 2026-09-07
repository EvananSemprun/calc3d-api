import { failureRate, lifeUsed, maintenanceBalance, productionStats } from './production';

describe('lifeUsed', () => {
  it('es la fracción de la vida útil ya consumida', () => {
    expect(lifeUsed(1200, 4800)).toBeCloseTo(0.25);
  });

  it('no se recorta al pasarse: una máquina puede estar más allá de su vida útil', () => {
    expect(lifeUsed(5000, 4800)).toBeCloseTo(1.0417, 4);
  });

  it('sin vida útil declarada no se puede saber', () => {
    expect(lifeUsed(100, 0)).toBeNull();
  });
});

describe('failureRate', () => {
  it('es lo reimpreso sobre lo que se entregó, como la merma del motor', () => {
    // 8 reimpresiones sobre 100 piezas buenas = 8 %, comparable con waste.pct.
    expect(failureRate(8, 100)).toBeCloseTo(0.08);
  });

  it('cero fallos es un dato, no ausencia de dato', () => {
    expect(failureRate(0, 50)).toBe(0);
  });

  it('sin piezas no hay tasa', () => {
    expect(failureRate(3, 0)).toBeNull();
  });
});

describe('productionStats', () => {
  it('suma las horas de máquina de los trabajos medidos', () => {
    const s = productionStats([
      { machineHours: 5, reprints: 0, pieces: 10 },
      { machineHours: 3.5, reprints: 1, pieces: 20 },
    ]);

    expect(s.hours).toBe(8.5);
  });

  it('IGNORA los trabajos sin medir en vez de contarlos como perfectos', () => {
    // Un pedido viejo sin cargar no es un pedido de cero fallos: es uno sin
    // medir. Contarlo como 0 bajaría la tasa real con datos que no existen.
    const s = productionStats([
      { machineHours: 4, reprints: 2, pieces: 10 },
      { machineHours: null, reprints: null, pieces: 90 },
    ]);

    expect(s.measuredJobs).toBe(1);
    expect(s.pieces).toBe(10);
    expect(s.reprints).toBe(2);
    expect(s.failureRate).toBeCloseTo(0.2);
  });

  it('sin ningún trabajo medido no inventa una tasa', () => {
    const s = productionStats([{ machineHours: null, reprints: null, pieces: 40 }]);

    expect(s.measuredJobs).toBe(0);
    expect(s.failureRate).toBeNull();
    expect(s.hours).toBe(0);
  });

  it('cuenta las horas aunque no se hayan anotado los fallos', () => {
    // Los dos datos son independientes: se puede saber cuánto imprimió la
    // máquina sin haber contado las reimpresiones.
    const s = productionStats([{ machineHours: 6, reprints: null, pieces: 10 }]);

    expect(s.hours).toBe(6);
    expect(s.measuredJobs).toBe(0);
    expect(s.failureRate).toBeNull();
  });
});

describe('maintenanceBalance', () => {
  it('compara lo gastado en repuestos con lo cobrado por hora', () => {
    const b = maintenanceBalance(92, 0.5, 100);

    expect(b.spent).toBe(92);
    expect(b.charged).toBe(50);
    expect(b.difference).toBe(-42);
  });

  it('con la tarifa en cero no se cobró nada y la diferencia es todo lo gastado', () => {
    // El caso real de hoy: $92 de repuestos que no tocan ningún precio.
    const b = maintenanceBalance(92, 0, 100);

    expect(b.charged).toBe(0);
    expect(b.difference).toBe(-92);
  });

  it('cobrar de más también se ve', () => {
    const b = maintenanceBalance(50, 1, 100);

    expect(b.difference).toBe(50);
  });
});
