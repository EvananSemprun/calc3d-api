import { StoreColeccionesService } from './store-colecciones.service';
import { StorePublicService } from '../store-public/store-public.service';

/**
 * La vista previa del panel y el endpoint público tienen que devolver LO MISMO: los mismos
 * productos en el mismo orden. Los dos comparten `resolverColeccion` y la consulta del
 * catálogo (`common/catalogo-de-colecciones.ts`); este test usa UN solo Prisma falso que
 * HONRA `where` y `orderBy`, así que si alguno de los dos lados dejara de usar la consulta
 * común (o ésta cambiara el orden/filtro en uno solo) la lista se separaría y esto cae.
 */

const ORG = 'org-A';

const fila = (id: string, position: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: ORG,
  slug: `slug-${id}`,
  name: `Producto ${id}`,
  kind: 'PHYSICAL',
  summary: null,
  priceUsd: '1.0000',
  compareAtUsd: null,
  priceTiers: [],
  leadTimeDays: null,
  minQty: 1,
  material: null,
  badge: null,
  custom: false,
  visible: true,
  position,
  createdAt: new Date(createdAt),
  publishedAt: null,
  categoryId: 'cat-1',
  category: { name: 'Navidad', slug: 'navidad' },
  images: [],
  optionGroups: [],
  ...extra,
});

// Mismo `position` en dos a propósito: ahí decide `createdAt desc`, el desempate del orden.
const PRODUCTOS = [
  fila('a', 2, '2026-01-01'),
  fila('b', 1, '2026-01-01'),
  fila('c', 1, '2026-03-01'),
  fila('d', 0, '2026-02-01', { visible: false }),
  fila('e', 0, '2026-02-01', { categoryId: 'cat-h' }),
  fila('x', 0, '2026-02-01', { organizationId: 'org-B' }),
];

function fakePrisma() {
  const coleccion = {
    id: 'col-1',
    organizationId: ORG,
    slug: 'navidad',
    nombre: 'Navidad',
    titulo: 'Navidad',
    subtitulo: null,
    verTodoTipo: 'NONE',
    verTodoValor: null,
    esPrincipal: true,
    visible: true,
    startsAt: null,
    endsAt: null,
  };
  const items = [{ id: 'i1', collectionId: 'col-1', categoryId: 'cat-1', productId: null, position: 0 }];
  const exclusiones: { collectionId: string; productId: string }[] = [];
  const coincide = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  return {
    storeCollection: {
      findFirst: jest.fn(({ where }) => Promise.resolve(coincide(coleccion, where) ? { ...coleccion, items, exclusions: exclusiones } : null)),
      findMany: jest.fn(({ where }) => Promise.resolve(coincide(coleccion, where) ? [{ ...coleccion, items, exclusions: exclusiones }] : [])),
    },
    storeCollectionItem: { findMany: jest.fn(() => Promise.resolve(items)) },
    storeCollectionExclusion: { findMany: jest.fn(() => Promise.resolve(exclusiones)) },
    storeCategory: {
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          [
            { id: 'cat-1', slug: 'navidad', parentId: null, organizationId: ORG },
            { id: 'cat-h', slug: 'adornos', parentId: 'cat-1', organizationId: ORG },
          ].filter((c) => coincide(c, where)),
        ),
      ),
    },
    storeProduct: {
      // Honra `where` y `orderBy` como Postgres: sin esto el test no mediría el orden.
      findMany: jest.fn(({ where, orderBy }: { where: Record<string, unknown>; orderBy: { position?: string; createdAt?: string }[] }) => {
        const rows = PRODUCTOS.filter((p) => coincide(p as Record<string, unknown>, where));
        return Promise.resolve(
          rows.sort((p, q) => {
            for (const o of orderBy) {
              const k = Object.keys(o)[0] as 'position' | 'createdAt';
              const dir = o[k] === 'asc' ? 1 : -1;
              const a = p[k] instanceof Date ? (p[k] as Date).getTime() : (p[k] as number);
              const b = q[k] instanceof Date ? (q[k] as Date).getTime() : (q[k] as number);
              if (a !== b) return (a - b) * dir;
            }
            return 0;
          }),
        );
      }),
    },
    organization: { findUnique: jest.fn() },
  };
}

describe('Vista previa == endpoint público', () => {
  it('devuelven los MISMOS productos en el MISMO orden', async () => {
    const prisma = fakePrisma();
    const config = { get: jest.fn(() => ORG) };
    const publico = new StorePublicService(prisma as never, config as never, {} as never, { configured: true, publicUrl: (k: string) => k } as never);
    const panel = new StoreColeccionesService(prisma as never);

    const publicados = (await publico.coleccionPorSlug('navidad')).productos.map((p) => p.slug);
    const previa = (await panel.preview(ORG, 'col-1')).productos.map((p) => p.slug);

    // Guarda contra un verde falso: la lista no puede estar vacía ni ser trivial.
    // `e` (hija) entra, `d` (oculto) y `x` (otra org) no; position 0, luego 1 (más nueva primero), luego 2.
    expect(publicados).toEqual(['slug-e', 'slug-c', 'slug-b', 'slug-a']);
    expect(previa).toEqual(publicados);
  });
});
