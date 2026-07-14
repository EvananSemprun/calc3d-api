import {
  roas,
  roi,
  costPer,
  netAfterAds,
  campaignHealth,
  campaignRecommendation,
  type CampaignMetricsInput,
} from './campaign';

const base: CampaignMetricsInput = {
  invested: 0,
  revenue: 0,
  profit: 0,
  hasCost: false,
  sales: 0,
  orders: 0,
  quotes: 0,
};

describe('campaign metrics', () => {
  it('roas = ingresos / inversión', () => {
    expect(roas(1000, 200)).toBe(5);
    expect(roas(150, 100)).toBe(1.5);
    expect(roas(100, 0)).toBeNull();
  });

  it('roi = (ganancia − inversión) / inversión', () => {
    expect(roi(300, 100)).toBe(2); // (300-100)/100
    expect(roi(50, 100)).toBe(-0.5);
    expect(roi(10, 0)).toBeNull();
  });

  it('costPer', () => {
    expect(costPer(100, 4)).toBe(25);
    expect(costPer(100, 0)).toBeNull();
  });

  it('netAfterAds', () => {
    expect(netAfterAds(300, 100)).toBe(200);
    expect(netAfterAds(50, 100)).toBe(-50);
  });

  it('health: sin ventas ni pedidos → NO_DATA', () => {
    expect(campaignHealth(base)).toBe('NO_DATA');
    expect(campaignHealth({ ...base, invested: 100 })).toBe('NO_DATA');
  });

  it('health con costo: ganancia supera inversión → PROFITABLE', () => {
    expect(campaignHealth({ ...base, invested: 100, revenue: 500, profit: 300, hasCost: true, sales: 3 })).toBe(
      'PROFITABLE',
    );
  });

  it('health con costo: ganó pero no cubre publicidad → AT_RISK', () => {
    expect(campaignHealth({ ...base, invested: 100, revenue: 200, profit: 60, hasCost: true, sales: 2 })).toBe(
      'AT_RISK',
    );
  });

  it('health con costo: sin ganancia → LOSS', () => {
    expect(campaignHealth({ ...base, invested: 100, revenue: 80, profit: -20, hasCost: true, sales: 1 })).toBe(
      'LOSS',
    );
  });

  it('health sin costo: cae a ROAS', () => {
    expect(campaignHealth({ ...base, invested: 100, revenue: 150, hasCost: false, sales: 2 })).toBe('PROFITABLE');
    expect(campaignHealth({ ...base, invested: 100, revenue: 60, hasCost: false, sales: 1 })).toBe('AT_RISK');
  });
});

describe('campaignRecommendation', () => {
  it('sin inversión → ESPERAR', () => {
    expect(campaignRecommendation(base).action).toBe('WAIT');
  });

  it('con gasto pero sin ventas ni pedidos → ESPERAR', () => {
    expect(campaignRecommendation({ ...base, invested: 50 }).action).toBe('WAIT');
  });

  it('pérdida → PAUSAR', () => {
    expect(
      campaignRecommendation({ ...base, invested: 100, revenue: 80, profit: -20, hasCost: true, sales: 1 }).action,
    ).toBe('PAUSE');
  });

  it('en riesgo → REVISAR', () => {
    expect(
      campaignRecommendation({ ...base, invested: 100, revenue: 200, profit: 60, hasCost: true, sales: 2 }).action,
    ).toBe('REVIEW');
  });

  it('rentable con ROAS ≥ 3 → ESCALAR', () => {
    expect(
      campaignRecommendation({ ...base, invested: 100, revenue: 400, hasCost: false, sales: 4 }).action,
    ).toBe('SCALE');
  });

  it('rentable con ROI ≥ 100 % → ESCALAR', () => {
    // ROAS 2.5 (<3) pero ROI = (250−100)/100 = 1.5 ≥ 1 → escalar por ganancia real
    expect(
      campaignRecommendation({ ...base, invested: 100, revenue: 250, profit: 250, hasCost: true, sales: 2 }).action,
    ).toBe('SCALE');
  });

  it('rentable con retorno moderado → MANTENER', () => {
    // ROAS 1.5, sin costo → rentable pero sin señal fuerte
    expect(
      campaignRecommendation({ ...base, invested: 100, revenue: 150, hasCost: false, sales: 2 }).action,
    ).toBe('KEEP');
  });
});
