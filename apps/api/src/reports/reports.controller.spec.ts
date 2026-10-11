import { ReportsController, ReportsService } from './reports.module';

/**
 * El nombre del archivo lleva la fecha de HOY en hora de Venezuela: con UTC,
 * un reporte bajado a las 22:00 del 31/08 salía fechado el 1/09.
 */
describe('ReportsController.excel — nombre del archivo', () => {
  afterEach(() => jest.useRealTimers());

  const descargar = async () => {
    const service = { workbook: jest.fn().mockResolvedValue({ xlsx: { write: jest.fn() } }) };
    const res = { setHeader: jest.fn(), end: jest.fn() };
    await new ReportsController(service as never).excel({ organizationId: 'org-A' } as never, res as never);
    return res.setHeader.mock.calls.find(([h]) => h === 'Content-Disposition')?.[1] as string;
  };

  it('a las 22:00 de Caracas del 31/08 (ya 1/09 en UTC) sale fechado el 31/08', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T02:00:00Z'));

    await expect(descargar()).resolves.toBe('attachment; filename="reporte-2026-08-31.xlsx"');
  });
});

/**
 * LA HOJA "Deuda" DEL EXCEL — y la cuarta definición del mismo saldo.
 *
 * El reporte existe para ser la SALIDA de la app, así que arma cada hoja
 * reusando los servicios de las pantallas en vez de repetir las cuentas (lo
 * dice su propio comentario de cabecera). La hoja Deuda se salía de esa regla:
 * tenía su propio `loanBalance(l.principal, l.payments)` sobre TODAS las
 * cuotas, incluidas las **anuladas**, mientras `LoansService` ya le entregaba
 * `balance` y `paid` calculados sobre las vigentes. Resultado: el Excel decía
 * que se debía MENOS de lo que se debe — el mismo defecto que tenía Caja.
 *
 * Números A MANO: capital 750, una cuota vigente de 100 y una ANULADA de 50.
 *   saldo = **650** · pagado = **$100.00**
 * El contrafáctico (la anulada contada como pagada) es **600**, que es
 * exactamente lo que devolvía antes.
 */
describe('ReportsService.workbook — la hoja Deuda no recalcula el saldo', () => {
  const pago = (id: string, amount: number, voidedAt: string | null) => ({
    id,
    date: new Date('2026-09-05').toISOString(),
    amount,
    reference: `REF-${id}`,
    counterpartyId: null,
    counterparty: null,
    accountId: null,
    generatesDebt: false,
    source: 'MANUAL',
    voidedAt,
    voidReason: voidedAt ? 'Se cargó dos veces' : null,
  });

  /** El préstamo tal como lo serializa `LoansService`: con su saldo YA hecho. */
  const prestamo = (balance: number, paid: number, pagos: ReturnType<typeof pago>[]) => ({
    id: 'p1',
    name: 'Deuda impresora P2S',
    concept: null,
    principal: 750,
    installmentTarget: 100,
    paymentFrequency: 'MONTHLY' as const,
    counterparty: { id: 'cp3', name: 'Señor Edwin', kind: 'EXTERNAL_LENDER' },
    nextDueDate: null,
    startDate: null,
    closedAt: null,
    notes: null,
    printer: null,
    payments: pagos,
    paid,
    balance,
    progress: 0,
    status: 'ACTIVO' as const,
    estimate: { atTarget: null, atActualPace: null, actualPace: null, unit: 'MONTHLY' as const },
  });

  /** Todo vacío salvo los préstamos: lo único que esta hoja tiene que decir. */
  const hojaDeuda = async (prestamos: ReturnType<typeof prestamo>[]) => {
    const vacio = { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) };
    const service = new ReportsService(
      {
        organization: { findFirst: jest.fn().mockResolvedValue({ name: 'Banano Lab' }) },
        settings: { findFirst: jest.fn().mockResolvedValue(null) },
        sale: vacio, order: vacio, expense: vacio, client: vacio, campaign: vacio,
      } as never,
      { purchases: async () => [], lastClosedMonth: async () => null, stock: async () => [] } as never,
      { list: async () => ({ months: [] }) } as never,
      { list: async () => prestamos } as never,
      {
        recovery: async () => ({ accumulatedProfit: 0, rows: [], freeCapital: 0 }),
        usage: async () => ({
          printers: [],
          total: { jobs: 0, unmeasuredJobs: 0, printersWithoutReading: 0 },
        }),
      } as never,
      {
        summary: async () => ({
          balance: {
            collected: 0, expenses: 0, filament: 0, equipment: 0,
            contributionsRefundable: 0, contributionsCapital: 0,
            debtRepayments: 0, ownerDraws: 0, loanPayments: 0, balance: 0,
          },
          counterparty: { id: 'cp1', name: 'Propietario', kind: 'OWNER' },
          financing: { rows: [], owedToOwner: 0, owedToLender: 650, totalOwed: 650, overWithdrawn: 0 },
          obligations: [],
          movements: [],
          reconciliations: [],
        }),
      } as never,
    );

    const wb = await service.workbook('org-A');
    const ws = wb.getWorksheet('Deuda')!;
    const filas: unknown[][] = [];
    ws.eachRow((r: { values: unknown }) => filas.push((r.values as unknown[]).slice(1)));
    return filas;
  };

  const vigente = () => pago('c1', 100, null);
  const anulada = () => pago('c2', 50, '2026-09-20T00:00:00.000Z');

  it('el saldo es el que trae el servicio: 650, no los 600 de recalcular', async () => {
    const filas = await hojaDeuda([prestamo(650, 100, [vigente(), anulada()])]);
    const saldo = filas.find((f) => f[0] === '   Saldo pendiente')!;

    expect(saldo[2]).toBe(650);
    expect(saldo[3]).toBe('Pagado $100.00');
  });

  /**
   * ⚠️ EL CONTRAFÁCTICO: con las dos cuotas vigentes el servicio dice 600 y la
   * hoja tiene que decir 600. Sin esto, una hoja que imprimiera siempre el
   * capital pasaría el test de arriba.
   */
  it('CONTRAFÁCTICO: si ninguna está anulada, el servicio dice 600 y la hoja también', async () => {
    const dosVigentes = [vigente(), { ...anulada(), voidedAt: null, voidReason: null }];
    const filas = await hojaDeuda([prestamo(600, 150, dosVigentes)]);
    const saldo = filas.find((f) => f[0] === '   Saldo pendiente')!;

    expect(saldo[2]).toBe(600);
    expect(saldo[3]).toBe('Pagado $150.00');
  });

  /**
   * La cuota anulada NO se esconde —el historial tiene que mostrar que
   * existió— pero tampoco puede verse igual que una pagada: su monto no está
   * en el "Saldo pendiente" de abajo, así que sin la marca la columna de montos
   * no suma lo que dice el total y la hoja se contradice a sí misma.
   */
  it('la cuota anulada sigue en la hoja, pero marcada y con su motivo', async () => {
    const filas = await hojaDeuda([prestamo(650, 100, [vigente(), anulada()])]);
    const pagos = filas.filter((f) => String(f[0]).includes('pago'));

    expect(pagos).toHaveLength(2);
    expect(pagos[0]).toMatchObject({ 0: '   pago', 3: 'REF-c1' });
    expect(pagos[1][0]).toBe('   pago ANULADO');
    expect(pagos[1][3]).toBe('ANULADA: Se cargó dos veces');
  });
});
