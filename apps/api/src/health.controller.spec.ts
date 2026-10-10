/**
 * `/api/health` TIENE QUE DECIR QUÉ VERSIÓN ESTÁ SIRVIENDO.
 *
 * Devolvía `{ ok, ts }`, y con eso no hay forma de saber si el despliegue que
 * acabás de empujar ya está arriba: el de la tarde del 2026-10-10 se
 * "verificó" esperando ocho minutos por reloj, que es suponer con cara de
 * comprobar. `ts` no sirve para eso — cambia en cada request, con la versión
 * vieja o con la nueva.
 *
 * ⚠️ Y tiene DOS restricciones que son la razón de que este endpoint exista
 * así, no detalles de estilo:
 *  1. **No toca la base.** Render lo usa como `healthCheckPath` para saber si
 *     la app vive; una consulta acá despertaría el cómputo cada pocos minutos.
 *  2. **Nada sensible.** Es PÚBLICO y sin JWT: ni variables de entorno, ni
 *     rutas, ni nombres de base, ni `DATABASE_URL`. Una versión y, a lo sumo,
 *     un hash corto de commit.
 */
import { readFileSync } from 'node:fs';
import { SHARED_VERSION } from '@calc3d/shared';
import { HealthController } from './health.controller';

describe('GET /api/health', () => {
  const controller = new HealthController();

  afterEach(() => {
    delete process.env.RENDER_GIT_COMMIT;
  });

  it('sigue diciendo que la app vive', () => {
    const r = controller.check();

    expect(r.ok).toBe(true);
    expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('dice la versión de shared que está sirviendo', () => {
    expect(controller.check().version).toBe(SHARED_VERSION);
  });

  /**
   * Una versión que no se puede comparar con la del repo no verifica nada.
   *
   * ⚠️ El `package.json` de shared se lee en EJECUCIÓN, no con un `import`.
   * Un `import` de un archivo fuera de `apps/api/src` le corre el `rootDir` a
   * `tsc`: el build pasó de `dist/src/main.js` a `dist/apps/api/src/main.js` y
   * **el Dockerfile arranca el primero**, así que el contenedor no levantaba.
   * Medido al compilar, no adivinado.
   */
  it('la versión es la del paquete de shared, no un literal suelto', () => {
    const pkg = JSON.parse(
      readFileSync(`${__dirname}/../../../packages/shared/package.json`, 'utf8'),
    ) as { version: string };

    expect(controller.check().version).toBe(pkg.version);
  });

  /**
   * ⚠️ LO ANTERIOR NO ALCANZA, y lo descubrió una mutación: cambiar
   * `SHARED_VERSION` por el literal `'0.41.0'` —el valor que shared tenía ese
   * día— **no tumbaba ni un test**, porque los dos comparaban contra el mismo
   * número. Un literal escrito a mano pasa la suite el día que se escribe y
   * miente en el siguiente despliegue, que es EXACTAMENTE el bug que este
   * endpoint vino a cerrar: una versión que no se mueve no sirve para verificar
   * nada. Por eso acá se mira el código: la versión se IMPORTA, no se escribe.
   */
  it('no hay ninguna versión escrita a mano en el controlador', () => {
    const fuente = readFileSync(`${__dirname}/health.controller.ts`, 'utf8');
    const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(sinComentarios).toContain('SHARED_VERSION');
    expect(sinComentarios).not.toMatch(/['"`]\d+\.\d+\.\d+/);
  });

  it('el commit viaja si el entorno lo expone, cortado a 7 caracteres', () => {
    process.env.RENDER_GIT_COMMIT = '0123456789abcdef0123456789abcdef01234567';

    expect(controller.check().commit).toBe('0123456');
  });

  /**
   * ⚠️ Sin esa variable **no se inventa nada**: ni `'unknown'`, ni un
   * `require` del `.git`, ni configuración nueva. El campo simplemente no
   * está, y con la versión alcanza.
   */
  it('sin la variable del entorno, el campo commit no aparece', () => {
    delete process.env.RENDER_GIT_COMMIT;

    expect(controller.check().commit).toBeUndefined();
    expect(Object.keys(controller.check())).not.toContain('commit');
  });

  /**
   * EL ATAQUE: el endpoint es público y sin sesión. Lo que se filtra acá se
   * filtra a internet. Se comprueba contra el objeto REAL, con el entorno
   * cargado de secretos: si alguien agrega un `...process.env` o un
   * `databaseUrl` "para depurar", esto se pone rojo.
   */
  it('no filtra nada sensible aunque el entorno esté lleno de secretos', () => {
    const secretos = {
      DATABASE_URL: 'postgresql://usuario:clave-secreta@host:5432/calc3d',
      JWT_SECRET: 'un-secreto-de-firma-muy-largo-para-produccion',
      RESEND_API_KEY: 're_clave_de_correo',
      R2_SECRET_ACCESS_KEY: 'clave-del-bucket',
      OWNER_PASSWORD: 'clave-del-dueno',
    };
    const previos = { ...process.env };
    Object.assign(process.env, secretos);

    try {
      const serializado = JSON.stringify(controller.check());

      for (const valor of Object.values(secretos)) {
        expect(serializado).not.toContain(valor);
      }
      // Ni los nombres de las variables, ni rutas, ni el nombre de la base.
      for (const pista of Object.keys(secretos)) {
        expect(serializado).not.toContain(pista);
      }
      expect(serializado).not.toMatch(/postgres|\/home\/|node_modules|calc3d\.local/i);
    } finally {
      process.env = previos;
    }
  });

  /** Y la lista de campos es CERRADA: lo que no está acá, no sale. */
  it('devuelve exactamente ok, ts y version (más commit si lo hay)', () => {
    expect(Object.keys(controller.check()).sort()).toEqual(['ok', 'ts', 'version']);

    process.env.RENDER_GIT_COMMIT = 'abcdef1234567890';
    expect(Object.keys(controller.check()).sort()).toEqual(['commit', 'ok', 'ts', 'version']);
  });

  /**
   * No puede tocar la base: no recibe `PrismaService` ni ningún colaborador.
   * Si algún día alguien le inyecta uno, el `new HealthController()` de arriba
   * seguiría compilando, pero esto no pasa.
   */
  it('no depende de nada: se construye sin colaboradores (no toca la BD)', () => {
    expect(HealthController.length).toBe(0);
  });
});
