import { ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const ORG = 'org-A';
const AGOSTO = new Date('2026-08-01T00:00:00Z');

function makePrisma() {
  return {
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG } as { id: string } | null),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
    stockMonth: { findMany: jest.fn().mockResolvedValue([] as { month: Date }[]) },
    stockCount: { findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null) },
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new MaterialsService(prisma as never);

/**
 * Borrar una ficha borra en CASCADA sus conteos: sin esta guarda, un mes cerrado
 * se podría modificar borrando la ficha. Regresión de seguridad del cierre mensual.
 */
describe('MaterialsService.remove', () => {
  it('una ficha con conteos en un mes cerrado no se borra', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);
    prisma.stockCount.findFirst.mockResolvedValue({ month: AGOSTO });

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(intento).rejects.toThrow('agosto de 2026');
    // Desde que el panel deja descontinuar, el mensaje sugiere esa salida.
    await expect(intento).rejects.toThrow('Descontinuala en vez de borrarla');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('busca conteos de esa ficha solo en los meses cerrados', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.stockMonth.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
    });
    expect(prisma.stockCount.findFirst.mock.calls[0][0]).toMatchObject({
      where: { materialId: 'm1', month: { in: [AGOSTO] } },
    });
    expect(prisma.stockCount.findFirst.mock.calls[0][0]).toMatchObject({
      orderBy: { month: 'desc' },
    });
  });

  it('con meses cerrados pero sin conteos de esa ficha, se borra', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);

    await expect(service(prisma).remove(ORG, 'm1')).resolves.toEqual({ ok: true });
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('sin meses cerrados se borra como siempre', async () => {
    const prisma = makePrisma();

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.stockCount.findFirst).not.toHaveBeenCalled();
    expect(prisma.material.delete).toHaveBeenCalled();
  });

  it('una ficha de otra organización sigue siendo 404', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue(null);

    await expect(service(prisma).remove(ORG, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('si ya está descontinuada, el 409 no sugiere descontinuarla', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'DISCONTINUED' } as never);
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);
    prisma.stockCount.findFirst.mockResolvedValue({ month: AGOSTO });

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(intento).rejects.toThrow('Ya está descontinuada');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });
});

/**
 * Descontinuar o reactivar una ficha. Regresión de seguridad: una ficha de otra
 * organización no se puede tocar (IDOR).
 */
describe('MaterialsService.setStatus', () => {
  it('descontinúa una ficha propia', async () => {
    const prisma = makePrisma();

    await service(prisma).setStatus(ORG, 'm1', { status: 'DISCONTINUED' });

    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'DISCONTINUED' },
    });
  });

  it('reactiva una ficha propia', async () => {
    const prisma = makePrisma();

    await service(prisma).setStatus(ORG, 'm1', { status: 'ACTIVE' });

    expect(prisma.material.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'ACTIVE' } });
  });

  it('una ficha de otra organización es 404 y no se escribe', async () => {
    const prisma = makePrisma();
    // Simula la base: 'm1' existe solo en org-A.
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG } : null),
    );

    await expect(service(prisma).setStatus('org-B', 'm1', { status: 'DISCONTINUED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});
