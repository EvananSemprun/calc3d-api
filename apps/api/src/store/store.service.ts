import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  STORE_IMAGE_MAX_BYTES,
  calculateQuote,
  STORE_IMAGE_MAX_COUNT,
  STORE_IMAGE_MIME_TYPES,
  slugify,
  type StoreCategoryDto,
  type StoreImageConfirmDto,
  type StoreImageUploadUrlDto,
  type StoreProductCreateDto,
  type StoreProductUpdateDto,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { RecostService } from './recost.service';

/** Sufijos numéricos que se prueban antes de caer a uno aleatorio. */
const SLUG_MAX_TRIES = 50;

/** Lo que se trae siempre de una ficha para el panel. */
const FULL_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { position: 'asc' } },
  optionGroups: {
    orderBy: { position: 'asc' },
    include: { options: { orderBy: { position: 'asc' } } },
  },
} satisfies Prisma.StoreProductInclude;

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly recostService: RecostService,
  ) {}

  /** true si el servidor puede recibir fotos (el panel avisa en vez de fallar). */
  get storageReady(): boolean {
    return this.storage.configured;
  }

  // ----- Fichas -----

  /**
   * Las fichas con su RECOSTEO: cuánto costaría hoy cada una y si el margen se
   * cayó desde que se publicó. El catálogo se carga UNA vez para todas.
   *
   * `recost` es null en las fichas sin costeo (un servicio, algo cargado a
   * mano). No es un error: es la mitad del catálogo.
   */
  async list(organizationId: string) {
    const products = await this.prisma.storeProduct.findMany({
      where: { organizationId },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      include: FULL_INCLUDE,
    });
    const conCosteo = products.some((p) => p.input);
    const ctx = conCosteo ? await this.recostService.loadCatalog(organizationId) : undefined;
    return Promise.all(
      products.map(async (p) => ({
        ...this.withImageUrls(p),
        recost: await this.recostService.recost(organizationId, p, ctx),
      })),
    );
  }

  async get(organizationId: string, id: string) {
    const product = await this.prisma.storeProduct.findFirst({
      where: { id, organizationId },
      include: FULL_INCLUDE,
    });
    if (!product) throw new NotFoundException('Producto de tienda no encontrado');
    return {
      ...this.withImageUrls(product),
      recost: await this.recostService.recost(organizationId, product),
    };
  }

  async create(organizationId: string, dto: StoreProductCreateDto) {
    const slug = await this.uniqueSlug(organizationId, dto.slug ?? slugify(dto.name));
    if (!slug) throw new BadRequestException('El nombre no genera un enlace válido');

    await this.assertCategory(organizationId, dto.categoryId);
    // El COSTO no se acepta del cliente: se lee del origen enlazado, si lo hay.
    // El costo lo pone el SERVIDOR: se corre el motor sobre el costeo que manda
    // la calculadora. Sin costeo no hay costo, y eso es válido (un servicio).
    const costAtPublish = dto.input ? calculateQuote(dto.input).costPerUnit : null;
    const position = await this.nextPosition(organizationId);

    const created = await this.prisma.storeProduct.create({
      data: {
        organizationId,
        slug,
        name: dto.name,
        kind: dto.kind,
        summary: dto.summary ?? null,
        description: dto.description ?? null,
        priceUsd: dto.priceUsd,
        compareAtUsd: dto.compareAtUsd ?? null,
        leadTimeDays: dto.leadTimeDays ?? null,
        material: dto.material ?? null,
        badge: dto.badge ?? null,
        custom: dto.custom,
        specs: dto.specs as unknown as Prisma.InputJsonValue,
        minQty: dto.minQty,
        visible: dto.visible,
        position,
        categoryId: dto.categoryId ?? null,
        input: (dto.input as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        costAtPublish,
        optionGroups: { create: this.optionGroupsData(dto.optionGroups) },
      },
      include: FULL_INCLUDE,
    });
    return this.withImageUrls(created);
  }

  async update(organizationId: string, id: string, dto: StoreProductUpdateDto) {
    const current = await this.get(organizationId, id);
    await this.assertCategory(organizationId, dto.categoryId);

    const slug =
      dto.slug !== undefined || dto.name !== undefined
        ? await this.uniqueSlug(organizationId, dto.slug ?? slugify(dto.name ?? current.name), id)
        : undefined;

    // Recostear al editar: si viene un costeo nuevo, el servidor recalcula.
    const costAtPublish = dto.input ? calculateQuote(dto.input).costPerUnit : undefined;

    await this.prisma.$transaction(async (tx) => {
      // Los grupos de opciones se editan como bloque: reemplazarlos entero evita
      // el baile de altas/bajas/actualizaciones por opción.
      if (dto.optionGroups !== undefined) {
        await tx.storeOptionGroup.deleteMany({ where: { storeProductId: id } });
      }
      await tx.storeProduct.update({
        where: { id },
        data: {
          ...(slug !== undefined && { slug }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.kind !== undefined && { kind: dto.kind }),
          ...(dto.summary !== undefined && { summary: dto.summary ?? null }),
          ...(dto.description !== undefined && { description: dto.description ?? null }),
          ...(dto.priceUsd !== undefined && { priceUsd: dto.priceUsd }),
          ...(dto.compareAtUsd !== undefined && { compareAtUsd: dto.compareAtUsd ?? null }),
          ...(dto.leadTimeDays !== undefined && { leadTimeDays: dto.leadTimeDays ?? null }),
          ...(dto.material !== undefined && { material: dto.material ?? null }),
          ...(dto.badge !== undefined && { badge: dto.badge ?? null }),
          ...(dto.custom !== undefined && { custom: dto.custom }),
          ...(dto.specs !== undefined && { specs: dto.specs as unknown as Prisma.InputJsonValue }),
          ...(dto.minQty !== undefined && { minQty: dto.minQty }),
          ...(dto.visible !== undefined && { visible: dto.visible }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId ?? null }),
          ...(costAtPublish !== undefined && { costAtPublish }),
          ...(dto.optionGroups !== undefined && {
            optionGroups: { create: this.optionGroupsData(dto.optionGroups) },
          }),
        },
      });
    });

    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    const product = await this.get(organizationId, id);
    await this.prisma.storeProduct.delete({ where: { id } });
    // Las filas se van en cascada; los archivos hay que borrarlos a mano.
    await Promise.all(product.images.map((img) => this.storage.remove(img.key)));
    return { ok: true };
  }

  /** Reordena la vitrina. Solo mueve las fichas de ESTA organización. */
  async reorder(organizationId: string, ids: string[]) {
    const owned = await this.prisma.storeProduct.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((p) => p.id));
    await this.prisma.$transaction(
      ids
        .filter((id) => ownedIds.has(id))
        .map((id, position) =>
          this.prisma.storeProduct.update({ where: { id }, data: { position } }),
        ),
    );
    return this.list(organizationId);
  }



  // ----- Fotos -----

  /** Paso 1: URL firmada para subir directo al almacenamiento. */
  async createImageUploadUrl(organizationId: string, id: string, dto: StoreImageUploadUrlDto) {
    const product = await this.get(organizationId, id);
    if (product.images.length >= STORE_IMAGE_MAX_COUNT) {
      throw new BadRequestException(`No se pueden cargar más de ${STORE_IMAGE_MAX_COUNT} fotos`);
    }
    return this.storage.createUploadUrl({
      organizationId,
      prefix: `store/${id}`,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
  }

  /**
   * Paso 2: registrar la foto ya subida. Verifica contra el almacenamiento que
   * el objeto exista y sea lo que dice ser — la firma acota la subida, pero es
   * ESTA comprobación la que decide qué queda publicado.
   */
  async confirmImage(organizationId: string, id: string, dto: StoreImageConfirmDto) {
    const product = await this.get(organizationId, id);
    if (product.images.length >= STORE_IMAGE_MAX_COUNT) {
      throw new BadRequestException(`No se pueden cargar más de ${STORE_IMAGE_MAX_COUNT} fotos`);
    }
    // La clave la genera el servidor bajo el prefijo de la organización; exigirlo
    // impide registrar un objeto ajeno pasando su clave a mano.
    const expectedPrefix = `${organizationId}/store/${id}/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new BadRequestException('La foto no pertenece a este producto');
    }

    const object = await this.storage.head(dto.key);
    if (!object) throw new BadRequestException('La foto no llegó al almacenamiento');
    if (
      !object.contentType ||
      !(STORE_IMAGE_MIME_TYPES as readonly string[]).includes(object.contentType)
    ) {
      await this.storage.remove(dto.key);
      throw new BadRequestException('La foto debe ser PNG, JPEG o WebP');
    }
    if ((object.contentLength ?? 0) > STORE_IMAGE_MAX_BYTES) {
      await this.storage.remove(dto.key);
      throw new BadRequestException('La foto no puede pesar más de 5 MB');
    }

    await this.prisma.storeImage.create({
      data: {
        storeProductId: id,
        key: dto.key,
        alt: dto.alt ?? null,
        width: dto.width ?? null,
        height: dto.height ?? null,
        position: product.images.length,
      },
    });
    return this.get(organizationId, id);
  }

  async removeImage(organizationId: string, id: string, imageId: string) {
    const product = await this.get(organizationId, id);
    const image = product.images.find((i) => i.id === imageId);
    if (!image) throw new NotFoundException('Foto no encontrada');
    await this.prisma.storeImage.delete({ where: { id: imageId } });
    await this.storage.remove(image.key);
    return this.get(organizationId, id);
  }

  async reorderImages(organizationId: string, id: string, imageIds: string[]) {
    const product = await this.get(organizationId, id);
    const owned = new Set(product.images.map((i) => i.id));
    await this.prisma.$transaction(
      imageIds
        .filter((imageId) => owned.has(imageId))
        .map((imageId, position) =>
          this.prisma.storeImage.update({ where: { id: imageId }, data: { position } }),
        ),
    );
    return this.get(organizationId, id);
  }

  // ----- Categorías -----

  listCategories(organizationId: string) {
    return this.prisma.storeCategory.findMany({
      where: { organizationId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(organizationId: string, dto: StoreCategoryDto) {
    const slug = await this.uniqueCategorySlug(organizationId, dto.slug ?? slugify(dto.name));
    if (!slug) throw new BadRequestException('El nombre no genera un enlace válido');
    const count = await this.prisma.storeCategory.count({ where: { organizationId } });
    return this.prisma.storeCategory.create({
      data: { organizationId, name: dto.name, slug, position: count },
    });
  }

  async updateCategory(organizationId: string, id: string, dto: StoreCategoryDto) {
    await this.assertCategory(organizationId, id);
    const slug = await this.uniqueCategorySlug(
      organizationId,
      dto.slug ?? slugify(dto.name),
      id,
    );
    return this.prisma.storeCategory.update({ where: { id }, data: { name: dto.name, slug } });
  }

  async removeCategory(organizationId: string, id: string) {
    await this.assertCategory(organizationId, id);
    // Las fichas quedan sin categoría (SetNull), no se borran con ella.
    await this.prisma.storeCategory.delete({ where: { id } });
    return { ok: true };
  }

  // ----- Auxiliares -----

  /** Agrega la URL pública de cada foto (la clave sola no sirve al panel). */
  private withImageUrls<T extends { images: { key: string }[] }>(product: T) {
    return {
      ...product,
      images: product.images.map((img) => ({ ...img, url: this.storage.publicUrl(img.key) })),
    };
  }

  private optionGroupsData(groups: StoreProductCreateDto['optionGroups'] = []) {
    return groups.map((g, position) => ({
      name: g.name,
      required: g.required,
      position,
      options: {
        create: g.options.map((o, i) => ({
          value: o.value,
          priceDeltaUsd: o.priceDeltaUsd,
          swatchHex: o.swatchHex ?? null,
          position: i,
        })),
      },
    }));
  }

  /** Verifica que la categoría, si viene, sea de esta organización. */
  private async assertCategory(organizationId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const found = await this.prisma.storeCategory.findFirst({
      where: { id: categoryId, organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Categoría no encontrada');
  }

  /**
   * Costo unitario del origen enlazado. Devuelve null si no hay origen: una
   * ficha cargada a mano simplemente no tiene alerta de rentabilidad.
   */


  private async nextPosition(organizationId: string): Promise<number> {
    const last = await this.prisma.storeProduct.findFirst({
      where: { organizationId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  /**
   * Primer slug libre: si choca, prueba -2, -3… La búsqueda está ACOTADA a
   * propósito; un bucle abierto dejaría el proceso girando para siempre si la
   * consulta devolviera siempre un choque, y termina en sufijo aleatorio.
   */
  private async firstFreeSlug(
    base: string,
    taken: (candidate: string) => Promise<boolean>,
  ): Promise<string> {
    const clean = slugify(base);
    if (!clean) return '';
    for (let i = 1; i <= SLUG_MAX_TRIES; i += 1) {
      const candidate = i === 1 ? clean : `${clean}-${i}`;
      if (!(await taken(candidate))) return candidate;
    }
    return `${clean}-${randomUUID().slice(0, 8)}`;
  }

  private uniqueSlug(organizationId: string, base: string, excludeId?: string) {
    return this.firstFreeSlug(base, async (slug) =>
      !!(await this.prisma.storeProduct.findFirst({
        where: { organizationId, slug, ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      })),
    );
  }

  private uniqueCategorySlug(organizationId: string, base: string, excludeId?: string) {
    return this.firstFreeSlug(base, async (slug) =>
      !!(await this.prisma.storeCategory.findFirst({
        where: { organizationId, slug, ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      })),
    );
  }
}
