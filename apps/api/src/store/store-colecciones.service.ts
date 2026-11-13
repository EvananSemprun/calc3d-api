import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDateKey,
  coleccionVigente,
  resolverColeccion,
  slugify,
  type StoreCollectionUpsertDto,
} from '@calc3d/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ColeccionItemVista {
  id: string;
  categoryId: string | null;
  productId: string | null;
  position: number;
}

export interface ColeccionVista {
  id: string;
  slug: string;
  nombre: string;
  titulo: string;
  subtitulo: string | null;
  verTodoTipo: string;
  verTodoValor: string | null;
  esPrincipal: boolean;
  visible: boolean;
  startsAt: string | null;
  endsAt: string | null;
  items: ColeccionItemVista[];
  exclusiones: string[];
}

/** Un producto de la vista previa: lo justo para que el dueño lo reconozca. */
export interface ColeccionPreviewProducto {
  id: string;
  slug: string;
  name: string;
}

export interface ColeccionPreview {
  /** ¿La portada la mostraría HOY? (principal, visible y dentro de su ventana). Informativo:
   *  la lista de `productos` se devuelve igual, para poder verla antes de activarla. */
  vigente: boolean;
  productos: ColeccionPreviewProducto[];
}

type ColeccionRow = {
  id: string;
  slug: string;
  nombre: string;
  titulo: string;
  subtitulo: string | null;
  verTodoTipo: string;
  verTodoValor: string | null;
  esPrincipal: boolean;
  visible: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** Fecha de NEGOCIO: se guarda a medianoche UTC y se lee con `toISOString().slice(0, 10)`
 *  (no con `businessDateKey`, que la correría un día para atrás). */
const aFecha = (dia?: string | null) => (dia ? new Date(`${dia}T00:00:00.000Z`) : null);
const aDia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Cuántos sufijos (-2, -3...) se prueban antes de caer a uno aleatorio: la búsqueda
 *  está acotada a propósito, igual que la de las categorías. */
const SLUG_MAX_TRIES = 50;

/**
 * Traduce la violación de un índice único (P2002) a un 400 legible.
 *
 * ⚠️ RIESGO ACEPTADO: el diff de items escribe uno por uno dentro de la transacción, así
 * que un guardado que INTERCAMBIARA la categoría (o el producto) entre dos items que ya
 * existen chocaría un instante con el único `[collectionId, categoryId]`. El panel no lo
 * puede producir —manda ids estables y reordenar cambia solo `position`, que no está en
 * ningún único—, y blindarlo costaría un constraint diferible o un diff más complejo por
 * un caso inalcanzable. Si un cliente a mano lo provocara, que salga un 400 que dice qué
 * pasó y no un 500 opaco. La misma red atrapa la carrera de dos altas con el mismo slug.
 */
function traducirChoqueDeUnico(e: unknown): never {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code === 'P2002') {
    const target = String(err.meta?.target ?? '');
    if (target.includes('slug')) {
      throw new BadRequestException('Ese enlace ya lo usa otra colección. Elige otro.');
    }
    throw new BadRequestException(
      'La colección tiene una categoría o un producto repetido. Revisa la lista y vuelve a guardar.',
    );
  }
  throw e;
}

/**
 * Colecciones de la portada: qué categorías y productos sueltos entran, y cuáles se
 * excluyen. Calcado de `StoreBannersService`: scope por organización en CADA consulta,
 * pertenencia validada ANTES de escribir y la respuesta armada a mano (nunca la fila).
 *
 * Qué productos resultan de todo esto lo decide la resolución pura de `shared`
 * (tarea 2); acá solo se guarda la receta.
 */
@Injectable()
export class StoreColeccionesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Arma la respuesta a mano: sin `organizationId`, sin fechas crudas. */
  private vista(c: ColeccionRow, items: ColeccionItemVista[], exclusiones: string[]): ColeccionVista {
    return {
      id: c.id,
      slug: c.slug,
      nombre: c.nombre,
      titulo: c.titulo,
      subtitulo: c.subtitulo,
      verTodoTipo: c.verTodoTipo,
      verTodoValor: c.verTodoValor,
      esPrincipal: c.esPrincipal,
      visible: c.visible,
      startsAt: aDia(c.startsAt),
      endsAt: aDia(c.endsAt),
      items: items.map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        productId: i.productId,
        position: i.position,
      })),
      exclusiones,
    };
  }

  /** Items y exclusiones de varias colecciones en DOS consultas, no dos por colección. */
  private async armar(rows: ColeccionRow[]): Promise<ColeccionVista[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [items, excl] = await Promise.all([
      this.prisma.storeCollectionItem.findMany({
        where: { collectionId: { in: ids } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.storeCollectionExclusion.findMany({ where: { collectionId: { in: ids } } }),
    ]);
    return rows.map((r) =>
      this.vista(
        r,
        items.filter((i) => i.collectionId === r.id),
        excl.filter((e) => e.collectionId === r.id).map((e) => e.productId),
      ),
    );
  }

  async list(organizationId: string): Promise<ColeccionVista[]> {
    const rows = await this.prisma.storeCollection.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    return this.armar(rows);
  }

  private async findOwn(organizationId: string, id: string) {
    const row = await this.prisma.storeCollection.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Colección no encontrada');
    return row;
  }

  async get(organizationId: string, id: string): Promise<ColeccionVista> {
    const row = await this.findOwn(organizationId, id);
    return (await this.armar([row]))[0];
  }

  /**
   * Todo lo que la colección ata tiene que ser de ESTA organización. Sin esto, el id de
   * otro negocio metería su categoría o su producto en la portada de este (y su slug
   * saldría por el endpoint público). Se valida ANTES de escribir: un 404 no puede
   * dejar la colección a medias.
   */
  private async assertPertenencia(organizationId: string, dto: StoreCollectionUpsertDto) {
    const categoryIds = [...new Set(dto.items.map((i) => i.categoryId).filter((x): x is string => !!x))];
    if (categoryIds.length > 0) {
      const propias = await this.prisma.storeCategory.findMany({
        where: { organizationId, id: { in: categoryIds } },
        select: { id: true },
      });
      if (propias.length !== categoryIds.length) throw new NotFoundException('Esa categoría no existe');
    }

    const productIds = [
      ...new Set([...dto.items.map((i) => i.productId).filter((x): x is string => !!x), ...dto.exclusiones]),
    ];
    if (productIds.length > 0) {
      const propios = await this.prisma.storeProduct.findMany({
        where: { organizationId, id: { in: productIds } },
        select: { id: true },
      });
      if (propios.length !== productIds.length) throw new NotFoundException('Ese producto no existe');
    }

    // El destino del «Ver todo» también: una categoría ajena publicaría un enlace a otro negocio.
    if (dto.verTodoTipo === 'CATEGORIA') {
      const c = await this.prisma.storeCategory.findFirst({
        where: { organizationId, slug: dto.verTodoValor ?? '' },
        select: { id: true },
      });
      if (!c) throw new BadRequestException('La categoría del «Ver todo» no existe');
    } else if (dto.verTodoTipo === 'COLECCION') {
      const c = await this.prisma.storeCollection.findFirst({
        where: { organizationId, slug: dto.verTodoValor ?? '' },
        select: { id: true },
      });
      if (!c) throw new BadRequestException('La colección del «Ver todo» no existe');
    }
  }

  /** Primer slug libre de ESTA organización: si choca prueba -2, -3... (como las categorías). */
  private async slugLibre(organizationId: string, base: string, excludeId?: string): Promise<string> {
    const limpio = slugify(base);
    if (!limpio) throw new BadRequestException('El nombre no genera un enlace válido');
    for (let i = 1; i <= SLUG_MAX_TRIES; i += 1) {
      const candidato = i === 1 ? limpio : `${limpio}-${i}`;
      const choca = await this.prisma.storeCollection.findFirst({
        where: { organizationId, slug: candidato, ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      });
      if (!choca) return candidato;
    }
    return `${limpio}-${randomUUID().slice(0, 8)}`;
  }

  private datos(dto: StoreCollectionUpsertDto) {
    return {
      nombre: dto.nombre,
      titulo: dto.titulo,
      subtitulo: dto.subtitulo ?? null,
      verTodoTipo: dto.verTodoTipo,
      verTodoValor: dto.verTodoTipo === 'NONE' ? null : dto.verTodoValor ?? null,
      visible: dto.visible,
      startsAt: aFecha(dto.startsAt),
      endsAt: aFecha(dto.endsAt),
    };
  }

  async create(organizationId: string, dto: StoreCollectionUpsertDto): Promise<ColeccionVista> {
    await this.assertPertenencia(organizationId, dto);
    const slug = await this.slugLibre(organizationId, dto.slug ?? dto.nombre);
    const id = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // `esPrincipal` no se escribe acá: nace en false y solo lo mueve su endpoint propio.
      const c = await tx.storeCollection.create({ data: { organizationId, slug, ...this.datos(dto) } });
      for (const it of dto.items) {
        await tx.storeCollectionItem.create({
          data: {
            collectionId: c.id,
            categoryId: it.categoryId ?? null,
            productId: it.productId ?? null,
            position: it.position,
          },
        });
      }
      for (const productId of dto.exclusiones) {
        await tx.storeCollectionExclusion.create({ data: { collectionId: c.id, productId } });
      }
      return c.id;
    }).catch(traducirChoqueDeUnico);
    return this.get(organizationId, id);
  }

  /**
   * ⚠️ Hace DIFF POR ID (crear / actualizar / borrar), NO borra y recrea. Borrar y
   * recrear es lo que hizo perder las fotos por color al editar un producto (ver
   * «foto por color» en el CLAUDE.md): cada guardado cambiaba todos los ids y cualquier
   * cosa colgada de ellos caía en cascada. Los items necesitan ids estables.
   */
  async update(organizationId: string, id: string, dto: StoreCollectionUpsertDto): Promise<ColeccionVista> {
    const actual = await this.findOwn(organizationId, id);
    await this.assertPertenencia(organizationId, dto);
    // Sin slug en el cuerpo se CONSERVA el que tenía: renombrar no cambia la URL pública.
    const slug = dto.slug === undefined ? actual.slug : await this.slugLibre(organizationId, dto.slug, id);

    const existentes = await this.prisma.storeCollectionItem.findMany({ where: { collectionId: id } });
    const idsExistentes = new Set(existentes.map((i) => i.id));
    // Un id que no es de ESTA colección no se actualiza: sería editar la entrada de otra.
    for (const it of dto.items) {
      if (it.id && !idsExistentes.has(it.id)) throw new NotFoundException('Esa entrada no existe en la colección');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.storeCollection.update({ where: { id }, data: { slug, ...this.datos(dto) } });

      const quedan = new Set(dto.items.map((i) => i.id).filter((x): x is string => !!x));
      const sobran = existentes.filter((i) => !quedan.has(i.id)).map((i) => i.id);
      // Primero se borra: así volver a agregar una categoría que se sacó en el mismo
      // guardado no choca con el índice único.
      if (sobran.length > 0) {
        await tx.storeCollectionItem.deleteMany({ where: { id: { in: sobran }, collectionId: id } });
      }
      for (const it of dto.items) {
        const campos = { categoryId: it.categoryId ?? null, productId: it.productId ?? null, position: it.position };
        if (it.id) {
          await tx.storeCollectionItem.update({ where: { id: it.id }, data: campos });
        } else {
          await tx.storeCollectionItem.create({ data: { collectionId: id, ...campos } });
        }
      }

      const excl = await tx.storeCollectionExclusion.findMany({ where: { collectionId: id } });
      const actuales = new Set(excl.map((e) => e.productId));
      const quiere = new Set(dto.exclusiones);
      const sacar = [...actuales].filter((p) => !quiere.has(p));
      if (sacar.length > 0) {
        await tx.storeCollectionExclusion.deleteMany({ where: { collectionId: id, productId: { in: sacar } } });
      }
      for (const productId of quiere) {
        if (!actuales.has(productId)) {
          await tx.storeCollectionExclusion.create({ data: { collectionId: id, productId } });
        }
      }
    }).catch(traducirChoqueDeUnico);
    return this.get(organizationId, id);
  }

  /**
   * Una sola principal: desmarcar la vieja y marcar la nueva van juntas o no van. La base
   * lo impone con un índice único parcial (`StoreCollection_org_principal_key`), así que
   * sin la transacción el índice rechazaría el instante en que hay dos.
   */
  async setPrincipal(organizationId: string, id: string): Promise<ColeccionVista[]> {
    await this.findOwn(organizationId, id);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.storeCollection.updateMany({
        where: { organizationId, esPrincipal: true },
        data: { esPrincipal: false },
      });
      await tx.storeCollection.update({ where: { id }, data: { esPrincipal: true } });
    });
    return this.list(organizationId);
  }

  /**
   * La lista que la tienda publicaría con esta colección, para verla ANTES de activarla.
   *
   * ⚠️ La resuelve el SERVIDOR con `resolverColeccion` de shared, la MISMA función que usa
   * el endpoint público: el panel no arma la lista. Una previa calculada aparte sería una
   * segunda definición y mentiría el día que una de las dos cambie (el dueño aprobaría una
   * portada y saldría otra). El catálogo se pide con el mismo criterio que el público
   * (solo VISIBLE, mismo orden), y por organización.
   *
   * No filtra por ventana ni por `visible` de la colección: previsualizar una que todavía no
   * arranca es justo para lo que sirve. `vigente` avisa si hoy se publicaría.
   */
  async preview(organizationId: string, id: string): Promise<ColeccionPreview> {
    const fila = await this.findOwn(organizationId, id);
    const [vista] = await this.armar([fila]);
    const [categorias, productos] = await Promise.all([
      this.prisma.storeCategory.findMany({
        where: { organizationId },
        select: { id: true, parentId: true },
      }),
      this.prisma.storeProduct.findMany({
        where: { organizationId, visible: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        select: { id: true, slug: true, name: true, categoryId: true },
      }),
    ]);
    const entran = resolverColeccion(vista.items, vista.exclusiones, productos, categorias);
    return {
      vigente: coleccionVigente([vista], businessDateKey(new Date())) !== null,
      productos: entran.map((p) => ({ id: p.id, slug: p.slug, name: p.name })),
    };
  }

  async remove(organizationId: string, id: string) {
    await this.findOwn(organizationId, id);
    // Los items y las exclusiones caen en cascada desde la tabla.
    await this.prisma.storeCollection.delete({ where: { id } });
    return { ok: true as const };
  }
}
