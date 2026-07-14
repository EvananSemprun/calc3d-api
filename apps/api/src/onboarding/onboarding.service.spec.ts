import { OnboardingService } from './onboarding.module';

function makePrisma() {
  return {
    material: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    printer: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    component: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
}

const ORG = 'org-1';

describe('OnboardingService.seedTemplates', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: OnboardingService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new OnboardingService(prisma as any);
  });

  it('con catálogo vacío siembra todas las plantillas', async () => {
    const out = await service.seedTemplates(ORG);
    expect(out.created.materials).toBe(4); // PLA, PETG, ABS, TPU
    expect(out.created.printers).toBe(1);
    expect(out.created.components).toBe(2);
    // Se ejecuta en una sola transacción con 7 creaciones.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(7);
  });

  it('es idempotente por nombre: no duplica lo que ya existe (case-insensitive)', async () => {
    prisma.material.findMany.mockResolvedValue([{ name: 'pla' }, { name: 'PETG' }]);
    const out = await service.seedTemplates(ORG);
    expect(out.created.materials).toBe(2); // solo ABS y TPU
    expect(out.skipped.materials).toBe(2); // PLA y PETG ya estaban
  });

  it('con todo ya sembrado no crea nada', async () => {
    prisma.material.findMany.mockResolvedValue([
      { name: 'PLA' }, { name: 'PETG' }, { name: 'ABS' }, { name: 'TPU' },
    ]);
    prisma.printer.findMany.mockResolvedValue([{ name: 'Impresora FDM (genérica)' }]);
    prisma.component.findMany.mockResolvedValue([
      { name: 'Argolla de llavero' }, { name: 'Bolsa de empaque' },
    ]);
    const out = await service.seedTemplates(ORG);
    expect(out.created).toEqual({ materials: 0, printers: 0, components: 0 });
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(0);
  });
});
