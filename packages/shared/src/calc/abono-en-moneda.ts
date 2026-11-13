import { D, toMoney } from './money';

/**
 * UN ABONO COBRADO EN OTRA MONEDA (2026-11-07).
 *
 * El cliente paga en bolívares y lo que queda registrado es USD, que es la
 * base de costeo y estadísticas de toda la app. La conversión vive acá, en una
 * función pura con decimal.js, por dos razones:
 *
 * 1. **El USD NO se acepta del cliente.** El panel manda lo que se escribió
 *    —los bolívares y la tasa— y el servidor deriva el monto. Si el monto
 *    viajara en el cuerpo, cualquiera podría acreditar lo que quisiera
 *    diciendo que pagó en Bs.
 * 2. Es una división de dinero: con coma flotante, Bs 1.900 ÷ 250 puede dar
 *    7.599999999999999.
 *
 * ⚠️ LA TASA ES «MONEDA DESTINO POR 1 USD», así que se DIVIDE, no se
 * multiplica. Bs 1.900 a tasa 250 son $7,60; multiplicando darían 475.000.
 * Es el mismo criterio que `rate` en `Payment` y en los snapshots de los
 * documentos — no inventar otra dirección acá.
 */
/**
 * EL ABONO QUE, CONVERTIDO, NO LLEGA NI A UN CENTAVO DE DÓLAR.
 *
 * `toMoney` redondea a 4 decimales: Bs 0,001 a tasa 250 son 0,000004 y dan 0.
 * Un abono de 0 no baja ningún saldo y se saltaba el `positive()` que sí
 * protege al abono en USD. La regla vive ACÁ y no en cada servicio porque hay
 * dos llamadores (abonos de pedido y de factura) y con la guarda copiada, un
 * tercero sin ella reabriría el agujero: es el patrón de "dos definiciones de
 * lo mismo".
 *
 * ⚠️ Lleva un NOMBRE para que los servicios lo atrapen con `instanceof` y lo
 * traduzcan a 400 con su propia redacción (el motor decide, el servicio
 * escribe el mensaje). Uno que escape sin traducir sale como 500.
 */
export class AbonoRedondeaACeroError extends Error {
  constructor(
    readonly montoEnMoneda: number,
    readonly tasa: number,
  ) {
    super(`${montoEnMoneda} a tasa ${tasa} no llega a 0,0001 USD: el abono quedaría en cero`);
    this.name = "AbonoRedondeaACeroError";
  }
}

export function usdDesdeMoneda(montoEnMoneda: number, tasa: number): number {
  if (!Number.isFinite(montoEnMoneda) || !Number.isFinite(tasa)) {
    throw new Error('El monto y la tasa tienen que ser números');
  }
  if (tasa <= 0) throw new Error('La tasa tiene que ser mayor que cero');
  if (montoEnMoneda <= 0) throw new Error('El monto tiene que ser mayor que cero');
  const usd = toMoney(D(montoEnMoneda).div(D(tasa)));
  if (usd <= 0) throw new AbonoRedondeaACeroError(montoEnMoneda, tasa);
  return usd;
}

/**
 * Cuánto queda A FAVOR del cliente si este abono supera el saldo, o 0 si no se
 * pasa. Se avisa pero NO se bloquea: con diferencia cambiaria pasarse unos
 * centavos es lo normal, y trabar ahí sería trabar el caso real.
 *
 * ⚠️ Compara al CENTAVO (2 decimales) y no al cuarto decimal: una división de
 * bolívares deja residuos como 0.00004 que no son plata de nadie y harían
 * aparecer el aviso en un abono exacto.
 */
export function saldoAFavorDelAbono(saldoPendiente: number, abonoUsd: number): number {
  const sobra = D(abonoUsd).minus(D(saldoPendiente)).toDecimalPlaces(2);
  return sobra.gt(0) ? sobra.toNumber() : 0;
}
