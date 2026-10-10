import type { RestockGroup } from './stock';
import { ROLLOS_SUGERIDOS, suggestRestockLines, type RestockOrderSource } from './restock-order';

/**
 * ARMAR EL PEDIDO CON LO QUE FALTA.
 *
 * Los números van puestos a mano. Lo que se prueba es QUÉ entra en la
 * propuesta, con qué ficha y con qué precio: es donde una propuesta miente sin
 * que se note (un color que ya está en el estante con otra marca, un color
 * descontinuado que se pide igual, un rollo que entra a $0 como si fuera
 * gratis).
 */

const grupo = (p: Partial<RestockGroup> = {}): RestockGroup => ({
  key: 'pla|negro',
  label: 'PLA Negro',
  status: 'OUT',
  total: 0,
  running: 0,
  purchased: 6,
  brands: ['Creality'],
  ...p,
});

const ficha = (p: Partial<RestockOrderSource> = {}): RestockOrderSource => ({
  materialId: 'm1',
  name: 'PLA Creality Negro',
  type: 'PLA',
  color: 'Negro',
  status: 'ACTIVE',
  lastRollPrice: 18,
  ...p,
});

describe('suggestRestockLines — qué entra', () => {
  it('un color sin rollos entra, con su ficha y el último precio pagado', () => {
    const lineas = suggestRestockLines([grupo()], [ficha({ lastRollPrice: 18.5 })]);

    expect(lineas).toEqual([
      {
        materialId: 'm1',
        label: 'PLA Negro',
        status: 'OUT',
        quantity: ROLLOS_SUGERIDOS,
        unitPrice: 18.5,
      },
    ]);
  });

  it('un color por acabarse entra como LOW', () => {
    const lineas = suggestRestockLines([grupo({ status: 'LOW', total: 2, running: 1 })], [ficha()]);

    expect(lineas.map((l) => l.status)).toEqual(['LOW']);
  });

  it('un color que solo conviene reponer NO entra: eso no es un faltante', () => {
    const lineas = suggestRestockLines([grupo({ status: 'SUGGEST', total: 1 })], [ficha()]);

    expect(lineas).toEqual([]);
  });

  it('sin nada que falte la propuesta queda vacía', () => {
    expect(suggestRestockLines([], [ficha()])).toEqual([]);
  });

  // ⚠️ La razón de ser de la agrupación por color: el PLA Negro de la base
  // real tiene CUATRO marcas. Una línea por ficha pediría negro cuatro veces.
  it('un color con varias marcas entra UNA sola vez', () => {
    const lineas = suggestRestockLines(
      [grupo({ brands: ['Creality', 'Bambu Lab', 'Sunlu'] })],
      [
        ficha({ materialId: 'c', name: 'PLA Creality Negro' }),
        ficha({ materialId: 'b', name: 'PLA Bambu Negro' }),
        ficha({ materialId: 's', name: 'PLA Sunlu Negro' }),
      ],
    );

    expect(lineas).toHaveLength(1);
  });

  it('un tipo distinto del mismo color es otro color: PETG Negro no es PLA Negro', () => {
    const lineas = suggestRestockLines(
      [grupo({ key: 'petg|negro', label: 'PETG Negro' })],
      [
        ficha({ materialId: 'pla', name: 'PLA Creality Negro', type: 'PLA' }),
        ficha({ materialId: 'petg', name: 'PETG Creality Negro', type: 'PETG' }),
      ],
    );

    expect(lineas.map((l) => l.materialId)).toEqual(['petg']);
  });

  it('un color del que no hay ninguna ficha cargada no inventa una línea', () => {
    const lineas = suggestRestockLines(
      [grupo({ key: 'pla|fucsia', label: 'PLA Fucsia' })],
      [ficha()],
    );

    expect(lineas).toEqual([]);
  });

  it('la clave se compara sin mayúsculas ni espacios de más', () => {
    const lineas = suggestRestockLines([grupo()], [ficha({ type: ' pla ', color: 'NEGRO' })]);

    expect(lineas.map((l) => l.materialId)).toEqual(['m1']);
  });
});

describe('suggestRestockLines — las descontinuadas', () => {
  // ⚠️ La regla que la verificación por mutación tiene que poder tumbar: si se
  // dejó de manejar ese color, proponer comprarlo es ruido.
  it('una ficha DESCONTINUADA no se propone, aunque su color esté en cero', () => {
    const lineas = suggestRestockLines(
      [grupo()],
      [ficha({ materialId: 'viejo', status: 'DISCONTINUED' })],
    );

    expect(lineas).toEqual([]);
  });

  // La descontinuada está armada para GANAR los dos desempates (va primero por
  // nombre y además tiene último precio): si el filtro no estuviera, se
  // propondría ella. Sin esto el test pasaba igual sin el filtro y no probaba nada.
  it('con una marca descontinuada y otra activa, se propone la activa', () => {
    const lineas = suggestRestockLines(
      [grupo({ brands: ['Bambu Lab', 'Creality'] })],
      [
        ficha({ materialId: 'muerta', name: 'PLA Bambu Negro', status: 'DISCONTINUED', lastRollPrice: 18 }),
        ficha({ materialId: 'viva', name: 'PLA Creality Negro', lastRollPrice: null }),
      ],
    );

    expect(lineas.map((l) => [l.materialId, l.unitPrice])).toEqual([['viva', null]]);
  });
});

describe('suggestRestockLines — el precio', () => {
  it('una ficha sin ninguna compra previa entra con el precio EN BLANCO', () => {
    const lineas = suggestRestockLines([grupo()], [ficha({ lastRollPrice: null })]);

    expect(lineas).toHaveLength(1);
    expect(lineas[0].unitPrice).toBeNull();
  });

  it('un precio en 0 también entra en blanco: un rollo no es gratis', () => {
    const lineas = suggestRestockLines([grupo()], [ficha({ lastRollPrice: 0 })]);

    expect(lineas[0].unitPrice).toBeNull();
  });

  it('un precio negativo o imposible entra en blanco', () => {
    const lineas = suggestRestockLines(
      [grupo({ key: 'pla|negro' }), grupo({ key: 'pla|rojo', label: 'PLA Rojo' })],
      [
        ficha({ materialId: 'a', color: 'Negro', lastRollPrice: -5 }),
        ficha({ materialId: 'b', color: 'Rojo', lastRollPrice: Number.NaN }),
      ],
    );

    expect(lineas.map((l) => l.unitPrice)).toEqual([null, null]);
  });

  it('el precio se pasa tal cual, sin redondear: es lo que se pagó', () => {
    const lineas = suggestRestockLines([grupo()], [ficha({ lastRollPrice: 17.3333 })]);

    expect(lineas[0].unitPrice).toBe(17.3333);
  });

  it('entre dos marcas, se propone la que SÍ se compró alguna vez', () => {
    const lineas = suggestRestockLines(
      [grupo({ brands: ['Bambu Lab', 'Creality'] })],
      [
        ficha({ materialId: 'nunca', name: 'PLA Bambu Negro', lastRollPrice: null }),
        ficha({ materialId: 'comprada', name: 'PLA Creality Negro', lastRollPrice: 18 }),
      ],
    );

    expect(lineas.map((l) => [l.materialId, l.unitPrice])).toEqual([['comprada', 18]]);
  });

  it('si ninguna se compró, se propone una igual, con el precio en blanco', () => {
    const lineas = suggestRestockLines(
      [grupo({ brands: ['Bambu Lab', 'Creality'] })],
      [
        // A propósito al revés: la que viene primero en el arreglo es Creality.
        ficha({ materialId: 'creality', name: 'PLA Creality Negro', lastRollPrice: null }),
        ficha({ materialId: 'bambu', name: 'PLA Bambu Negro', lastRollPrice: null }),
      ],
    );

    // Empate: la primera por NOMBRE (Bambu antes que Creality), no la primera
    // del arreglo, para que la propuesta no dependa del orden en que llegaron.
    expect(lineas.map((l) => [l.materialId, l.unitPrice])).toEqual([['bambu', null]]);
  });
});

describe('suggestRestockLines — el orden y la cantidad', () => {
  it('respeta el orden de la lista de reposición, de más comprado a menos', () => {
    const lineas = suggestRestockLines(
      [
        grupo({ key: 'pla|negro', label: 'PLA Negro', purchased: 9 }),
        grupo({ key: 'pla|azul', label: 'PLA Azul', purchased: 4, status: 'LOW' }),
        grupo({ key: 'petg|rojo', label: 'PETG Rojo', purchased: 1 }),
      ],
      [
        ficha({ materialId: 'negro', color: 'Negro' }),
        ficha({ materialId: 'azul', color: 'Azul' }),
        ficha({ materialId: 'rojo', type: 'PETG', color: 'Rojo' }),
      ],
    );

    expect(lineas.map((l) => l.materialId)).toEqual(['negro', 'azul', 'rojo']);
  });

  /**
   * Decisión: **un rollo por color**. Es la unidad con la que se compra y con
   * la que se cuenta el estante, y el riesgo es asimétrico — subir una
   * cantidad en el diálogo es un click, comprar un rollo que no se quería es
   * plata quieta en una repisa. La propuesta se queda del lado corto a
   * propósito.
   */
  it('propone un rollo por color, falte poco o falte todo', () => {
    const lineas = suggestRestockLines(
      [
        grupo({ key: 'pla|negro', total: 0 }),
        grupo({ key: 'pla|azul', label: 'PLA Azul', status: 'LOW', total: 3, running: 3 }),
      ],
      [
        ficha({ materialId: 'negro', color: 'Negro' }),
        ficha({ materialId: 'azul', color: 'Azul' }),
      ],
    );

    expect(lineas.map((l) => l.quantity)).toEqual([1, 1]);
  });
});
