import { calculateQuote } from './calculateQuote';
import type { CalcInput } from '../schemas/calc';

/**
 * El motor sigue la hoja "Costeo" del Excel de Banano Lab. Cuando un test cita
 * una celda (B47, B49, B54...) es esa hoja.
 *
 * Caso base: llavero de 30 piezas en una sola tanda. Números elegidos para que
 * el costo por pieza sea exactamente 3.284, así los estados del semáforo se
 * leen sin ruido de redondeo.
 * - Filamento: rollo de 1000 g a $250; 240 g la tanda.
 * - Impresora: $6000, vida útil 5000 h, 6 h de tanda, 0.12 kW, sin mantenimiento.
 * - Luz: $2.5/kWh.
 * - Insumos: argolla $0.50 y bolsita $0.30, una de cada por pieza.
 * - Merma 8 % sobre filamento + desgaste + luz.
 */
const base = (): CalcInput => ({
  quantity: 30,
  piecesPerBatch: 30,
  filament: { name: 'PLA', rollPrice: 250, rollGrams: 1000, grams: 240 },
  waste: { pct: 0.08 },
  supplies: [
    { name: 'Argolla', qty: 1, unitCost: 0.5 },
    { name: 'Bolsita', qty: 1, unitCost: 0.3 },
  ],
  printer: { name: 'Ender', price: 6000, lifetimeHours: 5000, hours: 6, powerKw: 0.12, maintPerHour: 0 },
  electricity: { enabled: true, kwhPrice: 2.5 },
  parallelPrinters: 1,
  labor: { minutes: 0, hourlyRate: 0 },
  extras: { packagingPerPiece: 0, otherPerOrder: 0 },
  margins: { markup: 1.0, minMarginPct: 0.6, rounding: { mode: 'NONE', increment: 1 } },
  manualPrice: null,
  wholesale: { tiers: [] },
  currency: 'USD',
  locale: 'en-US',
});

describe('calculateQuote — caso de referencia del Excel', () => {
  /**
   * Lo cargado en la hoja: 1 pieza, rollo $20/1000 g, 144.13 g, merma 5 %,
   * máquina $1532 (Inversion!B10) con vida útil 4800 h, 4 h 45 min, 100 W a
   * $0/kWh, sin postprocesado, empaque $1, margen 100 % (B48) y redondeo hacia
   * arriba a $0.50.
   */
  const excel = (): CalcInput => ({
    ...base(),
    quantity: 1,
    piecesPerBatch: 1,
    filament: { name: 'PLA', rollPrice: 20, rollGrams: 1000, grams: 144.13 },
    waste: { pct: 0.05 },
    supplies: [],
    printer: { price: 1532, lifetimeHours: 4800, hours: 4.75, powerKw: 0.1, maintPerHour: 0 },
    electricity: { enabled: true, kwhPrice: 0 },
    extras: { packagingPerPiece: 1, otherPerOrder: 0 },
    margins: { markup: 1.0, minMarginPct: 0.6, rounding: { mode: 'UP', increment: 0.5 } },
  });

  it('da el mismo PRECIO FINAL que la hoja: $11.50 (B54)', () => {
    expect(calculateQuote(excel()).price.final).toBe(11.5);
  });

  /**
   * El costo NO coincide con la hoja y es deliberado: el Excel aplica la merma
   * solo a los gramos, y el motor la aplica también al desgaste, porque una
   * impresión fallida también gasta horas de máquina.
   *   hoja:  3.026730 + 1.516042 + 1 = 5.542772
   *   motor: 2.882600 + 1.516042 + 0.219932 + 1 = 5.618574
   */
  it('cuenta la merma del desgaste, que la hoja deja fuera', () => {
    const r = calculateQuote(excel());
    expect(r.breakdown.material).toBeCloseTo(2.8826, 4);
    expect(r.breakdown.wear).toBeCloseTo(1.5160, 4);
    expect(r.breakdown.wasteAmount).toBeCloseTo(0.2199, 4);
    expect(r.costPerUnit).toBeCloseTo(5.6186, 4);
    // La hoja daría 5.542772: $0.0758 menos.
    expect(r.costPerUnit - 5.542772).toBeCloseTo(0.0758, 4);
  });

  it('el precio sugerido sale del margen objetivo (B49)', () => {
    const r = calculateQuote(excel());
    expect(r.price.suggested).toBeCloseTo(11.2371, 4);
    expect(r.price.rounded).toBe(11.5);
    expect(r.price.diffVsSuggested).toBeCloseTo(0.2629, 4);
  });
});

describe('calculateQuote — costos', () => {
  it('filamento: precio por gramo × gramos de la tanda', () => {
    expect(calculateQuote(base()).breakdown.material).toBe(60);
  });

  it('desgaste y luz salen de las horas de la tanda', () => {
    const r = calculateQuote(base());
    expect(r.breakdown.wear).toBe(7.2); // 6000/5000 × 6 h
    expect(r.breakdown.power).toBe(1.8); // 0.12 kW × $2.5 × 6 h
  });

  it('el mantenimiento por hora se suma al desgaste', () => {
    const r = calculateQuote({ ...base(), printer: { ...base().printer!, maintPerHour: 0.5 } });
    expect(r.breakdown.wear).toBe(10.2); // 7.2 + 0.5 × 6 h
  });

  it('la luz desactivada no suma nada', () => {
    const r = calculateQuote({ ...base(), electricity: { enabled: false, kwhPrice: 2.5 } });
    expect(r.breakdown.power).toBe(0);
  });

  it('sin impresora no hay desgaste ni luz', () => {
    const r = calculateQuote({ ...base(), printer: undefined });
    expect(r.breakdown.wear).toBe(0);
    expect(r.breakdown.power).toBe(0);
  });

  it('insumos: la cantidad es POR PIEZA y se multiplica por el pedido', () => {
    expect(calculateQuote(base()).breakdown.supplies).toBe(24); // (0.5 + 0.3) × 30
  });

  it('el postprocesado son minutos POR PIEZA', () => {
    const r = calculateQuote({ ...base(), labor: { minutes: 10, hourlyRate: 3 } });
    expect(r.breakdown.labor).toBe(15); // 10/60 × $3 × 30 piezas
  });

  it('empaque por pieza y otros por pedido', () => {
    const r = calculateQuote({ ...base(), extras: { packagingPerPiece: 0.2, otherPerOrder: 30 } });
    expect(r.breakdown.extras).toBe(36); // 0.2 × 30 + 30
  });

  it('la merma se aplica a filamento, desgaste y luz, y a nada más', () => {
    const r = calculateQuote(base());
    expect(r.breakdown.wasteAmount).toBe(5.52); // (60 + 7.2 + 1.8) × 8 %
  });

  it('costo del lote y por pieza', () => {
    const r = calculateQuote(base());
    expect(r.costBatch).toBe(98.52); // 60 + 7.2 + 1.8 + 24 + 5.52
    expect(r.costPerUnit).toBe(3.284);
  });

  it('el desglose sin merma suma exactamente el costo del lote', () => {
    const r = calculateQuote(base());
    const b = r.breakdown;
    const suma = b.material + b.wear + b.power + b.supplies + b.labor + b.extras;
    expect(suma).toBeCloseTo(r.subtotalBeforeWaste, 4);
    expect(r.subtotalBeforeWaste + b.wasteAmount).toBeCloseTo(r.costBatch, 4);
  });
});

describe('calculateQuote — tandas y entrega', () => {
  const enTandas = (): CalcInput => ({ ...base(), quantity: 50, piecesPerBatch: 10 });

  it('escala gramos y horas por la cantidad de tandas', () => {
    const r = calculateQuote(enTandas());
    expect(r.production.batches).toBe(5); // ceil(50 / 10)
    expect(r.production.totalGrams).toBe(1200); // 240 g × 5
    expect(r.production.machineHours).toBe(30); // 6 h × 5
    expect(r.breakdown.material).toBe(300); // $60 × 5
  });

  it('una tanda parcial cuenta como tanda completa', () => {
    const r = calculateQuote({ ...enTandas(), quantity: 41 });
    expect(r.production.batches).toBe(5); // ceil(41 / 10)
  });

  it('las impresoras en paralelo dividen la entrega, no el costo', () => {
    const uno = calculateQuote(enTandas());
    const dos = calculateQuote({ ...enTandas(), parallelPrinters: 2 });
    expect(uno.production.deliveryHours).toBe(30);
    expect(dos.production.deliveryHours).toBe(15);
    expect(dos.costBatch).toBe(uno.costBatch); // el desgaste es el mismo
  });
});

describe('calculateQuote — precio final y semáforo', () => {
  it('sin precio manual, el final es el sugerido redondeado (B53 → B54)', () => {
    const r = calculateQuote(base());
    expect(r.price.suggested).toBe(6.568); // 3.284 × 2
    expect(r.price.final).toBe(6.568);
    expect(r.price.marginReal).toBeCloseTo(1.0, 6);
    expect(r.price.profitPerUnit).toBe(3.284);
  });

  it('el precio manual pisa al sugerido y recalcula el margen (B54, B55)', () => {
    const r = calculateQuote({ ...base(), manualPrice: 8 });
    expect(r.price.final).toBe(8);
    expect(r.price.marginReal).toBeCloseTo(1.4361, 4); // 8 / 3.284 − 1
    expect(r.price.profitPerUnit).toBeCloseTo(4.716, 4);
    expect(r.price.diffVsSuggested).toBeCloseTo(1.432, 4); // 8 − 6.568
  });

  it('marca PIERDES DINERO cuando el precio no cubre el costo', () => {
    expect(calculateQuote({ ...base(), manualPrice: 3 }).price.status).toBe('LOSS');
  });

  it('marca margen bajo por debajo del 60 %', () => {
    expect(calculateQuote({ ...base(), manualPrice: 5 }).price.status).toBe('LOW');
  });

  it('avisa cuando queda por debajo del objetivo pero sobre el 60 %', () => {
    expect(calculateQuote({ ...base(), manualPrice: 6 }).price.status).toBe('BELOW_TARGET');
  });

  it('da OK cuando alcanza el margen objetivo', () => {
    expect(calculateQuote(base()).price.status).toBe('OK');
  });

  it('el total del pedido usa el precio final (B76, B77)', () => {
    const r = calculateQuote({ ...base(), manualPrice: 8 });
    expect(r.order.units).toBe(30);
    expect(r.order.total).toBe(240);
    expect(r.order.profit).toBeCloseTo(141.48, 2); // 4.716 × 30
  });
});

/**
 * El precio que se COBRA no siempre es el de lista: si el pedido alcanza un
 * tramo de mayoreo, manda el del tramo. `order` es la fuente ÚNICA de ese dato
 * para el panel, la cotización del cliente y el registro de la venta; si cada
 * uno lo dedujera por su cuenta, terminarían diciendo cifras distintas.
 */
describe('calculateQuote — el precio que se cobra de verdad', () => {
  const conTramos = (): CalcInput => ({
    ...base(),
    wholesale: {
      tiers: [
        { minQty: 1, discountPct: 0 },
        { minQty: 12, discountPct: 0.15 },
      ],
    },
  });

  it('sin tramos, cobra el precio de lista', () => {
    const r = calculateQuote(base());
    expect(r.order.listUnitPrice).toBe(6.568);
    expect(r.order.unitPrice).toBe(6.568);
    expect(r.order.discountPct).toBe(0);
    expect(r.order.fromTier).toBe(false);
  });

  it('con un tramo alcanzado, cobra el precio del tramo', () => {
    const r = calculateQuote(conTramos()); // 30 unidades → tramo de 12
    expect(r.order.listUnitPrice).toBe(6.568); // el de lista no se pierde
    expect(r.order.discountPct).toBe(0.15);
    expect(r.order.unitPrice).toBeCloseTo(5.5828, 4);
    expect(r.order.fromTier).toBe(true);
  });

  it('el total y la ganancia salen del precio cobrado, no del de lista', () => {
    const r = calculateQuote(conTramos());
    expect(r.order.total).toBeCloseTo(167.484, 3); // 5.5828 × 30
    expect(r.order.profit).toBeCloseTo(68.964, 3);
  });

  it('expone el margen real del precio cobrado, para no recalcularlo en la UI', () => {
    const r = calculateQuote(conTramos());
    expect(r.order.marginReal).toBeCloseTo(0.7, 6); // 5.5828 / 3.284 − 1
    expect(calculateQuote(base()).order.marginReal).toBeCloseTo(1.0, 6);
  });

  it('el semáforo del pedido juzga el precio cobrado', () => {
    const r = calculateQuote(conTramos());
    // 5.5828 deja 70 % de margen: sobre el piso, pero bajo el objetivo de 100 %.
    expect(r.order.status).toBe('BELOW_TARGET');
    expect(r.price.status).toBe('OK'); // el de lista sigue estando OK
  });

  it('un descuento que hunde el margen bajo el piso marca el PEDIDO', () => {
    const r = calculateQuote({
      ...base(),
      wholesale: { tiers: [{ minQty: 1, discountPct: 0.5 }] },
    });
    expect(r.order.status).toBe('LOW');
  });
});

/**
 * El piso de margen es una decisión del negocio, no una constante escondida:
 * bajo ese piso el trabajo no vale la pena y la app tiene que decirlo.
 */
describe('calculateQuote — piso de margen configurable', () => {
  it('por defecto el piso es 60 %', () => {
    // 5.25 sobre un costo de 3.284 = 59.9 % → apenas por debajo.
    expect(calculateQuote({ ...base(), manualPrice: 5.25 }).price.status).toBe('LOW');
    expect(calculateQuote({ ...base(), manualPrice: 5.26 }).price.status).toBe('BELOW_TARGET');
  });

  it('subir el piso a 80 % marca precios que antes pasaban', () => {
    const alto = {
      ...base(),
      margins: { ...base().margins, minMarginPct: 0.8 },
      manualPrice: 6, // 82.7 % de margen
    };
    expect(calculateQuote(alto).price.status).toBe('BELOW_TARGET');
    expect(calculateQuote({ ...alto, manualPrice: 5.8 }).price.status).toBe('LOW'); // 76.6 %
  });

  it('el piso también se aplica a los tramos de mayoreo', () => {
    const r = calculateQuote({
      ...base(),
      margins: { ...base().margins, minMarginPct: 0.8 },
      wholesale: { tiers: [{ minQty: 1, discountPct: 0.15 }] },
    });
    // 6.568 × 0.85 = 5.5828 → 70 % de margen, bajo el piso de 80 %.
    expect(r.wholesale!.tiers[0].status).toBe('LOW');
  });

  /** El piso es INCLUSIVO: quedar justo en él no es estar por debajo. */
  it('justo en el piso todavía no es margen bajo', () => {
    const r = calculateQuote({
      ...base(),
      margins: { ...base().margins, minMarginPct: 0.8 },
      wholesale: { tiers: [{ minQty: 1, discountPct: 0.1 }] },
    });
    // 6.568 × 0.9 = 5.9112 → exactamente 80 %.
    expect(r.wholesale!.tiers[0].marginReal).toBeCloseTo(0.8, 6);
    expect(r.wholesale!.tiers[0].status).toBe('BELOW_TARGET');
  });
});

describe('calculateQuote — comparador de redondeos', () => {
  it('ofrece las 5 opciones de la hoja con su margen (D52:F57)', () => {
    const r = calculateQuote({ ...base(), quantity: 1, piecesPerBatch: 1 });
    const modos = r.roundingOptions.map((o) => `${o.mode}:${o.increment}`);
    expect(modos).toEqual(['NEAREST:1', 'NEAREST:0.5', 'UP:1', 'UP:0.5', 'NONE:1']);
  });

  it('cada opción muestra a qué precio llevaría', () => {
    const r = calculateQuote({
      ...base(),
      quantity: 1,
      piecesPerBatch: 1,
      filament: { rollPrice: 20, rollGrams: 1000, grams: 144.13 },
      waste: { pct: 0.05 },
      supplies: [],
      printer: { price: 1532, lifetimeHours: 4800, hours: 4.75, powerKw: 0.1, maintPerHour: 0 },
      electricity: { enabled: true, kwhPrice: 0 },
      extras: { packagingPerPiece: 1, otherPerOrder: 0 },
    });
    // sugerido 11.2371
    const precios = r.roundingOptions.map((o) => o.price);
    expect(precios[0]).toBe(11); // NEAREST 1
    expect(precios[1]).toBe(11); // NEAREST 0.5 → 22.47 pasos → 22 × 0.5
    expect(precios[2]).toBe(12); // UP 1
    expect(precios[3]).toBe(11.5); // UP 0.5
    expect(precios[4]).toBeCloseTo(11.2371, 4); // sin redondeo
  });

  it('no ofrece redondear hacia abajo: regalaría margen', () => {
    const r = calculateQuote(base());
    expect(r.roundingOptions.some((o) => o.mode === 'DOWN')).toBe(false);
  });
});

describe('calculateQuote — mayoreo por descuento', () => {
  const conTramos = (): CalcInput => ({
    ...base(),
    wholesale: {
      tiers: [
        { minQty: 1, discountPct: 0 },
        { minQty: 6, discountPct: 0.1 },
        { minQty: 12, discountPct: 0.15 },
      ],
    },
  });

  it('aplica el descuento sobre el precio final (C82)', () => {
    const r = calculateQuote(conTramos());
    const tramo = r.wholesale!.tiers.find((t) => t.minQty === 12)!;
    expect(tramo.unitPrice).toBeCloseTo(5.5828, 4); // 6.568 × 0.85
  });

  it('elige el tramo según las unidades del pedido (B88)', () => {
    const r = calculateQuote(conTramos()); // 30 unidades
    expect(r.wholesale!.appliedTier!.minQty).toBe(12);
  });

  it('muestra el margen real y la ganancia de cada tramo (D82, E82)', () => {
    const r = calculateQuote(conTramos());
    const tramo = r.wholesale!.tiers.find((t) => t.minQty === 12)!;
    expect(tramo.marginReal).toBeCloseTo(0.7, 6); // 5.5828 / 3.284 − 1
    expect(tramo.profitPerUnit).toBeCloseTo(2.2988, 4);
    expect(tramo.status).toBe('BELOW_TARGET');
  });

  it('avisa si un tramo deja por debajo del costo (B92)', () => {
    const r = calculateQuote({
      ...base(),
      wholesale: { tiers: [{ minQty: 1, discountPct: 0.6 }] },
    });
    expect(r.wholesale!.tiers[0].status).toBe('LOSS');
  });

  it('el total del pedido usa el precio del tramo aplicado (B90, B91)', () => {
    const r = calculateQuote(conTramos());
    expect(r.wholesale!.orderTotal).toBeCloseTo(167.484, 3); // 5.5828 × 30
    expect(r.wholesale!.orderProfit).toBeCloseTo(68.964, 3); // 2.2988 × 30
  });

  it('redondea el precio del tramo, no el descuento', () => {
    const r = calculateQuote({
      ...conTramos(),
      margins: { markup: 1.0, minMarginPct: 0.6, rounding: { mode: 'UP', increment: 0.5 } },
    });
    // final redondeado 7.0 → tramo 15 % = 5.95 → hacia arriba a 0.5 = 6.0
    expect(r.price.final).toBe(7);
    expect(r.wholesale!.tiers.find((t) => t.minQty === 12)!.unitPrice).toBe(6);
  });

  it('sin tramos cargados, no hay bloque de mayoreo', () => {
    expect(calculateQuote(base()).wholesale).toBeNull();
  });
});

describe('calculateQuote — validaciones', () => {
  it('lanza si la cantidad es 0', () => {
    expect(() => calculateQuote({ ...base(), quantity: 0 })).toThrow();
  });

  it('lanza si los gramos del rollo son 0', () => {
    expect(() =>
      calculateQuote({ ...base(), filament: { rollPrice: 250, rollGrams: 0, grams: 240 } }),
    ).toThrow();
  });

  it('lanza si la vida útil de la impresora es 0', () => {
    expect(() =>
      calculateQuote({ ...base(), printer: { ...base().printer!, lifetimeHours: 0 } }),
    ).toThrow();
  });

  it('lanza si las piezas por tanda son 0', () => {
    expect(() => calculateQuote({ ...base(), piecesPerBatch: 0 })).toThrow();
  });

  it('lanza si las impresoras en paralelo son 0', () => {
    expect(() => calculateQuote({ ...base(), parallelPrinters: 0 })).toThrow();
  });
});
