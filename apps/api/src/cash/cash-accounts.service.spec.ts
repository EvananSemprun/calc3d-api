import { ConflictException, NotFoundException } from '@nestjs/common';
import { CashAccountsService } from './cash-accounts.service';

const ORG = 'org-A';
const service = (p: unknown) => new CashAccountsService(p as never);

const CUENTA = {
  name: 'Banco',
  kind: 'BANK' as const,
  currency: 'USD',
  shared: false,
  sharedWithId: null,
  autoAttributeShortfall: false,
  active: true,
};

function makePrisma() {
  const p = {
    cashAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'acc1', organizationId: ORG, name: 'Binance' }),
      create: jest.fn().mockResolvedValue({ id: 'acc2' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(2),
    },
    counterparty: { findFirst: jest.fn().mockResolvedValue({ id: 'cp1' }) },
    cashReconciliation: { count: jest.fn().mockResolvedValue(0) },
    // ⚠️ El callback recibe EL MISMO mock: si recibiera `undefined`, la única
    // forma de que el test pase sería que el servicio escriba con `this.prisma`
    // adentro de la transacción, que es justamente el bug (las dos escrituras
    // dejarían de ser atómicas y la organización podría quedar con cero cuentas
    // principales, o con dos).
    $transaction: jest.fn(),
  };
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p));
  return p;
}

describe('CashAccountsService', () => {
  it('lista solo las de la organización', async () => {
    const p = makePrisma();
    await service(p).list(ORG);

    expect(p.cashAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
  });

  it('la primera cuenta nace como principal; la segunda no', async () => {
    const p = makePrisma();
    p.cashAccount.count = jest.fn().mockResolvedValue(0);
    await service(p).create(ORG, CUENTA);
    expect(p.cashAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
    );

    const q = makePrisma();
    q.cashAccount.count = jest.fn().mockResolvedValue(1);
    await service(q).create(ORG, CUENTA);
    expect(q.cashAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
    );
  });

  it('⚠️ la contraparte de una cuenta compartida tiene que ser de la MISMA organización', async () => {
    const p = makePrisma();
    p.counterparty.findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      service(p).create(ORG, { ...CUENTA, shared: true, sharedWithId: 'cp-ajena' }),
    ).rejects.toThrow(NotFoundException);
    expect(p.counterparty.findFirst).toHaveBeenCalledWith({
      where: { id: 'cp-ajena', organizationId: ORG },
    });
    expect(p.cashAccount.create).not.toHaveBeenCalled();
  });

  it('dejar de compartir borra con quién y apaga la atribución', async () => {
    const p = makePrisma();

    await service(p).update(ORG, 'acc1', {
      ...CUENTA,
      shared: false,
      sharedWithId: 'cp1',
      autoAttributeShortfall: true,
    });

    expect(p.cashAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shared: false,
          sharedWithId: null,
          autoAttributeShortfall: false,
        }),
      }),
    );
  });

  it('crear nunca acepta organizationId del cuerpo', async () => {
    const p = makePrisma();

    await service(p).create(ORG, { ...CUENTA, organizationId: 'org-B' } as never);

    expect(p.cashAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG }) }),
    );
  });

  it('NO borra una cuenta con conciliaciones: 409 que sugiere desactivarla', async () => {
    const p = makePrisma();
    p.cashReconciliation.count = jest.fn().mockResolvedValue(2);

    await expect(service(p).remove(ORG, 'acc1')).rejects.toThrow(ConflictException);
    expect(p.cashAccount.delete).not.toHaveBeenCalled();
  });

  it('NO borra la única cuenta: la conciliación la necesita', async () => {
    const p = makePrisma();
    p.cashAccount.count = jest.fn().mockResolvedValue(1);

    await expect(service(p).remove(ORG, 'acc1')).rejects.toThrow(ConflictException);
    expect(p.cashAccount.delete).not.toHaveBeenCalled();
  });

  it('una cuenta sin conciliaciones y con otra al lado sí se borra', async () => {
    const p = makePrisma();

    await service(p).remove(ORG, 'acc1');

    expect(p.cashAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc1' } });
  });

  it('marcar principal desmarca la anterior, DENTRO de la transacción', async () => {
    const p = makePrisma();

    await service(p).setDefault(ORG, 'acc2');

    expect(p.$transaction).toHaveBeenCalled();
    expect(p.cashAccount.updateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, isDefault: true },
      data: { isDefault: false },
    });
  });

  it('una cuenta de otra organización no se toca: 404 (IDOR)', async () => {
    const p = makePrisma();
    p.cashAccount.findFirst = jest.fn().mockResolvedValue(null);

    await expect(service(p).update(ORG, 'acc-ajena', CUENTA)).rejects.toThrow(NotFoundException);
    expect(p.cashAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-ajena', organizationId: ORG },
    });
    expect(p.cashAccount.update).not.toHaveBeenCalled();
  });
});
