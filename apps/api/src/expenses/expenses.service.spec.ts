import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    material: { update: jest.fn(), updateMany: jest.fn() },
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

  /**
   * "La última compra manda": el precio del rollo con el que se cotiza sale de
   * lo que costó reponerlo la última vez. Lo calcula el SERVIDOR — si dependiera
   * de una casilla del formulario, el día que se olvide se sigue cotizando con
   * el precio de hace seis meses, que es como se pierde margen sin notarlo.
   */
  describe('create — el precio del rollo lo fija el servidor', () => {
    it('una compra de filamento fija el precio del rollo y reactiva la ficha', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e1' });

      await service.create(ORG, {
        date: '2026-09-07',
        category: 'CONSUMABLE',
        description: 'Compra PLA',
        amount: 40,
        isInvestment: false,
        quantity: 2,
        materialId: 'm1',
      } as any);

      // Regresión de IDOR: la escritura sobre la ficha filtra por la organización
      // del token; con un materialId ajeno, updateMany no encuentra nada.
      expect(prisma.material.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', organizationId: ORG },
        data: { rollPrice: 20, status: 'ACTIVE' }, // 40 ÷ 2 rollos; comprarla la vuelve a activa
      });
      expect(prisma.material.update).not.toHaveBeenCalled();
    });

    it('sin cantidad no se puede saber el precio por rollo: no lo toca', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e2' });

      await service.create(ORG, {
        date: '2026-09-07',
        category: 'CONSUMABLE',
        description: 'Ajuste',
        amount: 40,
        isInvestment: false,
        materialId: 'm1',
      } as any);

      expect(prisma.material.update).not.toHaveBeenCalled();
      expect(prisma.material.updateMany).not.toHaveBeenCalled();
    });

    it('un gasto que no es de filamento no toca ningún catálogo', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e3' });

      await service.create(ORG, {
        date: '2026-09-07',
        category: 'OTHER',
        description: 'Internet',
        amount: 30,
        isInvestment: false,
        quantity: 1,
      } as any);

      expect(prisma.material.update).not.toHaveBeenCalled();
      expect(prisma.material.updateMany).not.toHaveBeenCalled();
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

  it("modo 'existing' kind material con rollos: fija el precio y la reactiva", async () => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });
    tx.expense.create.mockResolvedValue({ id: 'e-mat' });

    await service.createWithDefinition(ORG, {
      expense: {
        date: '2026-09-13',
        amount: 50,
        category: 'CONSUMABLE',
        description: 'Recompra PLA',
        isInvestment: false,
        quantity: 2,
      },
      link: { kind: 'material', mode: 'existing', id: 'mat-9' },
    } as any);

    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-9' },
      data: { rollPrice: 25, status: 'ACTIVE' },
    });
  });

  /**
   * Regresión de seguridad: `referenceField` viaja en el body. Solo puede ser el
   * precio de ESE tipo de ficha y con un valor no negativo; si no, cualquier
   * campo numérico (gramos del rollo, vida útil, unidades por paquete) se
   * escribiría sin las reglas de su schema.
   */
  it.each([
    ['material', 'rollGrams', 0],
    ['material', 'status', 1],
    ['material', 'organizationId', 1],
    ['printer', 'lifetimeHours', 0],
    ['component', 'unitsPerPackage', 0],
    ['material', 'price', 10], // el precio de OTRO tipo de ficha
  ])("modo 'existing' kind %s con referenceField '%s' → 400 y no escribe nada", async (kind, field, value) => {
    const delegate = tx[kind as 'material' | 'printer' | 'component'];
    delegate.findFirst.mockResolvedValue({ id: 'x-1', organizationId: ORG });

    await expect(
      service.createWithDefinition(ORG, {
        expense: { date: '2026-09-13', amount: 10, category: 'CONSUMABLE', description: 'x', isInvestment: false },
        link: { kind, mode: 'existing', id: 'x-1', referenceField: field, referenceValue: value },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(delegate.update).not.toHaveBeenCalled();
    expect(tx.expense.create).not.toHaveBeenCalled();
  });

  it("modo 'existing' con el precio de su tipo pero negativo → 400", async () => {
    tx.printer.findFirst.mockResolvedValue({ id: 'pr-1', organizationId: ORG });

    await expect(
      service.createWithDefinition(ORG, {
        expense: { date: '2026-09-13', amount: 10, category: 'EQUIPMENT', description: 'x', isInvestment: true },
        link: { kind: 'printer', mode: 'existing', id: 'pr-1', referenceField: 'price', referenceValue: -5 },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.printer.update).not.toHaveBeenCalled();
  });
});
