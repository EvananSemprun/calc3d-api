import { type CompraDeRollos, preciosPorTipo } from './filament-type-price';

/**
 * EL PRECIO DE UN TIPO DE FILAMENTO, con los números a mano.
 *
 * Medido en producción el 2026-10-10: el PLA tiene 47 fichas entre $0,00 y
 * $25,94, y casi todas valen 20 — elegir el COLOR no compra precisión. Entre
 * TIPOS sí: PLA PURE $13 contra PLA SILK $22,84 es 75 % de diferencia, y
 * cotizar los dos a 20 deja el primero 54 % caro (se pierde el trabajo) y el
 * segundo 12 % barato (se pierde el margen).
 */

/** Una compra con lo mínimo que mira el promedio. */
function compra(p: Partial<CompraDeRollos>): CompraDeRollos {
  return { type: 'PLA', rolls: 1, amount: 20, rollGrams: 1000, ...p };
}

describe('preciosPorTipo', () => {
  it('pondera por ROLLOS comprados, no por ficha', () => {
    // Dos fichas del mismo tipo: una se compró UNA vez a $25, la otra se compra
    // siempre (9 rollos a $20). Por ficha el promedio sería (25 + 20) / 2 =
    // 22,50 y el color que casi no se usa pesaría lo mismo que el de siempre.
    // Por rollos: (25 + 180) / 10 = 20,50.
    const [pla] = preciosPorTipo([
      compra({ rolls: 1, amount: 25 }),
      compra({ rolls: 9, amount: 180 }),
    ]);

    expect(pla.rollPrice).toBeCloseTo(20.5, 10);
    expect(pla.rollPrice).not.toBeCloseTo(22.5, 2);
    expect(pla.rolls).toBe(10);
    expect(pla.purchases).toBe(2);
  });

  it('el rollo REGALADO no entra: $0 no es una señal de precio', () => {
    // `PLA Creality Azul oscuro` costó $0 porque se lo regalaron. El gasto en
    // $0 es verdadero y se queda en el ledger, pero metido acá hunde el
    // promedio: 80 / 5 = 16 en vez de 80 / 4 = 20.
    const [pla] = preciosPorTipo([
      compra({ rolls: 4, amount: 80 }),
      compra({ rolls: 1, amount: 0 }),
    ]);

    expect(pla.rollPrice).toBeCloseTo(20, 10);
    expect(pla.rollPrice).not.toBeCloseTo(16, 2);
    // El regalo tampoco cuenta como respaldo del promedio.
    expect(pla.rolls).toBe(4);
    expect(pla.purchases).toBe(1);
  });

  it('una compra BARATA de verdad SÍ entra: la regla es $0, no "es barato"', () => {
    // PLA PURE a $13 contra el PLA a $20 no es un error de carga: es el dato
    // que hace que valga la pena cotizar por tipo. Una regla de "descartar lo
    // que se aleja del promedio" lo borraría.
    const [pure] = preciosPorTipo([
      compra({ type: 'PLA PURE', rolls: 1, amount: 13 }),
      compra({ type: 'PLA PURE', rolls: 1, amount: 13 }),
    ]);

    expect(pure.rollPrice).toBeCloseTo(13, 10);
    expect(pure.rolls).toBe(2);
  });

  it('un tipo SIN ninguna compra con precio no tiene promedio: no se ofrece', () => {
    // Su única compra fue el regalo. Ofrecerlo a $0 sería cotizar gratis.
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 2, amount: 40 }),
      compra({ type: 'PLA TOUGH+', rolls: 1, amount: 0 }),
    ]);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
    expect(r.some((t) => t.rollPrice === 0)).toBe(false);
  });

  it('separa los tipos y da el promedio de cada uno', () => {
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 2, amount: 40 }),
      compra({ type: 'PETG', rolls: 1, amount: 18 }),
      compra({ type: 'PETG', rolls: 1, amount: 20 }),
      compra({ type: 'PLA SILK', rolls: 1, amount: 24 }),
    ]);

    const porTipo = Object.fromEntries(r.map((t) => [t.type, t.rollPrice]));
    expect(porTipo.PLA).toBeCloseTo(20, 10);
    expect(porTipo.PETG).toBeCloseTo(19, 10);
    expect(porTipo['PLA SILK']).toBeCloseTo(24, 10);
  });

  it('ordena por ROLLOS, de más a menos: la calculadora arranca en el primero', () => {
    const r = preciosPorTipo([
      compra({ type: 'PETG', rolls: 3, amount: 56 }),
      compra({ type: 'PLA', rolls: 47, amount: 940 }),
      compra({ type: 'PLA SILK', rolls: 2, amount: 45 }),
    ]);

    expect(r.map((t) => t.type)).toEqual(['PLA', 'PETG', 'PLA SILK']);
  });

  it('promedia los GRAMOS del rollo también por rollos, así el costo por gramo cierra', () => {
    // 2 rollos de 750 g y 2 de 1 kg: (1500 + 2000) / 4 = 875 g.
    // El par (precio, gramos) reproduce el costo por gramo REAL del tipo:
    // 80 / 3500 = 0,022857…, que es 20 / 875.
    const [pla] = preciosPorTipo([
      compra({ rolls: 2, amount: 40, rollGrams: 750 }),
      compra({ rolls: 2, amount: 40, rollGrams: 1000 }),
    ]);

    expect(pla.rollGrams).toBe(875);
    expect(pla.rollPrice / pla.rollGrams).toBeCloseTo(80 / 3500, 10);
  });

  it('una compra SIN rollos no divide por cero ni inventa un tipo', () => {
    // Un gasto de filamento viejo con `quantity` en null llega con 0 rollos.
    // No se puede saber qué costó el rollo, así que no entra.
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 0, amount: 20 }),
      compra({ type: 'PETG', rolls: 2, amount: 38 }),
    ]);

    expect(r.map((t) => t.type)).toEqual(['PETG']);
    expect(r.every((t) => Number.isFinite(t.rollPrice) && Number.isFinite(t.rollGrams))).toBe(true);
  });

  it('una ficha SIN tipo cargado no se ofrece como tipo', () => {
    // En el análisis de filamento "Sin especificar" es un grupo real (9 rollos);
    // acá no, porque no se puede cotizar "un rollo de tipo sin nombre".
    const r = preciosPorTipo([
      compra({ type: null, rolls: 5, amount: 100 }),
      compra({ type: '   ', rolls: 5, amount: 100 }),
      compra({ type: 'PLA', rolls: 1, amount: 20 }),
    ]);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
  });

  it('agrupa el tipo con espacios de sobra', () => {
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 1, amount: 20 }),
      compra({ type: ' PLA ', rolls: 1, amount: 22 }),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'PLA', rolls: 2 });
    expect(r[0].rollPrice).toBeCloseTo(21, 10);
  });

  it('sin compras devuelve una lista vacía, no un tipo en $0', () => {
    expect(preciosPorTipo([])).toEqual([]);
  });

  it('un tipo cuyos rollos no tienen gramos cargados no se ofrece', () => {
    // Sin gramos el costo por gramo sería una división por cero: el motor
    // devolvería 0 y la pieza saldría a costo de material cero.
    const r = preciosPorTipo([
      compra({ type: 'ASA', rolls: 2, amount: 50, rollGrams: 0 }),
      compra({ type: 'PLA', rolls: 1, amount: 20 }),
    ]);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
  });
});
