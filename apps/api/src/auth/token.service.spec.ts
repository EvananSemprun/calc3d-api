import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

function makePrisma() {
  return {
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    authToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('TokenService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: TokenService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new TokenService(prisma as any);
  });

  describe('issueRefresh', () => {
    it('guarda el HASH (no el token en claro) y devuelve el token', async () => {
      const { token, family } = await service.issueRefresh('u1');
      expect(token).toMatch(/^[a-f0-9]{96}$/); // 48 bytes hex
      expect(family).toBeTruthy();
      const data = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).not.toBe(token); // se persiste el hash, no el token
      expect(data.userId).toBe('u1');
    });
  });

  describe('rotateRefresh', () => {
    it('token válido → revoca el viejo y emite uno nuevo en la misma familia', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', family: 'fam1', revokedAt: null, expiresAt: future(),
      });
      const out = await service.rotateRefresh('raw-token');
      expect(out.userId).toBe('u1');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' }, data: { revokedAt: expect.any(Date) },
      });
      // El nuevo hereda la familia.
      expect(prisma.refreshToken.create.mock.calls[0][0].data.family).toBe('fam1');
    });

    it('REUSO de un token revocado → revoca toda la familia y rechaza', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', family: 'fam1', revokedAt: past(), expiresAt: future(),
      });
      await expect(service.rotateRefresh('raw')).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: 'fam1', revokedAt: null }, data: { revokedAt: expect.any(Date) },
      });
    });

    it('token expirado → rechaza', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', family: 'fam1', revokedAt: null, expiresAt: past(),
      });
      await expect(service.rotateRefresh('raw')).rejects.toThrow(UnauthorizedException);
    });

    it('token inexistente → rechaza', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotateRefresh('raw')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('consumeAuthToken', () => {
    it('token válido del propósito correcto → lo marca usado y devuelve userId', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 'at1', userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: future(),
      });
      const userId = await service.consumeAuthToken('raw', 'PASSWORD_RESET');
      expect(userId).toBe('u1');
      expect(prisma.authToken.update).toHaveBeenCalledWith({
        where: { id: 'at1' }, data: { usedAt: expect.any(Date) },
      });
    });

    it('propósito equivocado → rechaza (no se puede resetear con token de verificación)', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 'at1', userId: 'u1', purpose: 'EMAIL_VERIFY', usedAt: null, expiresAt: future(),
      });
      await expect(service.consumeAuthToken('raw', 'PASSWORD_RESET')).rejects.toThrow(UnauthorizedException);
    });

    it('token ya usado o expirado → rechaza', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 'at1', userId: 'u1', purpose: 'PASSWORD_RESET', usedAt: new Date(), expiresAt: future(),
      });
      await expect(service.consumeAuthToken('raw', 'PASSWORD_RESET')).rejects.toThrow(UnauthorizedException);
    });
  });
});
