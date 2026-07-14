import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CatalogOptionCreateSchema,
  CatalogOptionKindSchema,
  CatalogOptionUpdateSchema,
  type CatalogOptionCreateDto,
  type CatalogOptionKind,
  type CatalogOptionUpdateDto,
  type CatalogOptionView,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Opciones reutilizables de campos de catálogo (listas administradas aparte):
 * marca/tipo/color de filamento. El combobox creatable del front las lee, crea y
 * borra. Persisten por sí solas (independientes de que exista un material que las
 * use). Todo scopeado por organización.
 */
@Injectable()
export class CatalogOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, kind?: CatalogOptionKind): Promise<CatalogOptionView[]> {
    const rows = await this.prisma.catalogOption.findMany({
      where: { organizationId, ...(kind ? { kind } : {}) },
      orderBy: { value: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, kind: r.kind as CatalogOptionKind, value: r.value }));
  }

  /** Crea (idempotente por org+kind+value): si ya existe, devuelve la existente. */
  async create(organizationId: string, dto: CatalogOptionCreateDto): Promise<CatalogOptionView> {
    const row = await this.prisma.catalogOption.upsert({
      where: {
        organizationId_kind_value: { organizationId, kind: dto.kind, value: dto.value },
      },
      create: { organizationId, kind: dto.kind, value: dto.value },
      update: {},
    });
    return { id: row.id, kind: row.kind as CatalogOptionKind, value: row.value };
  }

  async update(organizationId: string, id: string, dto: CatalogOptionUpdateDto) {
    await this.ensureOwned(organizationId, id);
    try {
      const row = await this.prisma.catalogOption.update({
        where: { id },
        data: { value: dto.value },
      });
      return { id: row.id, kind: row.kind as CatalogOptionKind, value: row.value };
    } catch (e) {
      // Choca con el único (org, kind, value): ya existe una opción con ese nombre.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new NotFoundException('Ya existe una opción con ese nombre.');
      }
      throw e;
    }
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.catalogOption.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.catalogOption.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Opción no encontrada');
  }
}

@Controller('catalog-options')
@UseGuards(JwtAuthGuard)
export class CatalogOptionsController {
  constructor(private readonly service: CatalogOptionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    // El kind es opcional; si viene, se valida contra el enum conocido.
    const parsed = kind ? CatalogOptionKindSchema.parse(kind) : undefined;
    return this.service.list(user.organizationId, parsed);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CatalogOptionCreateSchema)) dto: CatalogOptionCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CatalogOptionUpdateSchema)) dto: CatalogOptionUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [CatalogOptionsController],
  providers: [CatalogOptionsService],
  exports: [CatalogOptionsService],
})
export class CatalogOptionsModule {}
