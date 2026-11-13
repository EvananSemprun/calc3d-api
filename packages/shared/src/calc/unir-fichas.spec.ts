import { UnirFichaSchema, costoPorUnidadDeInsumo, paquetePrecioDesdeCompra } from './unir-fichas';

/**
 * Unir dos fichas (13/11). El precio que queda sale de la ÚLTIMA compra del
 * conjunto; estas funciones son esa cuenta, con los números del caso real:
 * «Argollas» = una compra de $7,27 por 25 unidades.
 */
describe('paquetePrecioDesdeCompra', () => {
  it('con las mismas unidades por paquete, el paquete cuesta lo que costó la compra', () => {
    expect(paquetePrecioDesdeCompra(7.27, 25, 25)).toBe(7.27);
  });

  it('con otro tamaño de paquete conserva el costo POR UNIDAD de la compra', () => {
    // 7,27 / 25 = 0,2908 por unidad; en un paquete de 100 cuesta 29,08.
    expect(paquetePrecioDesdeCompra(7.27, 25, 100)).toBe(29.08);
  });

  it('redondea a 4 decimales, que es lo que guarda la base', () => {
    expect(paquetePrecioDesdeCompra(10, 3, 1)).toBe(3.3333);
  });

  it('sin unidades compradas no hay precio que calcular', () => {
    expect(() => paquetePrecioDesdeCompra(7.27, 0, 100)).toThrow('unidades');
  });
});

describe('costoPorUnidadDeInsumo', () => {
  it('es el precio del paquete entre sus unidades', () => {
    expect(costoPorUnidadDeInsumo(50, 100)).toBe(0.5);
    expect(costoPorUnidadDeInsumo(7.27, 25)).toBeCloseTo(0.2908, 4);
  });
});

describe('UnirFichaSchema', () => {
  it('pide el destino', () => {
    expect(UnirFichaSchema.safeParse({}).success).toBe(false);
    expect(UnirFichaSchema.safeParse({ destinoId: '' }).success).toBe(false);
    expect(UnirFichaSchema.parse({ destinoId: 'm2' })).toEqual({ destinoId: 'm2' });
  });

  it('descarta cualquier otro campo (no se cuela precio ni estado)', () => {
    expect(UnirFichaSchema.parse({ destinoId: 'm2', rollPrice: 0, status: 'ACTIVE' })).toEqual({ destinoId: 'm2' });
  });
});
