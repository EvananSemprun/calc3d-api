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
    expense: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
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

/**
 * El mantenimiento por hora se DERIVA (repuestos ÷ horas leídas), como la hoja
 * Costeo. Antes era un campo a mano que quedó en cero mientras se compraban
 * repuestos: la calculadora cobraba $0 de mantenimiento.
 */
describe('PrintersService — mantenimiento por hora derivado', () => {
  function conLecturas(horasPorMaquina: number[], repuestos: number | null) {
    return {
      printer: {
        findMany: jest.fn().mockResolvedValue(
          horasPorMaquina.map((h, i) => ({
            id: `p${i}`,
            name: `m${i}`,
            maintPerHour: '0',
            readings: h ? [{ hours: String(h) }] : [],
          })),
        ),
      },
      expense: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: repuestos } }) },
    };
  }

  it('reparte todos los repuestos entre las horas de todas las máquinas', async () => {
    const prisma = conLecturas([2413, 357], 122);
    const lista = await new PrintersService(prisma as never).list(ORG);

    expect(lista[0].maintPerHour).toBeCloseTo(0.044043, 6);
    expect(lista[1].maintPerHour).toBeCloseTo(0.044043, 6);
    expect(lista[0].maintPerHourDerived).toBe(true);
    // Solo los gastos de mantenimiento de ESTA organización.
    expect(prisma.expense.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, category: 'MAINTENANCE' } }),
    );
  });

  it('sin ninguna lectura usa la tarifa escrita a mano en la ficha', async () => {
    const prisma = conLecturas([0], 122);
    (prisma.printer.findMany as jest.Mock).mockResolvedValue([
      { id: 'p0', name: 'm0', maintPerHour: '0.05', readings: [] },
    ]);
    const lista = await new PrintersService(prisma as never).list(ORG);

    expect(lista[0].maintPerHour).toBe(0.05);
    expect(lista[0].maintPerHourDerived).toBe(false);
  });
});
