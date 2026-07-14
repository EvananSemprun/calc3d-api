import { NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';

/** Prisma mockeado: cada método usado por el servicio es un jest.fn() plano. */
function makePrisma() {
  return {
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

const ORG = 'org-1';

describe('ExpensesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExpensesService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExpensesService(prisma as any);
  });

  describe('list (dateWhere)', () => {
    it('trata las fechas date-only como UTC: gte = inicio y lte = fin del día EN UTC', () => {
      prisma.expense.findMany.mockReturnValue([]);

      service.list(ORG, '2026-07-01', '2026-07-06');

      const where = prisma.expense.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG);
      expect(where.date.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      // El fin del día debe calcularse en UTC (no en hora local del servidor):
      // en UTC-4, sin zona daría 2026-07-07T03:59:59.999Z e incluiría gastos
      // del día siguiente.
      expect(where.date.lte.toISOString()).toBe('2026-07-06T23:59:59.999Z');
    });

    it('sin from/to no aplica filtro por fecha', () => {
      prisma.expense.findMany.mockReturnValue([]);

      service.list(ORG);

      const where = prisma.expense.findMany.mock.calls[0][0].where;
      expect(where.date).toBeUndefined();
    });
  });

  describe('create', () => {
    it('mapea materialId vacío a null y siempre pasa include con los 3 links', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e-1' });

      await service.create(ORG, {
        date: '2026-06-01',
        category: 'FILAMENT',
        description: 'Rollo PLA',
        amount: 25,
        isInvestment: false,
        quantity: 2,
        materialId: '',
      } as any);

      expect(prisma.expense.create).toHaveBeenCalledTimes(1);
      const call = prisma.expense.create.mock.calls[0][0];
      expect(call.data.materialId).toBeNull();
      expect(call.data.quantity).toBe(2);
      expect(call.data.organizationId).toBe(ORG);
      expect(call.data.date).toEqual(new Date('2026-06-01'));
      // include con los links polimórficos + proveedor
      expect(call.include).toEqual({
        material: { select: { id: true, name: true } },
        printer: { select: { id: true, name: true } },
        component: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
      });
    });

    it('mapea quantity undefined a null', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e-2' });

      await service.create(ORG, {
        date: '2026-06-02',
        category: 'GENERAL',
        description: 'Gasto general',
        amount: 10,
        isInvestment: false,
      } as any);

      const call = prisma.expense.create.mock.calls[0][0];
      expect(call.data.quantity).toBeNull();
      expect(call.data.materialId).toBeNull();
      expect(call.data.printerId).toBeNull();
      expect(call.data.componentId).toBeNull();
    });
  });

  describe('update', () => {
    it('lanza NotFound si el gasto no es del org', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG, 'e-x', { amount: 99 } as any),
      ).rejects.toThrow(new NotFoundException('Gasto no encontrado'));
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });

    it('aplica solo los campos presentes (spread condicional)', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'e-3', organizationId: ORG });
      prisma.expense.update.mockResolvedValue({ id: 'e-3' });

      await service.update(ORG, 'e-3', { amount: 42 } as any);

      const call = prisma.expense.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'e-3' });
      expect(call.data).toEqual({ amount: 42 });
    });
  });

  describe('remove', () => {
    it('lanza NotFound si el gasto no es del org', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG, 'e-x')).rejects.toThrow(
        new NotFoundException('Gasto no encontrado'),
      );
      expect(prisma.expense.delete).not.toHaveBeenCalled();
    });

    it('borra el gasto si es del org', async () => {
      prisma.expense.findFirst.mockResolvedValue({ id: 'e-4', organizationId: ORG });
      prisma.expense.delete.mockResolvedValue({ id: 'e-4' });

      const res = await service.remove(ORG, 'e-4');

      expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'e-4' } });
      expect(res).toEqual({ ok: true });
    });
  });
});

/** Arnés del cliente transaccional: cada modelo expone create/findFirst/update. */
function makeTx() {
  return {
    material: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    printer: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    component: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    expense: { create: jest.fn() },
  };
}
function makePrismaTx(tx: ReturnType<typeof makeTx>) {
  return { $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
}

describe('ExpensesService.createWithDefinition', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: ReturnType<typeof makePrismaTx>;
  let service: ExpensesService;

  beforeEach(() => {
    tx = makeTx();
    prisma = makePrismaTx(tx);
    service = new ExpensesService(prisma as any);
  });

  it("modo 'new' kind material: crea la definición con organizationId y enlaza el gasto", async () => {
    tx.material.create.mockResolvedValue({ id: 'mat-1' });
    tx.expense.create.mockResolvedValue({ id: 'e-new' });

    await service.createWithDefinition(ORG, {
      expense: {
        date: '2026-06-19',
        amount: 25,
        category: 'CONSUMABLE',
        description: 'Rollo PLA',
        isInvestment: false,
        quantity: 1,
      },
      link: {
        kind: 'material',
        mode: 'new',
        data: { name: 'PLA Rojo', rollPrice: 25, rollGrams: 1000 },
      },
    } as any);

    const matCall = tx.material.create.mock.calls[0][0];
    expect(matCall.data.organizationId).toBe(ORG);
    expect(matCall.data.name).toBe('PLA Rojo');

    const expCall = tx.expense.create.mock.calls[0][0];
    expect(expCall.data.materialId).toBe('mat-1');
    expect(expCall.data.amount).toBe(25);
    expect(expCall.data.organizationId).toBe(ORG);
  });

  it("modo 'existing' kind printer con referencia: actualiza el precio y enlaza el gasto", async () => {
    tx.printer.findFirst.mockResolvedValue({ id: 'pr-1', organizationId: ORG });
    tx.printer.update.mockResolvedValue({ id: 'pr-1' });
    tx.expense.create.mockResolvedValue({ id: 'e-exist' });

    await service.createWithDefinition(ORG, {
      expense: {
        date: '2026-06-19',
        amount: 300,
        category: 'EQUIPMENT',
        description: 'Compra impresora',
        isInvestment: true,
      },
      link: {
        kind: 'printer',
        mode: 'existing',
        id: 'pr-1',
        referenceField: 'price',
        referenceValue: 300,
      },
    } as any);

    expect(tx.printer.update).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { price: 300 },
    });

    const expCall = tx.expense.create.mock.calls[0][0];
    expect(expCall.data.printerId).toBe('pr-1');
    expect(expCall.data.isInvestment).toBe(true);
  });

  it("modo 'existing' con id ajeno (findFirst null) → NotFoundException", async () => {
    tx.printer.findFirst.mockResolvedValue(null);

    await expect(
      service.createWithDefinition(ORG, {
        expense: {
          date: '2026-06-19',
          amount: 300,
          category: 'EQUIPMENT',
          description: 'Compra impresora',
          isInvestment: true,
        },
        link: { kind: 'printer', mode: 'existing', id: 'pr-x' },
      } as any),
    ).rejects.toThrow(NotFoundException);

    expect(tx.expense.create).not.toHaveBeenCalled();
  });
});
