import { ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const ORG = 'org-A';
const AGOSTO = new Date('2026-08-01T00:00:00Z');

type Ficha = { id: string; organizationId: string; status: 'ACTIVE' | 'DISCONTINUED' };

function makePrisma() {
  return {
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'ACTIVE' } as Ficha | null),
      findMany: jest.fn().mockResolvedValue([] as unknown[]),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
    expense: { count: jest.fn().mockResolvedValue(0) },
    stockMonth: { findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null) },
    stockCount: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([] as unknown[]),
    },
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new MaterialsService(prisma as never);

/**
 * Borrar una ficha: solo si no tiene historial (2026-09-14). `Expense→Material` es
 * `onDelete: SetNull` (borrarla deja compras huérfanas) y `StockCount→Material` es
 * `Cascade` (borrarla borra conteos). Con historial, se descontinúa.
 */
describe('MaterialsService.remove', () => {
  it('una ficha con una compra no se borra', async () => {
    const prisma = makePrisma();
    prisma.expense.count.mockResolvedValue(1);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(intento).rejects.toThrow('Descontinuala en vez de borrarla');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('una ficha con un conteo, aunque el mes esté abierto, no se borra', async () => {
    const prisma = makePrisma();
    prisma.stockCount.count.mockResolvedValue(1);

    await expect(service(prisma).remove(ORG, 'm1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('cuenta compras y conteos de esa ficha en la organización del token', async () => {
    const prisma = makePrisma();

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.expense.count).toHaveBeenCalledWith({ where: { materialId: 'm1', organizationId: ORG } });
    expect(prisma.stockCount.count).toHaveBeenCalledWith({ where: { materialId: 'm1', organizationId: ORG } });
  });

  it('sin compras ni conteos se borra', async () => {
    const prisma = makePrisma();

    await expect(service(prisma).remove(ORG, 'm1')).resolves.toEqual({ ok: true });
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('una ficha de otra organización es 404', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue(null);

    await expect(service(prisma).remove(ORG, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('si ya está descontinuada, el 409 no sugiere descontinuarla', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'DISCONTINUED' });
    prisma.expense.count.mockResolvedValue(3);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toThrow('se conserva descontinuada');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });
});

/**
 * Al cotizar se avisa "0 al cierre de agosto" (2026-09-14): la ficha tiene fila de
 * conteo en el último mes cerrado con total 0 y no se volvió a comprar después.
 * "Tiene fila" prueba que existía al cierre (cerrar escribe TODAS las fichas); no
 * se usa `createdAt` porque las fichas se importaron después, con compras del 31/08.
 */
describe('MaterialsService.list — outAtLastClose', () => {
  const ficha = (id: string, expenses: { quantity: number | null; date: Date }[] = []) => ({ id, name: id, expenses });

  it('sin meses cerrados, ninguna avisa', async () => {
    const prisma = makePrisma();
    prisma.material.findMany.mockResolvedValue([ficha('m1')]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
    expect(prisma.stockCount.findMany).not.toHaveBeenCalled();
  });

  it('en 0 al cierre y sin compras después: avisa con el mes', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    // La compra del 31/08 es de ANTES del cierre: no cuenta como reposición.
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: 1, date: new Date('2026-08-31T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBe('2026-08');
  });

  it('con rollos al cierre no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1')]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 1 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
  });

  it('comprada después del cierre no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: 2, date: new Date('2026-09-01T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
  });

  it('una compra posterior sin cantidad no cuenta como reposición', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: null, date: new Date('2026-09-05T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBe('2026-08');
  });

  it('sin fila en el mes cerrado (se creó después) no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('nueva')]);

    const [nueva] = await service(prisma).list(ORG);

    expect(nueva.outAtLastClose).toBeNull();
  });

  it('lee el último mes cerrado y sus conteos, de la organización del token', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });

    await service(prisma).list(ORG);

    expect(prisma.stockMonth.findFirst.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
    expect(prisma.stockCount.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, month: AGOSTO },
    });
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } });
  });
});

/**
 * Corregir una ficha. Regresión de seguridad: una ficha de otra organización no se
 * puede tocar (IDOR). Ya estaba cubierto por `ensureOwned`; este test lo fija.
 */
describe('MaterialsService.update', () => {
  it('corrige una ficha propia con lo que llegó', async () => {
    const prisma = makePrisma();

    await service(prisma).update(ORG, 'm1', { name: 'PLA Negro', color: null });

    expect(prisma.material.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { name: 'PLA Negro', color: null } });
  });

  it('una ficha de otra organización es 404 y no se escribe', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG, status: 'ACTIVE' as const } : null),
    );

    await expect(service(prisma).update('org-B', 'm1', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.update).not.toHaveBeenCalled();
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
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG, status: 'ACTIVE' as const } : null),
    );

    await expect(service(prisma).setStatus('org-B', 'm1', { status: 'DISCONTINUED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});
