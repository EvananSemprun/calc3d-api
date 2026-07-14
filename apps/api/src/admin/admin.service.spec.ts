import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.module';
import { PlanService } from '../plan/plan.module';

function makePrisma() {
  return {
    paymentReport: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    organization: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
}
const mail = { sendNotice: jest.fn().mockResolvedValue(undefined) };
const REPORT = (over = {}) => ({
  id: 'pr1',
  organizationId: 'org-1',
  plan: 'TALLER',
  months: 1,
  status: 'PENDING',
  organization: { id: 'org-1', name: 'Taller X', members: [{ user: { email: 'due@x.com' } }] },
  ...over,
});

describe('AdminService.reviewPayment', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let plan: PlanService;
  let service: AdminService;

  beforeEach(() => {
    prisma = makePrisma();
    plan = new PlanService(prisma as any);
    jest.spyOn(plan, 'extend').mockResolvedValue(new Date('2026-08-07T00:00:00Z'));
    service = new AdminService(prisma as any, plan, mail as any);
    mail.sendNotice.mockClear();
  });

  it('aprobar un reporte PENDIENTE extiende el plan y lo marca APPROVED', async () => {
    prisma.paymentReport.findUnique.mockResolvedValue(REPORT());
    const out = await service.reviewPayment('pr1', 'admin-1', { action: 'approve' });
    expect(plan.extend).toHaveBeenCalledWith('org-1', 'TALLER', 1);
    expect(prisma.paymentReport.update.mock.calls[0][0].data.status).toBe('APPROVED');
    expect(out).toMatchObject({ ok: true, plan: 'TALLER' });
    expect(mail.sendNotice).toHaveBeenCalled(); // avisa al taller
  });

  it('NO se puede aprobar dos veces (idempotente): un reporte ya revisado da conflicto', async () => {
    prisma.paymentReport.findUnique.mockResolvedValue(REPORT({ status: 'APPROVED' }));
    await expect(service.reviewPayment('pr1', 'admin-1', { action: 'approve' })).rejects.toThrow(
      ConflictException,
    );
    expect(plan.extend).not.toHaveBeenCalled(); // no vuelve a dar tiempo
  });

  it('rechazar marca REJECTED y no toca el plan', async () => {
    prisma.paymentReport.findUnique.mockResolvedValue(REPORT());
    await service.reviewPayment('pr1', 'admin-1', { action: 'reject', note: 'no cuadra la referencia' });
    expect(plan.extend).not.toHaveBeenCalled();
    expect(prisma.paymentReport.update.mock.calls[0][0].data.status).toBe('REJECTED');
  });

  it('reporte inexistente → NotFound', async () => {
    prisma.paymentReport.findUnique.mockResolvedValue(null);
    await expect(service.reviewPayment('x', 'admin-1', { action: 'approve' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PlanService.extend (acumula sobre lo que queda)', () => {
  it('renovar cuando aún queda plan SUMA sobre el vencimiento futuro, no desde hoy', async () => {
    const future = new Date(Date.now() + 20 * 86_400_000); // vence en 20 días
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ planExpiresAt: future }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const plan = new PlanService(prisma as any);
    await plan.extend('org-1', 'TALLER', 1);
    const saved = prisma.organization.update.mock.calls[0][0].data.planExpiresAt as Date;
    // base = vencimiento futuro (no hoy) + 1 mes → claramente > 30 días desde hoy
    expect(saved.getTime()).toBeGreaterThan(Date.now() + 40 * 86_400_000);
  });
});
