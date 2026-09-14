import { ReportsController } from './reports.module';

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
