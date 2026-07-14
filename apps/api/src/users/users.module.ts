import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  UpdateMeSchema,
  UserCreateSchema,
  UserUpdateSchema,
  type UpdateMeDto,
  type UserCreateDto,
  type UserUpdateDto,
} from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { EmailVerifiedGuard } from '../common/email-verified.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Usuarios (miembros) de la organización del actor. */
  async list(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      membershipId: m.id,
    }));
  }

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

  /** Crear un usuario en la organización (solo dueño). */
  async create(actor: AuthUser, dto: UserCreateDto) {
    this.assertOwner(actor);
    await this.ensureEmailFree(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        memberships: { create: { organizationId: actor.organizationId, role: dto.role } },
      },
      select: { id: true, email: true, name: true },
    });
    return { ...user, role: dto.role };
  }

  /** Editar un usuario de la organización (solo dueño). */
  async update(actor: AuthUser, userId: string, dto: UserUpdateDto) {
    this.assertOwner(actor);
    const membership = await this.getMembership(actor.organizationId, userId);
    await this.ensureEmailFree(dto.email, userId);

    if (dto.role && dto.role !== membership.role) {
      // No dejar a la organización sin ningún dueño.
      if (membership.role === 'OWNER') await this.assertNotLastOwner(actor.organizationId);
      await this.prisma.membership.update({ where: { id: membership.id }, data: { role: dto.role } });
    }

    const data = await this.buildUserData(dto);
    const user = Object.keys(data).length
      ? await this.prisma.user.update({
          where: { id: userId },
          data,
          select: { id: true, email: true, name: true },
        })
      : await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { id: true, email: true, name: true },
        });
    return { ...user, role: dto.role ?? membership.role };
  }

  /** Eliminar un usuario de la organización (solo dueño). */
  async remove(actor: AuthUser, userId: string) {
    this.assertOwner(actor);
    if (userId === actor.userId) {
      throw new ForbiddenException('No puedes eliminar tu propia cuenta');
    }
    const membership = await this.getMembership(actor.organizationId, userId);
    if (membership.role === 'OWNER') await this.assertNotLastOwner(actor.organizationId);
    // Al borrar el usuario, la membresía cae por cascade.
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  // --- Helpers ---

  private assertOwner(actor: AuthUser) {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Solo el dueño puede gestionar usuarios');
    }
  }

  private async getMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId },
    });
    if (!membership) throw new NotFoundException('Usuario no encontrado en tu organización');
    return membership;
  }

  private async assertNotLastOwner(organizationId: string) {
    const owners = await this.prisma.membership.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new ForbiddenException('La organización debe tener al menos un dueño');
    }
  }

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

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  // Invitar/crear miembros del equipo exige correo verificado.
  @Post()
  @UseGuards(EmailVerifiedGuard)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(UserCreateSchema)) dto: UserCreateDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UserUpdateSchema)) dto: UserUpdateDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
