import { PrismaClient } from '@prisma/client';

/**
 * Catálogo SINTÉTICO para medir la tienda con ~1.000 productos (producción tiene 1).
 * Se activa con SEED_CATALOGO_SINTETICO=1 y es SOLO para bases locales/de prueba:
 * todo lo que siembra lleva el prefijo `sint-` en el slug para reconocerlo y borrarlo.
 *
 * Idempotente por slug: usa `createMany({ skipDuplicates: true })` apoyándose en
 * @@unique([organizationId, slug]) (patrón nuevo en este archivo: con 1.000 productos,
 * "comprobar y saltar" uno por uno serían ~2.000 viajes). Las opciones y fotos solo se
 * crean para los productos NUEVOS de esta corrida, así una segunda corrida no duplica.
 */
const PREFIJO = 'sint-';
const TOTAL_PRODUCTOS = 1000;

const ARBOL: { madre: string; hijas: string[] }[] = [
  { madre: 'Hogar', hijas: ['Macetas', 'Organizadores', 'Decoración', 'Cocina'] },
  { madre: 'Oficina', hijas: ['Soportes', 'Portalápices', 'Cables', 'Escritorio', 'Papelería'] },
  { madre: 'Juguetes', hijas: ['Figuras', 'Rompecabezas', 'Articulados'] },
  { madre: 'Accesorios', hijas: ['Llaveros', 'Joyería', 'Fundas', 'Pines'] },
  { madre: 'Gaming', hijas: ['Soportes de control', 'Miniaturas', 'Dados', 'Torres de dados'] },
  { madre: 'Repuestos', hijas: ['Engranajes', 'Clips', 'Tapas'] },
];

const COLORES: [string, string][] = [
  ['Negro', '#111111'], ['Blanco', '#F5F5F5'], ['Rojo', '#D62828'], ['Azul', '#1D4ED8'],
  ['Verde', '#2E9E4F'], ['Amarillo', '#FFC300'], ['Naranja', '#F97316'], ['Morado', '#7C3AED'],
];
const MATERIALES = ['PLA', 'PETG', 'ABS', 'TPU'];
const BASES = ['Maceta', 'Soporte', 'Organizador', 'Llavero', 'Figura', 'Lámpara', 'Porta', 'Engranaje', 'Dado', 'Clip'];
const ADJ = ['mini', 'clásico', 'geométrico', 'articulado', 'modular', 'low poly', 'grande', 'personalizado'];
const MINIMOS = [1, 1, 1, 2, 10];
const INSIGNIAS = ['Nuevo', 'Más vendido', null, null, null, null];

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length];
const slugDe = (texto: string) => texto.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export async function seedCatalogoSintetico(organizationId: string): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const inicio = Date.now();

    // 1) Árbol de categorías (madres primero, luego hijas con parentId).
    const slugMadre = (madre: string) => `${PREFIJO}${slugDe(madre)}`;
    await prisma.storeCategory.createMany({
      data: ARBOL.map((a, i) => ({ organizationId, name: a.madre, slug: slugMadre(a.madre), position: i })),
      skipDuplicates: true,
    });
    const madres = await prisma.storeCategory.findMany({
      where: { organizationId, slug: { in: ARBOL.map((a) => slugMadre(a.madre)) } },
    });
    const idMadre = new Map(madres.map((m) => [m.slug, m.id]));
    await prisma.storeCategory.createMany({
      data: ARBOL.flatMap((a) =>
        a.hijas.map((h, j) => ({
          organizationId,
          name: h,
          position: j,
          parentId: idMadre.get(slugMadre(a.madre))!,
          slug: `${slugMadre(a.madre)}-${slugDe(h)}`,
        })),
      ),
      skipDuplicates: true,
    });
    const categorias = await prisma.storeCategory.findMany({
      where: { organizationId, slug: { startsWith: PREFIJO } },
      orderBy: { slug: 'asc' },
    });
    const hojas = categorias.filter((c) => c.parentId);
    const madresLista = categorias.filter((c) => !c.parentId);
    // 6 de cada 7 productos en hojas, 1 de cada 7 directamente en una madre.
    const destinos = [...hojas, ...hojas, ...hojas, ...hojas, ...hojas, ...hojas, ...madresLista];

    // 2) Productos: solo los que todavía no existen.
    const existentes = new Set(
      (
        await prisma.storeProduct.findMany({
          where: { organizationId, slug: { startsWith: PREFIJO } },
          select: { slug: true },
        })
      ).map((p) => p.slug),
    );
    const productos = Array.from({ length: TOTAL_PRODUCTOS }, (_, i) => {
      const n = i + 1;
      const precio = 2 + ((i * 37) % 5801) / 100; // 2,00 a 60,00
      return {
        organizationId,
        slug: `${PREFIJO}${String(n).padStart(4, '0')}`,
        name: `${pick(BASES, i)} ${pick(ADJ, i * 3 + 1)} ${n}`,
        summary: `Pieza sintética número ${n} para pruebas de carga.`,
        description: `Producto de prueba ${n}. Impreso bajo pedido.\nNo existe en el catálogo real.`,
        priceUsd: precio.toFixed(2),
        compareAtUsd: i % 7 === 0 ? (precio * 1.25).toFixed(2) : null,
        leadTimeDays: 2 + (i % 7), // 2 a 8
        minQty: pick(MINIMOS, i),
        material: pick(MATERIALES, i),
        badge: pick(INSIGNIAS, i),
        custom: i % 6 === 0,
        specs: [
          { label: 'Material', value: pick(MATERIALES, i) },
          { label: 'Alto', value: `${5 + (i % 20)} cm` },
        ],
        priceTiers: i % 5 === 0 ? [{ minQty: 5, discountPct: 0.05 }, { minQty: 20, discountPct: 0.12 }] : [],
        visible: true, // el default es false y no saldría por la API pública
        position: i,
        categoryId: pick(destinos, i * 7 + 3).id,
      };
    }).filter((p) => !existentes.has(p.slug));

    if (productos.length === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Catálogo sintético ya presente (${existentes.size} productos, ${categorias.length} categorías).`,
      );
      return;
    }
    await prisma.storeProduct.createMany({ data: productos, skipDuplicates: true });

    // 3) Opciones y fotos solo para los productos recién creados.
    const nuevos = await prisma.storeProduct.findMany({
      where: { organizationId, slug: { in: productos.map((p) => p.slug) } },
      select: { id: true, slug: true },
    });
    const grupos: { id: string; storeProductId: string; name: string; required: boolean; drivesPhoto: boolean; position: number }[] = [];
    const opciones: { id: string; groupId: string; value: string; priceDeltaUsd: string; swatchHex: string | null; position: number }[] = [];
    const imagenes: { storeProductId: string; key: string; alt: string; position: number }[] = [];

    for (const p of nuevos) {
      const i = Number(p.slug.slice(PREFIJO.length)) - 1;
      // Fotos: 2 de cada 3 con foto (1 a 3 imágenes); el resto sin foto. La clave no
      // existe en R2 a propósito: mide también la foto que no carga.
      if (i % 3 !== 0) {
        const cantidad = 1 + (i % 3);
        for (let k = 0; k < cantidad; k++) {
          imagenes.push({
            storeProductId: p.id,
            key: `${organizationId}/store/${p.id}/sint-${k}.jpg`,
            alt: `Foto ${k + 1} del producto ${i + 1}`,
            position: k,
          });
        }
      }
      // Opciones: 3 de cada 5 con grupo "Color" (con muestra; a lo sumo UN grupo
      // dirige la foto); 1 de cada 5 además con "Tamaño"; el resto sin opciones.
      if (i % 5 < 3) {
        const gid = `${PREFIJO}g-${i}-c`;
        grupos.push({ id: gid, storeProductId: p.id, name: 'Color', required: i % 2 === 0, drivesPhoto: i % 4 === 0, position: 0 });
        const nColores = 2 + (i % 5);
        for (let c = 0; c < nColores; c++) {
          const [nombre, hex] = COLORES[(i + c) % COLORES.length];
          opciones.push({ id: `${gid}-${c}`, groupId: gid, value: nombre, priceDeltaUsd: '0', swatchHex: hex, position: c });
        }
      }
      if (i % 5 === 0) {
        const gid = `${PREFIJO}g-${i}-t`;
        grupos.push({ id: gid, storeProductId: p.id, name: 'Tamaño', required: false, drivesPhoto: false, position: 1 });
        ['Chico', 'Mediano', 'Grande'].forEach((t, c) =>
          opciones.push({ id: `${gid}-${c}`, groupId: gid, value: t, priceDeltaUsd: (c * 1.5).toFixed(2), swatchHex: null, position: c }),
        );
      }
    }
    await prisma.storeOptionGroup.createMany({ data: grupos, skipDuplicates: true });
    await prisma.storeOption.createMany({ data: opciones, skipDuplicates: true });
    await prisma.storeImage.createMany({ data: imagenes });

    // eslint-disable-next-line no-console
    console.log(
      `Catálogo sintético: ${nuevos.length} producto(s) creados (${existentes.size} ya estaban), ` +
        `${categorias.length} categorías, ${grupos.length} grupos de opciones, ` +
        `${imagenes.length} fotos, en ${((Date.now() - inicio) / 1000).toFixed(1)} s.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
