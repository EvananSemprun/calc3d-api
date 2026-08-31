import type { ConfigService } from '@nestjs/config';

/**
 * Secreto de firma de los JWT. Fuente ÚNICA: si el módulo que FIRMA y la
 * estrategia que VERIFICA lo resolvieran cada uno por su cuenta, podrían
 * divergir y la app aceptaría tokens firmados con otra clave.
 *
 * El valor de desarrollo está escrito en el código, así que es público: quien lo
 * conozca puede firmar un token válido. Por eso en producción **no hay
 * fallback** — si falta `JWT_SECRET`, la app no arranca. Fallar al arrancar es
 * ruidoso y se arregla en un minuto; arrancar con un secreto conocido es una
 * puerta trasera silenciosa que puede quedar abierta durante meses.
 */
export const DEV_JWT_SECRET = 'dev-secret';

/** Largo mínimo aceptable en producción (256 bits en hex ≈ 64 caracteres). */
const MIN_SECRET_LENGTH = 32;

export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (!isProduction) return secret || DEV_JWT_SECRET;

  if (!secret) {
    throw new Error(
      'Falta JWT_SECRET. En producción no se usa un secreto por defecto: ' +
        'generá uno aleatorio (por ejemplo `openssl rand -hex 32`) y cargalo en el entorno.',
    );
  }
  if (secret === DEV_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET es el valor de desarrollo, que está escrito en el código fuente. ' +
        'Cualquiera podría firmar un token válido: generá uno aleatorio.',
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET es demasiado corto (${secret.length} caracteres). ` +
        `Usá al menos ${MIN_SECRET_LENGTH}, por ejemplo \`openssl rand -hex 32\`.`,
    );
  }
  return secret;
}
