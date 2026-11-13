import { coleccionVigente, resolverColeccion, type ColeccionConVentana } from './coleccion';

// El catálogo trae solo lo VISIBLE, ya en el orden de la tienda.
const catalogo = [
  { id: 'p-b', categoryId: 'cat-1' },
  { id: 'p-a', categoryId: 'cat-1' },
  { id: 'p-c', categoryId: 'cat-2' },
  { id: 'p-d', categoryId: null },
  { id: 'p-m', categoryId: 'cat-madre' },
  { id: 'p-h1', categoryId: 'cat-h1' },
  { id: 'p-h2', categoryId: 'cat-h2' },
];
// Árbol: cat-madre tiene dos hijas; cat-1 y cat-2 son raíces sueltas.
const categorias = [
  { id: 'cat-1' },
  { id: 'cat-2' },
  { id: 'cat-madre' },
  { id: 'cat-h1', parentId: 'cat-madre' },
  { id: 'cat-h2', parentId: 'cat-madre' },
];
const ids = (r: { id: string }[]) => r.map((p) => p.id);

describe('resolverColeccion', () => {
  it('una categoría trae sus productos, en el orden de la categoría', () => {
    const r = resolverColeccion([{ categoryId: 'cat-1', position: 0 }], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-b', 'p-a']); // no alfabético
  });

  it('un producto suelto se agrega aunque su categoría no esté', () => {
    const r = resolverColeccion([{ productId: 'p-c', position: 0 }], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-c']);
  });

  it('una exclusión saca un producto que entró por su categoría', () => {
    const r = resolverColeccion([{ categoryId: 'cat-1', position: 0 }], ['p-b'], catalogo, categorias);
    expect(ids(r)).toEqual(['p-a']);
  });

  it('el orden lo manda `position`, no el alfabético ni el id', () => {
    const r = resolverColeccion(
      [
        { productId: 'p-d', position: 2 },
        { productId: 'p-a', position: 0 },
        { categoryId: 'cat-2', position: 1 },
      ], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-a', 'p-c', 'p-d']);
  });

  it('un producto que entra por categoría Y suelto aparece UNA vez', () => {
    const r = resolverColeccion(
      [
        { productId: 'p-a', position: 0 },
        { categoryId: 'cat-1', position: 1 },
      ], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-a', 'p-b']);
  });

  it('un producto OCULTO no entra, aunque esté listado', () => {
    // «p-oculto» no está en el catálogo visible.
    const r = resolverColeccion(
      [
        { productId: 'p-oculto', position: 0 },
        { productId: 'p-a', position: 1 },
      ], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-a']);
  });

  it('un producto BORRADO no rompe: se saltea', () => {
    const items = [{ productId: 'ya-no-existe', position: 0 }];
    expect(() => resolverColeccion(items, ['tampoco'], catalogo, categorias)).not.toThrow();
    expect(resolverColeccion(items, [], catalogo, categorias)).toEqual([]);
  });

  it('una categoría MADRE trae los productos de sus hijas, en el orden del catálogo', () => {
    const r = resolverColeccion([{ categoryId: 'cat-madre', position: 0 }], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-m', 'p-h1', 'p-h2']);
  });

  it('una hija elegida SOLA trae solo los suyos (ni la madre ni la hermana)', () => {
    const r = resolverColeccion([{ categoryId: 'cat-h1', position: 0 }], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-h1']);
  });

  it('la madre y una hija listadas aparte no repiten al producto de la hija', () => {
    const r = resolverColeccion([{ categoryId: 'cat-h1', position: 0 }, { categoryId: 'cat-madre', position: 1 }], [], catalogo, categorias);
    expect(ids(r)).toEqual(['p-h1', 'p-m', 'p-h2']);
  });

  it('devuelve el objeto del catálogo, con sus campos extra', () => {
    const r = resolverColeccion([{ productId: 'p-a', position: 0 }], [], [{ id: 'p-a', categoryId: null, name: 'X' }], categorias);
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
  const principal = (o: Partial<ColeccionConVentana> & { id: string }) => col({ esPrincipal: true, ...o });

  it('la principal vigente es la colección de la portada, y las demás no', () => {
    const r = coleccionVigente([col({ id: 'a', startsAt: '2026-12-01' }), principal({ id: 'p' }), col({ id: 'c' })], '2026-12-10');
    expect(r?.id).toBe('p');
  });

  it('una principal fuera de su ventana de fechas NO está vigente', () => {
    const c = principal({ id: 'a', startsAt: '2026-12-01', endsAt: '2026-12-31' });
    expect(coleccionVigente([c], '2026-11-30')).toBeNull();
    expect(coleccionVigente([c], '2027-01-01')).toBeNull();
    expect(coleccionVigente([c], '2026-12-15')?.id).toBe('a');
  });

  it('los bordes son INCLUSIVOS: el primer y el último día cuentan', () => {
    const c = principal({ id: 'a', startsAt: '2026-12-01', endsAt: '2026-12-31' });
    expect(coleccionVigente([c], '2026-12-01')?.id).toBe('a');
    expect(coleccionVigente([c], '2026-12-31')?.id).toBe('a');
  });

  it('sin fechas, la principal vale siempre', () => {
    expect(coleccionVigente([principal({ id: 'a' })], '2031-05-05')?.id).toBe('a');
  });

  it('una principal NO visible nunca está vigente', () => {
    expect(coleccionVigente([principal({ id: 'a', visible: false })], '2026-12-10')).toBeNull();
  });

  it('principal vencida: NO cae en otra colección, ni siquiera en una vigente sin fechas', () => {
    const r = coleccionVigente(
      [principal({ id: 'p', endsAt: '2026-11-30' }), col({ id: 'sin-fechas' }), col({ id: 'nueva', startsAt: '2026-12-01' })],
      '2026-12-10',
    );
    expect(r).toBeNull();
  });

  it('sin principal, null aunque haya colecciones vigentes', () => {
    expect(coleccionVigente([col({ id: 'a' })], '2026-12-10')).toBeNull();
  });

  it('sin colecciones, null', () => {
    expect(coleccionVigente([], '2026-12-10')).toBeNull();
  });
});
