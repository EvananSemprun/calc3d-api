import {
  campaignLifecycle,
  isCampaignRunning,
  roas,
  roi,
  costPer,
  netAfterAds,
  campaignHealth,
  campaignRecommendation,
  campaignRevenue,
  type CampaignMetricsInput,
} from './campaign';

const base: CampaignMetricsInput = {
  invested: 0,
  revenue: 0,
  profit: 0,
  hasCost: false,
  sales: 0,
  orders: 0,
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

/**
 * REGRESIÓN (2026-10-02): el detalle de campaña reventaba con
 * "DecimalError: Invalid argument: undefined" en TODAS las campañas.
 *
 * `CampaignDetail.tsx` llamaba `costPer(s.invested, s.quotes)` y la API dejó de
 * devolver `quotes` al eliminar los presupuestos. La guarda `count <= 0` no lo
 * atrapaba porque `undefined <= 0` es FALSE (con `null` sí funciona), así que
 * llegaba a `D(invested).div(undefined)` y tumbaba la pantalla entera.
 *
 * Un campo que falta no puede romper una pantalla: estas funciones son el borde
 * entre el servidor y la UI y tienen que tolerar que falte un dato.
 */
describe('tolerancia a datos que faltan (no reventar la pantalla)', () => {
  const faltante = undefined as unknown as number;

  it('costPer con el divisor undefined → null, no excepción', () => {
    expect(costPer(100, faltante)).toBeNull();
  });

  it('costPer con la inversión undefined → null', () => {
    expect(costPer(faltante, 4)).toBeNull();
  });

  it('roas con la inversión undefined → null', () => {
    expect(roas(100, faltante)).toBeNull();
  });

  it('roas con los ingresos undefined → null', () => {
    expect(roas(faltante, 100)).toBeNull();
  });

  it('roi con argumentos undefined → null', () => {
    expect(roi(faltante, 100)).toBeNull();
    expect(roi(100, faltante)).toBeNull();
  });

  it('netAfterAds trata el dato que falta como cero, sin reventar', () => {
    // Sin ganancia conocida pero con $100 gastados, el neto es −100: devolver 0
    // escondería la pérdida, que es justo el dato que hay que ver.
    expect(netAfterAds(faltante, 100)).toBe(-100);
    expect(netAfterAds(100, faltante)).toBe(100);
    expect(netAfterAds(faltante, faltante)).toBe(0);
  });

  it('NaN e Infinity se tratan igual que un dato que falta', () => {
    expect(costPer(100, NaN)).toBeNull();
    expect(roas(100, Infinity)).toBeNull();
    expect(netAfterAds(NaN, 0)).toBe(0);
  });

  it('health y recomendación sobreviven a stats incompletas', () => {
    const roto = { sales: 0, orders: 0 } as unknown as CampaignMetricsInput;
    expect(() => campaignHealth(roto)).not.toThrow();
    expect(() => campaignRecommendation(roto)).not.toThrow();
  });
});

/**
 * REGRESIÓN (2026-10-02): el Dashboard avisaba "2 campañas no están rindiendo…
 * revísalas antes de seguir invirtiendo" sobre campañas TERMINADAS el 23/09.
 * Nada mueve el `status` a FINISHED cuando pasa la fecha de fin, así que seguían
 * diciendo "Activa". Pedir una acción imposible es peor que no avisar.
 */
describe('campaignLifecycle', () => {
  const HOY = '2026-10-02';

  it('activa sin fecha de fin → vigente', () => {
    expect(campaignLifecycle('ACTIVE', null, HOY)).toBe('RUNNING');
  });

  it('activa con fecha de fin futura → vigente', () => {
    expect(campaignLifecycle('ACTIVE', '2026-12-31', HOY)).toBe('RUNNING');
  });

  it('activa pero la fecha de fin ya pasó → FINALIZADA (derivada)', () => {
    expect(campaignLifecycle('ACTIVE', '2026-09-23', HOY)).toBe('FINISHED');
  });

  it('el último día cuenta como vigente (no se cierra antes de tiempo)', () => {
    expect(campaignLifecycle('ACTIVE', HOY, HOY)).toBe('RUNNING');
  });

  it('acepta la fecha en ISO completo, no solo YYYY-MM-DD', () => {
    expect(campaignLifecycle('ACTIVE', '2026-09-23T00:00:00.000Z', HOY)).toBe('FINISHED');
  });

  it('lo marcado a mano manda sobre la fecha', () => {
    expect(campaignLifecycle('PAUSED', '2026-12-31', HOY)).toBe('PAUSED');
    expect(campaignLifecycle('FINISHED', null, HOY)).toBe('FINISHED');
  });

  it('isCampaignRunning: solo las vigentes', () => {
    expect(isCampaignRunning('ACTIVE', null, HOY)).toBe(true);
    expect(isCampaignRunning('ACTIVE', '2026-09-23', HOY)).toBe(false);
    expect(isCampaignRunning('PAUSED', null, HOY)).toBe(false);
  });
});

describe('recomendación de una campaña cerrada', () => {
  const enPerdida: CampaignMetricsInput = {
    ...base,
    invested: 19.58,
    revenue: 15.46,
    sales: 0,
    orders: 1,
  };

  it('cerrada y en pérdida → veredicto en pasado, sin orden de pausar', () => {
    const r = campaignRecommendation(enPerdida, 'FINISHED');
    expect(r.action).toBe('CLOSED');
    expect(r.reason).toContain('No rindió');
    expect(r.reason).toContain('19.58');
    expect(r.reason).toContain('15.46');
    // Lo que NO puede decir: pedir una acción sobre algo que ya terminó.
    expect(r.reason).not.toContain('pausa');
    expect(r.reason).not.toContain('seguir gastando');
  });

  it('la MISMA campaña vigente sí pide acción', () => {
    const r = campaignRecommendation(enPerdida, 'RUNNING');
    expect(r.action).toBe('REVIEW');
  });

  it('pausada a mano no se trata como cerrada: todavía se puede retomar', () => {
    expect(campaignRecommendation(enPerdida, 'PAUSED').action).toBe('REVIEW');
  });

  it('cerrada y rentable → deja la referencia para la próxima', () => {
    const r = campaignRecommendation({ ...base, invested: 10, revenue: 50, orders: 2 }, 'FINISHED');
    expect(r.action).toBe('CLOSED');
    expect(r.title).toContain('rindió');
  });

  it('cerrada sin ventas → lo dice sin fingir que hay retorno', () => {
    const r = campaignRecommendation({ ...base, invested: 21.93 }, 'FINISHED');
    expect(r.action).toBe('CLOSED');
    expect(r.reason).toContain('sin ventas');
  });

  it('por defecto se asume vigente (no rompe a quien no pasa el ciclo)', () => {
    expect(campaignRecommendation(enPerdida).action).toBe('REVIEW');
  });
});

/**
 * VENTA ATRIBUIDA DECLARADA — regresión del 2026-10-04.
 *
 * La hoja "Publicidad" del Excel trae una columna "Venta atribuida ($)": de lo
 * que YA se vendió, cuánto se le puede rastrear a esa campaña. No es
 * facturación nueva. Como `Campaign` no tenía dónde guardarla, el 2026-10-02 se
 * resolvió creando PEDIDOS falsos ("Varios (historico sin detalle)"), y esos
 * pedidos entraron al ingreso: la reposición de equipos pasó a decir que las
 * impresoras se habían devuelto $431,08 cuando el Excel decía que nada.
 */
describe('campaignRevenue — venta atribuida declarada', () => {
  it('suma la atribución declarada a lo rastreado por ventas y pedidos', () => {
    // "Materializa tu fanatismo": $74,50 en el Excel = pedido real de Amed
    // ($30) + $44,50 sin desglose individual.
    expect(campaignRevenue({ salesTotal: 0, ordersTotal: 30, attributedSales: 44.5 })).toBe(74.5);
  });

  it('una campaña vieja sin pedidos vale exactamente lo declarado', () => {
    expect(campaignRevenue({ salesTotal: 0, ordersTotal: 0, attributedSales: 120 })).toBe(120);
  });

  it('una campaña con pedidos reales no necesita declarar nada', () => {
    expect(campaignRevenue({ salesTotal: 0, ordersTotal: 90.02, attributedSales: 0 })).toBe(90.02);
  });

  it('trata la atribución ausente o basura como cero, sin romper', () => {
    expect(
      campaignRevenue({
        salesTotal: 10,
        ordersTotal: 5,
        attributedSales: undefined as unknown as number,
      }),
    ).toBe(15);
  });
});

/**
 * El semáforo miraba SOLO `sales` y `orders`. Una campaña vieja cuya venta
 * atribuida es DECLARADA no tiene ni ventas ni encargos, así que se pintaba
 * "Sin datos" y se la recomendaba como "terminó sin retorno medible" mientras
 * la misma pantalla mostraba $120 vendidos y ROAS 10,04× (visto en el panel el
 * 2026-10-04, campaña "Sientete todo un campeon").
 */
describe('una campaña con venta atribuida declarada NO está "sin datos"', () => {
  const declarada = { ...base, invested: 11.95, revenue: 120, sales: 0, orders: 0 };

  it('la juzga por su retorno, no la da por vacía', () => {
    expect(campaignHealth(declarada)).toBe('PROFITABLE');
  });

  it('sin inversión ni venta sigue siendo "sin datos"', () => {
    expect(campaignHealth({ ...base, invested: 11.95, revenue: 0 })).toBe('NO_DATA');
  });

  it('cerrada con venta declarada, el veredicto dice que rindió', () => {
    expect(campaignRecommendation(declarada, 'FINISHED').title).toBe('Cerrada · rindió');
  });

  it('vigente con venta declarada no manda a esperar', () => {
    expect(campaignRecommendation(declarada, 'RUNNING').action).not.toBe('WAIT');
  });
});
