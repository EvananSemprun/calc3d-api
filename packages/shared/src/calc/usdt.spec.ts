import { RATE_LABELS, computeChargeEquivalents } from './charge-equivalents';
import { brechaUsdt, enBcv, enUsdt, precioParaPublicar } from './usdt';

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

describe('enBcv — el camino inverso, para publicar lo costeado', () => {
  const BCV = 900;
  const USDT = 1026;

  it('costear en USDT y publicar en BCV: el precio SUBE', () => {
    // Copiar el precio de la calculadora tal cual publicaba 12 % más barato.
    expect(enBcv(1.5, BCV, USDT)).toBe(1.71);
    expect(enBcv(8, BCV, USDT)).toBe(9.12);
    expect(enBcv(24, BCV, USDT)).toBe(27.36);
  });

  it('ida y vuelta: lo que se publica en BCV deja lo que se costeó en USDT', () => {
    const bcv = enBcv(24, BCV, USDT)!;
    expect(enUsdt(bcv, BCV, USDT)).toBeCloseTo(24, 2);
  });

  it('⚠️ da lo MISMO que la tabla «precio a cotizar» de la calculadora', () => {
    // Si divergen, la app diría dos precios distintos para la misma pieza en dos
    // pantallas. `adjustedBaseUsd` del perfil BCV es, por definición, esta cuenta.
    const eq = computeChargeEquivalents({
      baseUsd: 24,
      referenceLabel: RATE_LABELS.BINANCE,
      rates: [
        { label: RATE_LABELS.BINANCE, currencyCode: 'VES', rate: USDT },
        { label: RATE_LABELS.BCV_USD, currencyCode: 'VES', rate: BCV },
      ],
    });
    const perfilBcv = eq.profiles.find((p) => p.label === RATE_LABELS.BCV_USD)!;
    expect(enBcv(24, BCV, USDT)).toBeCloseTo(perfilBcv.adjustedBaseUsd, 2);
  });

  it('sin alguna tasa devuelve null, igual que enUsdt', () => {
    expect(enBcv(24, null, USDT)).toBeNull();
    expect(enBcv(24, BCV, 0)).toBeNull();
  });
});

describe('precioParaPublicar', () => {
  const BCV = 900;
  const USDT = 1026;
  /** La regla del dueño: hacia arriba, a 0,50. */
  const a50 = (v: number) => Math.ceil(v * 2) / 2;

  it('convierte PRIMERO y redondea después', () => {
    // 1.50 USDT → 1.71 BCV → 2.00 BCV. Redondeando antes quedaría en 1.50 y
    // publicaría 1.71, que no es redondo para nadie.
    const p = precioParaPublicar(1.5, BCV, USDT, a50);
    expect(p.bcv).toBe(2);
    expect(p.convertido).toBe(true);
  });

  it('lo que entra se mide sobre el precio YA redondeado', () => {
    // 2.00 BCV × 900 / 1026 = 1.75 USDT: el redondeo hacia arriba agregó plata y el
    // dueño tiene que verla, no el 1,50 que pidió.
    const p = precioParaPublicar(1.5, BCV, USDT, a50);
    expect(p.usdt).toBe(1.75);
    expect(p.usdt).toBeGreaterThan(1.5);
  });

  it('sin regla de redondeo publica la conversión exacta', () => {
    expect(precioParaPublicar(24, BCV, USDT).bcv).toBe(27.36);
  });

  it('sin tasas NO inventa: deja el precio costeado y lo declara', () => {
    const p = precioParaPublicar(1.5, null, USDT, a50);
    expect(p.convertido).toBe(false);
    expect(p.bcv).toBe(1.5);
    expect(p.usdt).toBe(1.5);
  });
});
