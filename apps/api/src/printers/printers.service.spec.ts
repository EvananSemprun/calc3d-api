import { PrintersService } from './printers.module';

const ORG = 'org-A';

function makePrisma() {
  return {
    printer: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'p1',
          name: 'a1',
          lifetimeHours: 5000,
          maintPerHour: '0.05',
          expenses: [],
          readings: [
            { month: new Date('2026-07-01T00:00:00Z'), hours: '100' },
            { month: new Date('2026-08-01T00:00:00Z'), hours: '130' },
          ],
        },
      ]),
    },
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new PrintersService(prisma as never);

/**
 * El servidor corre en UTC y el negocio en Venezuela (UTC−4): "el mes en curso"
 * se decide en hora de Caracas. Con UTC, desde las 20:00 del último día del mes
 * el servidor ya creía estar en el mes siguiente.
 */
describe('PrintersService.usage — mes en curso', () => {
  it('el 31/08 a las 22:00 de Caracas (ya 1/09 en UTC) sigue siendo agosto', async () => {
    const r = await service(makePrisma()).usage(ORG, new Date('2026-09-01T02:00:00Z'));

    expect(r.month).toBe('2026-08');
    // Las horas del mes son las de agosto (130 − 100), no las de un septiembre sin lectura.
    expect(r.printers[0].hoursThisMonth).toBe(30);
  });

  it('a las 00:00 de Caracas del 1/09 ya es septiembre', async () => {
    const r = await service(makePrisma()).usage(ORG, new Date('2026-09-01T04:00:00Z'));

    expect(r.month).toBe('2026-09');
  });
});
