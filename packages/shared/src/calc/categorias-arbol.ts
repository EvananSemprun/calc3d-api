/**
 * Árbol de categorías de la tienda (dos niveles como máximo).
 *
 * Función pura: recibe la lista plana y devuelve madres con sus hijas. Es la
 * ÚNICA definición de cómo se anidan y se ordenan; la API, el panel y la tienda
 * la consumen en vez de rehacer la cuenta.
 */

export interface CategoriaPlana {
  id: string;
  name: string;
  slug: string;
  position: number;
  parentId?: string | null;
}

export interface CategoriaConHijas<T extends CategoriaPlana = CategoriaPlana> {
  categoria: T;
  hijas: T[];
}

/** Mismo orden que `listCategories` del servidor: position asc, desempate por nombre. */
function porPosicionYNombre(a: CategoriaPlana, b: CategoriaPlana): number {
  return a.position - b.position || a.name.localeCompare(b.name, 'es');
}

/**
 * Anida la lista plana. Una categoría cuya madre no existe en la lista, o que
 * se apunta a sí misma, se trata como raíz: perderla por un dato roto es peor
 * que mostrarla fuera de lugar.
 */
export function arbolDeCategorias<T extends CategoriaPlana>(planas: T[]): CategoriaConHijas<T>[] {
  const ids = new Set(planas.map((c) => c.id));
  const raices: T[] = [];
  const hijasPorMadre = new Map<string, T[]>();

  for (const c of planas) {
    const madre = c.parentId;
    if (madre && madre !== c.id && ids.has(madre)) {
      const lista = hijasPorMadre.get(madre) ?? [];
      lista.push(c);
      hijasPorMadre.set(madre, lista);
    } else {
      raices.push(c);
    }
  }

  return raices.sort(porPosicionYNombre).map((categoria) => ({
    categoria,
    hijas: (hijasPorMadre.get(categoria.id) ?? []).sort(porPosicionYNombre),
  }));
}

/** Hijas directas de una categoría (hay dos niveles, no hay más abajo). */
export function descendientesDe<T extends CategoriaPlana>(planas: T[], id: string): T[] {
  return planas
    .filter((c) => c.parentId === id && c.id !== id)
    .sort(porPosicionYNombre);
}
