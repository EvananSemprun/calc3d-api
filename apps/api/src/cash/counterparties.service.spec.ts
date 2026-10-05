import { ConflictException, NotFoundException } from '@nestjs/common';
import { CounterpartiesService } from './counterparties.service';

const ORG = 'org-A';
const service = (p: unknown) => new CounterpartiesService(p as never);
const NUEVA = { name: 'Ana', kind: 'PARTNER' as const, active: true, notes: null };

function makePrisma() {
  const p = {
    counterparty: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'cp1', organizationId: ORG, kind: 'PARTNER', name: 'Ana' }),
      create: jest.fn().mockResolvedValue({ id: 'cp2' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(2),
    },
    ownerMovement: { count: jest.fn().mockResolvedValue(0) },
    cashAccount: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  };
  // El callback de una transacción SIEMPRE recibe un cliente, y las escrituras
  // de adentro tienen que usarlo (si usaran `this.prisma` se saldrían de la
  // transacción). Le pasamos el mismo mock para poder verificarlas.
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p));
  return p;
}

describe('CounterpartiesService', () => {
  it('lista solo las de la organización', async () => {
    const p = makePrisma();
    await service(p).list(ORG);

    expect(p.counterparty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
  });

  it('la primera contraparte de una organización nace por defecto', async () => {
    const p = makePrisma();
    p.counterparty.count = jest.fn().mockResolvedValue(0);

    await service(p).create(ORG, NUEVA);

    expect(p.counterparty.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
    );
  });

  it('la segunda NO nace por defecto: el índice único parcial solo admite una', async () => {
    const p = makePrisma();
    p.counterparty.count = jest.fn().mockResolvedValue(1);

    await service(p).create(ORG, NUEVA);

    expect(p.counterparty.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
    );
  });

  it('crear nunca acepta organizationId del cuerpo', async () => {
    const p = makePrisma();

    await service(p).create(ORG, { ...NUEVA, organizationId: 'org-B' } as never);

    expect(p.counterparty.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG }) }),
    );
  });

  it('marcar una por defecto desmarca la anterior, en una transacción', async () => {
    const p = makePrisma();

    await service(p).setDefault(ORG, 'cp2');

    expect(p.$transaction).toHaveBeenCalled();
    expect(p.counterparty.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, isDefault: true },
      data: { isDefault: false },
    });
  });

  it('NO borra una contraparte con movimientos: 409 que sugiere desactivarla', async () => {
    const p = makePrisma();
    p.ownerMovement.count = jest.fn().mockResolvedValue(3);

    await expect(service(p).remove(ORG, 'cp1')).rejects.toThrow(ConflictException);
    expect(p.counterparty.delete).not.toHaveBeenCalled();
  });

  it('NO borra la contraparte de una cuenta compartida: 409', async () => {
    const p = makePrisma();
    p.cashAccount.count = jest.fn().mockResolvedValue(1);

    await expect(service(p).remove(ORG, 'cp1')).rejects.toThrow(ConflictException);
    expect(p.counterparty.delete).not.toHaveBeenCalled();
  });

  it('NO borra la ÚNICA contraparte propietaria: la caja la necesita', async () => {
    const p = makePrisma();
    p.counterparty.findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'cp1', organizationId: ORG, kind: 'OWNER', name: 'Ana' });
    p.counterparty.count = jest.fn().mockResolvedValue(1);

    await expect(service(p).remove(ORG, 'cp1')).rejects.toThrow(ConflictException);
    expect(p.counterparty.delete).not.toHaveBeenCalled();
  });

  it('una contraparte SIN historial sí se borra', async () => {
    const p = makePrisma();

    await service(p).remove(ORG, 'cp1');

    expect(p.counterparty.delete).toHaveBeenCalledWith({ where: { id: 'cp1' } });
  });

  it('una contraparte de otra organización no se toca: 404 (IDOR)', async () => {
    const p = makePrisma();
    p.counterparty.findFirst = jest.fn().mockResolvedValue(null);

    await expect(service(p).update(ORG, 'cp-ajena', NUEVA)).rejects.toThrow(NotFoundException);
    expect(p.counterparty.findFirst).toHaveBeenCalledWith({
      where: { id: 'cp-ajena', organizationId: ORG },
    });
    expect(p.counterparty.update).not.toHaveBeenCalled();
  });
});
