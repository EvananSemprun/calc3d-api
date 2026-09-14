import { calculateQuote } from './calculateQuote';
import { suggestTiers, tierRanges } from './wholesale';
import type { CalcInput } from '../schemas/calc';

describe('tierRanges — los tramos como rangos que se leen solos', () => {
  it('los ordena y dice hasta dónde llega cada uno', () => {
    const r = tierRanges([
      { minQty: 25, discountPct: 0.12 },
      { minQty: 5, discountPct: 0.05 },
      { minQty: 10, discountPct: 0.08 },
    ]);

    expect(r.map((t) => [t.minQty, t.maxQty])).toEqual([
      [5, 9],
      [10, 24],
      [25, null],
    ]);
  });

  it('conserva la posición original, para editar el tramo correcto', () => {
    const r = tierRanges([
      { minQty: 10, discountPct: 0.1 },
      { minQty: 5, discountPct: 0.05 },
    ]);

    expect(r.map((t) => t.index)).toEqual([1, 0]);
  });

  it('un tramo sano no tiene avisos', () => {
    const r = tierRanges([
      { minQty: 5, discountPct: 0.05 },
      { minQty: 10, discountPct: 0.08 },
    ]);

    expect(r.every((t) => t.warnings.length === 0)).toBe(true);
  });

  it('avisa que un tramo desde 1 aplica a TODOS los pedidos', () => {
    // Es bajar el precio de lista sin que se note.
    const [t] = tierRanges([{ minQty: 1, discountPct: 0.05 }]);

    expect(t.warnings).toContain('FROM_ONE');
  });

  it('avisa cuando dos tramos empiezan en la misma cantidad', () => {
    const r = tierRanges([
      { minQty: 5, discountPct: 0.05 },
      { minQty: 5, discountPct: 0.08 },
      { minQty: 10, discountPct: 0.1 },
    ]);

    expect(r[0].warnings).toContain('DUPLICATE_QTY');
    expect(r[1].warnings).toContain('DUPLICATE_QTY');
    expect(r[2].warnings).not.toContain('DUPLICATE_QTY');
    // Los dos duplicados llegan hasta el siguiente tramo DISTINTO.
    expect(r.map((t) => t.maxQty)).toEqual([9, 9, null]);
  });

  it('avisa cuando un tramo no descuenta más que el anterior', () => {
    // El caso de la pantalla: desde 1 al 5 % y desde 2 al 5 %.
    const r = tierRanges([
      { minQty: 1, discountPct: 0.05 },
      { minQty: 2, discountPct: 0.05 },
    ]);

    expect(r[1].warnings).toContain('NO_BETTER');
    expect(r[0].warnings).not.toContain('NO_BETTER');
  });
});

/** El llavero del spec del motor: costo por pieza 3.284, precio 6.568, piso 60 %. */
const llavero = (): CalcInput => ({
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

/** Sugiere sobre el mismo `CalcInput` que manda la pantalla. */
const sugerir = (input: CalcInput) => suggestTiers(input);

describe('suggestTiers — el mayor descuento que respeta el piso de margen', () => {
  it('encuentra el descuento que deja el margen justo en el piso', () => {
    // 6.568 × 0.80 = 5.2544 → 5.2544 / 3.284 − 1 = 0.60, el piso exacto.
    expect(sugerir(llavero()).maxDiscountPct).toBe(0.2);
  });

  it('reparte ese descuento en tres escalones crecientes', () => {
    expect(sugerir(llavero()).tiers.map((t) => t.discountPct)).toEqual([0.06, 0.13, 0.2]);
  });

  it('arranca en una tanda completa, que es el mayoreo natural de la placa', () => {
    expect(sugerir(llavero()).tiers.map((t) => t.minQty)).toEqual([30, 60, 150]);
  });

  it('con una pieza por tanda arranca en 5 unidades, nunca en 1', () => {
    const input = { ...llavero(), quantity: 1, piecesPerBatch: 1 };

    expect(sugerir(input).tiers.map((t) => t.minQty)).toEqual([5, 10, 25]);
  });

  it('sin margen por encima del piso no sugiere nada', () => {
    // Margen objetivo 60 % = el piso: cualquier descuento lo rompe.
    const input: CalcInput = {
      ...llavero(),
      margins: { markup: 0.6, minMarginPct: 0.6, rounding: { mode: 'NONE', increment: 1 } },
    };
    const s = sugerir(input);

    expect(s.maxDiscountPct).toBe(0);
    expect(s.tiers).toEqual([]);
  });

  it.each([
    ['sin redondeo', { mode: 'NONE', increment: 1 }],
    ['hacia arriba a 0,50', { mode: 'UP', increment: 0.5 }],
    ['al entero más cercano', { mode: 'NEAREST', increment: 1 }],
  ] as const)('ningún tramo sugerido queda en margen bajo al pasarlo por el motor (%s)', (_, rounding) => {
    // La prueba que importa: si la sugerencia calcula distinto que el motor,
    // la pantalla pinta de rojo un tramo que la propia app propuso.
    const input: CalcInput = { ...llavero(), margins: { markup: 1.0, minMarginPct: 0.6, rounding } };
    const { tiers } = sugerir(input);
    expect(tiers.length).toBeGreaterThan(0);

    const r = calculateQuote({ ...input, wholesale: { tiers } });

    for (const t of r.wholesale!.tiers) {
      expect(['OK', 'BELOW_TARGET']).toContain(t.status);
    }
  });
});
