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
    counterparty: { findFirst: jest.fn(), findMany: jest.fn() },
    client: { findFirst: jest.fn(), create: jest.fn() },
  };
}

const ORG = 'org-1';
const OTRA_ORG = 'org-2';

/**
 * Las contrapartes de las DOS organizaciones en una sola tabla, y un mock que
 * filtra por TODAS las claves del `where` — no solo por el id.
 *
 * ⚠️ Un mock que devolviera siempre la fila pedida haría pasar el test de
 * aislamiento con y sin el filtro por organización: mediría el mock, no el
 * servicio.
 */
const CONTRAPARTES = [
  // La socia va PRIMERA a propósito: si el servicio se olvidara del
  // `orderBy: isDefault desc`, un gasto del panel viejo se le atribuiría a ella.
  { id: 'cp-socio', organizationId: ORG, name: 'Socia', kind: 'PARTNER', isDefault: false, active: true, createdAt: 2 },
  { id: 'cp-dueno', organizationId: ORG, name: 'Propietario', kind: 'OWNER', isDefault: true, active: true, createdAt: 1 },
  { id: 'cp-edwin', organizationId: ORG, name: 'Señor Edwin', kind: 'EXTERNAL_LENDER', isDefault: false, active: true, createdAt: 3 },
  { id: 'cp-ajena', organizationId: OTRA_ORG, name: 'Ajena', kind: 'OWNER', isDefault: true, active: true, createdAt: 1 },
];

const coincide = (fila: Record<string, any>, where: Record<string, any>) =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in v ? (v.in as string[]).includes(fila[k]) : fila[k] === v,
  );

/** El `orderBy` de Prisma, aplicado de verdad: si no, el servicio podría no tenerlo. */
const ordenar = (filas: any[], orderBy: Record<string, 'asc' | 'desc'>[] = []) =>
  [...filas].sort((a, b) => {
    for (const criterio of orderBy) {
      const [k, dir] = Object.entries(criterio)[0];
      const peso = (v: unknown) => (typeof v === 'boolean' ? Number(v) : (v as number));
      const d = peso(a[k]) - peso(b[k]);
      if (d !== 0) return dir === 'desc' ? -d : d;
    }
    return 0;
  });

function conContrapartes(prisma: ReturnType<typeof makePrisma>, filas = CONTRAPARTES) {
  prisma.counterparty.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(filas.find((f) => coincide(f, where)) ?? null),
  );
  prisma.counterparty.findMany.mockImplementation(({ where, orderBy }: any) =>
    Promise.resolve(ordenar(filas.filter((f) => coincide(f, where)), orderBy)),
  );
}

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
      // include con los links polimórficos + proveedor + quién lo pagó
      expect(call.include).toEqual({
        material: { select: { id: true, name: true } },
        printer: { select: { id: true, name: true } },
        component: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        counterparty: { select: { id: true, name: true, kind: true } },
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
    /**
     * El servicio ya no mira la compra que acaba de escribir sino **la última
     * por fecha**, así que el mock tiene que poder contestar esa consulta.
     * Devolver siempre la misma fila haría pasar el test incluso si el
     * servicio buscara cualquier otra cosa: por eso filtra por `materialId`.
     */
    const conUltimaCompra = (compras: Record<string, { amount: number; quantity: number }>) =>
      prisma.expense.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.materialId ? (compras[where.materialId] ?? null) : null),
      );

    it('una compra de filamento fija el precio del rollo y reactiva la ficha', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e1' });
      conUltimaCompra({ m1: { amount: 40, quantity: 2 } });

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

    it('sin NINGUNA compra con rollos se deja el precio que tenía', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e2' });
      conUltimaCompra({});

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
      conUltimaCompra({ m1: { amount: 40, quantity: 2 } });

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
   * Regresión de seguridad (2026-09-14): el precio del rollo sale SOLO de la compra
   * (monto ÷ rollos). Ni el "precio de referencia" ni `data.rollPrice` del body lo
   * pueden fijar a mano.
   */
  it("filamento existente: el precio de referencia del body se ignora", async () => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });
    tx.expense.create.mockResolvedValue({ id: 'e-mat' });

    await service.createWithDefinition(ORG, {
      expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false, quantity: 2 },
      link: { kind: 'material', mode: 'existing', id: 'mat-9', referenceField: 'rollPrice', referenceValue: 999 },
    } as any);

    expect(tx.material.update).toHaveBeenCalledTimes(1);
    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-9' },
      data: { rollPrice: 20, status: 'ACTIVE' },
    });
  });

  it('filamento nuevo: el rollPrice del body se pisa con el de la compra', async () => {
    tx.material.create.mockResolvedValue({ id: 'mat-1' });
    tx.expense.create.mockResolvedValue({ id: 'e-new' });

    await service.createWithDefinition(ORG, {
      expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false, quantity: 2 },
      link: { kind: 'material', mode: 'new', data: { name: 'PLA Rojo', rollPrice: 999, rollGrams: 1000 } },
    } as any);

    expect(tx.material.create.mock.calls[0][0].data.rollPrice).toBe(20);
  });

  it.each(['new', 'existing'])('filamento %s sin rollos → 400 y no escribe nada', async (mode) => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });

    await expect(
      service.createWithDefinition(ORG, {
        expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false },
        link: {
          kind: 'material',
          mode,
          id: mode === 'existing' ? 'mat-9' : null,
          data: mode === 'new' ? { name: 'PLA Rojo', rollGrams: 1000 } : null,
          referenceField: 'rollPrice',
          referenceValue: 40,
        },
      } as any),
    ).rejects.toThrow('Indicá cuántos rollos compraste');
    expect(tx.material.create).not.toHaveBeenCalled();
    expect(tx.material.update).not.toHaveBeenCalled();
    expect(tx.expense.create).not.toHaveBeenCalled();
  });

  /**
   * Regresión de seguridad: `referenceField` viaja en el body. Solo puede ser el
   * precio de ESE tipo de ficha y con un valor no negativo; si no, cualquier
   * campo numérico (vida útil, unidades por paquete) se escribiría sin las
   * reglas de su schema. En filamento el precio de referencia se ignora: lo fija
   * la compra.
   */
  it.each([
    ['printer', 'lifetimeHours', 0],
    ['printer', 'organizationId', 1],
    ['component', 'unitsPerPackage', 0],
    ['component', 'status', 1],
    ['printer', 'rollPrice', 10], // el precio de OTRO tipo de ficha
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

/**
 * QUIÉN PAGÓ: la contraparte, que es el único campo desde la migración
 * `20261010100000_adios_paidby`.
 *
 * Antes convivía con un enum `BUSINESS/OWNER/LOAN` que no distinguía socios.
 */
describe('ExpensesService — quién pagó', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExpensesService;

  const GASTO = {
    date: '2026-10-08',
    category: 'OTHER',
    description: 'Cinta',
    amount: 10,
    isInvestment: false,
  };
  const guardado = () => prisma.expense.create.mock.calls[0][0].data;

  beforeEach(() => {
    prisma = makePrisma();
    conContrapartes(prisma);
    prisma.expense.create.mockResolvedValue({ id: 'e-1' });
    prisma.expense.update.mockResolvedValue({ id: 'e-1' });
    prisma.expense.findFirst.mockResolvedValue({ id: 'e-1', organizationId: ORG });
    service = new ExpensesService(prisma as any);
  });

  /**
   * REGRESIÓN DE SEGURIDAD (IDOR): `counterpartyId` viaja en el body. Sin el
   * filtro por organización, el id de otro negocio ataría el gasto —y la deuda
   * que genera— a alguien de afuera.
   */
  it('una contraparte de OTRA organización → 404 y no escribe nada', async () => {
    await expect(
      service.create(ORG, { ...GASTO, counterpartyId: 'cp-ajena' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  // El hermano alcanzable: sin esto, el test de arriba pasaría igual con el
  // servicio rechazando SIEMPRE.
  it('la misma contraparte en MI organización sí se guarda', async () => {
    await service.create(ORG, { ...GASTO, counterpartyId: 'cp-dueno' } as any);
    expect(guardado().counterpartyId).toBe('cp-dueno');
  });

  it('un socio también puede poner la plata', async () => {
    await service.create(ORG, { ...GASTO, counterpartyId: 'cp-socio' } as any);
    expect(guardado().counterpartyId).toBe('cp-socio');
  });

  it('sin contraparte lo puso la caja y no se le debe a nadie', async () => {
    await service.create(ORG, { ...GASTO, counterpartyId: null } as any);
    expect(guardado().counterpartyId).toBeNull();
  });

  it('un PATCH que no habla de quién pagó no toca la contraparte', async () => {
    await service.update(ORG, 'e-1', { amount: 99 } as any);
    expect(prisma.expense.update.mock.calls[0][0].data).not.toHaveProperty('counterpartyId');
  });

  it('un PATCH de contraparte sí la cambia', async () => {
    await service.update(ORG, 'e-1', { counterpartyId: 'cp-edwin' } as any);
    expect(prisma.expense.update.mock.calls[0][0].data).toMatchObject({
      counterpartyId: 'cp-edwin',
    });
  });

  it('un PATCH con contraparte en null se la saca', async () => {
    await service.update(ORG, 'e-1', { counterpartyId: null } as any);
    expect(prisma.expense.update.mock.calls[0][0].data).toMatchObject({ counterpartyId: null });
  });
});

/**
 * EL PROVEEDOR, que desde 2026-10-09 es un contacto del directorio.
 *
 * Antes era una tabla aparte con su propia página, y el id del body se
 * escribía CRUDO: con el de otro negocio, el nombre de SU contacto salía a la
 * vista en Compras de filamento y en la hoja de Gastos del Excel.
 */
describe('ExpensesService — el proveedor', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExpensesService;

  const GASTO = {
    date: '2026-10-09',
    category: 'CONSUMABLE',
    description: 'Rollo',
    amount: 20,
    isInvestment: false,
  };
  const CONTACTOS = [
    { id: 'ct-strato', organizationId: ORG, name: 'StratoFill', type: 'SUPPLIER' },
    { id: 'ct-cliente', organizationId: ORG, name: 'Daelis Rivero', type: 'CLIENT' },
    { id: 'ct-ajeno', organizationId: OTRA_ORG, name: 'Proveedor ajeno', type: 'SUPPLIER' },
  ];
  const guardado = () => prisma.expense.create.mock.calls[0][0].data;

  /** Modela la base: filtra por TODAS las claves, incluido el `equals/insensitive`. */
  const coincideContacto = (fila: any, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'equals' in v
        ? String(fila[k]).toLowerCase() === String(v.equals).toLowerCase()
        : fila[k] === v,
    );

  beforeEach(() => {
    prisma = makePrisma();
    conContrapartes(prisma);
    prisma.expense.create.mockResolvedValue({ id: 'e-1' });
    prisma.expense.update.mockResolvedValue({ id: 'e-1' });
    prisma.expense.findFirst.mockResolvedValue({ id: 'e-1', organizationId: ORG });
    prisma.client.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(CONTACTOS.find((c) => coincideContacto(c, where)) ?? null),
    );
    prisma.client.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ct-nuevo', ...data }),
    );
    service = new ExpensesService(prisma as any);
  });

  it('un proveedor de OTRA organización → 404 y no escribe nada', async () => {
    await expect(
      service.create(ORG, { ...GASTO, providerId: 'ct-ajeno' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  // El hermano alcanzable: sin esto, lo de arriba pasaría con un servicio que
  // rechazara SIEMPRE.
  it('un proveedor de MI organización sí se guarda', async () => {
    await service.create(ORG, { ...GASTO, providerId: 'ct-strato' } as any);
    expect(guardado().providerId).toBe('ct-strato');
  });

  it('un contacto que NO es proveedor tampoco sirve', async () => {
    await expect(
      service.create(ORG, { ...GASTO, providerId: 'ct-cliente' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un nombre nuevo crea el contacto como proveedor y lo enlaza', async () => {
    await service.create(ORG, { ...GASTO, providerName: 'Filaven' } as any);

    expect(prisma.client.create).toHaveBeenCalledWith({
      data: { organizationId: ORG, name: 'Filaven', type: 'SUPPLIER' },
    });
    expect(guardado().providerId).toBe('ct-nuevo');
  });

  /** Si no, "StratoFill" y "stratofill" terminan siendo dos proveedores. */
  it('un nombre que ya existe con otras mayúsculas REUSA el contacto', async () => {
    await service.create(ORG, { ...GASTO, providerName: '  stratofill ' } as any);

    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(guardado().providerId).toBe('ct-strato');
  });

  it('un PATCH que no habla del proveedor no lo toca', async () => {
    await service.update(ORG, 'e-1', { amount: 5 } as any);
    expect(prisma.expense.update.mock.calls[0][0].data).not.toHaveProperty('providerId');
  });

  it('un PATCH con proveedor en null se lo saca', async () => {
    await service.update(ORG, 'e-1', { providerId: null } as any);
    expect(prisma.expense.update.mock.calls[0][0].data).toMatchObject({ providerId: null });
  });
});

/**
 * CORREGIR UNA COMPRA DE FILAMENTO.
 *
 * Una compra de filamento ES un gasto con `materialId`. Lo que se protege acá
 * es que el precio con el que se COTIZA siga a la última compra: antes,
 * arreglar un monto mal tipeado dejaba la calculadora con el precio viejo y
 * nadie se enteraba — exactamente la pérdida de margen silenciosa que la regla
 * "la última compra manda" vino a evitar.
 */
describe('ExpensesService — corregir y borrar una compra', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExpensesService;

  /** Las compras que hay en la base, por material, ya ordenadas por fecha. */
  const conCompras = (porMaterial: Record<string, { amount: number; quantity: number }>) =>
    prisma.expense.findFirst.mockImplementation(({ where, select }: any) => {
      // `ensureOwned` pregunta por id; `recalcularPrecioDelRollo`, por material.
      if (!select) return Promise.resolve({ id: 'e-1', organizationId: ORG, materialId: 'm1' });
      return Promise.resolve(where?.materialId ? (porMaterial[where.materialId] ?? null) : null);
    });

  const precioEscrito = () =>
    prisma.material.updateMany.mock.calls.map(([c]: any[]) => [c.where.id, c.data.rollPrice]);

  beforeEach(() => {
    prisma = makePrisma();
    conContrapartes(prisma);
    prisma.expense.update.mockResolvedValue({ id: 'e-1', materialId: 'm1' });
    service = new ExpensesService(prisma as any);
  });

  it('corregir el monto mueve el precio del rollo', async () => {
    conCompras({ m1: { amount: 30, quantity: 2 } }); // lo corregido: 30 ÷ 2

    await service.update(ORG, 'e-1', { amount: 30 } as any);

    expect(precioEscrito()).toEqual([['m1', 15]]);
  });

  // El hermano: sin esto, lo de arriba pasaría con un servicio que escribiera
  // el precio SIEMPRE, incluso sin compras.
  it('sin compras con rollos no se escribe ningún precio', async () => {
    conCompras({});

    await service.update(ORG, 'e-1', { amount: 30 } as any);

    expect(prisma.material.updateMany).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ Mover la compra a otra ficha toca DOS: la nueva gana una compra y la
   * vieja pierde la suya, así que las dos tienen que volver a mirar cuál es
   * ahora su última.
   */
  it('cambiar la compra de ficha recalcula las DOS', async () => {
    conCompras({ m1: { amount: 10, quantity: 1 }, m2: { amount: 50, quantity: 2 } });
    prisma.expense.update.mockResolvedValue({ id: 'e-1', materialId: 'm2' });

    await service.update(ORG, 'e-1', { materialId: 'm2' } as any);

    expect(precioEscrito().sort()).toEqual([
      ['m1', 10],
      ['m2', 25],
    ]);
  });

  it('borrar la última compra deja el precio de la ANTERIOR, no el de la borrada', async () => {
    conCompras({ m1: { amount: 18, quantity: 1 } }); // la que queda
    prisma.expense.delete.mockResolvedValue({ id: 'e-1' });

    await service.remove(ORG, 'e-1');

    expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'e-1' } });
    expect(precioEscrito()).toEqual([['m1', 18]]);
  });

  it('el precio sale de la ÚLTIMA compra por fecha, no de cualquiera', async () => {
    conCompras({ m1: { amount: 24, quantity: 2 } });

    await service.update(ORG, 'e-1', { amount: 999 } as any);

    // 12 = 24 ÷ 2 de la última; NO 999 del cuerpo que se acaba de mandar.
    expect(precioEscrito()).toEqual([['m1', 12]]);
    const orden = prisma.expense.findFirst.mock.calls.at(-1)[0].orderBy;
    expect(orden).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
  });
});
