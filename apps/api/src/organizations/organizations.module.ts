import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InviteCollaboratorSchema, type InviteCollaboratorDto } from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista los miembros de la organización. */
  async members(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      ...m.user,
    }));
  }

  /** Solo el OWNER puede invitar colaboradores (crea el usuario con su clave). */
  async invite(actor: AuthUser, dto: InviteCollaboratorDto) {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Solo el dueño puede invitar colaboradores');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        memberships: {
          create: { organizationId: actor.organizationId, role: 'COLLABORATOR' },
        },
      },
      select: { id: true, email: true, name: true },
    });
    return { ...user, role: 'COLLABORATOR' as const };
  }
}

@Controller('organization')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return this.service.members(user.organizationId);
  }

  @Post('invite')
  invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(InviteCollaboratorSchema)) dto: InviteCollaboratorDto,
  ) {
    return this.service.invite(user, dto);
  }
}

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
