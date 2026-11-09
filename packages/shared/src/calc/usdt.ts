import { Decimal } from 'decimal.js';

/**
 * Cuánto vale EN USDT un precio que está puesto en dólares BCV.
 *
 * Los precios de la tienda están en dólares BCV (decisión del dueño, 2026-11-08): es lo
 * que el cliente paga. Pero el dólar BCV y el USDT no valen lo mismo, así que la etiqueta
 * no dice cuánto entra de verdad. La cuenta es ir a bolívares y volver:
 *
 *     bolívares = precio × tasaBcv
 *     usdt      = bolívares ÷ tasaUsdt
 *
 * Medido el 2026-11-08 con BCV 900 y USDT 1026: un producto de $24 son 21.600 Bs, o sea
 * **21,05 USDT**. Un 12,3 % menos que lo que dice la etiqueta.
 *
 * ⚠️ **Esto NO cambia lo que se cobra ni lo que se guarda.** Es una lectura para el
 * dueño, de su lado del panel. El motor de costeo y las estadísticas siguen en la base
 * USD de siempre, y la tienda sigue mostrando el precio BCV.
 *
 * ⚠️ Devuelve `null` si falta una tasa o si alguna no es positiva, en vez de un número
 * inventado: una cifra de plata mal calculada es peor que no mostrarla. Con la tasa de
 * USDT cargada mal —pasó: estaba en 1,026 en vez de 1026— esto habría dado 21.052 USDT
 * por un producto de $24, y el `null` no ayuda ahí: ese caso lo tiene que ver el dueño.
 */
export function enUsdt(
  precioEnBcv: number,
  tasaBcv: number | null | undefined,
  tasaUsdt: number | null | undefined,
): number | null {
  if (!tasaBcv || !tasaUsdt || tasaBcv <= 0 || tasaUsdt <= 0) return null;
  if (!Number.isFinite(precioEnBcv)) return null;
  return new Decimal(precioEnBcv).mul(tasaBcv).div(tasaUsdt).toDecimalPlaces(2).toNumber();
}

/**
 * Cuánto se pierde contra el precio de etiqueta, en fracción (0.123 = 12,3 %).
 *
 * Es la lectura que el dueño pidió: no «cuánto es en USDT» sino «cuánto menos estoy
 * recibiendo». `null` con los mismos criterios que `enUsdt`, y también si el precio es 0
 * (no hay nada que perder y dividir por él daría infinito).
 */
export function brechaUsdt(
  precioEnBcv: number,
  tasaBcv: number | null | undefined,
  tasaUsdt: number | null | undefined,
): number | null {
  const usdt = enUsdt(precioEnBcv, tasaBcv, tasaUsdt);
  if (usdt === null || precioEnBcv <= 0) return null;
  return new Decimal(precioEnBcv).minus(usdt).div(precioEnBcv).toDecimalPlaces(4).toNumber();
}

/**
 * El camino INVERSO: qué precio hay que poner en dólares BCV para recibir una cantidad
 * dada de USDT. Es lo que hace falta al publicar una pieza costeada.
 *
 *     bolívares = precioEnUsdt × tasaUsdt
 *     bcv       = bolívares ÷ tasaBcv
 *
 * Con BCV 900 y USDT 1026, costear una pieza en $1,50 USDT exige publicarla en **$1,71
 * BCV**: copiar el $1,50 tal cual —que es lo que hacía el modal de guardar hasta el
 * 2026-11-08— la publica un 12 % más barata de lo costeado.
 *
 * ⚠️ Es la MISMA cuenta que el `adjustedBaseUsd` del perfil «BCV Dólar» de
 * `computeChargeEquivalents`, o sea la tabla «precio a cotizar» que el dueño ya mira en
 * la calculadora. Hay un test que las ancla: si divergen, la app diría dos precios
 * distintos para la misma pieza en dos pantallas.
 *
 * ⚠️ Devuelve 4 decimales, no 2: el redondeo de presentación es una decisión aparte
 * (`precioParaPublicar`), y redondear acá lo aplicaría dos veces.
 */
export function enBcv(
  precioEnUsdt: number,
  tasaBcv: number | null | undefined,
  tasaUsdt: number | null | undefined,
): number | null {
  if (!tasaBcv || !tasaUsdt || tasaBcv <= 0 || tasaUsdt <= 0) return null;
  if (!Number.isFinite(precioEnUsdt)) return null;
  return new Decimal(precioEnUsdt).mul(tasaUsdt).div(tasaBcv).toDecimalPlaces(4).toNumber();
}

/** Lo que el modal de guardar necesita saber para publicar una pieza costeada. */
export interface PrecioPublicado {
  /** El precio a publicar, en dólares BCV, YA redondeado con la regla del negocio. */
  bcv: number;
  /** Lo que entra en USDT cobrando ese `bcv` redondeado. Es el número que manda. */
  usdt: number;
  /**
   * false si faltó alguna tasa: `bcv` cae al precio costeado SIN convertir, que es lo
   * que la app hacía mal. Quien lo muestre tiene que decirlo en vez de publicar barato
   * sin avisar.
   */
  convertido: boolean;
}

/**
 * El precio de vitrina de una pieza costeada: convierte de USDT a dólares BCV y lo
 * redondea con la regla configurada (el dueño usa hacia arriba a 0,50).
 *
 * ⚠️ **El redondeo va DESPUÉS de convertir, y eso importa.** Redondeando antes se
 * redondearía un número que no es el que se publica: de $1,50 USDT a 0,50 hacia arriba
 * daría $1,50 → $1,71 BCV, un precio que no es redondo para nadie. Convirtiendo primero,
 * $1,71 → **$2,00 BCV**, que es lo que el cliente ve en la etiqueta.
 *
 * ⚠️ `usdt` se recalcula sobre el precio YA redondeado, no es el que se costeó: el
 * redondeo hacia arriba agrega plata y el dueño tiene que ver cuánta entra de verdad.
 */
export function precioParaPublicar(
  precioEnUsdt: number,
  tasaBcv: number | null | undefined,
  tasaUsdt: number | null | undefined,
  redondear: (v: number) => number = (v) => v,
): PrecioPublicado {
  const convertido = enBcv(precioEnUsdt, tasaBcv, tasaUsdt);
  if (convertido === null) {
    return { bcv: precioEnUsdt, usdt: precioEnUsdt, convertido: false };
  }
  const bcv = redondear(convertido);
  return { bcv, usdt: enUsdt(bcv, tasaBcv, tasaUsdt) ?? bcv, convertido: true };
}
