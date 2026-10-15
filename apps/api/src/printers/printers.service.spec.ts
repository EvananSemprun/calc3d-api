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

/**
 * REPOSICIÓN: el ingreso es lo COBRADO (ventas + abonos), no lo facturado.
 *
 * Antes `recovery()` sumaba el total de TODOS los pedidos (incluso cotizados o
 * cancelados), así que contaba plata que no entró y daba un número distinto del
 * "Resultado de la operación" del Dashboard. Ahora usa `Σ Sale.amount +
 * Σ Payment.amount`, la misma definición del Dashboard.
 * Spec: docs/superpowers/specs/2026-10-14-reposicion-ingresos-cobrados-design.md
 */
describe('recovery(): ingresos cobrados, no facturados', () => {
  it('suma ventas + abonos (no los totales de los pedidos)', async () => {
    const prisma = {
      sale: { findMany: jest.fn().mockResolvedValue([{ amount: '100' }]) },
      // Hay pedidos facturados por más de lo abonado y uno COTIZADO sin abonos:
      // si se contaran los totales de pedidos el ingreso daría 170, no 135.
      payment: { findMany: jest.fn().mockResolvedValue([{ amount: '35' }]) },
      expense: { findMany: jest.fn().mockResolvedValue([{ amount: '40' }]) },
      printer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', name: 'A1', price: '200', createdAt: new Date('2026-01-01T00:00:00Z'), expenses: [] },
        ]),
      },
    };
    const res = await new PrintersService(prisma as never).recovery(ORG);

    // 100 de ventas + 35 de abonos = 135 (NO 170 = 100 + pedidos de 50 y 20).
    expect(res.income).toBe(135);
    expect(res.operatingExpenses).toBe(40);
    // 135 − 40 = 95 (la forma vieja habría dado 130).
    expect(res.accumulatedProfit).toBe(95);
    // Los gastos de reposición filtran inversión: isInvestment false.
    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isInvestment: false }) }),
    );
    // El ingreso sale de abonos, por organización.
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
    );
  });
});
