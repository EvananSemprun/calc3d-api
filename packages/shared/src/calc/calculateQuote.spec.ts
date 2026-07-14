import { calculateQuote } from './calculateQuote';
import type { CalcInput } from '../schemas/calc';

/**
 * Caso de prueba canónico: llavero personalizado (spec §5).
 * - Lote: 30 piezas en una sola tanda.
 * - Material: 8 g de PLA por pieza; rollo 1000 g a $250.
 * - Impresora: $6000, vida útil 5000 h; tanda de 6 h; 0.12 kW.
 * - Luz: $2.5/kWh, 6 h.
 * - Componente: argolla, bolsa de 100 a $50, 1 por pieza (paquete completo).
 * - Empaque: bolsita, paquete de 100 a $30, 1 por pieza (paquete completo).
 * - Merma: 8 % sobre material + desgaste + luz.
 */
const keychain: CalcInput = {
  quantity: 30,
  materials: [{ name: 'PLA', rollPrice: 250, rollGrams: 1000, grams: 240 }], // 8 g/pieza × 30
  printer: { name: 'Ender', price: 6000, lifetimeHours: 5000, hours: 6, powerKw: 0.12, maintPerHour: 0 },
  electricity: { enabled: true, kwhPrice: 2.5 },
  components: [
    { name: 'Argolla', packagePrice: 50, unitsPerPackage: 100, unitsPerPiece: 1, prorationMode: 'FULL_PACKAGE' },
  ],
  packaging: [
    {
      name: 'Bolsita',
      packagePrice: 30,
      unitsPerPackage: 100,
      unitsPerPiece: 1,
      scope: 'PER_PIECE',
      prorationMode: 'FULL_PACKAGE',
    },
  ],
  labor: [],
  waste: { pct: 0.08, appliesTo: ['MATERIAL', 'WEAR', 'POWER'] },
  margins: { markups: [0.3, 0.5, 1.0], mode: 'MARKUP', rounding: { mode: 'NONE', increment: 1 } },
  wholesale: {
    tiers: [
      { minQty: 1, marginPct: 1.0 },
      { minQty: 10, marginPct: 0.5 },
      { minQty: 50, marginPct: 0.3 },
    ],
  },
  batch: { setupCost: 0 },
  surcharges: { designFee: 0, rushPct: 0, minOrderPrice: 0 },
  currency: 'USD',
  locale: 'en-US',
};

describe('calculateQuote — multi-tanda (1 pieza por impresión)', () => {
  // Caso manual del dueño: 5 piezas, cada una es una impresión propia.
  // Pieza: 282 g y 8 h 49 min. Filamento $30/kg. Impresora $615, vida 4800 h.
  // Merma 8 % sobre material + desgaste. Sin luz, insumos ni mano de obra.
  // Esperado: ~$10.36 por pieza y ~$51.78 el total; 5 tandas, 1410 g, 44 h 05 min.
  const r = calculateQuote({
    quantity: 5,
    materials: [{ name: 'PLA', rollPrice: 30, rollGrams: 1000, grams: 282 }],
    printer: { name: 'Impresora', price: 615, lifetimeHours: 4800, hours: 8 + 49 / 60 },
    electricity: { enabled: false, kwhPrice: 0 },
    waste: { pct: 0.08, appliesTo: ['MATERIAL', 'WEAR', 'POWER'] },
    batch: { piecesPerBatch: 1, setupCost: 0 },
  });

  it('costo por pieza ≈ 10.36 y total ≈ 51.78', () => {
    expect(r.costPerUnit).toBeCloseTo(10.36, 2);
    expect(r.costBatch).toBeCloseTo(51.78, 2);
  });

  it('producción por tandas: 5 tandas, 1410 g y 44.083 h reales', () => {
    expect(r.production?.piecesPerBatch).toBe(1);
    expect(r.production?.batches).toBe(5);
    expect(r.production?.totalGrams).toBeCloseTo(1410, 1);
    expect(r.production?.totalHours).toBeCloseTo(44.083, 2);
    expect(r.production?.costPerBatch).toBeCloseTo(10.36, 2); // 1 pieza por tanda
    expect(r.production?.costTotal).toBeCloseTo(51.78, 2);
  });

  it('divide el costo entre las piezas que caben (10 por impresión)', () => {
    // Misma placa (2820 g, 88 h) pero con 10 piezas: el costo se reparte entre 10.
    const r10 = calculateQuote({
      quantity: 10,
      materials: [{ name: 'PLA', rollPrice: 30, rollGrams: 1000, grams: 2820 }],
      printer: { name: 'Impresora', price: 615, lifetimeHours: 4800, hours: 88.167 },
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0.08, appliesTo: ['MATERIAL', 'WEAR', 'POWER'] },
      batch: { piecesPerBatch: 10, setupCost: 0 },
    });
    expect(r10.production?.batches).toBe(1);
    expect(r10.production?.piecesPerBatch).toBe(10);
    // 10 piezas de 282 g equivalen al mismo costo unitario que 1 de 282 g.
    expect(r10.costPerUnit).toBeCloseTo(10.36, 1);
  });
});

describe('calculateQuote — caso llavero', () => {
  const r = calculateQuote(keychain);

  it('costo de material por pieza y del lote', () => {
    expect(r.materials[0].perPieceCost).toBeCloseTo(2.0, 6); // 250/1000*8
    expect(r.materials[0].batchCost).toBeCloseTo(60.0, 6); // *30
  });

  it('desgaste y luz del lote (no por pieza, en crudo)', () => {
    expect(r.breakdown.wear).toBeCloseTo(7.2, 4); // (6000/5000)*6, sin merma
    expect(r.breakdown.power).toBeCloseTo(1.8, 4); // 0.12*2.5*6, sin merma
  });

  it('componente por paquete: unidades, paquetes y sobrantes', () => {
    const c = r.components[0];
    expect(c.unitCost).toBeCloseTo(0.5, 6);
    expect(c.totalUnits).toBe(30);
    expect(c.packagesToBuy).toBe(1);
    expect(c.leftover).toBe(70);
    expect(c.usedCost).toBeCloseTo(15, 6); // prorrateo por usadas
    expect(c.fullPackageCost).toBeCloseTo(50, 6); // paquete completo
    expect(c.appliedCost).toBeCloseTo(50, 6); // default FULL_PACKAGE
  });

  it('merma se aplica solo a material+desgaste+luz', () => {
    expect(r.breakdown.wasteAmount).toBeCloseTo((60 + 7.2 + 1.8) * 0.08, 4); // 5.52
    expect(r.breakdown.components).toBeCloseTo(50, 4); // sin merma
    expect(r.breakdown.packaging).toBeCloseTo(30, 4); // sin merma
  });

  it('costo real del lote y por unidad', () => {
    expect(r.subtotalBeforeWaste).toBeCloseTo(149.0, 4); // 60+7.2+1.8+50+30
    expect(r.costBatch).toBeCloseTo(154.52, 4); // + merma 5.52
    expect(r.costPerUnit).toBeCloseTo(154.52 / 30, 4); // 5.15066...
  });

  it('precios de venta 30/50/100 % (markup sobre costo)', () => {
    const cost = 154.52 / 30;
    const p30 = r.prices.find((p) => p.marginPct === 0.3)!;
    const p50 = r.prices.find((p) => p.marginPct === 0.5)!;
    const p100 = r.prices.find((p) => p.marginPct === 1.0)!;
    expect(p30.price).toBeCloseTo(cost * 1.3, 4);
    expect(p50.price).toBeCloseTo(cost * 1.5, 4);
    expect(p100.price).toBeCloseTo(cost * 2.0, 4);
    // markup real sobre costo = el % ingresado
    expect(p30.markupOnCost).toBeCloseTo(0.3, 6);
    // margen real sobre venta = m / (1+m)
    expect(p30.realMarginOnPrice).toBeCloseTo(0.3 / 1.3, 6);
    expect(p100.realMarginOnPrice).toBeCloseTo(0.5, 6);
    // ganancia en dinero por pieza
    expect(p100.profit).toBeCloseTo(cost, 4); // a 100 %, ganancia = costo
  });

  it('mayoreo: tramo aplicable y comparativa', () => {
    expect(r.wholesale).not.toBeNull();
    const w = r.wholesale!;
    expect(w.appliedTier!.minQty).toBe(10); // 30 cae en 10–49
    expect(w.appliedTier!.marginPct).toBe(0.5);
    expect(w.wholesaleTotal).toBeCloseTo(231.78, 2); // (cost*1.5)*30
    expect(w.retailTotal).toBeCloseTo(309.04, 2); // tramo menor cantidad (margen 100 %)
    expect(w.savings).toBeCloseTo(77.26, 2);
  });
});

describe('calculateQuote — validaciones y bordes', () => {
  it('lanza si la cantidad es 0', () => {
    expect(() => calculateQuote({ ...keychain, quantity: 0 })).toThrow();
  });

  it('lanza si los gramos del rollo son 0', () => {
    expect(() =>
      calculateQuote({ ...keychain, materials: [{ rollPrice: 250, rollGrams: 0, grams: 240 }] }),
    ).toThrow();
  });

  it('lanza si unidades por paquete es 0', () => {
    expect(() =>
      calculateQuote({
        ...keychain,
        components: [{ packagePrice: 50, unitsPerPackage: 0, unitsPerPiece: 1, prorationMode: 'USED' }],
      }),
    ).toThrow();
  });

  it('prorrateo USED carga solo las unidades usadas', () => {
    const r = calculateQuote({
      ...keychain,
      components: [{ packagePrice: 50, unitsPerPackage: 100, unitsPerPiece: 1, prorationMode: 'USED' }],
    });
    expect(r.components[0].appliedCost).toBeCloseTo(15, 4); // 0.5*30
    expect(r.breakdown.components).toBeCloseTo(15, 4);
  });

  it('suma varios materiales en el lote', () => {
    const r = calculateQuote({
      ...keychain,
      materials: [
        { rollPrice: 250, rollGrams: 1000, grams: 240 }, // 60 lote
        { rollPrice: 600, rollGrams: 500, grams: 30 }, // 36 lote
      ],
    });
    expect(r.materials).toHaveLength(2);
    expect(r.breakdown.material).toBeCloseTo(60 + 36, 4); // crudo, sin merma
  });

  it('merma selectiva: incluir componentes', () => {
    const r = calculateQuote({
      ...keychain,
      waste: { pct: 0.1, appliesTo: ['COMPONENTS'] },
    });
    expect(r.breakdown.components).toBeCloseTo(50, 4); // desglose en crudo
    expect(r.breakdown.wasteAmount).toBeCloseTo(5.0, 4); // 10 % de 50
    expect(r.breakdown.material).toBeCloseTo(60, 4); // sin merma
  });

  it('modo MARGIN: precio = costo / (1 - margen)', () => {
    const r = calculateQuote({
      ...keychain,
      margins: { markups: [0.5], mode: 'MARGIN', rounding: { mode: 'NONE', increment: 1 } },
    });
    const cost = 154.52 / 30; // costo unitario preciso (sin redondear a 4 dp)
    const p = r.prices[0];
    expect(p.price).toBeCloseTo(cost / (1 - 0.5), 4);
    expect(p.realMarginOnPrice).toBeCloseTo(0.5, 6); // margen real = el ingresado
  });

  it('redondeo NEAREST 0.5 solo afecta presentación', () => {
    const r = calculateQuote({
      ...keychain,
      margins: { markups: [0.3], mode: 'MARKUP', rounding: { mode: 'NEAREST', increment: 0.5 } },
    });
    const p = r.prices[0];
    // el precio crudo no es múltiplo de 0.5; el redondeado sí
    expect(p.priceRounded % 0.5).toBeCloseTo(0, 6);
    expect(p.priceRounded).not.toBe(p.price);
  });

  it('mano de obra por pieza vs por pedido', () => {
    const r = calculateQuote({
      ...keychain,
      labor: [
        { name: 'Lijado', hourlyRate: 100, hours: 0.1, scope: 'PER_PIECE' }, // 10/pieza -> 300 lote
        { name: 'Diseño', hourlyRate: 200, hours: 1, scope: 'PER_ORDER' }, // 200 al lote
      ],
    });
    expect(r.breakdown.labor).toBeCloseTo(100 * 0.1 * 30 + 200 * 1, 4); // 500
  });

  it('electricidad desactivada no suma luz', () => {
    const r = calculateQuote({ ...keychain, electricity: { enabled: false, kwhPrice: 2.5 } });
    expect(r.breakdown.power).toBeCloseTo(0, 6);
  });
});

describe('calculateQuote — multi-tanda', () => {
  const baseMaterial = { name: 'PLA', rollPrice: 250, rollGrams: 1000, grams: 400 };

  it('sin piecesPerBatch se comporta como una sola tanda (retrocompatible)', () => {
    const r = calculateQuote({
      quantity: 10,
      materials: [{ ...baseMaterial, grams: 200 }],
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0, appliesTo: [] },
    });
    // 250/1000 * 200 = 50, sin escalar
    expect(r.breakdown.material).toBe(50);
    expect(r.batches).toBeNull();
  });

  it('escala el material lineal por cantidad/tanda y resume las tandas', () => {
    const r = calculateQuote({
      quantity: 50,
      materials: [baseMaterial], // 400 g por tanda
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0, appliesTo: [] },
      batch: { piecesPerBatch: 20 },
    });
    // multiplicador = 50/20 = 2.5 ; material = 0.25*400*2.5 = 250
    expect(r.breakdown.material).toBe(250);
    expect(r.batches).toEqual({
      size: 20,
      count: 3, // ceil(50/20)
      full: 2, // floor(50/20)
      partialPieces: 10, // 50 mod 20
      setupCostPerBatch: 0,
      setupCostTotal: 0,
    });
  });

  it('la suma de las tandas (llenas + parcial) es igual al total del lote', () => {
    const r = calculateQuote({
      quantity: 50,
      materials: [baseMaterial],
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0, appliesTo: [] },
      batch: { piecesPerBatch: 20 },
    });
    const perFullBatch = 0.25 * 400; // 100
    const partialFraction = 10 / 20; // 0.5
    const suma = perFullBatch * r.batches!.full + perFullBatch * partialFraction;
    expect(suma).toBeCloseTo(r.breakdown.material, 6); // 100*2 + 50 = 250
  });

  it('desgaste y luz también escalan por tanda', () => {
    const r = calculateQuote({
      quantity: 40,
      materials: [],
      printer: { price: 6000, lifetimeHours: 5000, hours: 10, powerKw: 0.12, maintPerHour: 0 },
      electricity: { enabled: true, kwhPrice: 2 },
      waste: { pct: 0, appliesTo: [] },
      batch: { piecesPerBatch: 20 },
    });
    // multiplicador = 40/20 = 2
    // wear por tanda = 6000/5000*10 = 12 ; total = 24
    expect(r.breakdown.wear).toBe(24);
    // power por tanda = 0.12*2*10 = 2.4 ; total = 4.8
    expect(r.breakdown.power).toBeCloseTo(4.8, 6);
  });

  it('suma el costo de arranque (setupCost × número de tandas) al lote', () => {
    const r = calculateQuote({
      quantity: 50,
      materials: [baseMaterial],
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0, appliesTo: [] },
      batch: { piecesPerBatch: 20, setupCost: 5 },
    });
    // 3 tandas × 5 = 15
    expect(r.breakdown.setup).toBe(15);
    expect(r.batches!.setupCostTotal).toBe(15);
    // material 250 + arranque 15 = 265
    expect(r.costBatch).toBe(265);
    expect(r.costPerUnit).toBe(5.3); // 265/50
  });

  it('sin multi-tanda el arranque es 0 y no altera el costo', () => {
    const r = calculateQuote({
      quantity: 10,
      materials: [{ ...baseMaterial, grams: 200 }],
      electricity: { enabled: false, kwhPrice: 0 },
      waste: { pct: 0, appliesTo: [] },
    });
    expect(r.breakdown.setup).toBe(0);
  });
});

describe('calculateQuote — diseño, urgencia y precio mínimo', () => {
  // costo/unidad = 250/1000*200 = 50 total / 10 = 5 por unidad
  const base = {
    quantity: 10,
    materials: [{ name: 'PLA', rollPrice: 250, rollGrams: 1000, grams: 200 }],
    electricity: { enabled: false, kwhPrice: 0 },
    waste: { pct: 0, appliesTo: [] },
    margins: { markups: [1.0], mode: 'MARKUP', rounding: { mode: 'NONE', increment: 1 } },
  } as const;

  it('sin ajustes, finalPerUnit = precio base y jobTotal = precio × cantidad', () => {
    const r = calculateQuote(base);
    const p = r.prices[0];
    expect(p.priceRounded).toBe(10); // 5 * (1+1.0)
    expect(p.designPerUnit).toBe(0);
    expect(p.rushAmount).toBe(0);
    expect(p.finalPerUnit).toBe(10);
    expect(p.jobTotal).toBe(100);
    expect(p.hitMinimum).toBe(false);
  });

  it('la tarifa de diseño se amortiza entre las unidades', () => {
    const r = calculateQuote({ ...base, surcharges: { designFee: 20, rushPct: 0, minOrderPrice: 0 } });
    const p = r.prices[0];
    expect(p.designPerUnit).toBe(2); // 20/10
    expect(p.finalPerUnit).toBe(12); // 10 + 2
    expect(p.jobTotal).toBe(120);
  });

  it('el recargo por urgencia se aplica sobre (precio + diseño)', () => {
    const r = calculateQuote({ ...base, surcharges: { designFee: 20, rushPct: 0.5, minOrderPrice: 0 } });
    const p = r.prices[0];
    // (10 + 2) * 0.5 = 6 de recargo
    expect(p.rushAmount).toBe(6);
    expect(p.finalPerUnit).toBe(18); // 12 + 6
    expect(p.jobTotal).toBe(180);
  });

  it('el precio mínimo eleva el total del pedido y marca hitMinimum', () => {
    const r = calculateQuote({ ...base, surcharges: { designFee: 0, rushPct: 0, minOrderPrice: 250 } });
    const p = r.prices[0];
    // jobTotal crudo = 100 < 250 → se eleva
    expect(p.jobTotal).toBe(250);
    expect(p.hitMinimum).toBe(true);
    // finalPerUnit queda como el pre-mínimo (informativo)
    expect(p.finalPerUnit).toBe(10);
  });
});
