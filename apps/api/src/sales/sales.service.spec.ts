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

  describe('fromQuote', () => {
    it('lanza NotFound si el presupuesto no existe', async () => {
      prisma.quote.findFirst.mockResolvedValue(null);

      await expect(
        service.fromQuote(ORG, { quoteId: 'q-x', kind: 'ENCARGO' } as any),
      ).rejects.toThrow(new NotFoundException('Presupuesto no encontrado'));

      expect(prisma.quote.findFirst).toHaveBeenCalledWith({
        where: { id: 'q-x', organizationId: ORG },
      });
      expect(prisma.sale.create).not.toHaveBeenCalled();
    });

    it('registra el total del pedido guardado y arma clientId/quoteId/note', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-1',
        clientId: 'c-1',
        name: 'Llavero lote',
        quantity: 3,
        totals: { price: { final: 20 }, order: { units: 3, total: 60, profit: 30 } },
      });
      prisma.sale.create.mockResolvedValue({ id: 's-1' });

      await service.fromQuote(ORG, {
        quoteId: 'q-1',
        kind: 'ENCARGO',
        note: 'pedido especial',
      } as any);

      expect(prisma.sale.create).toHaveBeenCalledTimes(1);
      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.amount).toBe(60);
      expect(data.clientId).toBe('c-1');
      expect(data.quoteId).toBe('q-1');
      expect(data.note).toBe('pedido especial');
      expect(data.kind).toBe('ENCARGO');
      expect(data.organizationId).toBe(ORG);
      expect(data.date).toBeInstanceOf(Date);
      expect(data.exchangeRates).toEqual(SNAPSHOT);
    });

    it('sin total del pedido, usa el precio final por la cantidad', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-2',
        clientId: 'c-2',
        name: 'Único',
        quantity: 5,
        totals: { price: { final: 7 } },
      });
      prisma.sale.create.mockResolvedValue({ id: 's-2' });

      await service.fromQuote(ORG, { quoteId: 'q-2', kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.amount).toBe(35);
    });

    /**
     * Un presupuesto guardado antes de shared 0.7.0 trae `prices[]` y ningún
     * precio final. Caer al costo registraría una venta A PÉRDIDA sin avisar,
     * que es peor que no registrarla.
     */
    it('rechaza un snapshot anterior a 0.7.0 en vez de vender al costo', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-viejo',
        clientId: null,
        name: 'Formato viejo',
        quantity: 4,
        totals: { prices: [{ priceRounded: 20 }], costBatch: 50 },
      });

      await expect(
        service.fromQuote(ORG, { quoteId: 'q-viejo', kind: 'COUNTER' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.sale.create).not.toHaveBeenCalled();
    });

    it('sin ningún precio cae a costBatch', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-3',
        clientId: null,
        name: 'Sin precios',
        quantity: 4,
        totals: { costBatch: 123.45 },
      });
      prisma.sale.create.mockResolvedValue({ id: 's-3' });

      await service.fromQuote(ORG, { quoteId: 'q-3', kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.amount).toBe(123.45);
    });

    it('con totals null => amount 0', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-4',
        clientId: null,
        name: 'Nulo',
        quantity: 2,
        totals: null,
      });
      prisma.sale.create.mockResolvedValue({ id: 's-4' });

      await service.fromQuote(ORG, { quoteId: 'q-4', kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.amount).toBe(0);
    });

    it('usa quote.name como note cuando dto.note es undefined', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-5',
        clientId: 'c-5',
        name: 'Nombre del presupuesto',
        quantity: 1,
        totals: { price: { final: 9 } },
      });
      prisma.sale.create.mockResolvedValue({ id: 's-5' });

      await service.fromQuote(ORG, { quoteId: 'q-5', kind: 'COUNTER' } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.note).toBe('Nombre del presupuesto');
    });

    it('respeta dto.date si viene', async () => {
      prisma.quote.findFirst.mockResolvedValue({
        id: 'q-6',
        clientId: null,
        name: 'Con fecha',
        quantity: 1,
        totals: { price: { final: 1 } },
      });
      prisma.sale.create.mockResolvedValue({ id: 's-6' });

      await service.fromQuote(ORG, {
        quoteId: 'q-6',
        kind: 'COUNTER',
        date: '2026-01-15',
      } as any);

      const data = prisma.sale.create.mock.calls[0][0].data;
      expect(data.date).toEqual(new Date('2026-01-15'));
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
