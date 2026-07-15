import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UpdateMeSchema, type UpdateMeDto } from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Datos del usuario autenticado. */
  async me(actor: AuthUser) {
    return {
      id: actor.userId,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      organizationId: actor.organizationId,
    };
  }

  /** Editar mi propio perfil (nombre, correo, contraseña). */
  async updateMe(actor: AuthUser, dto: UpdateMeDto) {
    await this.ensureEmailFree(dto.email, actor.userId);
    const data = await this.buildUserData(dto);
    const user = await this.prisma.user.update({
      where: { id: actor.userId },
      data,
      select: { id: true, email: true, name: true },
    });
    return { ...user, role: actor.role };
  }

  // --- Helpers ---

  private async ensureEmailFree(email: string | undefined, exceptUserId?: string) {
    if (!email) return;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== exceptUserId) {
      throw new ConflictException('Ya existe una cuenta con ese correo');
    }
  }

  private async buildUserData(dto: { name?: string; email?: string; password?: string }) {
    const data: { name?: string; email?: string; passwordHash?: string } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    return data;
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.me(user);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UpdateMeSchema)) dto: UpdateMeDto) {
    return this.service.updateMe(user, dto);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
