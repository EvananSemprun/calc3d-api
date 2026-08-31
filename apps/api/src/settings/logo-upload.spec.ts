import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LOGO_MAX_BYTES, LogoUploadSchema } from '@calc3d/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.module';

/**
 * Regresión de seguridad de la subida del logo del negocio. Es la única entrada
 * del sistema que acepta un ARCHIVO, y lo que se guarde acá se sirve después con
 * un `Content-Type` propio y se dibuja en documentos que salen del negocio.
 *
 * Las pruebas van contra el pipe REAL y el servicio REAL (no mocks del schema):
 * si alguien afloja la validación, esto se cae.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

/** Cabecera PNG válida + relleno (el servicio no decodifica la imagen). */
function pngDataUrl(bytes = 64): string {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([magic, Buffer.alloc(Math.max(0, bytes - magic.length), 0x42)]);
  return `data:image/png;base64,${data.toString('base64')}`;
}

function prismaMock(settings: Record<string, unknown> = {}) {
  const row = { organizationId: ORG, logo: null, logoMime: null, ...settings };
  return {
    settings: {
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn(({ data }: any) => Promise.resolve({ ...row, ...data })),
    },
    // El nombre del negocio vive en Organization y viaja en el mismo payload.
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Banano Lab' }) },
  };
}

const pipe = new ZodValidationPipe(LogoUploadSchema);

describe('Subida del logo del negocio', () => {
  describe('validación de entrada (pipe real)', () => {
    it('rechaza un SVG: es markup ejecutable y pdfkit no lo dibuja', () => {
      const svg = `data:image/svg+xml;base64,${Buffer.from(
        '<svg onload="alert(1)"/>',
      ).toString('base64')}`;
      expect(() => pipe.transform({ dataUrl: svg })).toThrow(BadRequestException);
    });

    it('rechaza una URL remota (evita que el servidor traiga archivos de afuera)', () => {
      expect(() => pipe.transform({ dataUrl: 'https://ejemplo.com/logo.png' })).toThrow(
        BadRequestException,
      );
    });

    it('rechaza un archivo por encima del tope de 1 MB', () => {
      const grande = `data:image/png;base64,${'A'.repeat(
        Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 200,
      )}`;
      expect(() => pipe.transform({ dataUrl: grande })).toThrow(BadRequestException);
    });

    it('acepta un PNG bien formado', () => {
      expect(pipe.transform({ dataUrl: pngDataUrl() })).toEqual({ dataUrl: pngDataUrl() });
    });
  });

  describe('validación de contenido (servicio real)', () => {
    it('rechaza un archivo que dice ser PNG pero no lo es', async () => {
      // El mime declarado NO es prueba: se compara contra los bytes mágicos.
      const falso = `data:image/png;base64,${Buffer.from('GIF89a-no-soy-un-png').toString(
        'base64',
      )}`;
      const prisma = prismaMock();
      const service = new SettingsService(prisma as any);
      await expect(service.setLogo(ORG, { dataUrl: falso })).rejects.toThrow(BadRequestException);
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rechaza un archivo vacío', async () => {
      const prisma = prismaMock();
      const service = new SettingsService(prisma as any);
      await expect(service.setLogo(ORG, { dataUrl: 'data:image/png;base64,' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('rechaza un PNG que supera el tope aunque pase el schema', async () => {
      // Defensa en profundidad: el tamaño real se mide sobre los bytes decodificados.
      const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const enorme = Buffer.concat([magic, Buffer.alloc(LOGO_MAX_BYTES + 1, 0x42)]);
      const prisma = prismaMock();
      const service = new SettingsService(prisma as any);
      await expect(
        service.setLogo(ORG, { dataUrl: `data:image/png;base64,${enorme.toString('base64')}` }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.settings.update).not.toHaveBeenCalled();
    });

    it('guarda un PNG válido con su mime', async () => {
      const prisma = prismaMock();
      const service = new SettingsService(prisma as any);
      await service.setLogo(ORG, { dataUrl: pngDataUrl() });
      expect(prisma.settings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG },
          data: expect.objectContaining({ logoMime: 'image/png' }),
        }),
      );
    });
  });

  describe('salida', () => {
    it('GET /settings no devuelve los bytes del logo, solo la bandera', async () => {
      // Si los bytes se colaran acá, cada carga de Ajustes arrastraría 1 MB.
      const prisma = prismaMock({ logo: Buffer.from([1, 2, 3]), logoMime: 'image/png' });
      const service = new SettingsService(prisma as any);
      const settings = await service.get(ORG);
      expect(settings).not.toHaveProperty('logo');
      expect(settings.hasLogo).toBe(true);
    });

    it('el logo se lee SIEMPRE con scope de organización', async () => {
      const prisma = {
        settings: {
          findUnique: jest.fn(({ where }: any) =>
            Promise.resolve(
              where.organizationId === OTHER
                ? { logo: Buffer.from([1]), logoMime: 'image/png' }
                : null,
            ),
          ),
        },
      };
      const service = new SettingsService(prisma as any);
      await expect(service.getLogo(ORG)).rejects.toThrow(NotFoundException);
      expect(prisma.settings.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG } }),
      );
    });
  });
});
