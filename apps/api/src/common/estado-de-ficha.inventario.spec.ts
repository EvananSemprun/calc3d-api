/**
 * INVENTARIO: NADIE COMPARA EL ESTADO DE UNA FICHA A MANO.
 *
 * `MaterialStatus` tiene tres valores y la pregunta «¿esta ficha entra acá?»
 * se contesta SOLO con los predicados de `estado-de-ficha.ts`. El `switch`
 * exhaustivo de ese archivo protege a quien LLAMA a los predicados; no protege
 * a quien compara contra texto (`status === 'DISCONTINUED'`), que compila igual
 * con el valor nuevo y trata el tercer estado como si fuera ACTIVE: era justo
 * el defecto de los sitios que había antes. La revisión humana ya falló en este
 * repo con las fechas y con el nombre accesible; la salida, las dos veces, fue
 * un inventario que recorre el código. Este es ese inventario: el décimo sitio,
 * el que alguien escriba el mes que viene, también salta acá.
 *
 * Lo que mira (sin comentarios, y sin los tests): comparaciones `===`/`!==`
 * contra un valor del enum, `case 'X'`, y las formas de Prisma
 * (`not: 'X'`, `in: [...]`, `where: { status: 'X' }`).
 *
 * ⚠️ La exención va por USO, no por archivo: en `estado-de-ficha.ts` solo se
 * perdonan las etiquetas `case`, que son lo que ese archivo ES. Una
 * comparación cruda escrita ahí adentro también salta.
 *
 * ⚠️ Este archivo es un `.spec.ts` y por eso no se recorre: no hace falta
 * eximirlo a mano, y no queda ciego ningún código de producción.
 *
 * Límite conocido: no ve un valor del enum guardado primero en una variable
 * (`const D = 'DISCONTINUED'; if (s === D)`). Es el precio de un inventario
 * por texto; el `switch` con `never` cubre ese rincón para quien usa predicados.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const VALORES = ['DISCONTINUED', 'SOLO_PEDIDO_ESPECIAL'];
const Q = '[\'"`]';

/** Quita comentarios para que un «por qué» que menciona la comparación no cuente como código. */
export function sinComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[ \t])\/\/.*$/gm, '$1');
}

const alt = VALORES.join('|');
const PATRONES: { nombre: string; re: RegExp; soloCase?: boolean }[] = [
  { nombre: 'comparación (valor a la derecha)', re: new RegExp(`(===|!==|==|!=)\\s*${Q}(${alt})${Q}`, 'g') },
  { nombre: 'comparación (valor a la izquierda)', re: new RegExp(`${Q}(${alt})${Q}\\s*(===|!==|==|!=)`, 'g') },
  { nombre: 'case', re: new RegExp(`\\bcase\\s+${Q}(${alt})${Q}`, 'g'), soloCase: true },
  { nombre: 'Prisma not', re: new RegExp(`\\bnot\\s*:\\s*${Q}(${alt})${Q}`, 'g') },
  { nombre: 'Prisma in', re: new RegExp(`\\bin\\s*:\\s*\\[[^\\]]*${Q}(${alt})${Q}`, 'g') },
  { nombre: 'Prisma where status', re: new RegExp(`\\bwhere\\s*:\\s*\\{[^}]*\\bstatus\\s*:\\s*${Q}(${alt})${Q}`, 'g') },
  // ACTIVE también es un valor de CampaignStatus: solo se vigila `status ===/!== 'ACTIVE'`,
  // la forma que dejaba al tercer estado cayendo en el «else» (hoja del Excel).
  { nombre: 'status contra ACTIVE', re: new RegExp(`\\bstatus\\s*(===|!==)\\s*${Q}ACTIVE${Q}`, 'g') },
];

export interface Hallazgo {
  archivo: string;
  linea: number;
  patron: string;
  texto: string;
}

export function hallazgosEn(archivo: string, codigo: string, esElArchivoDeLosPredicados = false): Hallazgo[] {
  const limpio = sinComentarios(codigo);
  const res: Hallazgo[] = [];
  for (const p of PATRONES) {
    if (p.soloCase && esElArchivoDeLosPredicados) continue;
    for (const m of limpio.matchAll(p.re)) {
      const linea = limpio.slice(0, m.index).split('\n').length;
      res.push({ archivo, linea, patron: p.nombre, texto: codigo.split('\n')[linea - 1].trim() });
    }
  }
  return res;
}

function recorrer(dir: string, salida: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, salida);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(spec|test)\.[tj]sx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      salida.push(p);
    }
  }
  return salida;
}

const RAIZ = path.resolve(__dirname, '../../../..');
const CARPETAS = ['apps/api/src', 'apps/api/prisma', 'packages/shared/src'];
const ARCHIVO_DE_PREDICADOS = path.join('packages', 'shared', 'src', 'calc', 'estado-de-ficha.ts');

describe('el detector del inventario (sin esto, un inventario que no ve nada pasaría siempre en verde)', () => {
  it.each([
    ["if (f.status === 'DISCONTINUED') continue;"],
    ["const activas = items.filter((m) => m.status !== 'DISCONTINUED');"],
    ["if ('SOLO_PEDIDO_ESPECIAL' === s) x();"],
    ["switch (s) {\n case 'DISCONTINUED':\n return 1;\n}"],
    ["findMany({ where: { status: { not: 'DISCONTINUED' } } })"],
    ["findMany({ where: { organizationId, status: 'DISCONTINUED' } })"],
    ["r.status === 'ACTIVE' ? 'Activo' : 'Descontinuado'"],
  ])('caza %j', (codigo) => {
    expect(hallazgosEn('x.ts', codigo).length).toBeGreaterThan(0);
  });

  it.each([
    ["// antes: status === 'DISCONTINUED'"],
    ["/* if (s === 'DISCONTINUED') */ const a = 1;"],
    ["data: { status: 'DISCONTINUED' }"], // ESCRIBIR el estado no es compararlo
    ["campaignDisplayStatus(c) === 'ACTIVE'"],
    ["const ok = entraEnReposicion(f.status);"],
  ])('no se queja de %j', (codigo) => {
    expect(hallazgosEn('x.ts', codigo)).toEqual([]);
  });

  it('en el archivo de los predicados perdona el `case`, pero NO una comparación cruda', () => {
    expect(hallazgosEn('estado-de-ficha.ts', "case 'DISCONTINUED':\n return false;", true)).toEqual([]);
    expect(hallazgosEn('estado-de-ficha.ts', "if (s === 'DISCONTINUED') return false;", true)).not.toEqual([]);
  });
});

describe('inventario: nadie compara el estado de una ficha a mano', () => {
  const archivos = CARPETAS.flatMap((c) => {
    const dir = path.join(RAIZ, c);
    return fs.existsSync(dir) ? recorrer(dir) : [];
  });

  it('el recorrido ve código (si no, el inventario estaría ciego)', () => {
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos.some((a) => a.endsWith('estado-de-ficha.ts'))).toBe(true);
    expect(archivos.some((a) => a.endsWith('expenses.service.ts'))).toBe(true);
  });

  it('ninguna comparación cruda fuera de los predicados', () => {
    const hallazgos = archivos.flatMap((a) =>
      hallazgosEn(
        path.relative(RAIZ, a),
        fs.readFileSync(a, 'utf8'),
        path.relative(RAIZ, a) === ARCHIVO_DE_PREDICADOS,
      ),
    );
    const informe = hallazgos.map((h) => `${h.archivo}:${h.linea} [${h.patron}] ${h.texto}`).join('\n');

    // Si salta: usa entraEnReposicion / entraEnConteo / entraEnCalculadora /
    // estadoTrasComprar / ETIQUETA_DE_ESTADO en vez de comparar.
    expect(informe).toBe('');
  });
});
