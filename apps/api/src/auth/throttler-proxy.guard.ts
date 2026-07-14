import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiter que identifica al cliente por su IP REAL. Si se usara la IP de la
 * conexión directa detrás de un proxy/CDN, todos los usuarios contarían como uno
 * solo (un atacante los tumba a todos, o se esconde entre ellos).
 *
 * `req.ip` ya resuelve la IP correcta SEGÚN el ajuste `trust proxy` de Express
 * (configurable con `TRUST_PROXY` en `main.ts`): sin proxy usa la IP del socket
 * (no spoofeable); con proxy confiable usa el X-Forwarded-For. Solo cuando hay un
 * proxy confiable configurado se prioriza `cf-connecting-ip` (Cloudflare) — de lo
 * contrario ese header sería falsificable por el cliente.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const trustsProxy = !!req.app?.get?.('trust proxy');
    if (trustsProxy) {
      const cf = req.headers?.['cf-connecting-ip'];
      if (typeof cf === 'string' && cf) return cf;
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }
}
