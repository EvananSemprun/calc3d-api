import { businessDateKey, daysBetween } from './stock';

/**
 * Cuántos días una ficha se muestra como «Nuevo».
 *
 * Quince es la decisión del dueño (2026-11-08). No sale de una medición —no hay
 * historial de publicaciones con el que medirlo— y está dicho acá para que nadie lo
 * confunda con un número derivado de datos.
 */
export const DIAS_NUEVO = 15;

/**
 * ¿La ficha es nueva para el cliente?
 *
 * ⚠️ Cuenta desde que se PUBLICÓ, no desde que se creó el registro. Acá las fichas nacen
 * ocultas: medido en producción el 2026-11-08, el «llavero con QR» llevaba 78 días
 * creado y seguía sin publicarse. Con la fecha de creación, publicarlo nunca lo habría
 * mostrado como nuevo, que es justo cuando el cliente lo ve por primera vez.
 *
 * ⚠️ `publishedAt` es un INSTANTE (cuándo ocurrió), no una fecha de negocio: se lee con
 * `businessDateKey`, que lo lleva al día en hora de Venezuela. Leerlo con `toISOString`
 * lo correría un día para adelante desde las 20:00 de Caracas.
 *
 * ⚠️ `hoy` entra como PARÁMETRO (`'AAAA-MM-DD'`, día local de quien pregunta): el motor
 * es puro y no decide husos. Es la misma convención de `facturasAtrasadas`,
 * `cashChainCuts` y `campaignLifecycle`.
 *
 * Sin fecha de publicación no es nueva: una ficha que nunca se publicó no puede serlo, y
 * adivinar con la de creación es exactamente el error que esta función evita.
 */
export function esNuevo(publishedAt: Date | string | null | undefined, hoy: string): boolean {
  if (!publishedAt) return false;
  const fecha = new Date(publishedAt);
  // Una fecha ilegible se descarta ANTES de convertirla: `businessDateKey` lanza con un
  // Date invalido, y eso ocurre fuera del try de abajo.
  if (Number.isNaN(fecha.getTime())) return false;
  const dia = businessDateKey(fecha);
  // Una fecha futura (reloj corrido, dato cargado a mano) cuenta como recién publicada
  // en vez de lanzar: una insignia no puede tumbar la vitrina.
  if (dia >= hoy) return true;
  try {
    return daysBetween(dia, hoy) < DIAS_NUEVO;
  } catch {
    return false;
  }
}
