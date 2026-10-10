import { rollosRecibidosPorFicha } from './stock';

/**
 * LO QUE ENTRÓ EN EL MES, por ficha — el punto de partida que se le OFRECE al
 * dueño cuando cuenta.
 *
 * ⚠️ **Sugerir no es escribir.** Esta función solo dice cuántos rollos entraron;
 * la casilla la llena el dueño. La decisión de fondo (descartó "el cierre
 * anterior más lo recibido") está en el comentario de `stock.ts`: si la app
 * completa el conteo, se termina confirmando un número en vez de mirando el
 * estante.
 *
 * ⚠️ **"No sé" y "cero" no son lo mismo.** Una ficha sin recepciones NO entra
 * en el resultado, así que la pantalla no puede ofrecerle un 0 — y 0 es un
 * conteo válido: ofrecerlo sería ofrecer una respuesta.
 */
describe('rollosRecibidosPorFicha', () => {
  it('suma los rollos de cada ficha, con números a mano', () => {
    expect(
      rollosRecibidosPorFicha([
        { materialId: 'm1', rolls: 2 },
        { materialId: 'm2', rolls: 1 },
        { materialId: 'm1', rolls: 3 },
      ]),
    ).toEqual({ m1: 5, m2: 1 });
  });

  it('una ficha SIN recepciones no está en el resultado: no sugiere 0', () => {
    const recibidos = rollosRecibidosPorFicha([{ materialId: 'm1', rolls: 2 }]);

    expect(recibidos.m2).toBeUndefined();
    expect('m2' in recibidos).toBe(false);
    // HERMANO ALCANZABLE: la que sí recibió está, con su número.
    expect(recibidos.m1).toBe(2);
  });

  it('una recepción de CERO rollos tampoco crea una sugerencia', () => {
    // Un gasto de filamento sin rollos existe (hay compras importadas en 0):
    // ofrecer "0 recibidos" es ofrecer un conteo, no una referencia.
    const recibidos = rollosRecibidosPorFicha([
      { materialId: 'm1', rolls: 0 },
      { materialId: 'm2', rolls: 4 },
    ]);

    expect('m1' in recibidos).toBe(false);
    expect(recibidos).toEqual({ m2: 4 });
  });

  it('una cantidad negativa es un dato roto y no se suma', () => {
    // Nunca debería pasar; si pasa, una sugerencia negativa de rollos no
    // significa nada y restaría de lo que sí entró.
    expect(
      rollosRecibidosPorFicha([
        { materialId: 'm1', rolls: 3 },
        { materialId: 'm1', rolls: -1 },
      ]),
    ).toEqual({ m1: 3 });
  });

  it('un gasto sin ficha enlazada se ignora', () => {
    // `Expense.materialId` es opcional: sin ficha no hay casilla que sugerir.
    expect(
      rollosRecibidosPorFicha([
        { materialId: null, rolls: 9 },
        { materialId: 'm1', rolls: 1 },
      ]),
    ).toEqual({ m1: 1 });
  });

  it('sin recepciones en el mes no sugiere nada en ninguna ficha', () => {
    expect(rollosRecibidosPorFicha([])).toEqual({});
  });
});
