import { DIAS_NUEVO, esNuevo } from './novedad';

/**
 * La insignia «Nuevo» se DERIVA de cuándo se publicó la ficha. Spec:
 * `docs/superpowers/specs/2026-11-08-tres-tipos-de-banner-design.md` (misma tanda).
 */
describe('esNuevo', () => {
  const HOY = '2026-11-08';
  // Un instante, no una fecha de negocio: lleva hora.
  const alMediodia = (dia: string) => new Date(`${dia}T16:00:00Z`);

  it('recién publicada es nueva', () => {
    expect(esNuevo(alMediodia('2026-11-08'), HOY)).toBe(true);
  });

  it('el día 14 todavía, el 15 ya no', () => {
    // El borde, con números a mano: 15 días es el primero que NO.
    expect(esNuevo(alMediodia('2026-10-25'), HOY)).toBe(true); // 14 días
    expect(esNuevo(alMediodia('2026-10-24'), HOY)).toBe(false); // 15 días
    expect(DIAS_NUEVO).toBe(15);
  });

  it('una ficha vieja no es nueva', () => {
    // El caso real del llavero: 78 días.
    expect(esNuevo(alMediodia('2026-08-22'), HOY)).toBe(false);
  });

  it('sin fecha de publicación NO es nueva', () => {
    // Una ficha que nunca se publicó no puede ser nueva para nadie.
    expect(esNuevo(null, HOY)).toBe(false);
    expect(esNuevo(undefined, HOY)).toBe(false);
  });

  it('una fecha futura cuenta como recién publicada, no revienta', () => {
    expect(esNuevo(alMediodia('2026-11-20'), HOY)).toBe(true);
  });

  it('una fecha ilegible devuelve false en vez de tumbar la vitrina', () => {
    expect(esNuevo('no es una fecha', HOY)).toBe(false);
  });

  it('el instante se lee en hora de Venezuela, no en UTC', () => {
    // 2026-11-09T02:00Z son las 22:00 del 8 en Caracas. Leído en UTC sería el 9, y con
    // `hoy` en el 8 la ficha quedaría publicada "mañana". Son las dos clases de fecha
    // del proyecto: un instante se lee con businessDateKey.
    expect(esNuevo(new Date('2026-11-09T02:00:00Z'), HOY)).toBe(true);
  });
});
