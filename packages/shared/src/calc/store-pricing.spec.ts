import { precioConTramos, tramosParaLaTienda } from './store-pricing';
import { StoreProductCreateSchema, type StorePriceTier } from '../schemas/store';

const tiers = [
  { minQty: 10, discountPct: 0.1 },
  { minQty: 25, discountPct: 0.2 },
];

describe('precioConTramos', () => {
  it('sin tramos devuelve el precio base', () => {
    expect(precioConTramos(5, 100, [])).toBe(5);
  });
  it('qty por debajo del primer tramo = precio base', () => {
    expect(precioConTramos(5, 9, tiers)).toBe(5);
  });
  it('borde inclusivo: en el minQty del tramo aplica', () => {
    expect(precioConTramos(10, 10, tiers)).toBeCloseTo(9, 10); // 10 % off
  });
  it('toma el MAYOR tramo aplicable', () => {
    expect(precioConTramos(10, 30, tiers)).toBeCloseTo(8, 10); // 20 % off
  });
  it('entre tramos usa el de abajo', () => {
    expect(precioConTramos(10, 24, tiers)).toBeCloseTo(9, 10);
  });
  it('no toca compareAt ni nada: solo descuenta el baseUnit que recibe', () => {
    expect(precioConTramos(12, 100, [{ minQty: 2, discountPct: 0.5 }])).toBeCloseTo(6, 10);
  });
});

const prod = { name: 'X', priceUsd: 10, minQty: 1 };

describe('priceTiers en StoreProductCreateSchema', () => {
  it('acepta tramos crecientes', () => {
    const r = StoreProductCreateSchema.safeParse({
      ...prod,
      priceTiers: [
        { minQty: 10, discountPct: 0.1 },
        { minQty: 25, discountPct: 0.2 },
      ],
    });
    expect(r.success).toBe(true);
  });
  it('rechaza minQty no creciente', () => {
    expect(
      StoreProductCreateSchema.safeParse({
        ...prod,
        priceTiers: [
          { minQty: 25, discountPct: 0.2 },
          { minQty: 10, discountPct: 0.1 },
        ],
      }).success,
    ).toBe(false);
  });
  it('rechaza minQty duplicado', () => {
    expect(
      StoreProductCreateSchema.safeParse({
        ...prod,
        priceTiers: [
          { minQty: 10, discountPct: 0.1 },
          { minQty: 10, discountPct: 0.2 },
        ],
      }).success,
    ).toBe(false);
  });
  it('rechaza un tramo que no supera el minQty del producto', () => {
    expect(
      StoreProductCreateSchema.safeParse({
        ...prod,
        minQty: 10,
        priceTiers: [{ minQty: 10, discountPct: 0.1 }],
      }).success,
    ).toBe(false);
  });
  it('rechaza discountPct fuera de [0,1)', () => {
    expect(
      StoreProductCreateSchema.safeParse({ ...prod, priceTiers: [{ minQty: 10, discountPct: 1 }] }).success,
    ).toBe(false);
  });
  it('sin priceTiers es válido (default [])', () => {
    const r = StoreProductCreateSchema.safeParse(prod);
    expect(r.success && r.data.priceTiers).toEqual([]);
  });
});

describe('tramosParaLaTienda — de la calculadora a la ficha', () => {
  const ok = (t: StorePriceTier[]) => StoreProductCreateSchema.safeParse({ ...prod, priceTiers: t }).success;

  it('deja pasar los tramos buenos tal cual', () => {
    expect(tramosParaLaTienda([{ minQty: 10, discountPct: 0.2 }])).toEqual([
      { minQty: 10, discountPct: 0.2 },
    ]);
  });

  it('descarta el "descuento desde 1 unidad", que es el precio base', () => {
    expect(tramosParaLaTienda([{ minQty: 1, discountPct: 0.3 }])).toEqual([]);
  });

  it('descarta el tramo que no descuenta nada', () => {
    expect(tramosParaLaTienda([{ minQty: 5, discountPct: 0 }])).toEqual([]);
  });

  it('respeta el mínimo del producto: un tramo que no lo supera no entra', () => {
    expect(tramosParaLaTienda([{ minQty: 6, discountPct: 0.1 }], 6)).toEqual([]);
    expect(tramosParaLaTienda([{ minQty: 7, discountPct: 0.1 }], 6)).toEqual([
      { minQty: 7, discountPct: 0.1 },
    ]);
  });

  it('ordena de menor a mayor cantidad aunque lleguen al revés', () => {
    const r = tramosParaLaTienda([
      { minQty: 50, discountPct: 0.3 },
      { minQty: 10, discountPct: 0.1 },
    ]);
    expect(r.map((t) => t.minQty)).toEqual([10, 50]);
  });

  it('ante dos tramos de la misma cantidad se queda con el MAYOR descuento', () => {
    const r = tramosParaLaTienda([
      { minQty: 10, discountPct: 0.1 },
      { minQty: 10, discountPct: 0.25 },
    ]);
    expect(r).toEqual([{ minQty: 10, discountPct: 0.25 }]);
  });

  it('corta en 8 y conserva los de cantidad más baja', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ minQty: (i + 2) * 10, discountPct: 0.1 }));
    const r = tramosParaLaTienda(muchos);
    expect(r).toHaveLength(8);
    expect(r[0].minQty).toBe(20);
    expect(r[7].minQty).toBe(90);
  });

  it('sin tramos (o sin lista) no rompe', () => {
    expect(tramosParaLaTienda([])).toEqual([]);
    expect(tramosParaLaTienda(null)).toEqual([]);
    expect(tramosParaLaTienda(undefined)).toEqual([]);
  });

  /**
   * ⚠️ EL TEST QUE IMPORTA: lo que sale de acá tiene que ATRAVESAR el schema
   * real de la ficha. Pasar la lista de la calculadora tal cual hacía rebotar
   * el guardado entero, que era el bug.
   */
  it('lo que devuelve SIEMPRE pasa el schema de la ficha', () => {
    const crudos = [
      { minQty: 1, discountPct: 0.5 },
      { minQty: 10, discountPct: 0.1 },
      { minQty: 10, discountPct: 0.2 },
      { minQty: 3, discountPct: 0.05 },
      { minQty: 2, discountPct: 0 },
    ];
    const r = tramosParaLaTienda(crudos);
    expect(r).toEqual([
      { minQty: 3, discountPct: 0.05 },
      { minQty: 10, discountPct: 0.2 },
    ]);
    expect(ok(r)).toBe(true);
    // Y el crudo NO pasa: por eso hace falta traducir.
    expect(ok(crudos as StorePriceTier[])).toBe(false);
  });
});
