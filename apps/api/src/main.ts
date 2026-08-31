import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // El logo del negocio viaja como data URL en JSON: 1 MB de imagen son ~1,4 MB
  // de base64 y el tope por defecto de Express (100 kb) lo rechazaría con 413.
  // El límite real del archivo se valida en el endpoint (LOGO_MAX_BYTES).
  app.useBodyParser('json', { limit: '2mb' });

  // Detrás de un proxy/CDN (Cloudflare, nginx), confiar en X-Forwarded-For para
  // resolver la IP real del cliente (rate limiting, logs). Valor configurable:
  // number (saltos de proxy), 'true', o una lista de IPs/subredes. Sin proxy: false.
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) {
    const n = Number(trustProxy);
    app.set('trust proxy', Number.isNaN(n) ? trustProxy : n);
  }

  // Orígenes permitidos: el panel (WEB_ORIGIN, admite lista separada por comas)
  // más la tienda pública (STORE_ORIGIN) cuando exista. Antes era un solo origen
  // y con la tienda dejan de ser uno.
  const origins = [
    ...config.get<string>('WEB_ORIGIN', 'http://localhost:5173').split(','),
    ...(config.get<string>('STORE_ORIGIN') ?? '').split(','),
  ]
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API Calc3D escuchando en http://localhost:${port}/api`);
}

bootstrap();
