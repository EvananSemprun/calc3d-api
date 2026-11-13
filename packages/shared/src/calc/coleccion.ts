/**
 * Colección de la portada: qué productos entran y cuál colección está vigente.
 *
 * ⚠️ Es la ÚNICA definición y la llaman los DOS lados: la vista previa del panel y el
 * endpoint público. Si cada uno resolviera por su cuenta, el dueño aprobaría una portada
 * y saldría otra. Por eso es pura: sin Prisma, sin Nest, sin reloj.
 */

export interface ItemDeColeccion {
  categoryId?: string | null;
  productId?: string | null;
  position: number;
}

/** Un producto del catálogo VISIBLE. Lo que sobre de estos campos se devuelve intacto. */
export interface ProductoDeCatalogo {
  id: string;
  categoryId: string | null;
}

/** Lo mínimo de una categoría para saber de quién es hija. */
export interface CategoriaDeColeccion {
  id: string;
  parentId?: string | null;
}

/**
 * Devuelve los productos de la colección, en orden y sin repetir.
 *
 * - Los items se recorren por `position` (no por alfabeto ni por id).
 * - Una categoría trae sus productos en el orden en que vienen en `catalogo`, que es el
 *   orden de la categoría en la tienda. Una MADRE trae también los de sus hijas: es lo que
 *   ya hace `?category=` en el catálogo público, y si la colección lo hiciera distinto el
 *   dueño elegiría «Navidad» (madre) y se llevaría una colección vacía sin ningún error.
 *   Por eso recibe `categorias` (lista plana con `parentId`, la forma más simple: es lo que
 *   ya devuelve la API y no obliga a armar el árbol). Es parámetro OBLIGATORIO: con un
 *   default vacío, olvidarlo reintroduciría la colección vacía en silencio.
 * - Un producto que entra por categoría Y suelto sale UNA vez (el primero que lo trae).
 * - `catalogo` trae solo lo VISIBLE: un producto oculto o borrado no está ahí, así que un
 *   item que lo nombra se saltea. El dato roto se resuelve en el borde, no rompe la portada.
 * - Una exclusión saca el producto aunque entre por categoría o suelto.
 */
export function resolverColeccion<P extends ProductoDeCatalogo>(
  items: readonly ItemDeColeccion[],
  exclusiones: readonly string[],
  catalogo: readonly P[],
  categorias: readonly CategoriaDeColeccion[],
): P[] {
  const excluidos = new Set(exclusiones);
  const porId = new Map(catalogo.map((p) => [p.id, p]));
  // sort estable: items con la misma `position` conservan el orden en que llegaron.
  const ordenados = [...items].sort((a, b) => a.position - b.position);

  const vistos = new Set<string>();
  const resultado: P[] = [];
  const agregar = (p: P | undefined) => {
    if (!p || excluidos.has(p.id) || vistos.has(p.id)) return;
    vistos.add(p.id);
    resultado.push(p);
  };

  for (const item of ordenados) {
    if (item.categoryId) {
      // La categoría elegida y sus hijas directas (hay dos niveles, no más). Se recorre el
      // catálogo una vez para conservar su orden, el mismo de `?category=`.
      const entran = new Set([item.categoryId]);
      for (const c of categorias) if (c.parentId === item.categoryId) entran.add(c.id);
      for (const p of catalogo) if (p.categoryId && entran.has(p.categoryId)) agregar(p);
    } else if (item.productId) {
      agregar(porId.get(item.productId));
    }
  }
  return resultado;
}

/** Día de negocio AAAA-MM-DD. Las comparaciones son de texto: ese formato ordena bien. */
export type DiaNegocio = string;

export interface ColeccionConVentana {
  esPrincipal: boolean;
  visible: boolean;
  startsAt: DiaNegocio | null;
  endsAt: DiaNegocio | null;
}

/** ¿Vale en `now`? Bordes INCLUSIVOS: el primer y el último día cuentan (como `activeSale`). */
export function coleccionEnVentana(
  c: Pick<ColeccionConVentana, 'startsAt' | 'endsAt'>,
  now: DiaNegocio,
): boolean {
  if (c.startsAt && now < c.startsAt) return false;
  if (c.endsAt && now > c.endsAt) return false;
  return true;
}

/**
 * La colección que la portada muestra hoy, o null.
 *
 * ⚠️ `now` es un PARÁMETRO (el día LOCAL, AAAA-MM-DD), nunca el reloj: el servidor corre
 * en UTC y desde las 20:00 de Caracas una colección se activaría o moriría un día antes.
 *
 * Vigente = visible y dentro de su ventana. SOLO la principal puede ser la colección de la
 * portada: si no está vigente (o no hay principal) devuelve null y quien llama cae a
 * «Destacados». No se elige una sustituta a propósito: una colección SIN fechas vale
 * siempre, así que la primera guardada y nunca promovida se adueñaría de la portada, en
 * silencio y para siempre, el día que venza la principal.
 */
export function coleccionVigente<C extends ColeccionConVentana>(
  colecciones: readonly C[],
  now: DiaNegocio,
): C | null {
  const principal = colecciones.find((c) => c.esPrincipal);
  if (!principal || !principal.visible || !coleccionEnVentana(principal, now)) return null;
  return principal;
}
