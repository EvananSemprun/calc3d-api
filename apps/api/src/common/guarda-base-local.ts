/**
 * Guarda para scripts que escriben datos de PRUEBA (la siembra del catálogo sintético):
 * solo corren contra una base LOCAL. Con el `.env` de producción a mano, un seed de
 * mil productos visibles terminaría publicado en la tienda real. Romper fuerte y antes
 * de escribir es la doctrina del repo: lo irreversible no se hace en silencio.
 */
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Host de una URL de conexión, o null si no se puede leer (en ese caso NO se asume local). */
export function hostDeUrlDeBase(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Lanza si la base de `DATABASE_URL` no es local. Nunca imprime la URL (lleva la contraseña). */
export function exigirBaseLocal(url: string | undefined = process.env.DATABASE_URL): void {
  const host = hostDeUrlDeBase(url);
  if (host && HOSTS_LOCALES.has(host)) return;
  const donde = host ? `al host "${host}"` : 'a un host que no se pudo leer de DATABASE_URL';
  throw new Error(
    `El catálogo sintético se negó a correr: DATABASE_URL apunta ${donde}, que no es una base local ` +
      `(localhost, 127.0.0.1 o ::1). Este seed crea 1.000 productos VISIBLES y, en una base real, ` +
      `terminarían publicados en la tienda. Apuntá DATABASE_URL a tu Postgres local y volvé a correrlo.`,
  );
}

/** Modo pedido por `SEED_CATALOGO_SINTETICO`: sembrar (1/true), borrar, o nada. */
export function modoSintetico(valor: string | undefined): 'sembrar' | 'borrar' | null {
  if (valor === '1' || valor === 'true') return 'sembrar';
  if (valor === 'borrar') return 'borrar';
  return null;
}
