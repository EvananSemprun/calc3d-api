import { PaymentCreateSchema } from './api';

const ok = (v: unknown) => PaymentCreateSchema.safeParse(v).success;
const motivos = (v: unknown) => {
  const r = PaymentCreateSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

const base = { date: '2026-11-07' };

describe('PaymentCreateSchema — abono en USD', () => {
  it('acepta el camino de siempre', () => {
    expect(ok({ ...base, amount: 7.6 })).toBe(true);
    expect(ok({ ...base, amount: 7.6, note: 'adelanto' })).toBe(true);
  });

  it('sin monto no pasa', () => {
    expect(ok(base)).toBe(false);
  });

  it('un monto en cero o negativo no pasa', () => {
    expect(ok({ ...base, amount: 0 })).toBe(false);
    expect(ok({ ...base, amount: -5 })).toBe(false);
  });

  it('una fecha que no existe en el calendario no pasa', () => {
    expect(ok({ date: '2026-02-30', amount: 10 })).toBe(false);
  });
});

describe('PaymentCreateSchema — abono en otra moneda', () => {
  const enBs = { ...base, currencyLabel: 'BCV Euro', rate: 250, amountForeign: 1900 };

  it('acepta moneda + tasa + monto en esa moneda', () => {
    expect(ok(enBs)).toBe(true);
  });

  /**
   * ⚠️ EL TEST DE SEGURIDAD: el USD lo calcula el servidor. Si el cuerpo
   * pudiera traerlo, cualquiera acreditaría lo que quisiera diciendo que pagó
   * en bolívares — mass-assignment de dinero, el mismo agujero que el saldo en
   * el registro público.
   */
  it('RECHAZA el monto en USD junto con la moneda', () => {
    expect(ok({ ...enBs, amount: 999999 })).toBe(false);
    expect(motivos({ ...enBs, amount: 999999 }).join(' ')).toMatch(/lo calcula el servidor/);
  });

  it('los tres campos van juntos o no va ninguno', () => {
    expect(ok({ ...base, currencyLabel: 'BCV Euro' })).toBe(false);
    expect(ok({ ...base, rate: 250 })).toBe(false);
    expect(ok({ ...base, amountForeign: 1900 })).toBe(false);
    expect(ok({ ...base, currencyLabel: 'BCV Euro', rate: 250 })).toBe(false);
    expect(ok({ ...base, rate: 250, amountForeign: 1900 })).toBe(false);
  });

  /**
   * ⚠️ Una tasa en cero haría una división por cero y el monto saldría
   * infinito; una negativa acreditaría un abono en negativo. Se cierra acá,
   * antes de que el servicio divida.
   */
  it('una tasa en cero o negativa no pasa', () => {
    expect(ok({ ...enBs, rate: 0 })).toBe(false);
    expect(ok({ ...enBs, rate: -250 })).toBe(false);
  });

  it('un monto en esa moneda en cero o negativo no pasa', () => {
    expect(ok({ ...enBs, amountForeign: 0 })).toBe(false);
    expect(ok({ ...enBs, amountForeign: -1900 })).toBe(false);
  });

  it('una moneda sin nombre no pasa', () => {
    expect(ok({ ...enBs, currencyLabel: '' })).toBe(false);
  });
});
