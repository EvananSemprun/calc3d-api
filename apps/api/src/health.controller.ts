import { Controller, Get } from '@nestjs/common';
import { SHARED_VERSION } from '@calc3d/shared';

/** El commit, solo si el entorno lo expone. Render lo inyecta en sus servicios. */
const COMMIT_ENV = 'RENDER_GIT_COMMIT';

/**
 * Health check público (sin JWT y sin tocar la BD): lo usa Render como
 * `healthCheckPath` para saber si la app está viva sin despertar el cómputo.
 *
 * **Además dice QUÉ VERSIÓN está sirviendo** (2026-10-10). Devolvía `{ ok, ts }`
 * y con eso no había forma de saber si el despliegue que acabás de empujar ya
 * está arriba: el de esa tarde se "verificó" esperando ocho minutos por reloj,
 * que es suponer con cara de comprobar. `ts` no sirve — cambia en cada request,
 * con la versión vieja o con la nueva.
 *
 * ⚠️ **Sigue sin tocar la base.** Render lo pega cada pocos minutos; una
 * consulta acá despertaría el cómputo sola. Este controlador no recibe ningún
 * colaborador a propósito, y hay un test que lo fija.
 *
 * ⚠️ **Nada sensible**: es PÚBLICO y sin sesión. Ni variables de entorno, ni
 * rutas, ni nombres de base, ni `DATABASE_URL`. Una versión y, si el entorno lo
 * expone, un hash corto de commit — y si no lo expone, **el campo no está**: no
 * se inventa un `'unknown'` ni se agrega configuración nueva, porque con la
 * versión ya alcanza para comparar contra el `package.json` del repo.
 *
 * Regresión: `health.controller.spec.ts`.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: boolean; ts: string; version: string; commit?: string } {
    const commit = process.env[COMMIT_ENV]?.trim();

    return {
      ok: true,
      ts: new Date().toISOString(),
      version: SHARED_VERSION,
      ...(commit ? { commit: commit.slice(0, 7) } : {}),
    };
  }
}
