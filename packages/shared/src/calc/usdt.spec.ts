import { brechaUsdt, enUsdt } from './usdt';

/**
 * Los precios de la tienda están en dólares BCV; esto dice cuánto entra de verdad.
 * Números de producción del 2026-11-08: BCV 900, Binance/USDT 1026.
 */
describe('enUsdt', () => {
  const BCV = 900;
  const USDT = 1026;

  it('los tres productos reales, con números a mano', () => {
    expect(enUsdt(1.5, BCV, USDT)).toBe(1.32);
    expect(enUsdt(8, BCV, USDT)).toBe(7.02);
    expect(enUsdt(24, BCV, USDT)).toBe(21.05);
  });

  it('con las dos tasas iguales, el precio no se mueve', () => {
    // El contrafáctico: si el BCV valiera lo mismo que el USDT, no habría brecha.
    expect(enUsdt(24, 1000, 1000)).toBe(24);
    expect(brechaUsdt(24, 1000, 1000)).toBe(0);
  });

  it('la brecha es la que el dueño quiere ver', () => {
    // 1 − 21,05/24 = 0,1229…
    expect(brechaUsdt(24, BCV, USDT)).toBeCloseTo(0.1229, 4);
  });

  it('sin alguna tasa devuelve null, no un número inventado', () => {
    // Una cifra de plata mal calculada es peor que no mostrarla.
    expect(enUsdt(24, null, USDT)).toBeNull();
    expect(enUsdt(24, BCV, undefined)).toBeNull();
    expect(enUsdt(24, 0, USDT)).toBeNull();
    expect(enUsdt(24, BCV, -5)).toBeNull();
  });

  it('un precio en 0 no tiene brecha que mostrar', () => {
    // Dividir por él daría infinito; el equivalente sí es 0 y es correcto.
    expect(enUsdt(0, BCV, USDT)).toBe(0);
    expect(brechaUsdt(0, BCV, USDT)).toBeNull();
  });

  it('⚠️ con la tasa cargada mal NO se protege, y es a propósito', () => {
    // Pasó de verdad: USDT estaba en 1,026 en vez de 1026. La función no puede saber
    // que una tasa positiva es absurda, así que devuelve el número y el disparate se ve.
    // Esconderlo con un null dejaría al dueño sin pista de que la tasa está mal.
    expect(enUsdt(24, 900, 1.026)).toBe(21052.63);
  });
});
