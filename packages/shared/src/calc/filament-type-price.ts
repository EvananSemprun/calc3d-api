import Decimal from 'decimal.js';
import { D, toMoney } from './money';
import { isCalendarDay, monthsBefore } from './stock';

/**
 * EL PRECIO DE UN TIPO DE FILAMENTO — lo que la calculadora ofrece por defecto
 * desde el 2026-10-10 (decisión del dueño).
 *
 * Hasta ese día cotizar obligaba a elegir una FICHA concreta (un color). Medido
 * en producción: el PLA tiene 47 fichas entre $0,00 y $25,94 y casi todas valen
 * 20, así que elegir el color no compraba precisión. **Entre TIPOS sí importa**:
 * PLA PURE $13 contra PLA SILK $22,84 es 75 % de diferencia, y cotizar los dos
 * a 20 deja el primero 54 % caro (se pierde el trabajo) y el segundo 12 %
 * barato (se pierde el margen).
 *
 * Las tres reglas del promedio, cada una con su test:
 *
 * 1. ⚠️ **El rollo REGALADO no entra.** `PLA Creality Azul oscuro` costó $0
 *    porque se lo regalaron: el gasto en $0 es verdadero y se queda en el
 *    ledger, pero **no es una señal de precio**. La regla es exactamente
 *    "**no hay precio**" (`amount <= 0`), **no** "es sospechosamente barato":
 *    el PLA PURE a $13 contra el PLA a $20 es un dato real y tiene que entrar
 *    — es justo el dato que hace que cotizar por tipo valga la pena. Cualquier
 *    regla de atípicos borraría al PLA PURE junto con el regalo.
 * 2. **Se pondera por ROLLOS comprados, no por ficha.** Un color que se compró
 *    una vez no puede pesar lo mismo que uno que se compra siempre. Hoy casi
 *    todas las fichas tienen una sola compra (entraron con el import del Excel
 *    del 31/08) y los dos números coinciden; está fijado con un test AHORA,
 *    mientras no se nota, para que el día que empiece a importar nadie tenga
 *    que descubrir por qué cambió.
 * 3. ⚠️ **Un tipo sin ninguna compra con precio no tiene promedio**: no se
 *    ofrece, en vez de ofrecerse en $0 y cotizar gratis.
 * 4. ⚠️ **Solo mira los últimos `MESES_DE_LA_VENTANA` meses** (2026-10-10).
 *    Con toda la historia, una compra vieja y barata pesa para siempre y el día
 *    que el filamento suba la calculadora cotiza con el precio de antes **sin
 *    avisar**. Pero un tipo que no se compró dentro de la ventana **NO
 *    desaparece**: se apoya en su ÚLTIMA compra y sale marcado con `stale`,
 *    porque desaparecer es peor que estar un poco viejo — el dueño no podría
 *    cotizar ese tipo en absoluto. La pantalla dice las dos cosas distinto.
 *
 * El motor es PURO: no sabe de Prisma. **"Hoy" entra como PARÁMETRO** y no se
 * lee del reloj acá adentro: un test que dependa de la fecha de la máquina pasa
 * hoy y falla solo algún día. Es la convención de `cashChainCuts`,
 * `facturasAtrasadas` y `campaignLifecycle`. Quien llama le pasa las compras ya
 * resueltas (`GET /filament/type-prices` en la API).
 *
 * ⚠️ **Con los datos de hoy esto no cambia ningún número**: casi todo el
 * catálogo entró con el import del 31/08 y cae dentro de la ventana. Los tests
 * de `filament-type-price.spec.ts`, con las fechas a mano, son la única prueba
 * de que la ventana hace algo.
 */

/** Una compra de rollos, con lo mínimo que mira el promedio. */
export interface CompraDeRollos {
  /** El tipo de la ficha comprada ("PLA", "PETG"); null o vacío si no está cargado. */
  type: string | null;
  /** Rollos que trajo esa compra. */
  rolls: number;
  /** Lo que se pagó por la compra COMPLETA, en USD base. 0 = regalado o sin precio. */
  amount: number;
  /** Gramos por rollo de la ficha comprada. */
  rollGrams: number;
  /**
   * Día de la compra, `'AAAA-MM-DD'` (se tolera un ISO completo: se corta).
   * `null` o un día inventado = sin fecha, y se trata como la compra MÁS VIEJA.
   */
  date: string | null;
}

/**
 * El precio de un tipo, derivado de sus compras. Es lo que la calculadora copia
 * al trabajo: el mismo par (precio del rollo, gramos del rollo) que copiaría una
 * ficha.
 */
export interface PrecioPorTipo {
  /** El tipo, sin espacios de sobra ("PLA", "PLA SILK"). */
  type: string;
  /** Promedio de lo que costó el rollo, ponderado por rollos comprados (USD). */
  rollPrice: number;
  /** Promedio de los gramos del rollo, ponderado por rollos comprados. */
  rollGrams: number;
  /** Rollos que respaldan el promedio (solo los de las compras CON precio). */
  rolls: number;
  /** Compras que respaldan el promedio (solo las que tienen precio). */
  purchases: number;
  /**
   * `true` si el tipo NO tuvo ninguna compra dentro de la ventana y el número
   * sale de su última compra: NO es un precio de hoy y la pantalla lo dice
   * distinto.
   */
  stale: boolean;
  /** Día de la compra más reciente que respalda el número, o `null` si ninguna tenía fecha. */
  lastPurchase: string | null;
}

/** Acumulador por tipo, en decimal.js: el dinero no se suma en coma flotante. */
interface Acumulado {
  type: string;
  dinero: Decimal;
  gramos: Decimal;
  rolls: number;
  purchases: number;
  /** El día de la compra más reciente que ya entró, o null si ninguna tenía fecha. */
  lastPurchase: string | null;
  /** true si el tipo no tuvo compras en la ventana y esto es su última compra. */
  stale: boolean;
}

/** Una compra ya filtrada, con su día resuelto (`null` = sin fecha usable). */
interface ComprayDia {
  compra: CompraDeRollos;
  type: string;
  dia: string | null;
}

/**
 * El precio de cada tipo: primero los que tienen compras en la ventana, y
 * dentro de cada grupo de más a menos rollos comprados.
 *
 * El orden es por ROLLOS a propósito: el primero es el tipo que más se compra y
 * es el que la calculadora elige al abrirse. ⚠️ **Los `stale` van al final**
 * por eso mismo: un tipo que no se compra desde el año pasado no puede ser el
 * default por tener más rollos acumulados.
 *
 * ⚠️ **Los gramos se promedian ponderados por rollos igual que el precio**, y
 * eso no es un detalle: así `rollPrice / rollGrams` da el costo por gramo REAL
 * del tipo (Σdinero / Σgramos). Promediar los gramos de otra forma —o dejarlos
 * fijos en 1000— haría que el par que la calculadora copia mienta en cuanto
 * haya un rollo que no sea de 1 kg.
 *
 * ⚠️ **Las fichas DESCONTINUADAS sí entran.** La pregunta que responde esto es
 * "cuánto me cuesta un rollo de este tipo", y lo que se pagó por un color que
 * ya no se repone sigue siendo evidencia de eso. Descontinuar es una decisión
 * sobre la VARIEDAD, no sobre el precio.
 */
/**
 * Meses que mira el promedio (2026-10-10, decisión del dueño).
 *
 * Antes miraba TODA la historia, así que una compra vieja y barata pesaba para
 * siempre: el día que el filamento suba, la calculadora seguiría cotizando con
 * el precio de antes **sin avisar**.
 */
export const MESES_DE_LA_VENTANA = 6;

/**
 * El día de una compra, `'AAAA-MM-DD'`, o `null` si no hay uno usable.
 *
 * ⚠️ Un día que no existe (`'2026-02-30'`) devuelve `null` y NO se corre al 2
 * de marzo: una fecha corrida metería en la ventana una compra que está afuera,
 * o al revés, y el promedio parecería bueno.
 */
function dia(date: string | null): string | null {
  if (!date) return null;
  const d = date.slice(0, 10);
  return isCalendarDay(d) ? d : null;
}

/**
 * La compra MÁS RECIENTE del tipo, en una lista de una sola.
 *
 * ⚠️ **Una compra sin fecha cuenta como la más VIEJA**: no puede afirmar que es
 * reciente. Sigue sirviendo de respaldo —que es lo que evita que el tipo
 * desaparezca del desplegable— pero solo si no hay ninguna fechada.
 */
function ultima(suyas: ComprayDia[]): ComprayDia[] {
  let mejor = suyas[0];
  for (const u of suyas) {
    if (u.dia === null) continue;
    if (mejor.dia === null || u.dia > mejor.dia) mejor = u;
  }
  return mejor ? [mejor] : [];
}

export function preciosPorTipo(compras: CompraDeRollos[], hoy: string): PrecioPorTipo[] {
  if (!isCalendarDay(hoy)) {
    throw new Error(`Hoy inválido: "${hoy}". Se espera un día real en AAAA-MM-DD (ej. 2026-10-01).`);
  }
  // El arranque de la ventana. Se compara como TEXTO 'AAAA-MM-DD', que ordena
  // igual que la fecha y no arrastra husos horarios.
  const desde = monthsBefore(hoy, MESES_DE_LA_VENTANA);

  const utiles: ComprayDia[] = [];
  for (const c of compras) {
    const type = c.type?.trim();
    // Sin tipo no hay nada que ofrecer: en el análisis de filamento "Sin
    // especificar" es un grupo real, pero acá no se puede cotizar "un rollo de
    // tipo sin nombre".
    if (!type) continue;
    // Regla 1: sin precio no hay señal de precio (el rollo regalado). Vale
    // también para la ÚLTIMA compra del respaldo: si no, un tipo cuyo último
    // rollo fue regalado se ofrecería en $0.
    if (!(c.amount > 0)) continue;
    // Sin rollos no se puede saber qué costó el rollo, y dividir por cero daría
    // Infinity. Sin gramos, el costo por gramo del motor se iría a cero y la
    // pieza saldría con material gratis.
    if (!(c.rolls > 0) || !(c.rollGrams > 0)) continue;

    utiles.push({ compra: c, type, dia: dia(c.date) });
  }

  const porTipo = new Map<string, Acumulado>();
  for (const type of new Set(utiles.map((u) => u.type))) {
    const suyas = utiles.filter((u) => u.type === type);
    const dentro = suyas.filter((u) => u.dia !== null && u.dia >= desde);
    // Regla 4: un tipo sin compras recientes NO desaparece — se apoya en su
    // ÚLTIMA compra. Desaparecer sería peor que estar un poco viejo: el dueño
    // no podría cotizar ese tipo en absoluto.
    const base = dentro.length > 0 ? dentro : ultima(suyas);
    const acc: Acumulado = {
      type,
      dinero: D(0),
      gramos: D(0),
      rolls: 0,
      purchases: 0,
      lastPurchase: null,
      stale: dentro.length === 0,
    };
    for (const u of base) {
      acc.dinero = acc.dinero.plus(u.compra.amount);
      acc.gramos = acc.gramos.plus(D(u.compra.rollGrams).times(u.compra.rolls));
      acc.rolls += u.compra.rolls;
      acc.purchases += 1;
      if (u.dia && (!acc.lastPurchase || u.dia > acc.lastPurchase)) acc.lastPurchase = u.dia;
    }
    porTipo.set(type, acc);
  }

  return [...porTipo.values()]
    .map((a) => ({
      type: a.type,
      rollPrice: toMoney(a.dinero.div(a.rolls)),
      // Entero, como `Material.rollGrams`: el error es de menos de un gramo.
      rollGrams: a.gramos.div(a.rolls).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
      rolls: a.rolls,
      purchases: a.purchases,
      stale: a.stale,
      lastPurchase: a.lastPurchase,
    }))
    .sort(
      (a, b) =>
        // Los de precio VIEJO, al final: el orden decide qué elige la
        // calculadora al abrirse, y un tipo que no se compra desde el año
        // pasado no puede ser el default por tener más rollos.
        Number(a.stale) - Number(b.stale) ||
        b.rolls - a.rolls ||
        b.rollPrice - a.rollPrice ||
        a.type.localeCompare(b.type),
    );
}
