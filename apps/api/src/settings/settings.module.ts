import { Body, Controller, Get, Injectable, Module, Patch, UseGuards } from '@nestjs/common';
import { SettingsUpdateSchema, type SettingsUpdateDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la configuración de la organización, creándola si faltara. */
  async get(organizationId: string) {
    const existing = await this.prisma.settings.findUnique({ where: { organizationId } });
    if (existing) return existing;
    return this.prisma.settings.create({ data: { organizationId } });
  }

  async update(organizationId: string, dto: SettingsUpdateDto) {
    await this.get(organizationId); // asegura que exista
    return this.prisma.settings.update({ where: { organizationId }, data: dto });
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
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
