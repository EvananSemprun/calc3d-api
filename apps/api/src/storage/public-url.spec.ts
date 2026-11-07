import { resolvePublicUrlBase } from './public-url';

/**
 * LA URL PÚBLICA DE LAS FOTOS SE VALIDA AL ARRANCAR (2026-11-07).
 *
 * ⚠️ **Nació de un fallo real y SILENCIOSO.** En producción, el valor de
 * `R2_PUBLIC_URL` quedó como `R2_PUBLIC_URL=https://fotos...` — la línea
 * entera del `.env` pegada dentro del campo del valor. La API **arrancó sin
 * quejarse**, respondió `storageReady: true`, dejó subir una foto de 621 kB
 * (que llegó bien al bucket) y recién entonces mostró un recuadro vacío: el
 * `<img src>` no era una URL válida, así que el navegador la tomó como ruta
 * relativa, se la pidió al panel y recibió el `index.html` del SPA.
 *
 * El diagnóstico llevó varias pasadas y pasó por culpar a R2, al DNS y al
 * CORS. Nada de eso: un error de copiar y pegar que **nadie podía ver**.
 *
 * La regla, que es la misma de `jwt-secret.ts`: **sin configurar es válido;
 * mal configurado NO arranca.** Un valor roto que deja la app en pie es peor
 * que una caída, porque el error aparece lejos de su causa.
 */
describe('resolvePublicUrlBase', () => {
  it('sin valor devuelve vacío: R2 es opcional y la app tiene que arrancar', () => {
    expect(resolvePublicUrlBase(undefined)).toBe('');
    expect(resolvePublicUrlBase('')).toBe('');
    expect(resolvePublicUrlBase('   ')).toBe('');
  });

  it('con una URL válida la devuelve', () => {
    expect(resolvePublicUrlBase('https://fotos.ejemplo.com')).toBe('https://fotos.ejemplo.com');
  });

  it('le saca la barra final, que duplicaría la de la clave', () => {
    expect(resolvePublicUrlBase('https://fotos.ejemplo.com/')).toBe('https://fotos.ejemplo.com');
    expect(resolvePublicUrlBase('https://fotos.ejemplo.com///')).toBe('https://fotos.ejemplo.com');
  });

  it('acepta http, para un almacenamiento local de desarrollo', () => {
    expect(resolvePublicUrlBase('http://localhost:9000/fotos')).toBe('http://localhost:9000/fotos');
  });

  // ⚠️ EL CASO REAL: la línea del .env pegada entera en el campo del valor.
  it('LANZA si el valor trae su propio nombre adelante', () => {
    expect(() => resolvePublicUrlBase('R2_PUBLIC_URL=https://fotos.ejemplo.com')).toThrow(
      /R2_PUBLIC_URL/,
    );
  });

  it('LANZA con comillas alrededor, el otro error de pegado típico', () => {
    expect(() => resolvePublicUrlBase('"https://fotos.ejemplo.com"')).toThrow(/R2_PUBLIC_URL/);
  });

  it('LANZA si no es una URL', () => {
    expect(() => resolvePublicUrlBase('fotos.ejemplo.com')).toThrow(/R2_PUBLIC_URL/);
    expect(() => resolvePublicUrlBase('cualquier cosa')).toThrow(/R2_PUBLIC_URL/);
  });

  // ⚠️ Un esquema raro pasa `new URL()` sin problema (`javascript:` es una URL
  // válida), así que el chequeo tiene que mirar el PROTOCOLO y no solo que
  // parsee. Si no, un valor así terminaría dentro de un `<img src>`.
  it('LANZA con un esquema que no es http(s)', () => {
    expect(() => resolvePublicUrlBase('javascript:alert(1)')).toThrow(/R2_PUBLIC_URL/);
    expect(() => resolvePublicUrlBase('ftp://fotos.ejemplo.com')).toThrow(/R2_PUBLIC_URL/);
  });

  // El mensaje tiene que decir QUÉ llegó, o el dueño no sabe qué corregir en
  // el panel de Railway: ahí el valor se ve enmascarado.
  it('el mensaje incluye el valor recibido y qué se esperaba', () => {
    let mensaje = '';
    try {
      resolvePublicUrlBase('R2_PUBLIC_URL=https://x.com');
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain('R2_PUBLIC_URL=https://x.com');
    expect(mensaje).toMatch(/https:\/\//);
  });

  /**
   * ⚠️ Este test existe por lo que destapó la mutación: desactivar la rama que
   * detecta el nombre de la variable **no rompía ningún test**, porque
   * `new URL()` rechaza ese texto igual (`_` y `=` no son válidos en un
   * esquema) y se lanza por el camino genérico. O sea: la rama NO cambia el
   * resultado — cambia el MENSAJE, y el mensaje es todo el valor de esta
   * guarda. El fallo real llevó tres pasadas de diagnóstico; la diferencia
   * entre "no es una URL" y "se pegó la línea entera del .env" es que el
   * segundo se arregla sin pensar. Sin este test, borrar la rama pasa en verde.
   */
  it('el mensaje del caso real DICE que se pegó la línea entera, no solo que falló', () => {
    expect(() => resolvePublicUrlBase('R2_PUBLIC_URL=https://x.com')).toThrow(/línea entera/);
    expect(() => resolvePublicUrlBase('"https://x.com"')).toThrow(/comillas/);
  });
});
