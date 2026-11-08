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
