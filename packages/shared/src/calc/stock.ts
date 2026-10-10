import type { MaterialStatus, StockCountParts } from '../schemas/stock';

/**
 * CONTROL DE FILAMENTO — las cuentas de las hojas "Inventario" (compras) y
 * "Stock mensual" (conteo físico) del Excel de Banano Lab.
 *
 * Son enteros y divisiones simples: no hace falta decimal.js acá. El dinero de
 * las compras ya viene calculado en USD base desde el gasto.
 */

/** Rollos que hay: las tres casillas del conteo sumadas. */
export function stockTotal(c: StockCountParts): number {
  return c.sealed + c.inUse + c.running;
}

/**
 * Rollos consumidos en el mes: los que había, más los que entraron, menos los
 * que quedaron.
 *
 * La hoja solo resta los dos totales (`prev − curr`), y por eso un mes con
 * compras le da un "consumo" negativo. Contando lo comprado, el número vuelve a
 * significar lo que dice su nombre.
 *
 * Devuelve `null` si falta alguno de los dos conteos: sin contar un mes no se
 * puede saber cuánto se gastó, y es preferible decir "sin dato" a inventarlo.
 */
export function monthConsumption(
  prevTotal: number | null,
  currentTotal: number | null,
  purchasedInMonth = 0,
): number | null {
  if (prevTotal == null || currentTotal == null) return null;
  const consumed = prevTotal + purchasedInMonth - currentTotal;
  // Un conteo mal cargado daría negativo; como consumo, eso no significa nada.
  return Math.max(0, consumed);
}

/** Lo que costó cada rollo de una compra. */
export function purchaseCostPerRoll(amount: number, quantity: number): number {
  if (quantity <= 0) return 0;
  return amount / quantity;
}

/**
 * Lo que costó el gramo. Usa los gramos REALES del rollo: la hoja divide entre
 * 1000 fijo, lo que miente en cuanto un rollo no es de 1 kg.
 */
export function purchaseCostPerGram(costPerRoll: number, rollGrams: number): number {
  if (rollGrams <= 0) return 0;
  return costPerRoll / rollGrams;
}

/**
 * Si hay que reponer ese filamento:
 * - `OUT`: no queda ninguno (rojo en la hoja).
 * - `LOW`: hay alguno por acabarse (naranja en la hoja).
 * - `OK`: hay stock sano.
 * - `IGNORED`: color descontinuado; no entra en la lista de compras aunque esté
 *   en cero (regla 3 de la hoja).
 *
 * `null` cuando ese mes no se contó: sin conteo no se sabe.
 */
export type RestockStatus = 'OUT' | 'LOW' | 'OK' | 'IGNORED';

export function restockStatus(
  material: { status: MaterialStatus },
  count: StockCountParts | null,
): RestockStatus | null {
  if (material.status === 'DISCONTINUED') return 'IGNORED';
  if (!count) return null;
  if (stockTotal(count) === 0) return 'OUT';
  if (count.running > 0) return 'LOW';
  return 'OK';
}

// ----- Reposición por COLOR -----
//
// La marca cambia de un mes a otro (este mes Creality, el otro Bambu Lab): lo
// que se maneja en el estante es el TIPO + COLOR. Decisión del dueño,
// 2026-09-13. La hoja del Excel ya contaba así, por eso muchas fichas de una
// segunda marca nunca tuvieron conteo propio.

/** Una ficha de filamento, con lo que necesita la reposición. */
export interface RestockMaterial {
  id: string;
  type: string | null;
  color: string | null;
  brand: string | null;
  status: MaterialStatus;
}

/**
 * - `OUT`: no queda ningún rollo de ese color, de ninguna marca.
 * - `LOW`: hay alguno por acabarse.
 * - `SUGGEST`: de los colores que MÁS se compran (más rollos que el promedio
 *   por color) y queda 1 rollo o menos: conviene tener otro antes de quedarse
 *   sin el que más se usa.
 */
export type RestockGroupStatus = 'OUT' | 'LOW' | 'SUGGEST';

export interface RestockGroup {
  /** `tipo|color` normalizado */
  key: string;
  /** "PLA Negro" */
  label: string;
  status: RestockGroupStatus;
  /** rollos que quedan, sumando todas las marcas */
  total: number;
  running: number;
  /** rollos comprados de ese color hasta el cierre del mes */
  purchased: number;
  brands: string[];
}

export interface RestockByColor {
  /** solo los que hay que comprar, de más comprado a menos */
  groups: RestockGroup[];
  /** colores contados ese mes: todos si el mes tiene algún conteo, ninguno si no */
  countedColors: number;
  /** colores que se siguen reponiendo (no todos sus fichas descontinuadas) */
  totalColors: number;
  /** rollos comprados por color, en promedio: el umbral de "los que más se compran" */
  averagePurchased: number;
}

const normalizar = (s: string | null) => (s ?? '').trim().toLowerCase();

/**
 * La clave de un grupo de reposición: `tipo|color` normalizado.
 *
 * Vive acá y no inline en `restockByColor` porque hay un segundo lector —la
 * propuesta de pedido (`suggestRestockLines`), que tiene que encontrar las
 * fichas del mismo color que la lista—. Dos formas de armar la clave divergen
 * el día que una de las dos cambie, y la propuesta quedaría sin fichas que
 * ofrecer sin que nada falle.
 */
export const restockKey = (m: { type: string | null; color: string | null }): string =>
  `${normalizar(m.type)}|${normalizar(m.color)}`;

/**
 * Agrupa las fichas por tipo + color y decide qué comprar.
 *
 * - Como en el Excel, si el mes se contó (hay al menos un conteo), un color o
 *   una marca sin nada marcado es CERO: no hay. Decisión del dueño, 2026-09-13.
 *   Solo un mes sin NINGÚN conteo es "sin dato": sin eso, al abrir un mes nuevo
 *   todos los colores saldrían "sin rollos".
 * - Un color con TODAS sus fichas descontinuadas no cuenta ni se pide; si solo
 *   una marca está descontinuada, el color se sigue reponiendo.
 * - "Los que más se compran" sale de las compras de la cuenta, no de un número
 *   fijo: los que superan el promedio de rollos por color.
 */
export function restockByColor(
  materials: RestockMaterial[],
  counts: Record<string, StockCountParts | undefined>,
  purchased: Record<string, number | undefined>,
): RestockByColor {
  const grupos = new Map<string, { label: string; fichas: RestockMaterial[] }>();
  for (const m of materials) {
    const key = restockKey(m);
    const grupo = grupos.get(key);
    if (grupo) {
      grupo.fichas.push(m);
    } else {
      const label =
        [m.type, m.color]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join(' ') || 'Sin tipo ni color';
      grupos.set(key, { label, fichas: [m] });
    }
  }

  const mesContado = Object.values(counts).some((c) => !!c);

  const filas = [...grupos.entries()]
    .filter(([, g]) => g.fichas.some((m) => m.status !== 'DISCONTINUED'))
    .map(([key, g]) => {
      const conteos = g.fichas
        .map((m) => counts[m.id])
        .filter((c): c is StockCountParts => !!c);
      const suma = conteos.reduce(
        (a, c) => ({ sealed: a.sealed + c.sealed, inUse: a.inUse + c.inUse, running: a.running + c.running }),
        { sealed: 0, inUse: 0, running: 0 },
      );
      return {
        key,
        label: g.label,
        // Casillas vacías = no hay: lo que no se marcó en un mes contado suma cero.
        counted: mesContado,
        total: stockTotal(suma),
        running: suma.running,
        purchased: g.fichas.reduce((s, m) => s + (purchased[m.id] ?? 0), 0),
        brands: [...new Set(g.fichas.map((m) => m.brand?.trim()).filter((b): b is string => !!b))],
      };
    });

  const averagePurchased = filas.length
    ? filas.reduce((s, f) => s + f.purchased, 0) / filas.length
    : 0;

  const groups: RestockGroup[] = [];
  for (const f of filas) {
    if (!f.counted) continue;
    let status: RestockGroupStatus | null = null;
    if (f.total === 0) status = 'OUT';
    else if (f.running > 0) status = 'LOW';
    else if (f.purchased > averagePurchased && f.total <= 1) status = 'SUGGEST';
    if (!status) continue;
    groups.push({
      key: f.key,
      label: f.label,
      status,
      total: f.total,
      running: f.running,
      purchased: f.purchased,
      brands: f.brands,
    });
  }
  groups.sort((a, b) => b.purchased - a.purchased || a.label.localeCompare(b.label, 'es'));

  return {
    groups,
    countedColors: filas.filter((f) => f.counted).length,
    totalColors: filas.length,
    averagePurchased,
  };
}

// ----- El mes del conteo -----
//
// Se guarda como el primer día del mes a medianoche UTC, igual que
// `deliveryDate`. Las conversiones van acá y no sueltas en cada pantalla: en
// este proyecto ya hubo un bug por formatear una fecha UTC en la zona local,
// que imprimía el día anterior.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `'2026-08'` → el 1 de agosto de 2026 a medianoche UTC. */
export function monthStart(month: string): Date {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Mes inválido: "${month}". Se espera AAAA-MM (ej. 2026-08).`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/** Una fecha → `'2026-08'`, leyendo el mes en UTC. */
export function monthKey(date: Date): string {
  const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mes}`;
}

/** El mes anterior, para comparar dos conteos. */
export function previousMonth(month: string): string {
  const d = monthStart(month);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthKey(d);
}

// ----- Cierre de mes -----
//
// "El último día del mes" se decide en la zona horaria del negocio. El servidor
// corre en UTC y Venezuela está en UTC−4: comparar en UTC dejaría cerrar agosto
// desde las 20:00 del 30. Es el mismo error que ya rompió el calendario del panel.

/** Zona horaria del negocio (Banano Lab, Venezuela). */
export const BUSINESS_TIME_ZONE = 'America/Caracas';

/** La fecha de HOY en la zona del negocio, como `'AAAA-MM-DD'`. */
export function businessDateKey(now: Date, timeZone = BUSINESS_TIME_ZONE): string {
  // Se arma con las PARTES y no con el texto formateado: el patrón de un locale
  // puede cambiar entre motores y versiones, y una fecha con otro orden
  // compararía mal como texto sin avisar.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valor = (tipo: 'year' | 'month' | 'day') => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** Último día del mes, como `'AAAA-MM-DD'`: desde ese día se puede cerrar. */
export function monthCloseDay(month: string): string {
  const inicio = monthStart(month);
  const ultimo = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
  return ultimo.toISOString().slice(0, 10);
}

/**
 * true si el mes ya se puede cerrar: hoy, en la zona del negocio, es su último
 * día o después. Sin límite hacia adelante (decisión del dueño): si se pasó el
 * día, el mes se cierra igual.
 */
export function canCloseMonth(month: string, now: Date, timeZone = BUSINESS_TIME_ZONE): boolean {
  return businessDateKey(now, timeZone) >= monthCloseDay(month);
}

// ----- El día anterior -----
//
// La aritmética de "con cuánto venías": el saldo con el que arranca un periodo
// es el que había al CERRAR el día de antes. Va acá, con el resto de las
// conversiones de fecha, y NO suelta en cada pantalla.

const DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * true si `AAAA-MM-DD` es un día que EXISTE en el calendario.
 *
 * ⚠️ Un regex NO alcanza: `'2026-02-30'` y `'2026-13-01'` pasan cualquier
 * `\d{4}-\d{2}-\d{2}` y JS los **corre al mes siguiente** sin avisar. Un día
 * inventado que se acepta en silencio es peor que un error: devuelve una cuenta
 * que parece buena. Por eso el chequeo es uno solo y vive acá — lo usan tanto
 * `previousDay` como el schema que valida la fecha que llega del cliente.
 */
export function isCalendarDay(day: string): boolean {
  const m = DIA_RE.exec(day);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
}

/**
 * El día anterior a uno dado: `'2026-10-01'` → `'2026-09-30'`.
 *
 * ⚠️ Toda la cuenta va en **UTC**, como el resto de las fechas de negocio.
 * Hecha con `new Date(key)` + `setDate` en la zona LOCAL, al oeste de UTC la
 * fecha nace un día antes y la cadena entera se corre: es el mismo error que ya
 * imprimió el día previo en los documentos.
 */
export function previousDay(day: string): string {
  if (!isCalendarDay(day)) {
    throw new Error(`Fecha inválida: "${day}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }
  const m = DIA_RE.exec(day) as RegExpExecArray;
  // El día 0 de un mes ES el último del anterior, así que el cruce de mes y de
  // año sale solo (y el 29 de febrero bisiesto también).
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return f.toISOString().slice(0, 10);
}

/**
 * Cuántos días hay de `desde` a `hasta`, los dos `AAAA-MM-DD`. Negativo si
 * `hasta` es anterior.
 *
 * ⚠️ En **UTC**, como el resto de las fechas de negocio: restar dos
 * `new Date(key)` locales cruza mal el borde del día al oeste de UTC y
 * devuelve un día de más o de menos. Y un día que no existe LANZA en vez de
 * devolver un número: `'2026-02-30'` corrido al 2 de marzo daría una cuenta
 * que parece buena.
 */
export function daysBetween(desde: string, hasta: string): number {
  for (const d of [desde, hasta]) {
    if (!isCalendarDay(d)) {
      throw new Error(`Fecha inválida: "${d}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
    }
  }
  const utc = (day: string) => {
    const m = DIA_RE.exec(day) as RegExpExecArray;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}

/**
 * El día que queda `months` meses ANTES de `day`: `'2026-10-10'` + 6 →
 * `'2026-04-10'`. Es el arranque de una ventana "los últimos N meses".
 *
 * ⚠️ **Un día que el mes destino no tiene se RECORTA al último día de ese
 * mes**, no se corre al siguiente. `setUTCMonth` hace lo segundo: el 31 de
 * agosto menos 6 meses le daría "31 de febrero" y lo devolvería como 3 de
 * marzo, así que la ventana arrancaría TRES DÍAS DESPUÉS de lo pedido y
 * dejaría afuera, en silencio, lo de fin de febrero.
 *
 * ⚠️ Todo en **UTC**, como el resto de las fechas de negocio, y un día que no
 * existe LANZA en vez de devolver una ventana corrida.
 */
export function monthsBefore(day: string, months: number): string {
  if (!isCalendarDay(day)) {
    throw new Error(`Fecha inválida: "${day}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }
  const m = DIA_RE.exec(day) as RegExpExecArray;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // El día 0 del mes SIGUIENTE es el último del destino: así se sabe cuántos
  // días tiene sin tabla de meses ni caso especial para febrero bisiesto.
  const ultimo = new Date(Date.UTC(anio, mes - months, 0)).getUTCDate();
  const f = new Date(Date.UTC(anio, mes - 1 - months, Math.min(dia, ultimo)));
  return f.toISOString().slice(0, 10);
}

// ----- El recordatorio del conteo -----
//
// El dueño no contó septiembre porque **no entró** a la pantalla de Stock, así
// que el aviso vive en el Dashboard (decisión del dueño, 2026-10-10) y esta
// función es la que decide si aparece. Un aviso que sale cuando no hay nada que
// hacer entrena a ignorarlo, y el que se pierde después es el que importaba:
// por eso las tres puertas de abajo son tan importantes como el aviso mismo.

/** Lo que falta contar, con lo que hace falta para redactar el aviso. */
export interface ConteoPendiente {
  /** El mes que toca contar: el ANTERIOR al de `hoy` (`AAAA-MM`). */
  mes: string;
  /** El último mes que SÍ se cerró (`AAAA-MM`). */
  ultimoCerrado: string;
  /** Cuántos meses quedaron sin cerrar, contando `mes`. */
  meses: number;
}

/**
 * true si falta cerrar el conteo del mes anterior, con el detalle para el aviso.
 * `null` cuando no hay nada que hacer.
 *
 * ⚠️ **`hoy` entra como PARÁMETRO** (`'AAAA-MM-DD'`, día LOCAL calculado por
 * quien llama): el reloj no se lee adentro. Un test que dependa de la fecha de
 * la máquina pasa hoy y falla solo algún día, y con el reloj adentro el borde
 * del cambio de mes no se podría probar. Misma convención que `cashChainCuts`,
 * `facturasAtrasadas`, `preciosPorTipo` y `campaignLifecycle`.
 *
 * ⚠️ **Sin ningún mes cerrado no avisa.** Un negocio que arranca no tiene nada
 * que contar: no hay cierre anterior con el que comparar y el aviso aparecería
 * el día uno, antes de que exista un estante.
 *
 * ⚠️ Los dos meses se comparan como TEXTO, que para `AAAA-MM` ordena bien —
 * pero solo si los dos son meses de verdad. Un `'2026-13'` compararía mal sin
 * avisar (es el error que ya mordió en `CashBalanceQuerySchema` y en las
 * lecturas de impresora), así que `monthStart` los valida y LANZA.
 */
export function conteoDeStockPendiente(
  ultimoMesCerrado: string | null,
  hoy: string,
): ConteoPendiente | null {
  if (!isCalendarDay(hoy)) {
    throw new Error(`Hoy inválido: "${hoy}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }
  // Sin un cierre previo no hay olvido que recordar.
  if (ultimoMesCerrado == null) return null;
  // Valida los dos meses: lanza si alguno no existe en el calendario.
  const cerrado = monthStart(ultimoMesCerrado);
  const mes = previousMonth(hoy.slice(0, 7));
  if (monthKey(cerrado) >= mes) return null;

  return {
    mes,
    ultimoCerrado: monthKey(cerrado),
    meses: mesesEntre(monthKey(cerrado), mes),
  };
}

/** Cuántos meses hay de `desde` (excluido) a `hasta` (incluido). */
function mesesEntre(desde: string, hasta: string): number {
  const [a1, m1] = desde.split('-').map(Number);
  const [a2, m2] = hasta.split('-').map(Number);
  return (a2 * 12 + m2) - (a1 * 12 + m1);
}

// ----- La sugerencia del conteo -----
//
// Al contar, los rollos que ENTRARON ese mes se ofrecen como punto de partida.
//
// ⚠️ **SUGERIR, NO ESCRIBIR, y el alcance es una decisión del dueño
// (2026-10-10): se sugiere SOLO lo recibido en el mes.** Descartó "el cierre
// anterior más lo recibido", y la razón va acá porque es la que sostiene todo
// el diseño: si la app completa el conteo, el dueño termina **confirmando un
// número en vez de mirando el estante**, y el conteo deja de medir nada. Lo
// que ahorra tipeo ahorra también la verificación, que es lo único que el
// conteo aporta.
//
// ⚠️ Una recepción de una factura de Compras **es** uno de estos gastos (la
// recepción crea un `Expense` con `materialId` y la fecha en que llegó), y una
// compra cargada a mano es un rollo en el estante exactamente igual. Por eso
// entran las dos: dejar afuera las de a mano haría que la sugerencia
// contradiga el "comprados" que la MISMA pantalla muestra en su resumen.

/** Un gasto de filamento del mes: la ficha y cuántos rollos entraron. */
export interface RecepcionDeRollos {
  /** `Expense.materialId`; null = gasto sin ficha enlazada. */
  materialId: string | null;
  rolls: number;
}

/**
 * Rollos recibidos en el mes, por ficha.
 *
 * ⚠️ **Una ficha sin recepciones NO está en el resultado**, y eso es el
 * contrato: "no sé" y "cero" no son lo mismo, y 0 es un conteo válido. Si
 * devolviera 0, la pantalla ofrecería una respuesta en vez de una referencia.
 * Por el mismo motivo una recepción de 0 rollos no crea entrada.
 */
export function rollosRecibidosPorFicha(
  recepciones: RecepcionDeRollos[],
): Record<string, number> {
  const porFicha: Record<string, number> = {};
  for (const r of recepciones) {
    // Sin ficha no hay casilla que sugerir, y una cantidad que no es positiva
    // (un gasto sin rollos, un dato roto) no es una recepción.
    if (!r.materialId || !(r.rolls > 0)) continue;
    porFicha[r.materialId] = (porFicha[r.materialId] ?? 0) + r.rolls;
  }
  return porFicha;
}
