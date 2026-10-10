import Decimal from 'decimal.js';
import { D, toMoney } from './money';

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
 *
 * El motor es PURO: no sabe de Prisma ni de fechas. Quien llama le pasa las
 * compras ya resueltas (`GET /filament/type-prices` en la API).
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
}

/** Acumulador por tipo, en decimal.js: el dinero no se suma en coma flotante. */
interface Acumulado {
  type: string;
  dinero: Decimal;
  gramos: Decimal;
  rolls: number;
  purchases: number;
}

/**
 * El precio de cada tipo, de más a menos rollos comprados.
 *
 * El orden es por ROLLOS a propósito: el primero es el tipo que más se compra y
 * es el que la calculadora elige al abrirse.
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
export function preciosPorTipo(compras: CompraDeRollos[]): PrecioPorTipo[] {
  const porTipo = new Map<string, Acumulado>();

  for (const c of compras) {
    const type = c.type?.trim();
    // Sin tipo no hay nada que ofrecer: en el análisis de filamento "Sin
    // especificar" es un grupo real, pero acá no se puede cotizar "un rollo de
    // tipo sin nombre".
    if (!type) continue;
    // Regla 1: sin precio no hay señal de precio (el rollo regalado).
    if (!(c.amount > 0)) continue;
    // Sin rollos no se puede saber qué costó el rollo, y dividir por cero daría
    // Infinity. Sin gramos, el costo por gramo del motor se iría a cero y la
    // pieza saldría con material gratis.
    if (!(c.rolls > 0) || !(c.rollGrams > 0)) continue;

    const acc = porTipo.get(type) ?? {
      type,
      dinero: D(0),
      gramos: D(0),
      rolls: 0,
      purchases: 0,
    };
    acc.dinero = acc.dinero.plus(c.amount);
    acc.gramos = acc.gramos.plus(D(c.rollGrams).times(c.rolls));
    acc.rolls += c.rolls;
    acc.purchases += 1;
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
    }))
    .sort((a, b) => b.rolls - a.rolls || b.rollPrice - a.rollPrice || a.type.localeCompare(b.type));
}
