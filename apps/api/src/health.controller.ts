import { Controller, Get } from '@nestjs/common';

/**
 * Health check público (sin JWT y sin tocar la BD): lo usa Render para saber si
 * la app está viva sin despertar el cómputo de Neon.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
