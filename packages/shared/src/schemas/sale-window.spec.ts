import { SettingsUpdateSchema } from './api';

describe('SettingsUpdateSchema — ventana de Flash Sale', () => {
  const base = {
    saleTitle: 'Oferta de octubre',
    saleStartsAt: '2026-10-20T22:00:00.000Z',
    saleEndsAt: '2026-10-27T03:59:00.000Z',
  };

  it('acepta una ventana válida', () => {
    expect(SettingsUpdateSchema.safeParse(base).success).toBe(true);
  });

  it('acepta null en los tres (limpiar la ventana)', () => {
    const r = SettingsUpdateSchema.safeParse({
      saleTitle: null,
      saleStartsAt: null,
      saleEndsAt: null,
    });
    expect(r.success).toBe(true);
  });

  it('acepta que no vengan (update parcial de otros campos)', () => {
    expect(SettingsUpdateSchema.safeParse({ kwhPrice: 0.1 }).success).toBe(true);
  });

  it('rechaza fin <= inicio', () => {
    const r = SettingsUpdateSchema.safeParse({
      ...base,
      saleEndsAt: base.saleStartsAt, // igual al inicio
    });
    expect(r.success).toBe(false);
  });

  it('no rompe si viene solo una de las dos fechas', () => {
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: base.saleStartsAt }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ saleEndsAt: base.saleEndsAt }).success).toBe(true);
  });

  it('rechaza una fecha que no es ISO datetime', () => {
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: 'ayer' }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: '2026-10-20' }).success).toBe(false);
  });
});
