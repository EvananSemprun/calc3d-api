import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AUDITORÍA: NINGÚN CONTROLLER NACE ABIERTO A INTERNET (2026-11-05).
 *
 * ⚠️ La autenticación en este proyecto es **opt-in**: no hay un guard global,
 * cada controller declara `@UseGuards(JwtAuthGuard)` por su cuenta. Eso
 * significa que un controller nuevo **nace público** y nada avisa: no falla el
 * build, no falla ningún test, y el endpoint queda expuesto hasta que alguien
 * lo note. Este test es ese "alguien".
 *
 * Lo que fija:
 *   1. Todo controller exige sesión, salvo los que están en PUBLICOS, uno por uno.
 *   2. Un controller público TIENE que tener rate limiting. Un endpoint sin
 *      sesión y sin tope es el que se abusa primero.
 *
 * Para agregar un controller público hay que tocar este archivo a mano, que es
 * justo el punto: obliga a decidirlo en vez de que pase por descuido.
 */

/** Controllers públicos A PROPÓSITO, con el motivo de cada uno. */
const PUBLICOS: Record<string, { motivo: string; exigeTope: boolean }> = {
  HealthController: {
    motivo: 'Sonda de salud del despliegue: la llama Railway, no un usuario.',
    // No toca la base ni devuelve datos del negocio: un tope acá le estorbaría
    // al healthcheck, que es justo quien más la llama.
    exigeTope: false,
  },
  AuthController: {
    motivo: 'Login, refresh y recuperar contraseña: son la puerta, no pueden exigir sesión.',
    exigeTope: true,
  },
  StorePublicController: {
    motivo: 'Catálogo de la tienda: lo lee cualquier visitante.',
    exigeTope: true,
  },
  StoreRequestsPublicController: {
    motivo: 'Pedidos y solicitudes de la tienda: los manda un visitante sin cuenta.',
    exigeTope: true,
  },
};

interface ControllerHallado {
  clase: string;
  ruta: string;
  archivo: string;
  decoradores: string;
}

/** Todos los .ts de src, sin tests. */
function archivosDeFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const completo = join(dir, nombre);
    if (statSync(completo).isDirectory()) archivosDeFuente(completo, acc);
    else if (nombre.endsWith('.ts') && !nombre.includes('.spec.')) acc.push(completo);
  }
  return acc;
}

/**
 * Cada `@Controller(...)` con TODOS los decoradores de su clase.
 *
 * ⚠️ Se recorre línea por línea, y no con una expresión regular que vaya del
 * `@Controller` al `export class`: **el `@UseGuards` suele ir ARRIBA del
 * `@Controller`**, y mirar solo hacia abajo daba 7 controllers protegidos por
 * desprotegidos. El primer intento de este test reportó exactamente eso, y el
 * número era tan alto que delató al instrumento, no al código.
 *
 * ⚠️ Se analiza POR CONTROLLER y no por archivo: hay archivos con dos (uno
 * público y uno de panel), y mirar el archivo entero daría por protegido al
 * público solo porque su vecino sí tiene guard.
 */
function controllersDe(texto: string, archivo: string): ControllerHallado[] {
  const hallados: ControllerHallado[] = [];
  let bufer: string[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const recortada = linea.trim();
    const clase = /^export class (\w+)/.exec(recortada);
    if (clase) {
      const decoradores = bufer.join(' ');
      const ctrl = /@Controller\(([^)]*)\)/.exec(decoradores);
      if (ctrl) hallados.push({ ruta: ctrl[1].trim(), decoradores, clase: clase[1], archivo });
      bufer = [];
      continue;
    }
    // Los decoradores de una clase son un bloque contiguo: una línea en blanco
    // lo corta, y una que no empieza con @ solo cuenta si continúa el bloque
    // (un decorador partido en varias líneas).
    if (recortada.startsWith('@')) bufer.push(recortada);
    else if (recortada === '') bufer = [];
    else if (bufer.length > 0) bufer.push(recortada);
  }
  return hallados;
}

/** El separador de rutas del sistema, para que los mensajes se lean igual en todos lados. */
const SEPARADOR = join('a', 'b').slice(1, -1);
const SRC = join(__dirname, '..');
const CONTROLLERS = archivosDeFuente(SRC).flatMap((f) =>
  controllersDe(readFileSync(f, 'utf8'), f.slice(SRC.length + 1).split(SEPARADOR).join('/')),
);

describe('Ningún controller queda abierto por descuido', () => {
  // Si esto se cae, el análisis dejó de encontrar los controllers y todo lo de
  // abajo pasaría en verde sin mirar nada: un test que no prueba nada.
  it('el análisis encuentra los controllers del proyecto', () => {
    expect(CONTROLLERS.length).toBeGreaterThan(25);
  });

  it.each(CONTROLLERS.map((c) => [c.clase, c] as const))(
    '%s exige sesión, o está declarado público a propósito',
    (_nombre, ctrl) => {
      const protegido = /@UseGuards\([^)]*JwtAuthGuard/.test(ctrl.decoradores);
      if (protegido || PUBLICOS[ctrl.clase]) return;
      throw new Error(
        `${ctrl.clase} (${ctrl.archivo}, ruta ${ctrl.ruta}) no tiene JwtAuthGuard.\n` +
          'Si debe exigir sesión, agrégale @UseGuards(JwtAuthGuard).\n' +
          'Si es público a propósito, agrégalo a PUBLICOS en este archivo con su motivo.',
      );
    },
  );

  // ⚠️ Lo que de verdad se abusa en un endpoint público no es la falta de
  // sesión —no la puede tener— sino la falta de tope.
  it.each(
    Object.entries(PUBLICOS)
      .filter(([, v]) => v.exigeTope)
      .map(([clase]) => [clase]),
  )('%s es público, así que tiene rate limiting', (clase) => {
    const ctrl = CONTROLLERS.find((c) => c.clase === clase);
    expect(ctrl).toBeDefined();
    expect(ctrl!.decoradores).toMatch(/@UseGuards\([^)]*ThrottlerGuard/);
  });

  // Una entrada que ya no existe es ruido que tapa la lista: si alguien borra
  // un controller público, su excepción tiene que irse con él.
  it('no sobra ningún controller en la lista de públicos', () => {
    const clases = new Set(CONTROLLERS.map((c) => c.clase));
    expect(Object.keys(PUBLICOS).filter((c) => !clases.has(c))).toEqual([]);
  });
});
