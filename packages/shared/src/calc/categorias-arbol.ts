/**
 * Árbol de categorías de la tienda (dos niveles como máximo).
 *
 * Función pura: recibe la lista plana y devuelve madres con sus hijas. Es la
 * ÚNICA definición de cómo se anidan y se ordenan; la consumen el panel (y la tienda
 * pública cuando la adopte, mapeando su lista: `id: slug`, `parentId: parentSlug`,
 * `position: índice`). La API NO la usa: devuelve la lista plana.
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
 * Anida la lista plana. Una categoría cuya madre no existe en la lista, que
 * se apunta a sí misma, cuya madre es a su vez hija (nieta) o que forma un
 * ciclo, se trata como raíz: perderla por un dato roto es peor
 * que mostrarla fuera de lugar.
 */
export function arbolDeCategorias<T extends CategoriaPlana>(planas: T[]): CategoriaConHijas<T>[] {
  const ids = new Set(planas.map((c) => c.id));
  const tieneMadreValida = (c: T): boolean =>
    !!c.parentId && c.parentId !== c.id && ids.has(c.parentId);
  // Solo puede ser madre quien NO tiene madre válida. Así una nieta (tres
  // niveles) o un ciclo suben a la raíz en vez de quedar colgadas de una lista
  // que nunca se emite.
  const puedenSerMadre = new Set(planas.filter((c) => !tieneMadreValida(c)).map((c) => c.id));
  const raices: T[] = [];
  const hijasPorMadre = new Map<string, T[]>();

  for (const c of planas) {
    const madre = c.parentId;
    if (madre && madre !== c.id && puedenSerMadre.has(madre)) {
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

/**
 * Texto de la opción de una hija en un selector de una sola columna: sangría con
 * espacios duros. Si OTRA hija de otra madre se llama igual, agrega la madre entre
 * paréntesis: al buscar solo se muestran las coincidencias y, sin la madre, «Autos» bajo
 * Juguetes y «Autos» bajo Llaveros serían idénticas. Si el nombre es único, queda limpio.
 */
export function etiquetaDeHija<T extends CategoriaPlana>(
  arbol: CategoriaConHijas<T>[],
  madre: T,
  hija: T,
): string {
  const norm = (n: string) => n.trim().toLowerCase();
  const repetida = arbol.some(
    (g) =>
      g.categoria.id !== madre.id &&
      g.hijas.some((h) => h.id !== hija.id && norm(h.name) === norm(hija.name)),
  );
  return '  ' + hija.name + (repetida ? ` (${madre.name})` : '');
}
