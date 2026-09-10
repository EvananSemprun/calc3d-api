import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesService } from './sales.service';

/** Prisma mockeado: cada método usado por el servicio es un jest.fn() plano. */
function makePrisma() {
  return {
    quote: { findFirst: jest.fn() },
    sale: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

const ORG = 'org-1';

const SNAPSHOT = { VES: { rate: 667.05, source: 'MANUAL', at: '2026-07-06T12:00:00.000Z' } };

/** ExchangeRatesService mockeado: solo snapshotJson(), que es lo que usa Sales. */
function makeRates() {
  return { snapshotJson: jest.fn().mockResolvedValue(SNAPSHOT) };
}

describe('SalesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let rates: ReturnType<typeof makeRates>;
  let service: SalesService;

  beforeEach(() => {
    prisma = makePrisma();
    rates = makeRates();
    service = new SalesService(prisma as any, rates as any);
  });

  describe('list (dateWhere)', () => {
    it('trata las fechas date-only como UTC: gte = inicio y lte = fin del día EN UTC', () => {
      prisma.sale.findMany.mockReturnValue([]);

      service.list(ORG, '2026-07-01', '2026-07-06');

      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG);
      expect(where.date.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      // El límite superior debe ser el fin del día EN UTC, no en la hora local
      // del servidor. En un servidor al oeste de UTC (p. ej. UTC-4) parsear
      // `${to}T23:59:59.999` sin zona da 2026-07-07T03:59:59.999Z e incluye
      // ventas del día siguiente (guardadas como medianoche UTC).
      expect(where.date.lte.toISOString()).toBe('2026-07-06T23:59:59.999Z');
    });

    it('sin from/to no aplica filtro por fecha', () => {
      prisma.sale.findMany.mockReturnValue([]);

      service.list(ORG);

      const where = prisma.sale.findMany.mock.calls[0][0].where;
      expect(where.date).toBeUndefined();
    });
  });

  describe('create', () => {
    it('congela el snapshot de tasas al registrar la venta', async () => {
      prisma.sale.create.mockResolvedValue({ id: 's-new' });

      await service.create(ORG, { date: '2026-07-06', amount: 10, kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.exchangeRates).toEqual(SNAPSHOT);
    });

    it('sin tasas registradas guarda la venta sin snapshot', async () => {
      rates.snapshotJson.mockResolvedValue(undefined);
      prisma.sale.create.mockResolvedValue({ id: 's-new' });

      await service.create(ORG, { date: '2026-07-06', amount: 10, kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.exchangeRates).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('lanza NotFound si ensureOwned no encuentra la venta', async () => {
      prisma.sale.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG, 's-x')).rejects.toThrow(
        new NotFoundException('Venta no encontrada'),
      );
      expect(prisma.sale.delete).not.toHaveBeenCalled();
    });

    it('borra la venta si es del org', async () => {
      prisma.sale.findFirst.mockResolvedValue({ id: 's-1', organizationId: ORG });
      prisma.sale.delete.mockResolvedValue({ id: 's-1' });

      const res = await service.remove(ORG, 's-1');

      expect(prisma.sale.findFirst).toHaveBeenCalledWith({
        where: { id: 's-1', organizationId: ORG },
      });
      expect(prisma.sale.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
      expect(res).toEqual({ ok: true });
    });
  });
});
