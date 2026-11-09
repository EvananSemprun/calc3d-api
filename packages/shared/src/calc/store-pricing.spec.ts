import { descuentoDeTramo, precioConTramos, tramosParaLaTienda } from './store-pricing';
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

/**
 * TRAMOS POR PRECIO FIJO (2026-11-08).
 *
 * Con el descuento en porcentaje no se puede llegar a un precio redondo: de $1,50, un
 * 27 % da $1,0950. El dueño quiere escribir «desde 10 u: $1,25» y que el porcentaje se
 * derive solo.
 *
 * ⚠️ **ESTO TOCA LO QUE EL SERVIDOR LE COBRA A UN CLIENTE REAL** y hay dos fichas
 * publicadas con tramos viejos. Por eso el primer bloque es la compatibilidad: si deja
 * de leer `discountPct`, el mayoreo de esos productos desaparece sin un error.
 */
describe('tramos por precio fijo', () => {
  describe('los tramos VIEJOS siguen cobrando igual', () => {
    // Los de producción el 2026-11-08: identificadores-para-lapices.
    const viejos: StorePriceTier[] = [
      { minQty: 10, discountPct: 0.17 },
      { minQty: 20, discountPct: 0.266 },
    ];

    it('el producto real, con los números que se ven hoy en la tienda', () => {
      expect(precioConTramos(1.5, 1, viejos)).toBe(1.5);
      expect(precioConTramos(1.5, 10, viejos)).toBe(1.245);
      expect(precioConTramos(1.5, 20, viejos)).toBe(1.101);
    });
  });

  describe('la forma nueva', () => {
    const nuevos: StorePriceTier[] = [
      { minQty: 10, unitPriceUsd: 1.25 },
      { minQty: 20, unitPriceUsd: 1.1 },
    ];

    it('cobra el precio EXACTO, sin arrastrar decimales', () => {
      expect(precioConTramos(1.5, 9, nuevos)).toBe(1.5);
      expect(precioConTramos(1.5, 10, nuevos)).toBe(1.25);
      expect(precioConTramos(1.5, 20, nuevos)).toBe(1.1);
    });

    it('gana el MAYOR tramo aplicable, igual que con el porcentaje', () => {
      expect(precioConTramos(1.5, 50, nuevos)).toBe(1.1);
    });

    it('los dos estilos conviven en la misma ficha', () => {
      const mezclados: StorePriceTier[] = [
        { minQty: 10, discountPct: 0.17 },
        { minQty: 20, unitPriceUsd: 1.1 },
      ];
      expect(precioConTramos(1.5, 10, mezclados)).toBe(1.245);
      expect(precioConTramos(1.5, 20, mezclados)).toBe(1.1);
    });

    it('con los dos campos manda el precio fijo: es lo que el dueño escribió', () => {
      const ambos: StorePriceTier[] = [{ minQty: 10, discountPct: 0.5, unitPriceUsd: 1.25 }];
      expect(precioConTramos(1.5, 10, ambos)).toBe(1.25);
    });
  });

  describe('⚠️ los RECARGOS de opción se suman al precio fijo', () => {
    // Un precio fijo reemplaza al de LISTA, no a lo que el cliente eligió encima. Si no,
    // a partir del tramo el tamaño grande saldría gratis.
    const nuevos: StorePriceTier[] = [{ minQty: 10, unitPriceUsd: 1.25 }];

    it('el tramo fijo reemplaza la lista y el recargo se cobra igual', () => {
      // Lista 1.50 + recargo 1.50 = 3.00. Desde 10 u: 1.25 + 1.50 = 2.75.
      expect(precioConTramos(3, 10, nuevos, 1.5)).toBe(2.75);
    });

    it('sin recargo, el precio fijo es el precio fijo', () => {
      expect(precioConTramos(1.5, 10, nuevos, 0)).toBe(1.25);
    });

    it('el tramo por PORCENTAJE no cambia: descuenta sobre todo, como siempre', () => {
      // 3.00 × (1 − 0.17) = 2.49. El recargo entra en el descuento, que es lo que hacía.
      expect(precioConTramos(3, 10, [{ minQty: 10, discountPct: 0.17 }], 1.5)).toBe(2.49);
    });
  });

  describe('descuentoDeTramo (para mostrar el %, no para cobrar)', () => {
    it('lo deriva del precio fijo', () => {
      // 1 − 1.25/1.50 = 0.1667
      expect(descuentoDeTramo(1.5, { minQty: 10, unitPriceUsd: 1.25 })).toBeCloseTo(0.1667, 4);
    });

    it('con porcentaje devuelve el porcentaje, sin inventar nada', () => {
      expect(descuentoDeTramo(1.5, { minQty: 10, discountPct: 0.266 })).toBe(0.266);
    });

    it('un precio de lista en 0 no puede dar porcentaje', () => {
      expect(descuentoDeTramo(0, { minQty: 10, unitPriceUsd: 1.25 })).toBeNull();
    });

    it('un tramo que SUBE el precio da un descuento negativo, no se esconde', () => {
      expect(descuentoDeTramo(1.5, { minQty: 10, unitPriceUsd: 2 })).toBeCloseTo(-0.3333, 4);
    });
  });
});
