import { restockByColor, type RestockMaterial } from './stock';

/**
 * Reposición POR COLOR: la marca cambia de un mes a otro (este mes Creality, el
 * otro Bambu), lo que se maneja es el tipo + color. Decisión del dueño,
 * 2026-09-13.
 */

const mat = (
  id: string,
  type: string | null,
  color: string | null,
  brand: string | null = 'Creality',
  status: RestockMaterial['status'] = 'ACTIVE',
): RestockMaterial => ({ id, type, color, brand, status });

const cero = { sealed: 0, inUse: 0, running: 0 };

describe('restockByColor — agrupar', () => {
  it('suma las marcas del mismo tipo y color', () => {
    // Negro Creality en cero y Negro Bambu con uno en uso: HAY negro.
    const r = restockByColor(
      [mat('a', 'PLA', 'Negro', 'Creality'), mat('b', 'PLA', 'Negro', 'Bambu Lab')],
      { a: cero, b: { sealed: 0, inUse: 1, running: 0 } },
      {},
    );

    expect(r.groups.find((g) => g.label === 'PLA Negro')?.status).not.toBe('OUT');
    expect(r.totalColors).toBe(1);
  });

  it('un PETG negro no es un PLA negro', () => {
    const r = restockByColor(
      [mat('a', 'PLA', 'Negro'), mat('b', 'PETG', 'Negro')],
      { a: cero, b: cero },
      {},
    );

    expect(r.groups.map((g) => g.label).sort()).toEqual(['PETG Negro', 'PLA Negro']);
  });

  it('no distingue mayúsculas ni espacios de más', () => {
    const r = restockByColor(
      [mat('a', 'PLA', 'Negro'), mat('b', 'pla ', ' negro', 'Sunlu')],
      { a: cero, b: cero },
      {},
    );

    expect(r.totalColors).toBe(1);
    expect(r.groups[0].brands.sort()).toEqual(['Creality', 'Sunlu']);
  });
});

describe('restockByColor — qué se contó', () => {
  it('en un mes con conteo, un color sin nada marcado es CERO (como en el Excel)', () => {
    // Decisión del dueño, 2026-09-13: casillas vacías = no hay.
    const r = restockByColor(
      [mat('a', 'PLA', 'Blanco', 'Bambu Lab'), mat('b', 'PLA', 'Blanco', 'Creality'), mat('c', 'PLA', 'Rojo')],
      { a: { sealed: 0, inUse: 1, running: 0 } },
      {},
    );

    expect(r.groups.find((g) => g.label === 'PLA Rojo')?.status).toBe('OUT');
    expect(r.countedColors).toBe(2);
    expect(r.totalColors).toBe(2);
  });

  it('un mes SIN NINGÚN conteo no pide nada: todavía no se contó', () => {
    // Sin esto, al abrir un mes nuevo todos los colores saldrían "sin rollos".
    const r = restockByColor([mat('a', 'PLA', 'Rojo')], {}, { a: 10 });

    expect(r.groups).toEqual([]);
    expect(r.countedColors).toBe(0);
  });

  it('un color con TODAS sus fichas descontinuadas no cuenta ni se pide', () => {
    const r = restockByColor(
      [mat('a', 'PLA', 'Arcoiris', 'Creality', 'DISCONTINUED')],
      { a: cero },
      {},
    );

    expect(r.totalColors).toBe(0);
    expect(r.groups).toEqual([]);
  });

  it('si solo una marca está descontinuada, el color se sigue reponiendo', () => {
    const r = restockByColor(
      [mat('a', 'PLA', 'Negro', 'Sunlu', 'DISCONTINUED'), mat('b', 'PLA', 'Negro', 'Creality')],
      { a: cero, b: cero },
      {},
    );

    expect(r.groups[0]).toMatchObject({ label: 'PLA Negro', status: 'OUT' });
  });
});

describe('restockByColor — estados', () => {
  it('sin rollos de ninguna marca: OUT', () => {
    const r = restockByColor([mat('a', 'PLA', 'Negro')], { a: cero }, {});

    expect(r.groups[0].status).toBe('OUT');
  });

  it('con alguno por acabarse: LOW', () => {
    const r = restockByColor([mat('a', 'PLA', 'Gris')], { a: { sealed: 1, inUse: 0, running: 1 } }, {});

    expect(r.groups[0].status).toBe('LOW');
  });

  it('de los más comprados y con 1 rollo o menos: SUGGEST', () => {
    // Promedio: (8 + 1 + 1) / 3 ≈ 3.33. El negro está arriba y le queda uno en uso.
    const r = restockByColor(
      [mat('n', 'PLA', 'Negro'), mat('b', 'PLA', 'Beige'), mat('t', 'PLA', 'Turquesa')],
      {
        n: { sealed: 0, inUse: 1, running: 0 },
        b: { sealed: 0, inUse: 1, running: 0 },
        t: { sealed: 0, inUse: 1, running: 0 },
      },
      { n: 8, b: 1, t: 1 },
    );

    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ label: 'PLA Negro', status: 'SUGGEST', purchased: 8, total: 1 });
  });

  it('uno de los más comprados con 2 rollos NO se sugiere', () => {
    const r = restockByColor(
      [mat('n', 'PLA', 'Negro'), mat('b', 'PLA', 'Beige')],
      { n: { sealed: 1, inUse: 1, running: 0 }, b: { sealed: 1, inUse: 1, running: 0 } },
      { n: 8, b: 1 },
    );

    expect(r.groups).toEqual([]);
  });

  it('justo en el promedio no es "de los más comprados"', () => {
    // Promedio (2 + 2) / 2 = 2: ninguno lo supera.
    const r = restockByColor(
      [mat('a', 'PLA', 'Rojo'), mat('b', 'PLA', 'Azul')],
      { a: { sealed: 0, inUse: 1, running: 0 }, b: { sealed: 0, inUse: 1, running: 0 } },
      { a: 2, b: 2 },
    );

    expect(r.groups).toEqual([]);
  });
});

describe('restockByColor — orden', () => {
  it('de más comprado a menos, para comprar primero lo que más se usa', () => {
    const r = restockByColor(
      [mat('a', 'PLA', 'Arena'), mat('n', 'PLA', 'Negro'), mat('b', 'PLA', 'Blanco')],
      { a: cero, n: cero, b: cero },
      { a: 1, n: 8, b: 5 },
    );

    expect(r.groups.map((g) => g.label)).toEqual(['PLA Negro', 'PLA Blanco', 'PLA Arena']);
  });
});
