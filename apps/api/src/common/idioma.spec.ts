import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardián de idioma: la API y el motor (`shared`) hablan de «tú», nunca de voseo.
 * Los mensajes de error de la API salen en los avisos del panel, así que son
 * texto de cara al usuario; los comentarios se barren igual para que el repo
 * tenga un solo registro.
 *
 * Diseño en dos mitades (el mismo del panel, `calc3d-web/apps/web/src/idioma.spec.ts`):
 *
 * - Presente de voseo (`-ás`, `-és`, `-ís`): POR PATRÓN. Se marca cualquier palabra
 *   con esa terminación sin que nadie la enumere, salvo las terminadas en
 *   `-rás`/`-rés`/`-rís` (futuro del tuteo: verás, tendrás) y las de
 *   `PALABRAS_PERMITIDAS`. Una lista fija falló dos veces: dejó 19 formas sin
 *   corregir con todo en verde.
 * - Imperativos (`cargá`, `volvé`, `borrala`): lista explícita, porque ahí el
 *   patrón chocaría con medio diccionario (`está`, `acá`, `categoría`, `había`).
 *
 * ⚠️ Las formas del imperativo van CON ACENTO y como palabra completa. Sin él,
 * `hace`/`toca`/`mira` son tercera persona («el motor hace la cuenta»).
 */

/**
 * Palabras legítimas que el patrón de `-ás/-és/-ís` marca sin ser voseo. Medidas
 * sobre el corpus de la API y `shared` (no copiadas del panel):
 * - `más`, `además`, `demás`, `jamás`, `después`, `revés`: adverbios y
 *   determinantes comunes.
 * - `país`, `arnés`: sustantivos (código de país en teléfonos; arnés de test).
 * - `estás`, `estés`: de «estar» en TÚ («lo que realmente estás ganando»,
 *   «que estés eligiendo»). Es tuteo correcto y no hay otra forma de escribirlo.
 *
 * Cada entrada tiene que seguir apareciendo en el código (hay un test): una lista
 * blanca con palabras que ya nadie usa es la forma lenta de apagar el guardián.
 */
export const PALABRAS_PERMITIDAS = [
  'más', 'además', 'después', 'demás', 'revés', 'jamás', 'país', 'arnés', 'estás', 'estés',
] as const;

/** Imperativos de voseo (y con pronombre pegado). Lista explícita, ver arriba. */
export const IMPERATIVOS_DE_VOSEO = [
  'abonás', 'tenés', 'podés', 'tocá', 'mirá', 'dejalo', 'registrá', 'elegí',
  'hacé', 'ingresá', 'avisá', 'sacá', 'pasá', 'verificá', 'poné', 'cargá',
  'borrá', 'revisá', 'usá', 'sumá', 'decí', 'fijate', 'acordate', 'escribí',
  'mandá', 'corregí', 'volvé', 'cargala', 'contá', 'llená', 'cerrá', 'anotá',
  'publicá', 'cambiá', 'marcá', 'recargá',
  // Medidas en este corpus:
  'deshacé', 'generá', 'indicá', 'apuntá', 'bajá', 'probá', 'pedí', 'agregá',
  // Con pronombre pegado (el acento se pierde: borrá + la = borrala):
  'cargalo', 'borrala', 'borralas', 'desactivala', 'activala', 'anulala',
  'descontinuala', 'corregila', 'reabrilo', 'anotalo', 'abonalo', 'elegilo',
  'agregalo', 'agregale', 'cambiale', 'movelas', 'ponele', 'contanos',
  // El pronombre mismo:
  'vos',
] as const;

const NO_LETRA = String.raw`(?<![\p{L}\p{N}_])`;
const NO_LETRA_DESPUES = String.raw`(?![\p{L}\p{N}_])`;

const PATRON_PRESENTE = new RegExp(
  String.raw`${NO_LETRA}[\p{L}]*(?<!r)(?:ás|és|ís)${NO_LETRA_DESPUES}`,
  'giu',
);

export function presentesDeVoseo(texto: string): string[] {
  const permitidas: readonly string[] = PALABRAS_PERMITIDAS;
  return (texto.match(PATRON_PRESENTE) ?? [])
    .map((p) => p.toLowerCase())
    .filter((p) => !permitidas.includes(p));
}

function regexDe(forma: string): RegExp {
  return new RegExp(`${NO_LETRA}${forma}${NO_LETRA_DESPUES}`, 'giu');
}

export function imperativosDeVoseo(texto: string): string[] {
  return IMPERATIVOS_DE_VOSEO.filter((forma) => regexDe(forma).test(texto));
}

// `src/common` -> `apps/api/src` y `packages/shared/src`.
const RAICES = [
  path.resolve(__dirname, '..'),
  path.resolve(__dirname, '../../../../packages/shared/src'),
];
const ESTE_ARCHIVO = path.resolve(__dirname, 'idioma.spec.ts');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

const TODOS = RAICES.flatMap(archivos).filter((r) => r !== ESTE_ARCHIVO);
const relativa = (ruta: string) => path.relative(path.resolve(__dirname, '../../../..'), ruta);

describe('idioma de la API y shared', () => {
  it('el barrido encuentra archivos de las dos raíces', () => {
    expect(TODOS.some((r) => r.includes(`${path.sep}apps${path.sep}api${path.sep}`))).toBe(true);
    expect(TODOS.some((r) => r.includes(`${path.sep}packages${path.sep}shared${path.sep}`))).toBe(true);
  });

  it('ningún archivo usa el imperativo de voseo', () => {
    const encontrados: string[] = [];
    for (const ruta of TODOS) {
      const texto = readFileSync(ruta, 'utf8');
      for (const forma of imperativosDeVoseo(texto)) {
        const n = texto.match(regexDe(forma))?.length ?? 0;
        encontrados.push(`${relativa(ruta)}: «${forma}» x${n}`);
      }
    }
    // Se compara el texto: Jest no admite mensaje propio y así el diff lista los hallazgos.
    expect(encontrados.join('\n')).toBe('');
  });

  it('ningún archivo usa el presente de voseo (-ás/-és/-ís)', () => {
    const encontrados: string[] = [];
    for (const ruta of TODOS) {
      for (const palabra of new Set(presentesDeVoseo(readFileSync(ruta, 'utf8')))) {
        encontrados.push(`${relativa(ruta)}: «${palabra}»`);
      }
    }
    // Si la palabra es legítima (no es voseo), agrégala a PALABRAS_PERMITIDAS.
    expect(encontrados.join('\n')).toBe('');
  });

  it('el patrón caza voseo que nadie enumeró y deja pasar lo legítimo', () => {
    expect(presentesDeVoseo('Si pensás o elegís algo')).toEqual(['pensás', 'elegís']);
    expect(
      presentesDeVoseo('Después verás que estás además más aquí, tendrás el revés, jamás en el país'),
    ).toEqual([]);
  });

  it('la lista blanca no está vacía y cada entrada sigue usándose en el código', () => {
    expect(PALABRAS_PERMITIDAS.length).toBeGreaterThan(0);
    const todo = TODOS.map((r) => readFileSync(r, 'utf8').toLowerCase()).join('\n');
    const sinUso = PALABRAS_PERMITIDAS.filter((p) => !regexDe(p).test(todo));
    // Si falla: entradas de la lista blanca que ya nadie usa.
    expect(sinUso).toEqual([]);
  });

  it('no marca la tercera persona sin acento', () => {
    expect(imperativosDeVoseo('el motor hace la cuenta, toca el botón, mira y registra')).toEqual([]);
  });

  it('sí marca el imperativo con acento y como palabra completa', () => {
    expect(imperativosDeVoseo('Tocá acá y mirá el total, borrala')).toEqual(['tocá', 'mirá', 'borrala']);
  });
});
