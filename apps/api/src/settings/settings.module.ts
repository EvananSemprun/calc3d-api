import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Patch,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  LogoUploadSchema,
  SettingsUpdateSchema,
  type LogoMimeType,
  type LogoUploadDto,
  type SettingsUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Firma binaria de cada formato aceptado. El mime que declara el cliente NO es
 *  prueba de nada: se compara contra los primeros bytes del archivo. */
const MAGIC_BYTES: Record<LogoMimeType, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

function matchesMagic(data: Buffer, mime: LogoMimeType): boolean {
  const magic = MAGIC_BYTES[mime];
  if (data.length < magic.length) return false;
  return magic.every((byte, i) => data[i] === byte);
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Configuración de la organización, creándola si faltara. El logo NO viaja en
   * este payload (son bytes y se pide aparte); solo se informa si existe.
   */
  async get(organizationId: string) {
    const [existing, org] = await Promise.all([
      this.prisma.settings.findUnique({ where: { organizationId } }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ]);
    const settings = existing ?? (await this.prisma.settings.create({ data: { organizationId } }));
    return { ...this.withoutLogo(settings), businessName: org?.name ?? '' };
  }

  async update(organizationId: string, dto: SettingsUpdateDto) {
    await this.get(organizationId); // asegura que exista
    // El nombre del negocio NO es una columna de Settings: vive en Organization
    // (es el emisor de los documentos). Se separa antes de tocar la tabla.
    const { businessName, ...settingsData } = dto;
    if (businessName !== undefined) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { name: businessName.trim() },
      });
    }
    await this.prisma.settings.update({ where: { organizationId }, data: settingsData });
    return this.get(organizationId);
  }

  /** Bytes del logo para la vista previa y para el encabezado de los PDF. */
  async getLogo(organizationId: string) {
    const settings = await this.prisma.settings.findUnique({
      where: { organizationId },
      select: { logo: true, logoMime: true },
    });
    if (!settings?.logo || !settings.logoMime) {
      throw new NotFoundException('El negocio no tiene logo cargado');
    }
    return { data: Buffer.from(settings.logo), mime: settings.logoMime };
  }

  /**
   * Guarda el logo desde un data URL. Rechaza cualquier archivo cuyo contenido
   * real no coincida con el tipo declarado: un PNG que en realidad es otra cosa
   * terminaría servido con un Content-Type mentido.
   */
  async setLogo(organizationId: string, dto: LogoUploadDto) {
    const [head, base64] = dto.dataUrl.split(',', 2);
    const rawMime = head.slice('data:'.length, head.indexOf(';'));
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(rawMime)) {
      throw new BadRequestException('El logo debe ser un PNG o JPEG');
    }
    const mime = rawMime as LogoMimeType;

    const data = Buffer.from(base64, 'base64');
    if (data.length === 0) throw new BadRequestException('El archivo del logo está vacío');
    if (data.length > LOGO_MAX_BYTES) {
      throw new BadRequestException('El logo no puede pesar más de 1 MB');
    }
    if (!matchesMagic(data, mime)) {
      throw new BadRequestException('El archivo no es una imagen PNG o JPEG válida');
    }

    await this.get(organizationId); // asegura que exista
    await this.prisma.settings.update({
      where: { organizationId },
      data: { logo: data, logoMime: mime },
    });
    return this.get(organizationId);
  }

  async removeLogo(organizationId: string) {
    await this.get(organizationId);
    await this.prisma.settings.update({
      where: { organizationId },
      data: { logo: null, logoMime: null },
    });
    return this.get(organizationId);
  }

  /** Saca los bytes del logo del payload JSON y deja solo la bandera. */
  private withoutLogo<T extends { logo: Uint8Array | null }>(settings: T) {
    const { logo, ...rest } = settings;
    return { ...rest, hasLogo: !!logo };
  }
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user.organizationId);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SettingsUpdateSchema)) dto: SettingsUpdateDto,
  ) {
    return this.service.update(user.organizationId, dto);
  }

  @Get('logo')
  async logo(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const { data, mime } = await this.service.getLogo(user.organizationId);
    res.set({
      'Content-Type': mime,
      'Content-Length': data.length.toString(),
      // El tipo ya se validó contra los bytes; igual se prohíbe el sniffing.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache',
    });
    res.end(data);
  }

  @Put('logo')
  setLogo(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LogoUploadSchema)) dto: LogoUploadDto,
  ) {
    return this.service.setLogo(user.organizationId, dto);
  }

  @Delete('logo')
  removeLogo(@CurrentUser() user: AuthUser) {
    return this.service.removeLogo(user.organizationId);
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
