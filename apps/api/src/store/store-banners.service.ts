import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  STORE_IMAGE_MAX_BYTES,
  STORE_IMAGE_MIME_TYPES,
  type StoreBannerCreateDto,
  type StoreBannerUpdateDto,
  type StoreImageUploadUrlDto,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';

/** Prefijo de las imágenes de banner en R2: `{organizationId}/store/banners/…`. */
const BANNER_PREFIX = 'store/banners';

/**
 * Banners del carrusel de la home. La imagen se sube con el MISMO flujo de 2
 * pasos que las fotos de ficha; acá se verifica y se guarda la clave. El destino
 * (categoría/producto) se valida contra la organización — nunca apunta a algo ajeno.
 */
@Injectable()
export class StoreBannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Paso 1 de la subida: URL firmada para mandar el archivo directo a R2. */
  createImageUploadUrl(organizationId: string, dto: StoreImageUploadUrlDto) {
    return this.storage.createUploadUrl({
      organizationId,
      prefix: BANNER_PREFIX,
      contentType: dto.contentType,
      contentLength: dto.contentLength,
    });
  }

  private withUrl = <T extends { imageKey: string }>(b: T) => ({
    ...b,
    imageUrl: this.storage.publicUrl(b.imageKey),
  });

  async list(organizationId: string) {
    const rows = await this.prisma.storeBanner.findMany({
      where: { organizationId },
      orderBy: { position: 'asc' },
    });
    return rows.map(this.withUrl);
  }

  async get(organizationId: string, id: string) {
    const b = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Banner no encontrado');
    return this.withUrl(b);
  }

  /** Verifica que la imagen exista en R2, sea de esta organización y cumpla
   *  tipo/tamaño. En fallo de tipo/tamaño BORRA el objeto. */
  private async assertImage(organizationId: string, imageKey: string) {
    const prefix = `${organizationId}/${BANNER_PREFIX}/`;
    if (!imageKey.startsWith(prefix)) {
      throw new BadRequestException('La imagen no pertenece a esta organización');
    }
    const obj = await this.storage.head(imageKey);
    if (!obj) throw new BadRequestException('La imagen no llegó al almacenamiento');
    if (!obj.contentType || !(STORE_IMAGE_MIME_TYPES as readonly string[]).includes(obj.contentType)) {
      await this.storage.remove(imageKey);
      throw new BadRequestException('La imagen debe ser PNG, JPEG o WebP');
    }
    if ((obj.contentLength ?? 0) > STORE_IMAGE_MAX_BYTES) {
      await this.storage.remove(imageKey);
      throw new BadRequestException('La imagen no puede pesar más de 5 MB');
    }
  }

  /** El destino CATEGORY/PRODUCT debe existir EN ESTA organización (cierra el
   *  IDOR). La URL ya la validó el schema; NONE no tiene destino. */
  private async assertLink(organizationId: string, dto: { linkType: string; linkValue?: string | null }) {
    if (dto.linkType === 'CATEGORY') {
      const c = await this.prisma.storeCategory.findFirst({
        where: { organizationId, slug: dto.linkValue ?? '' },
        select: { id: true },
      });
      if (!c) throw new BadRequestException('La categoría del enlace no existe');
    } else if (dto.linkType === 'PRODUCT') {
      const p = await this.prisma.storeProduct.findFirst({
        where: { organizationId, slug: dto.linkValue ?? '', visible: true },
        select: { id: true },
      });
      if (!p) throw new BadRequestException('El producto del enlace no existe o no está publicado');
    }
  }

  private async nextPosition(organizationId: string) {
    const last = await this.prisma.storeBanner.findFirst({
      where: { organizationId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private linkValueFor(dto: { linkType: string; linkValue?: string | null }) {
    return dto.linkType === 'NONE' ? null : dto.linkValue ?? null;
  }

  async create(organizationId: string, dto: StoreBannerCreateDto) {
    await this.assertImage(organizationId, dto.imageKey);
    await this.assertLink(organizationId, dto);
    const row = await this.prisma.storeBanner.create({
      data: {
        organizationId,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        imageKey: dto.imageKey,
        linkType: dto.linkType,
        linkValue: this.linkValueFor(dto),
        visible: dto.visible,
        position: await this.nextPosition(organizationId),
      },
    });
    return this.withUrl(row);
  }

  async update(organizationId: string, id: string, dto: StoreBannerUpdateDto) {
    const current = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Banner no encontrado');
    if (dto.imageKey !== current.imageKey) await this.assertImage(organizationId, dto.imageKey);
    await this.assertLink(organizationId, dto);
    const row = await this.prisma.storeBanner.update({
      where: { id },
      data: {
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        imageKey: dto.imageKey,
        linkType: dto.linkType,
        linkValue: this.linkValueFor(dto),
        visible: dto.visible,
      },
    });
    // La imagen vieja queda huérfana en R2 si cambió; se borra después de guardar.
    if (dto.imageKey !== current.imageKey) await this.storage.remove(current.imageKey);
    return this.withUrl(row);
  }

  async reorder(organizationId: string, ids: string[]) {
    const propios = await this.prisma.storeBanner.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    const set = new Set(propios.map((b) => b.id));
    const ordenados = ids.filter((id) => set.has(id));
    await this.prisma.$transaction(
      ordenados.map((id, i) => this.prisma.storeBanner.update({ where: { id }, data: { position: i } })),
    );
    return this.list(organizationId);
  }

  async remove(organizationId: string, id: string) {
    const b = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Banner no encontrado');
    await this.prisma.storeBanner.delete({ where: { id } });
    await this.storage.remove(b.imageKey);
    return { ok: true };
  }
}
