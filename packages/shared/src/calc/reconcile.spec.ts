import { reconcile } from './reconcile';

describe('reconcile', () => {
  it('lo del negocio es el total MENOS lo personal declarado', () => {
    const r = reconcile({ expectedUsd: 150, totalUsd: 220, personalUsd: 120 });

    expect(r.businessActualUsd).toBe(100);
    expect(r.differenceUsd).toBe(-50);
    expect(r.kind).toBe('SHORT');
  });

  it('cuadra dentro de la tolerancia de un centavo', () => {
    const r = reconcile({ expectedUsd: 100, totalUsd: 220.005, personalUsd: 120 });

    expect(r.kind).toBe('SQUARE');
  });

  it('sobra plata: diferencia a favor, sin inventar de dónde salió', () => {
    const r = reconcile({ expectedUsd: 100, totalUsd: 250, personalUsd: 120 });

    expect(r.businessActualUsd).toBe(130);
    expect(r.differenceUsd).toBe(30);
    expect(r.kind).toBe('FAVOR');
  });

  it('el total de la cuenta NO se compara con lo esperado: sin personal declarado, el faltante aparece', () => {
    // El modo viejo (personal = residuo) daba SIEMPRE cuadrado. Este es el bug
    // que la fase 1 corrige: con $0 personal declarado, los $120 que sobran son
    // del negocio y la diferencia es a favor, no cero.
    const r = reconcile({ expectedUsd: 100, totalUsd: 220, personalUsd: 0 });

    expect(r.businessActualUsd).toBe(220);
    expect(r.kind).toBe('FAVOR');
  });

  it('redondea al centavo', () => {
    const r = reconcile({ expectedUsd: 0.1, totalUsd: 0.3, personalUsd: 0.2 });

    expect(r.businessActualUsd).toBe(0.1);
    expect(r.differenceUsd).toBe(0);
    expect(r.kind).toBe('SQUARE');
  });
});
