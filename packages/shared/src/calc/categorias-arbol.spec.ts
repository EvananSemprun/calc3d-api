import { arbolDeCategorias, descendientesDe, CategoriaPlana } from './categorias-arbol';

const cat = (id: string, name: string, position: number, parentId?: string | null): CategoriaPlana => ({
  id,
  name,
  slug: id,
  position,
  parentId,
});

describe('arbolDeCategorias', () => {
  it('anida cada hija bajo su madre, en orden de position y después por nombre', () => {
    const arbol = arbolDeCategorias([
      cat('h3', 'Zeta', 1, 'm1'),
      cat('m2', 'Hogar', 1),
      cat('h1', 'Árboles', 1, 'm1'),
      cat('h2', 'Bases', 0, 'm1'),
      cat('m1', 'Decoración', 0),
    ]);
    expect(arbol.map((n) => n.categoria.id)).toEqual(['m1', 'm2']);
    expect(arbol[0].hijas.map((h) => h.id)).toEqual(['h2', 'h1', 'h3']);
    expect(arbol[1].hijas).toEqual([]);
  });

  it('una categoría cuya madre no existe en la lista sube a la raíz', () => {
    const arbol = arbolDeCategorias([cat('a', 'A', 0), cat('huerfana', 'H', 1, 'no-existe')]);
    expect(arbol.map((n) => n.categoria.id)).toEqual(['a', 'huerfana']);
  });

  it('ignora un parentId que apunta a sí misma', () => {
    const arbol = arbolDeCategorias([cat('a', 'A', 0, 'a')]);
    expect(arbol).toHaveLength(1);
    expect(arbol[0].categoria.id).toBe('a');
    expect(arbol[0].hijas).toEqual([]);
  });

  it('devuelve [] con una lista vacía', () => {
    expect(arbolDeCategorias([])).toEqual([]);
  });
});

describe('descendientesDe', () => {
  const lista = [cat('m', 'M', 0), cat('h2', 'B', 1, 'm'), cat('h1', 'A', 1, 'm'), cat('otra', 'O', 1)];

  it('devuelve las hijas directas de una madre', () => {
    expect(descendientesDe(lista, 'm').map((c) => c.id)).toEqual(['h1', 'h2']);
  });
  it('devuelve [] para una hoja', () => {
    expect(descendientesDe(lista, 'h1')).toEqual([]);
  });
  it('devuelve [] si el id no existe', () => {
    expect(descendientesDe(lista, 'zzz')).toEqual([]);
  });
});
