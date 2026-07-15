import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginDto } from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.module';
import { TokenService } from './token.service';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('El usuario no pertenece a ninguna organización');
    }
    return this.buildTokens(user.id, user.email, membership.organizationId, membership.role);
  }

  /** Rota el refresh token y emite un par nuevo (mismo usuario/organización). */
  async refresh(rawToken: string) {
    const { userId, token } = await this.tokens.rotateRefresh(rawToken);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) throw new UnauthorizedException('Sesión inválida');
    const accessToken = await this.signAccess(user.id, user.email, membership.organizationId, membership.role);
    return {
      accessToken,
      refreshToken: token,
      user: {
        id: user.id,
        email: user.email,
        organizationId: membership.organizationId,
        role: membership.role,
      },
    };
  }

  /** Cierra la sesión: revoca el refresh token presentado. */
  async logout(rawToken: string) {
    await this.tokens.revokeRefresh(rawToken);
    return { ok: true };
  }

  /**
   * Inicia el reset de contraseña. Responde SIEMPRE genérico (no revela si el
   * correo existe) para no filtrar qué cuentas están registradas.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = await this.tokens.issueAuthToken(user.id, 'PASSWORD_RESET', RESET_TTL_MS);
      await this.mail.sendPasswordReset(user.email, token);
    }
    return { ok: true };
  }

  /** Restablece la contraseña y CIERRA todas las sesiones activas del usuario. */
  async resetPassword(token: string, password: string) {
    const userId = await this.tokens.consumeAuthToken(token, 'PASSWORD_RESET');
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId); // invalida sesiones robadas
    return { ok: true };
  }

  private signAccess(userId: string, email: string, organizationId: string, role: 'OWNER' | 'COLLABORATOR') {
    return this.jwt.signAsync({ sub: userId, email, organizationId, role });
  }

  private async buildTokens(
    userId: string,
    email: string,
    organizationId: string,
    role: 'OWNER' | 'COLLABORATOR',
  ) {
    const accessToken = await this.signAccess(userId, email, organizationId, role);
    const { token: refreshToken } = await this.tokens.issueRefresh(userId);
    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, organizationId, role },
    };
  }
}
