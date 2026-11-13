import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { StoreCollectionUpsertDto } from '@calc3d/shared';
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

type ColeccionRow = {
  id: string;
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
        where: { organizationId, id: dto.verTodoValor ?? '' },
        select: { id: true },
      });
      if (!c) throw new BadRequestException('La colección del «Ver todo» no existe');
    }
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
    const id = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // `esPrincipal` no se escribe acá: nace en false y solo lo mueve su endpoint propio.
      const c = await tx.storeCollection.create({ data: { organizationId, ...this.datos(dto) } });
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
    });
    return this.get(organizationId, id);
  }

  /**
   * ⚠️ Hace DIFF POR ID (crear / actualizar / borrar), NO borra y recrea. Borrar y
   * recrear es lo que hizo perder las fotos por color al editar un producto (ver
   * «foto por color» en el CLAUDE.md): cada guardado cambiaba todos los ids y cualquier
   * cosa colgada de ellos caía en cascada. Los items necesitan ids estables.
   */
  async update(organizationId: string, id: string, dto: StoreCollectionUpsertDto): Promise<ColeccionVista> {
    await this.findOwn(organizationId, id);
    await this.assertPertenencia(organizationId, dto);

    const existentes = await this.prisma.storeCollectionItem.findMany({ where: { collectionId: id } });
    const idsExistentes = new Set(existentes.map((i) => i.id));
    // Un id que no es de ESTA colección no se actualiza: sería editar la entrada de otra.
    for (const it of dto.items) {
      if (it.id && !idsExistentes.has(it.id)) throw new NotFoundException('Esa entrada no existe en la colección');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.storeCollection.update({ where: { id }, data: this.datos(dto) });

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
    });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.findOwn(organizationId, id);
    // Los items y las exclusiones caen en cascada desde la tabla.
    await this.prisma.storeCollection.delete({ where: { id } });
    return { ok: true as const };
  }
}
