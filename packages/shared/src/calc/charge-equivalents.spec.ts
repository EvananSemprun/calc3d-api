import { computeChargeEquivalents, RATE_LABELS } from './charge-equivalents';

/** Atajo para armar una tasa. */
const r = (label: string, rate: number, currencyCode = 'VES') => ({ label, currencyCode, rate });

describe('computeChargeEquivalents', () => {
  it('caso 1: ref=alt (1000/1000) → precio ajustado = base', () => {
    const out = computeChargeEquivalents({
      baseUsd: 1,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ALT', 1000)],
    });
    expect(out.targetVes).toBe(1000);
    const alt = out.profiles.find((p) => p.label === 'ALT')!;
    expect(alt.adjustedBaseUsd).toBeCloseTo(1, 4);
    expect(alt.shortfallVes).toBeCloseTo(0, 4);
  });

  it('caso 2: ref=1000 alt=666.66 → ajustado ≈ 1.5', () => {
    const out = computeChargeEquivalents({
      baseUsd: 1,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ALT', 666.66)],
    });
    const alt = out.profiles.find((p) => p.label === 'ALT')!;
    expect(alt.adjustedBaseUsd).toBeCloseTo(1.5, 2);
  });

  it('caso 3: ref=1000 alt=400 → ajustado = 2.5', () => {
    const out = computeChargeEquivalents({
      baseUsd: 1,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ALT', 400)],
    });
    const alt = out.profiles.find((p) => p.label === 'ALT')!;
    expect(alt.adjustedBaseUsd).toBeCloseTo(2.5, 4);
  });

  it('caso 4: base=10 ref=1000 alt=400 → ajustado=25, objetivo=10000', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ALT', 400)],
    });
    expect(out.targetVes).toBe(10000);
    const alt = out.profiles.find((p) => p.label === 'ALT')!;
    expect(alt.adjustedBaseUsd).toBeCloseTo(25, 4);
    expect(alt.plainVes).toBeCloseTo(4000, 4); // 10 × 400 sin ajustar
    expect(alt.shortfallVes).toBeCloseTo(6000, 4); // 10000 − 4000
  });

  it('caso 5: tasa 0 → no disponible, sin dividir entre 0', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ROTA', 0)],
    });
    const rota = out.profiles.find((p) => p.label === 'ROTA')!;
    expect(rota.available).toBe(false);
    expect(Number.isFinite(rota.adjustedBaseUsd)).toBe(true);
    expect(rota.adjustedBaseUsd).toBe(10); // cae al precio base, no Infinity
    expect(rota.plainVes).toBe(0);
    expect(rota.shortfallVes).toBe(0);
  });

  it('la tasa de referencia no tiene faltante (shortfall = 0) y se marca isReference', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: 'REF',
      rates: [r('REF', 1000), r('ALT', 400)],
    });
    const ref = out.profiles.find((p) => p.label === 'REF')!;
    expect(ref.isReference).toBe(true);
    expect(ref.shortfallVes).toBeCloseTo(0, 4);
    expect(ref.adjustedBaseUsd).toBeCloseTo(10, 4);
  });

  it('tasa alterna MAYOR que la referencia → ajustado < base y faltante negativo (recibirías de más)', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: 'REF',
      rates: [r('REF', 400), r('ALTA', 1000)],
    });
    const alta = out.profiles.find((p) => p.label === 'ALTA')!;
    expect(alta.adjustedBaseUsd).toBeCloseTo(4, 4); // 4000 / 1000
    expect(alta.shortfallVes).toBeCloseTo(-6000, 4); // 4000 − 10000
  });

  it('sin referencia usable → sin objetivo; los perfiles caen al precio base', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: null,
      rates: [r('BCV', 400)],
    });
    expect(out.targetVes).toBeNull();
    expect(out.referenceLabel).toBeNull();
    const bcv = out.profiles.find((p) => p.label === 'BCV')!;
    expect(bcv.adjustedBaseUsd).toBe(10);
    expect(bcv.shortfallVes).toBe(0);
    expect(bcv.plainVes).toBeCloseTo(4000, 4);
  });

  it('referenceLabel que no existe entre las tasas → sin protección', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: 'NO_EXISTE',
      rates: [r('BCV', 400)],
    });
    expect(out.referenceLabel).toBeNull();
    expect(out.targetVes).toBeNull();
  });

  it('escenario real: precio $10, Binance 700 ref, BCV 400 → recomienda cobrar más en BCV', () => {
    const out = computeChargeEquivalents({
      baseUsd: 10,
      referenceLabel: RATE_LABELS.BINANCE,
      rates: [r(RATE_LABELS.BINANCE, 700), r(RATE_LABELS.BCV_USD, 400)],
    });
    expect(out.targetVes).toBe(7000);
    const bcv = out.profiles.find((p) => p.label === RATE_LABELS.BCV_USD)!;
    expect(bcv.adjustedBaseUsd).toBeCloseTo(17.5, 4); // 7000 / 400
    expect(bcv.shortfallVes).toBeCloseTo(3000, 4); // 7000 − 4000
    const bin = out.profiles.find((p) => p.label === RATE_LABELS.BINANCE)!;
    expect(bin.shortfallVes).toBeCloseTo(0, 4);
  });
});
