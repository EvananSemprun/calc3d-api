import {
  FRACCIONES_DE_ROLLO,
  valorDelInventario,
  type RolloValorizable,
} from './valor-inventario';

/** Una ficha con un solo rollo, en el estado que se indique. */
const ficha = (partes: Partial<RolloValorizable>): RolloValorizable => ({
  sealed: 0,
  inUse: 0,
  running: 0,
  lastRollPrice: 20,
  ...partes,
});

describe('valorDelInventario', () => {
  it('un rollo sellado vale su precio completo', () => {
    const v = valorDelInventario([ficha({ sealed: 1, lastRollPrice: 25 })]);
    expect(v.sellados).toBe(25);
    expect(v.total).toBe(25);
  });

  it('un rollo en uso vale la mitad', () => {
    const v = valorDelInventario([ficha({ inUse: 1, lastRollPrice: 25 })]);
    expect(v.enUso).toBe(12.5);
    expect(v.total).toBe(12.5);
  });

  it('un rollo por acabarse vale un octavo', () => {
    const v = valorDelInventario([ficha({ running: 1, lastRollPrice: 24 })]);
    expect(v.porAcabarse).toBe(3);
    expect(v.total).toBe(3);
  });

  it('suma las tres partes de varias fichas', () => {
    const v = valorDelInventario([
      ficha({ sealed: 2, lastRollPrice: 20 }), // 40
      ficha({ inUse: 4, lastRollPrice: 25 }), // 50
      ficha({ running: 8, lastRollPrice: 16 }), // 16
    ]);
    expect(v.sellados).toBe(40);
    expect(v.enUso).toBe(50);
    expect(v.porAcabarse).toBe(16);
    expect(v.total).toBe(106);
  });

  // ⚠️ El piso y el techo son el rango HONESTO: el conteo no sabe gramos, así
  // que un rollo abierto vale algo entre nada y un rollo entero. Mostrar solo
  // el total sería dar por medido algo que es una convención.
  it('el piso son solo los sellados y el techo es todo a precio completo', () => {
    const v = valorDelInventario([
      ficha({ sealed: 1, lastRollPrice: 20 }),
      ficha({ inUse: 1, lastRollPrice: 20 }),
      ficha({ running: 1, lastRollPrice: 20 }),
    ]);
    expect(v.piso).toBe(20);
    expect(v.techo).toBe(60);
    expect(v.total).toBe(20 + 10 + 2.5);
  });

  // ⚠️ "Un default no es un dato": una ficha que nunca se compró no tiene
  // precio, y poner 0 diría "vale nada" en vez de "no sé". Se cuentan aparte.
  it('una ficha sin precio no suma plata y sus rollos se cuentan aparte', () => {
    const v = valorDelInventario([
      ficha({ sealed: 1, lastRollPrice: 20 }),
      ficha({ sealed: 2, inUse: 1, lastRollPrice: null }),
    ]);
    expect(v.total).toBe(20);
    expect(v.sinPrecio).toBe(3);
  });

  it('sin rollos sin precio, sinPrecio es 0', () => {
    expect(valorDelInventario([ficha({ sealed: 1 })]).sinPrecio).toBe(0);
  });

  it('un inventario vacío vale 0 y no rompe', () => {
    const v = valorDelInventario([]);
    expect(v).toEqual({
      sellados: 0,
      enUso: 0,
      porAcabarse: 0,
      total: 0,
      piso: 0,
      techo: 0,
      sinPrecio: 0,
    });
  });

  // ⚠️ El dinero se suma con decimal.js: 0.1 + 0.2 en punto flotante da
  // 0.30000000000000004, y acá se multiplican precios por fracciones muchas
  // veces. Un centavo de más en pantalla es un número que no cuadra.
  it('no arrastra error de punto flotante al sumar muchos rollos', () => {
    const fichas = Array.from({ length: 3 }, () => ficha({ inUse: 1, lastRollPrice: 0.1 }));
    expect(valorDelInventario(fichas).total).toBe(0.15);
  });

  it('las fracciones de la convención son 100 %, 50 % y 12.5 %', () => {
    expect(FRACCIONES_DE_ROLLO).toEqual({ sealed: 1, inUse: 0.5, running: 0.125 });
  });
});
