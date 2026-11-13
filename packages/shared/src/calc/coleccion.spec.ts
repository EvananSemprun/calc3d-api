import { coleccionVigente, resolverColeccion, type ColeccionConVentana } from './coleccion';

// El catálogo trae solo lo VISIBLE, ya en el orden de la tienda.
const catalogo = [
  { id: 'p-b', categoryId: 'cat-1' },
  { id: 'p-a', categoryId: 'cat-1' },
  { id: 'p-c', categoryId: 'cat-2' },
  { id: 'p-d', categoryId: null },
];
const ids = (r: { id: string }[]) => r.map((p) => p.id);

describe('resolverColeccion', () => {
  it('una categoría trae sus productos, en el orden de la categoría', () => {
    const r = resolverColeccion([{ categoryId: 'cat-1', position: 0 }], [], catalogo);
    expect(ids(r)).toEqual(['p-b', 'p-a']); // no alfabético
  });

  it('un producto suelto se agrega aunque su categoría no esté', () => {
    const r = resolverColeccion([{ productId: 'p-c', position: 0 }], [], catalogo);
    expect(ids(r)).toEqual(['p-c']);
  });

  it('una exclusión saca un producto que entró por su categoría', () => {
    const r = resolverColeccion([{ categoryId: 'cat-1', position: 0 }], ['p-b'], catalogo);
    expect(ids(r)).toEqual(['p-a']);
  });

  it('el orden lo manda `position`, no el alfabético ni el id', () => {
    const r = resolverColeccion(
      [
        { productId: 'p-d', position: 2 },
        { productId: 'p-a', position: 0 },
        { categoryId: 'cat-2', position: 1 },
      ],
      [],
      catalogo,
    );
    expect(ids(r)).toEqual(['p-a', 'p-c', 'p-d']);
  });

  it('un producto que entra por categoría Y suelto aparece UNA vez', () => {
    const r = resolverColeccion(
      [
        { productId: 'p-a', position: 0 },
        { categoryId: 'cat-1', position: 1 },
      ],
      [],
      catalogo,
    );
    expect(ids(r)).toEqual(['p-a', 'p-b']);
  });

  it('un producto OCULTO no entra, aunque esté listado', () => {
    // «p-oculto» no está en el catálogo visible.
    const r = resolverColeccion(
      [
        { productId: 'p-oculto', position: 0 },
        { productId: 'p-a', position: 1 },
      ],
      [],
      catalogo,
    );
    expect(ids(r)).toEqual(['p-a']);
  });

  it('un producto BORRADO no rompe: se saltea', () => {
    const items = [{ productId: 'ya-no-existe', position: 0 }];
    expect(() => resolverColeccion(items, ['tampoco'], catalogo)).not.toThrow();
    expect(resolverColeccion(items, [], catalogo)).toEqual([]);
  });

  it('devuelve el objeto del catálogo, con sus campos extra', () => {
    const r = resolverColeccion([{ productId: 'p-a', position: 0 }], [], [{ id: 'p-a', categoryId: null, name: 'X' }]);
    expect(r[0].name).toBe('X');
  });
});

const col = (o: Partial<ColeccionConVentana> & { id: string }) => ({
  esPrincipal: false,
  visible: true,
  startsAt: null,
  endsAt: null,
  ...o,
});

describe('coleccionVigente', () => {
  it('la principal gana sobre las demás', () => {
    const r = coleccionVigente(
      [col({ id: 'a', startsAt: '2026-12-01' }), col({ id: 'p', esPrincipal: true }), col({ id: 'c' })],
      '2026-12-10',
    );
    expect(r?.id).toBe('p');
  });

  it('una colección fuera de su ventana de fechas NO está vigente', () => {
    const c = col({ id: 'a', startsAt: '2026-12-01', endsAt: '2026-12-31' });
    expect(coleccionVigente([c], '2026-11-30')).toBeNull();
    expect(coleccionVigente([c], '2027-01-01')).toBeNull();
    expect(coleccionVigente([c], '2026-12-15')?.id).toBe('a');
  });

  it('los bordes son INCLUSIVOS: el primer y el último día cuentan', () => {
    const c = col({ id: 'a', startsAt: '2026-12-01', endsAt: '2026-12-31' });
    expect(coleccionVigente([c], '2026-12-01')?.id).toBe('a');
    expect(coleccionVigente([c], '2026-12-31')?.id).toBe('a');
  });

  it('sin fechas, la colección vale siempre', () => {
    expect(coleccionVigente([col({ id: 'a' })], '2031-05-05')?.id).toBe('a');
  });

  it('una colección NO visible nunca está vigente', () => {
    expect(coleccionVigente([col({ id: 'a', visible: false, esPrincipal: true })], '2026-12-10')).toBeNull();
  });

  it('una principal fuera de ventana cede ante otra vigente', () => {
    const r = coleccionVigente(
      [col({ id: 'p', esPrincipal: true, endsAt: '2026-11-30' }), col({ id: 'b' })],
      '2026-12-10',
    );
    expect(r?.id).toBe('b');
  });

  it('sin principal vigente gana la de arranque más reciente', () => {
    const r = coleccionVigente(
      [col({ id: 'vieja', startsAt: '2026-10-01' }), col({ id: 'nueva', startsAt: '2026-12-01' }), col({ id: 'sin' })],
      '2026-12-10',
    );
    expect(r?.id).toBe('nueva');
  });

  it('sin colecciones, null', () => {
    expect(coleccionVigente([], '2026-12-10')).toBeNull();
  });
});
