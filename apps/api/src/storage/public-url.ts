/**
 * Base pública de las fotos (R2), validada al arrancar.
 *
 * ⚠️ **Nació de un fallo real y SILENCIOSO** (producción, 2026-11-07). El valor
 * de `R2_PUBLIC_URL` quedó como `R2_PUBLIC_URL=https://fotos...` — la línea
 * entera del `.env` pegada dentro del campo del valor. La API arrancó sin
 * quejarse, respondió `storageReady: true`, aceptó una foto de 621 kB (que
 * llegó bien al bucket) y recién ahí mostró un recuadro vacío: ese texto no es
 * una URL, así que el navegador lo tomó como ruta relativa, se la pidió al
 * panel y recibió el `index.html` del SPA. El diagnóstico pasó por culpar a R2,
 * al DNS y al CORS antes de encontrar un error de copiar y pegar.
 *
 * La regla es la misma de `jwt-secret.ts`: **sin configurar es válido; mal
 * configurado NO arranca.** Un valor roto que deja la app en pie es peor que
 * una caída, porque el error aparece lejos de su causa.
 */

/** Lo que puede escribirse dentro de un `<img src>` sin sorpresas. */
const ESQUEMAS = ['http:', 'https:'];

function invalido(valor: string, porque: string): never {
  throw new Error(
    `R2_PUBLIC_URL ${porque}. Se recibió: ${JSON.stringify(valor)}. ` +
      'Tiene que ser solo la URL base de las fotos, por ejemplo ' +
      '"https://fotos.ejemplo.com" — sin el nombre de la variable adelante, ' +
      'sin comillas y sin barra final.',
  );
}

/**
 * Devuelve la base pública sin barra final, o `''` si no está configurada
 * (R2 es opcional: sin él la app funciona, solo que no sirve fotos).
 * Lanza si hay un valor pero no es una URL http(s).
 */
export function resolvePublicUrlBase(valor: string | undefined): string {
  const crudo = (valor ?? '').trim();
  if (!crudo) return '';

  // El caso real: la línea del .env pegada entera. `new URL()` lo rechazaría
  // igual, pero con un mensaje genérico que no dice qué hacer.
  if (/^R2_PUBLIC_URL\s*=/i.test(crudo)) {
    invalido(crudo, 'trae su propio nombre adelante (se pegó la línea entera del .env)');
  }
  if (/^["']|["']$/.test(crudo)) {
    invalido(crudo, 'está entre comillas');
  }

  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    invalido(crudo, 'no es una URL');
  }
  // ⚠️ `javascript:alert(1)` es una URL VÁLIDA para `new URL()`. Si solo se
  // comprobara que parsea, ese valor terminaría dentro de un `<img src>`.
  if (!ESQUEMAS.includes(url.protocol)) {
    invalido(crudo, `usa el esquema "${url.protocol}" en lugar de http o https`);
  }

  return crudo.replace(/\/+$/, '');
}
