import {
  monthConsumption,
  monthKey,
  monthStart,
  previousMonth,
  purchaseCostPerGram,
  purchaseCostPerRoll,
  restockStatus,
  stockTotal,
} from './stock';

/**
 * Control de filamento: las cuentas de las hojas "Inventario" y "Stock mensual"
 * del Excel de Banano Lab.
 */

describe('stockTotal', () => {
  it('suma las tres casillas del conteo', () => {
    expect(stockTotal({ sealed: 2, inUse: 1, running: 3 })).toBe(6);
  });

  it('un conteo en cero es cero, no falta de dato', () => {
    expect(stockTotal({ sealed: 0, inUse: 0, running: 0 })).toBe(0);
  });
});

describe('monthConsumption', () => {
  it('lo consumido es lo que había menos lo que quedó', () => {
    expect(monthConsumption(10, 7)).toBe(3);
  });

  /**
   * La hoja resta los dos totales y nada más, así que un mes con compras le da
   * consumo NEGATIVO (entraron más rollos de los que se gastaron). Contando lo
   * comprado, el número vuelve a significar lo que dice su nombre.
   */
  it('cuenta los rollos comprados en el mes', () => {
    // Había 10, compró 5, quedaron 12 → gastó 3, no "−2".
    expect(monthConsumption(10, 12, 5)).toBe(3);
  });

  it('sin compras se comporta como la resta de la hoja', () => {
    expect(monthConsumption(10, 7, 0)).toBe(3);
  });

  it('sin el conteo de alguno de los dos meses no inventa un número', () => {
    expect(monthConsumption(null, 7)).toBeNull();
    expect(monthConsumption(10, null)).toBeNull();
    expect(monthConsumption(null, null)).toBeNull();
  });

  /** Un conteo mal cargado no debe aparecer como consumo negativo. */
  it('nunca devuelve un consumo negativo', () => {
    expect(monthConsumption(5, 9)).toBe(0);
  });
});

describe('costo de una compra', () => {
  it('el costo por rollo reparte lo pagado entre los rollos', () => {
    expect(purchaseCostPerRoll(40, 2)).toBe(20);
  });

  it('sin rollos no hay costo por rollo que calcular', () => {
    expect(purchaseCostPerRoll(40, 0)).toBe(0);
  });

  /**
   * El Excel divide entre 1000 fijo. Acá se usan los gramos REALES del rollo:
   * para uno de 1 kg da lo mismo, para uno de 250 g la hoja miente.
   */
  it('el costo por gramo usa los gramos reales del rollo', () => {
    expect(purchaseCostPerGram(20, 1000)).toBe(0.02);
    expect(purchaseCostPerGram(20, 250)).toBe(0.08);
  });

  it('sin gramos no hay costo por gramo', () => {
    expect(purchaseCostPerGram(20, 0)).toBe(0);
  });
});

describe('restockStatus', () => {
  const activo = { status: 'ACTIVE' as const };
  const descontinuado = { status: 'DISCONTINUED' as const };

  it('sin rollos hay que reponer ya', () => {
    expect(restockStatus(activo, { sealed: 0, inUse: 0, running: 0 })).toBe('OUT');
  });

  it('con alguno por acabarse, toca reponer', () => {
    expect(restockStatus(activo, { sealed: 0, inUse: 0, running: 1 })).toBe('LOW');
  });

  it('con rollos sellados o en uso está bien', () => {
    expect(restockStatus(activo, { sealed: 2, inUse: 1, running: 0 })).toBe('OK');
  });

  /** Regla 3 de la hoja: un color descontinuado no entra en la reposición. */
  it('un color descontinuado no se repone aunque esté en cero', () => {
    expect(restockStatus(descontinuado, { sealed: 0, inUse: 0, running: 0 })).toBe('IGNORED');
    expect(restockStatus(descontinuado, { sealed: 0, inUse: 0, running: 2 })).toBe('IGNORED');
  });

  it('sin conteo del mes no se sabe si hay que reponer', () => {
    expect(restockStatus(activo, null)).toBeNull();
  });
});

/**
 * El mes se guarda como el primer día en UTC. En este proyecto ya hubo un bug
 * por formatear fechas UTC en la zona local (imprimía el día anterior), así que
 * la conversión va fijada en los dos sentidos.
 */
describe('mes del conteo', () => {
  it('monthStart devuelve el primer día del mes a medianoche UTC', () => {
    expect(monthStart('2026-08').toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(monthStart('2026-12').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('monthKey no se corre de mes en una zona al oeste de UTC', () => {
    expect(monthKey(new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08');
    // El primer instante del mes, que es donde una conversión local rompe.
    expect(monthKey(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09');
  });

  it('ida y vuelta conservan el mes', () => {
    expect(monthKey(monthStart('2026-08'))).toBe('2026-08');
  });

  it('rechaza un mes mal escrito', () => {
    expect(() => monthStart('2026-8')).toThrow();
    expect(() => monthStart('agosto')).toThrow();
    expect(() => monthStart('2026-13')).toThrow();
  });

  it('previousMonth retrocede un mes, incluso cruzando el año', () => {
    expect(previousMonth('2026-09')).toBe('2026-08');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
});
