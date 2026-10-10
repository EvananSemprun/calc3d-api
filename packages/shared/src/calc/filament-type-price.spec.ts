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

/** El "hoy" de los tests: SIEMPRE a mano, nunca el reloj de la máquina. */
const HOY = '2026-10-10';

/**
 * Una compra con lo mínimo que mira el promedio. Su fecha por defecto cae
 * DENTRO de la ventana de 6 meses de `HOY`: los tests que no hablan de la
 * ventana no tienen que pensar en ella.
 */
function compra(p: Partial<CompraDeRollos>): CompraDeRollos {
  return { type: 'PLA', rolls: 1, amount: 20, rollGrams: 1000, date: '2026-08-31', ...p };
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
    ], HOY);

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
    ], HOY);

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
    ], HOY);

    expect(pure.rollPrice).toBeCloseTo(13, 10);
    expect(pure.rolls).toBe(2);
  });

  it('un tipo SIN ninguna compra con precio no tiene promedio: no se ofrece', () => {
    // Su única compra fue el regalo. Ofrecerlo a $0 sería cotizar gratis.
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 2, amount: 40 }),
      compra({ type: 'PLA TOUGH+', rolls: 1, amount: 0 }),
    ], HOY);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
    expect(r.some((t) => t.rollPrice === 0)).toBe(false);
  });

  it('separa los tipos y da el promedio de cada uno', () => {
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 2, amount: 40 }),
      compra({ type: 'PETG', rolls: 1, amount: 18 }),
      compra({ type: 'PETG', rolls: 1, amount: 20 }),
      compra({ type: 'PLA SILK', rolls: 1, amount: 24 }),
    ], HOY);

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
    ], HOY);

    expect(r.map((t) => t.type)).toEqual(['PLA', 'PETG', 'PLA SILK']);
  });

  it('promedia los GRAMOS del rollo también por rollos, así el costo por gramo cierra', () => {
    // 2 rollos de 750 g y 2 de 1 kg: (1500 + 2000) / 4 = 875 g.
    // El par (precio, gramos) reproduce el costo por gramo REAL del tipo:
    // 80 / 3500 = 0,022857…, que es 20 / 875.
    const [pla] = preciosPorTipo([
      compra({ rolls: 2, amount: 40, rollGrams: 750 }),
      compra({ rolls: 2, amount: 40, rollGrams: 1000 }),
    ], HOY);

    expect(pla.rollGrams).toBe(875);
    expect(pla.rollPrice / pla.rollGrams).toBeCloseTo(80 / 3500, 10);
  });

  it('una compra SIN rollos no divide por cero ni inventa un tipo', () => {
    // Un gasto de filamento viejo con `quantity` en null llega con 0 rollos.
    // No se puede saber qué costó el rollo, así que no entra.
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 0, amount: 20 }),
      compra({ type: 'PETG', rolls: 2, amount: 38 }),
    ], HOY);

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
    ], HOY);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
  });

  it('agrupa el tipo con espacios de sobra', () => {
    const r = preciosPorTipo([
      compra({ type: 'PLA', rolls: 1, amount: 20 }),
      compra({ type: ' PLA ', rolls: 1, amount: 22 }),
    ], HOY);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'PLA', rolls: 2 });
    expect(r[0].rollPrice).toBeCloseTo(21, 10);
  });

  it('sin compras devuelve una lista vacía, no un tipo en $0', () => {
    expect(preciosPorTipo([], HOY)).toEqual([]);
  });

  it('un tipo cuyos rollos no tienen gramos cargados no se ofrece', () => {
    // Sin gramos el costo por gramo sería una división por cero: el motor
    // devolvería 0 y la pieza saldría a costo de material cero.
    const r = preciosPorTipo([
      compra({ type: 'ASA', rolls: 2, amount: 50, rollGrams: 0 }),
      compra({ type: 'PLA', rolls: 1, amount: 20 }),
    ], HOY);

    expect(r.map((t) => t.type)).toEqual(['PLA']);
  });
});

/**
 * LA VENTANA DE 6 MESES (2026-10-10, decisión del dueño).
 *
 * Hasta ese día el promedio miraba TODA la historia, así que una compra vieja y
 * barata pesaba para siempre: el día que el filamento suba, la calculadora
 * seguiría cotizando con el precio de antes y **sin avisar**.
 *
 * ⚠️ **Con los datos de hoy esto no cambia ningún número**: casi todo el
 * catálogo entró con el import del 31/08 y cae dentro de la ventana. Estos
 * tests, con las fechas puestas a mano, son la ÚNICA prueba de que la ventana
 * existe y hace algo.
 *
 * ⚠️ **"Hoy" entra como PARÁMETRO**, como en `cashChainCuts`,
 * `facturasAtrasadas` y `campaignLifecycle`: leerlo del reloj acá adentro daría
 * un test que pasa hoy y falla solo algún día, sin que nadie toque el código.
 */
describe('preciosPorTipo: la ventana de 6 meses', () => {
  it('una compra VIEJA no arrastra el promedio hacia abajo', () => {
    // El PLA se compraba a $12 hace un año y hoy cuesta $20. Con toda la
    // historia el promedio daría (12 + 20 + 20) / 3 = 17,33 y cada trabajo se
    // cotizaría 13 % barato; con la ventana da 20, que es lo que cuesta hoy.
    const [pla] = preciosPorTipo(
      [
        compra({ rolls: 1, amount: 12, date: '2025-10-01' }),
        compra({ rolls: 1, amount: 20, date: '2026-09-01' }),
        compra({ rolls: 1, amount: 20, date: '2026-10-01' }),
      ],
      HOY,
    );

    expect(pla.rollPrice).toBeCloseTo(20, 10);
    expect(pla.rollPrice).not.toBeCloseTo(17.33, 1);
    // Y el respaldo que muestra la pantalla es el de la ventana, no el total.
    expect(pla.rolls).toBe(2);
    expect(pla.purchases).toBe(2);
    expect(pla.stale).toBe(false);
    expect(pla.lastPurchase).toBe('2026-10-01');
  });

  it('el borde de la ventana se incluye, el día de antes no', () => {
    // Ventana de 6 meses desde el 2026-10-10: arranca el 2026-04-10.
    const [justo] = preciosPorTipo(
      [compra({ rolls: 1, amount: 30, date: '2026-04-10' }), compra({ rolls: 1, amount: 20 })],
      HOY,
    );
    expect(justo.rollPrice).toBeCloseTo(25, 10);
    expect(justo.rolls).toBe(2);

    const [afuera] = preciosPorTipo(
      [compra({ rolls: 1, amount: 30, date: '2026-04-09' }), compra({ rolls: 1, amount: 20 })],
      HOY,
    );
    expect(afuera.rollPrice).toBeCloseTo(20, 10);
    expect(afuera.rolls).toBe(1);
  });

  it('una compra con fecha FUTURA entra: es una compra cargada, no un error', () => {
    // El dueño puede fechar una compra mañana al cargarla; descartarla haría
    // desaparecer el tipo entero sin explicación.
    const [pla] = preciosPorTipo([compra({ rolls: 1, amount: 22, date: '2026-10-31' })], HOY);

    expect(pla.rollPrice).toBeCloseTo(22, 10);
    expect(pla.stale).toBe(false);
  });

  /**
   * ⚠️ La regla que evita el peor resultado posible: **un tipo sin compras
   * recientes NO desaparece del desplegable**. Desaparecer sería peor que estar
   * un poco viejo, porque el dueño no podría cotizar ese tipo en absoluto.
   */
  it('un tipo SIN compras en la ventana sigue ofreciéndose, con su última compra', () => {
    const r = preciosPorTipo(
      [
        compra({ type: 'PLA', rolls: 2, amount: 40 }),
        compra({ type: 'ABS', rolls: 1, amount: 15, date: '2025-11-01' }),
        compra({ type: 'ABS', rolls: 2, amount: 50, date: '2026-01-15' }),
      ],
      HOY,
    );

    const abs = r.find((t) => t.type === 'ABS');
    expect(abs).toBeDefined();
    // La ÚLTIMA compra (25 el rollo), no el promedio de las dos viejas (21,66).
    expect(abs!.rollPrice).toBeCloseTo(25, 10);
    expect(abs!.rolls).toBe(2);
    expect(abs!.purchases).toBe(1);
    expect(abs!.stale).toBe(true);
    expect(abs!.lastPurchase).toBe('2026-01-15');
  });

  it('el tipo con el promedio viejo se marca `stale` y el reciente no', () => {
    const r = preciosPorTipo(
      [
        compra({ type: 'PLA', rolls: 1, amount: 20 }),
        compra({ type: 'ABS', rolls: 1, amount: 15, date: '2025-11-01' }),
      ],
      HOY,
    );

    expect(Object.fromEntries(r.map((t) => [t.type, t.stale]))).toEqual({ PLA: false, ABS: true });
  });

  it('los tipos con precio VIEJO van al FINAL: la calculadora arranca en uno de hoy', () => {
    // El orden decide qué elige la calculadora al abrirse. Un tipo que no se
    // compra desde el año pasado no puede ser el default por tener más rollos.
    const r = preciosPorTipo(
      [
        compra({ type: 'ABS', rolls: 40, amount: 600, date: '2025-11-01' }),
        compra({ type: 'PLA', rolls: 3, amount: 60 }),
      ],
      HOY,
    );

    expect(r.map((t) => t.type)).toEqual(['PLA', 'ABS']);
  });

  it('una compra SIN fecha cuenta como la más vieja: no se presenta como precio de hoy', () => {
    // Un gasto sin fecha legible no puede afirmar que es reciente. Sigue
    // sirviendo de respaldo, que es lo que evita que el tipo desaparezca.
    const r = preciosPorTipo(
      [
        compra({ type: 'ASA', rolls: 1, amount: 30, date: null }),
        compra({ type: 'ASA', rolls: 1, amount: 40, date: '2026-02-01' }),
      ],
      HOY,
    );

    expect(r[0].stale).toBe(true);
    expect(r[0].rollPrice).toBeCloseTo(40, 10);
    expect(r[0].lastPurchase).toBe('2026-02-01');
  });

  it('un tipo cuya única compra no tiene fecha se ofrece igual, sin inventarle una', () => {
    const [pla] = preciosPorTipo([compra({ rolls: 2, amount: 50, date: null })], HOY);

    expect(pla.rollPrice).toBeCloseTo(25, 10);
    expect(pla.stale).toBe(true);
    expect(pla.lastPurchase).toBeNull();
  });

  it('tolera un ISO con hora: la fecha es el día', () => {
    const [pla] = preciosPorTipo(
      [compra({ rolls: 1, amount: 20, date: '2026-09-01T00:00:00.000Z' })],
      HOY,
    );

    expect(pla.stale).toBe(false);
    expect(pla.lastPurchase).toBe('2026-09-01');
  });

  it('un día inventado se trata como sin fecha, no como una ventana corrida', () => {
    // `'2026-02-30'` no existe: `new Date` lo correría al 2 de marzo.
    const [pla] = preciosPorTipo([compra({ rolls: 1, amount: 20, date: '2026-02-30' })], HOY);

    expect(pla.stale).toBe(true);
    expect(pla.lastPurchase).toBeNull();
  });

  it('un "hoy" que no existe LANZA: sin ventana confiable no hay promedio', () => {
    expect(() => preciosPorTipo([compra({})], '2026-13-01')).toThrow();
    expect(() => preciosPorTipo([compra({})], '')).toThrow();
  });

  it('el regalo sigue afuera aunque sea la compra MÁS RECIENTE del tipo', () => {
    // El rollo regalado no es señal de precio ni dentro ni fuera de la ventana:
    // si entrara como "última compra", el tipo se ofrecería en $0.
    const r = preciosPorTipo(
      [
        compra({ type: 'PLA TOUGH+', rolls: 1, amount: 0, date: '2026-10-01' }),
        compra({ type: 'PLA TOUGH+', rolls: 2, amount: 44, date: '2025-12-01' }),
      ],
      HOY,
    );

    expect(r[0].rollPrice).toBeCloseTo(22, 10);
    expect(r[0].stale).toBe(true);
    expect(r[0].lastPurchase).toBe('2025-12-01');
  });
});
