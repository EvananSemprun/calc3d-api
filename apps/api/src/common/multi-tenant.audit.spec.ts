import { NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.module';
import { ProductsService } from '../products/products.module';
import { ClientsService } from '../clients/clients.module';

/**
 * Auditoría multi-tenant: cada lectura por id DEBE filtrar también por
 * `organizationId`, de modo que una organización NUNCA pueda leer un recurso de
 * otra aunque adivine su id. Estos tests fijan ese contrato: si alguien quita el
 * scope por organización, el test se cae.
 */
const ORG = 'org-A';
const OTHER = 'org-B';
const ratesMock = { snapshotJson: jest.fn().mockResolvedValue(undefined) };

describe('Aislamiento multi-tenant (scope por organizationId)', () => {
  it('OrdersService.get filtra por { id, organizationId }', async () => {
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1', lines: [], payments: [] }) },
    };
    const service = new OrdersService(prisma as any, ratesMock as any);
    await service.get(ORG, 'o1');
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', organizationId: ORG } }),
    );
  });

  it('OrdersService.get NO devuelve un pedido de otra organización', async () => {
    // Simula la DB real: si el id no pertenece a la org, findFirst no lo encuentra.
    const prisma = {
      order: {
        findFirst: jest.fn(({ where }: any) =>
          where.organizationId === OTHER ? { id: 'o1', lines: [], payments: [] } : null,
        ),
      },
    };
    const service = new OrdersService(prisma as any, ratesMock as any);
    await expect(service.get(ORG, 'o1')).rejects.toThrow(NotFoundException);
  });

  it('ProductsService.get filtra por { id, organizationId }', async () => {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProductsService(prisma as any, ratesMock as any);
    await expect(service.get(ORG, 'p1')).rejects.toThrow(NotFoundException);
    expect(prisma.product.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', organizationId: ORG } });
  });

  it('ClientsService.get filtra por { id, organizationId }', async () => {
    const prisma = {
      client: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ClientsService(prisma as any);
    await expect(service.get(ORG, 'c1')).rejects.toThrow(NotFoundException);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', organizationId: ORG } });
  });
});
