import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');

  // Detrás de un proxy/CDN (Cloudflare, nginx), confiar en X-Forwarded-For para
  // resolver la IP real del cliente (rate limiting, logs). Valor configurable:
  // number (saltos de proxy), 'true', o una lista de IPs/subredes. Sin proxy: false.
  const trustProxy = config.get<string>('TRUST_PROXY');
  if (trustProxy) {
    const n = Number(trustProxy);
    app.set('trust proxy', Number.isNaN(n) ? trustProxy : n);
  }

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:5173'),
    credentials: true,
  });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API Calc3D escuchando en http://localhost:${port}/api`);
}

bootstrap();
