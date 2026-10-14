import { precioConTramos } from './store-pricing';
import { StoreProductCreateSchema } from '../schemas/store';

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
