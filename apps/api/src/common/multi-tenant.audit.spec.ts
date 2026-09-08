import { NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.module';
import { StoreService } from '../store/store.service';
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
const storageMock = { configured: false, publicUrl: jest.fn() };
const recostMock = { loadCatalog: jest.fn(), recost: jest.fn().mockResolvedValue(null) };

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

  // El catálogo de tienda es el producto interno desde 2026-09-07, y además es
  // lo que alimenta la vitrina pública: su scope importa más que ninguno.
  it('StoreService.get filtra por { id, organizationId }', async () => {
    const prisma = {
      storeProduct: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new StoreService(prisma as any, storageMock as any, recostMock as any);
    await expect(service.get(ORG, 'p1')).rejects.toThrow(NotFoundException);
    expect(prisma.storeProduct.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', organizationId: ORG } }),
    );
  });

  it('StoreService.get NO devuelve una ficha de otra organización', async () => {
    const prisma = {
      storeProduct: {
        findFirst: jest.fn(({ where }: any) =>
          where.organizationId === OTHER ? { id: 'p1', images: [], optionGroups: [] } : null,
        ),
      },
    };
    const service = new StoreService(prisma as any, storageMock as any, recostMock as any);
    await expect(service.get(ORG, 'p1')).rejects.toThrow(NotFoundException);
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
