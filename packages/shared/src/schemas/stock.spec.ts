import {
  MaterialCorrectionSchema,
  MaterialStatusUpdateSchema,
  StockMonthCloseSchema,
  StockMonthReopenSchema,
} from './stock';

describe('StockMonthCloseSchema', () => {
  it('acepta el mes con sus conteos', () => {
    const r = StockMonthCloseSchema.parse({
      month: '2026-08',
      counts: [{ materialId: 'm1', sealed: 1, inUse: 0, running: 2 }],
    });

    expect(r.counts[0]).toEqual({ materialId: 'm1', sealed: 1, inUse: 0, running: 2 });
  });

  it('una casilla que no vino llega como 0: casillas vacías = no hay', () => {
    const r = StockMonthCloseSchema.parse({ month: '2026-08', counts: [{ materialId: 'm1' }] });

    expect(r.counts[0]).toMatchObject({ sealed: 0, inUse: 0, running: 0 });
  });

  it('sin conteos es válido: todas las fichas quedan en 0', () => {
    expect(StockMonthCloseSchema.parse({ month: '2026-08' }).counts).toEqual([]);
  });

  it('rechaza rollos negativos', () => {
    const r = StockMonthCloseSchema.safeParse({
      month: '2026-08',
      counts: [{ materialId: 'm1', sealed: -1 }],
    });

    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['counts', 0, 'sealed']);
  });

  it('rechaza un mes mal escrito', () => {
    expect(StockMonthCloseSchema.safeParse({ month: '2026-8' }).success).toBe(false);
  });

  it('rechaza rollos que no son enteros', () => {
    const r = StockMonthCloseSchema.safeParse({
      month: '2026-08',
      counts: [{ materialId: 'm1', sealed: 1.5 }],
    });

    expect(r.success).toBe(false);
  });

  it('rechaza una ficha sin id', () => {
    const r = StockMonthCloseSchema.safeParse({ month: '2026-08', counts: [{ materialId: '' }] });

    expect(r.success).toBe(false);
  });

  it('no acepta más de 500 fichas en un cierre', () => {
    const counts = Array.from({ length: 501 }, (_, i) => ({ materialId: `m${i}` }));

    expect(StockMonthCloseSchema.safeParse({ month: '2026-08', counts }).success).toBe(false);
  });
});

describe('StockMonthReopenSchema', () => {
  it('solo pide el mes', () => {
    expect(StockMonthReopenSchema.parse({ month: '2026-08' })).toEqual({ month: '2026-08' });
  });

  it('rechaza un mes inválido', () => {
    expect(StockMonthReopenSchema.safeParse({ month: '2026-13' }).success).toBe(false);
  });
});

describe('MaterialStatusUpdateSchema', () => {
  it('acepta descontinuar y reactivar', () => {
    expect(MaterialStatusUpdateSchema.parse({ status: 'DISCONTINUED' })).toEqual({ status: 'DISCONTINUED' });
    expect(MaterialStatusUpdateSchema.parse({ status: 'ACTIVE' })).toEqual({ status: 'ACTIVE' });
  });

  it('rechaza un estado que no existe o que falta', () => {
    expect(MaterialStatusUpdateSchema.safeParse({ status: 'BORRADO' }).success).toBe(false);
    expect(MaterialStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('descarta cualquier otro campo', () => {
    expect(MaterialStatusUpdateSchema.parse({ status: 'ACTIVE', rollPrice: 0 })).toEqual({ status: 'ACTIVE' });
  });
});

/**
 * Corregir una ficha (2026-09-14): solo nombre y color, para tipeos. El precio
 * sale de la compra; marca, tipo y gramos quedan como nacieron.
 */
describe('MaterialCorrectionSchema', () => {
  it('solo deja nombre y color: el precio y el resto se descartan', () => {
    const r = MaterialCorrectionSchema.parse({
      name: ' PLA Negro ',
      color: ' Negro ',
      rollPrice: 1,
      rollGrams: 250,
      brand: 'Otra',
      type: 'PETG',
      status: 'DISCONTINUED',
      organizationId: 'org-B',
    });

    expect(r).toEqual({ name: 'PLA Negro', color: 'Negro' });
  });

  it('un nombre en blanco no vale', () => {
    expect(MaterialCorrectionSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('un color vacío queda sin color', () => {
    expect(MaterialCorrectionSchema.parse({ color: '' })).toEqual({ color: null });
  });
});
