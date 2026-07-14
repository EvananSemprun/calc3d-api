import { planStatus } from './plan';

const NOW = new Date('2026-07-07T12:00:00Z').getTime();
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('planStatus', () => {
  it('TRIAL vigente: activo, cuenta días restantes del trial', () => {
    const s = planStatus({ plan: 'TRIAL', trialEndsAt: inDays(10), planExpiresAt: null }, NOW);
    expect(s.active).toBe(true);
    expect(s.isTrial).toBe(true);
    expect(s.daysLeft).toBe(10);
    expect(s.expired).toBe(false);
  });

  it('TRIAL vencido: solo lectura (expired)', () => {
    const s = planStatus({ plan: 'TRIAL', trialEndsAt: inDays(-1), planExpiresAt: null }, NOW);
    expect(s.active).toBe(false);
    expect(s.expired).toBe(true);
    expect(s.daysLeft).toBe(0);
  });

  it('plan pagado vigente usa planExpiresAt, no trialEndsAt', () => {
    const s = planStatus({ plan: 'TALLER', trialEndsAt: inDays(-30), planExpiresAt: inDays(20) }, NOW);
    expect(s.active).toBe(true);
    expect(s.isTrial).toBe(false);
    expect(s.daysLeft).toBe(20);
  });

  it('plan pagado vencido: solo lectura', () => {
    const s = planStatus({ plan: 'PRO', trialEndsAt: null, planExpiresAt: inDays(-2) }, NOW);
    expect(s.active).toBe(false);
    expect(s.expired).toBe(true);
  });

  it('sin fecha límite: vencido (no activo por defecto)', () => {
    expect(planStatus({ plan: 'TRIAL', trialEndsAt: null, planExpiresAt: null }, NOW).active).toBe(false);
  });

  it('el último día (deadline futuro por horas) sigue activo y daysLeft ≥ 1', () => {
    const s = planStatus({ plan: 'TRIAL', trialEndsAt: inDays(0.5), planExpiresAt: null }, NOW);
    expect(s.active).toBe(true);
    expect(s.daysLeft).toBe(1);
  });
});
