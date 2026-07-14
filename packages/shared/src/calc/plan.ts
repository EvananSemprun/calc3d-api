/**
 * Estado de plan de una organización (Fase 7 SaaS). PURO y testeable.
 *
 * La fecha límite vigente es `trialEndsAt` en TRIAL o `planExpiresAt` en un plan
 * pagado. El plan está ACTIVO mientras esa fecha sea futura; vencido = solo lectura.
 */
export type PlanTier = 'TRIAL' | 'TALLER' | 'PRO';

export interface PlanInput {
  plan: PlanTier;
  trialEndsAt: string | Date | null;
  planExpiresAt: string | Date | null;
}

export interface PlanState {
  tier: PlanTier;
  isTrial: boolean;
  /** true si puede ESCRIBIR (crear/editar). false = solo lectura. */
  active: boolean;
  expired: boolean;
  /** Días completos que faltan para vencer (0 si ya venció o no hay fecha). */
  daysLeft: number;
  /** Fecha límite vigente en ISO, o null. */
  deadline: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(d: string | Date | null): number | null {
  if (!d) return null;
  const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function planStatus(org: PlanInput, now: number = Date.now()): PlanState {
  const isTrial = org.plan === 'TRIAL';
  const deadlineMs = toMs(isTrial ? org.trialEndsAt : org.planExpiresAt);
  const active = deadlineMs !== null && deadlineMs > now;
  const daysLeft = deadlineMs !== null ? Math.max(0, Math.ceil((deadlineMs - now) / DAY_MS)) : 0;
  return {
    tier: org.plan,
    isTrial,
    active,
    expired: !active,
    daysLeft,
    deadline: deadlineMs !== null ? new Date(deadlineMs).toISOString() : null,
  };
}
