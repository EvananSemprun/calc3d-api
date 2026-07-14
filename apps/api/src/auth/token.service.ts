import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokenPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

/** Guarda el HASH del token (sha256), nunca el token en claro. */
function sha256(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Emite un refresh token nuevo. Sin `family`, arranca una cadena nueva (login). */
  async issueRefresh(userId: string, family?: string): Promise<{ token: string; family: string }> {
    const token = randomBytes(48).toString('hex'); // 384 bits, no adivinable
    const fam = family ?? randomBytes(16).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        family: fam,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { token, family: fam };
  }

  /**
   * Rota un refresh token: valida, revoca el viejo y emite uno nuevo en la MISMA
   * familia. Si el token presentado ya estaba revocado → posible robo: se revoca
   * toda la familia y se rechaza.
   */
  async rotateRefresh(rawToken: string): Promise<{ userId: string; token: string }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!existing) throw new UnauthorizedException('Sesión inválida');

    if (existing.revokedAt) {
      // Reuso de un token ya revocado: se cae toda la familia (defensa ante robo).
      await this.prisma.refreshToken.updateMany({
        where: { family: existing.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sesión inválida');
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión expirada');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const { token } = await this.issueRefresh(existing.userId, existing.family);
    return { userId: existing.userId, token };
  }

  /** Revoca un refresh token puntual (logout). Silencioso si no existe. */
  async revokeRefresh(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoca TODAS las sesiones de un usuario (p. ej. tras cambiar la contraseña). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Emite un token de un solo uso (verificación / reset) y devuelve el token en claro. */
  async issueAuthToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.authToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        purpose,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return token;
  }

  /** Consume un token de un solo uso: valida propósito, vigencia y no-reuso. */
  async consumeAuthToken(rawToken: string, purpose: AuthTokenPurpose): Promise<string> {
    const found = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!found || found.purpose !== purpose || found.usedAt || found.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace no es válido o ya venció');
    }
    await this.prisma.authToken.update({ where: { id: found.id }, data: { usedAt: new Date() } });
    return found.userId;
  }
}
