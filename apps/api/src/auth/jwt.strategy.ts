import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';
import { resolveJwtSecret } from './jwt-secret';

interface JwtPayload {
  sub: string; // userId
  email: string;
  organizationId: string;
  role: 'OWNER' | 'COLLABORATOR';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Verifica que la membresía siga existiendo (multi-tenant) y lee los datos
    // actuales del usuario desde la DB (para reflejar cambios de perfil).
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: payload.sub,
          organizationId: payload.organizationId,
        },
      },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!membership) {
      throw new UnauthorizedException('Membresía inválida');
    }
    return {
      userId: payload.sub,
      email: membership.user.email,
      name: membership.user.name,
      organizationId: payload.organizationId,
      role: membership.role,
    };
  }
}
