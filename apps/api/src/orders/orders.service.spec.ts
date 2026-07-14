import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.module';

function makePrisma() {
  return {
    order: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
}

const ratesMock = { snapshotJson: jest.fn().mockResolvedValue(undefined) };
const ORG = 'org-1';

const lines = [{ description: 'Llavero', quantity: 200, unit: 'u', unitPrice: 1.5 }]; // total 300

describe('OrdersService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: OrdersService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new OrdersService(prisma as any, ratesMock as any);
    ratesMock.snapshotJson.mockClear();
  });

  describe('list / get — derivan total, abonado y saldo', () => {
    it('list agrega total/paid/balance por pedido', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'o1', lines, payments: [{ amount: '100' }, { amount: '50' }] },
      ]);
      const out = await service.list(ORG);
      expect(out[0].total).toBe(300);
      expect(out[0].paid).toBe(150);
      expect(out[0].balance).toBe(150);
    });

    it('get lanza NotFound si el pedido no existe', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.get(ORG, 'x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create — correlativo por organización y snapshot de tasa', () => {
    it('asigna code = max(code)+1 y congela las tasas', async () => {
      prisma.order.findFirst.mockResolvedValue({ code: 7 }); // último correlativo
      ratesMock.snapshotJson.mockResolvedValue({ VES: { rate: 667, source: 'MANUAL', at: 'x' } });
      prisma.order.create.mockResolvedValue({ id: 'o-new' });

      await service.create(ORG, { clientId: 'c1', status: 'QUOTED', lines } as any);

      const data = prisma.order.create.mock.calls[0][0].data;
      expect(data.code).toBe(8);
      expect(data.organizationId).toBe(ORG);
      expect(data.exchangeRates).toEqual({ VES: { rate: 667, source: 'MANUAL', at: 'x' } });
    });

    it('el primer pedido de la organización arranca en code 1', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      prisma.order.create.mockResolvedValue({ id: 'o1' });
      await service.create(ORG, { clientId: 'c1', status: 'QUOTED', lines: [] } as any);
      expect(prisma.order.create.mock.calls[0][0].data.code).toBe(1);
    });
  });

  describe('abonos', () => {
    it('addPayment crea el pago con organizationId y devuelve el pedido con saldo', async () => {
      prisma.order.findFirst
        .mockResolvedValueOnce({ id: 'o1', organizationId: ORG }) // ensureOwned
        .mockResolvedValueOnce({ id: 'o1', lines, payments: [{ amount: '120' }] }); // get
      prisma.payment.create.mockResolvedValue({});

      const out = await service.addPayment(ORG, 'o1', { date: '2026-07-06', amount: 120 } as any);

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: { orderId: 'o1', organizationId: ORG, date: expect.any(Date), amount: 120, note: null },
      });
      expect(out.balance).toBe(180); // 300 - 120
    });

    it('removePayment lanza NotFound si el abono no es del pedido/org', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      await expect(service.removePayment(ORG, 'o1', 'p-x')).rejects.toThrow(NotFoundException);
      expect(prisma.payment.delete).not.toHaveBeenCalled();
    });
  });
});
