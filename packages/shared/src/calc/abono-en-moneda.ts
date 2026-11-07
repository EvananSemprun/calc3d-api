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
export function usdDesdeMoneda(montoEnMoneda: number, tasa: number): number {
  if (!Number.isFinite(montoEnMoneda) || !Number.isFinite(tasa)) {
    throw new Error('El monto y la tasa tienen que ser números');
  }
  if (tasa <= 0) throw new Error('La tasa tiene que ser mayor que cero');
  if (montoEnMoneda <= 0) throw new Error('El monto tiene que ser mayor que cero');
  return toMoney(D(montoEnMoneda).div(D(tasa)));
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
