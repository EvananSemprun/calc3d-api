/**
 * LA CONSULTA DEL CATÁLOGO que alimenta a `resolverColeccion`: qué productos y en qué orden
 * entran a resolver una colección.
 *
 * ⚠️ **Vive acá y no en un servicio porque la leen DOS**: `StorePublicService` (lo que la
 * tienda publica) y `StoreColeccionesService.preview` (lo que el panel enseña antes de
 * activar). Que la RESOLUCIÓN sea una sola función de shared no alcanza: si cada lado armara
 * su catálogo por su cuenta, el día que uno cambiara el filtro de visibles o el orden la
 * vista previa seguiría funcionando y empezaría a MENTIR (el dueño aprobaría una portada y
 * saldría otra), sin que nada se pusiera rojo. Con una sola definición, cambiarla mueve a
 * los dos a la vez. Lo fija `store/colecciones-paridad.spec.ts`.
 *
 * Devuelve solo los argumentos de Prisma (`where` + `orderBy`/`select` comunes): cada lado
 * agrega lo suyo (`include` de la tarjeta, o nada) sin tocar el criterio.
 */

/** Productos VISIBLES de la organización, en el orden de la tienda. */
export function productosParaColecciones(organizationId: string) {
  return {
    where: { organizationId, visible: true },
    orderBy: [{ position: 'asc' as const }, { createdAt: 'desc' as const }],
  };
}

/** Categorías planas con su madre: lo que `resolverColeccion` necesita para las hijas. */
export function categoriasParaColecciones(organizationId: string) {
  return {
    where: { organizationId },
    select: { id: true, slug: true, parentId: true },
  };
}
