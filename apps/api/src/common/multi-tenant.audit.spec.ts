import { NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders/orders.module';
import { StoreService } from '../store/store.service';
import { ClientsService } from '../clients/clients.module';
import { CashService } from '../cash/cash.service';
import { CounterpartiesService } from '../cash/counterparties.service';
import { CashAccountsService } from '../cash/cash-accounts.service';
import { GoalsService } from '../goals/goals.module';
import { LoansService } from '../loans/loans.module';

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
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: ORG },
    });
  });
});

/**
 * CAJA. Acá no se lee un catálogo: se mueve PLATA (faltantes atribuidos como
 * deuda, ajustes que se anulan). Un id ajeno alcanzable escribiría deuda en
 * otra organización, así que el scope se fija contrato por contrato.
 */
describe('Aislamiento multi-tenant — Caja', () => {
  it('CashService.confirm filtra por { id, organizationId }', async () => {
    const prisma = { cashReconciliation: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new CashService(prisma as never);

    await expect(
      service.confirm(ORG, 'r1', { attributeShortfall: true } as never, 'u1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.cashReconciliation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', organizationId: ORG } }),
    );
  });

  it('CashService.confirm NO confirma una conciliación de otra organización', async () => {
    // Simula la DB real: si el id no pertenece a la org, findFirst no lo encuentra.
    const prisma = {
      cashReconciliation: {
        findFirst: jest.fn(({ where }: any) =>
          where.organizationId === OTHER ? { id: 'r1', status: 'DRAFT', account: {} } : null,
        ),
      },
    };
    const service = new CashService(prisma as never);

    await expect(
      service.confirm(ORG, 'r1', { attributeShortfall: true } as never, 'u1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('CashService.voidReconciliation NO anula una conciliación de otra organización', async () => {
    const prisma = {
      cashReconciliation: {
        findFirst: jest.fn(({ where }: any) =>
          where.organizationId === OTHER
            ? { id: 'r1', status: 'CONFIRMED', adjustment: null }
            : null,
        ),
      },
    };
    const service = new CashService(prisma as never);

    await expect(service.voidReconciliation(ORG, 'r1')).rejects.toThrow(NotFoundException);
  });

  it('CashService.saveReconciliation NO escribe contra una cuenta de otra organización', async () => {
    const prisma = { cashAccount: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new CashService(prisma as never);

    await expect(
      service.saveReconciliation(ORG, {
        accountId: 'acc-ajena',
        date: '2026-10-05',
        totalAmount: 1,
        personalAmount: 0,
        currency: 'USD',
        rate: null,
        note: null,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.cashAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-ajena', organizationId: ORG },
    });
  });

  /**
   * `GET /cash/breakdown/:category` es la superficie más expuesta de la Caja:
   * no devuelve un total sino PLATA fila por fila, con la etiqueta de cada
   * registro. Un escape de scope acá no se nota como un número raro — entrega
   * el detalle del negocio ajeno, con sus conceptos y sus clientes.
   *
   * ⚠️ El mock modela la BASE: `findMany` devuelve lo que el `where` deje
   * pasar, así que si el servicio omite `organizationId` las filas de OTHER
   * SALEN y el test se cae. Un mock que devolviera `[]` ante cualquier `where`
   * inesperado pasaría con y sin la protección (el error de la fase 2).
   */
  it('CashService.breakdown NO devuelve asientos de otra organización', async () => {
    const ajena = {
      id: 'v-ajena',
      organizationId: OTHER,
      date: new Date('2026-09-01'),
      amount: '999',
      kind: 'COUNTER',
      note: 'Venta del otro negocio',
      source: 'MANUAL',
    };
    const filtra = (filas: Record<string, unknown>[]) => ({
      findMany: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
        Promise.resolve(
          filas.filter((f) =>
            Object.entries(where ?? {}).every(([k, v]) =>
              v !== null && typeof v === 'object' ? true : f[k] === v,
            ),
          ),
        ),
      ),
    });
    const prisma = {
      sale: filtra([ajena]),
      payment: filtra([]),
      expense: filtra([]),
      loanPayment: filtra([]),
      loan: filtra([]),
      ownerMovement: filtra([]),
      debtApplication: filtra([]),
      cashAccount: filtra([]),
      cashReconciliation: filtra([]),
      counterparty: filtra([]),
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const r = await new CashService(prisma as never).breakdown(ORG, 'collected');

    expect(r.entries).toEqual([]);
    expect(r.total).toBe(0);
    // Y la fila ERA alcanzable: pedida como OTHER, el mismo mock la devuelve.
    const suya = await new CashService(prisma as never).breakdown(OTHER, 'collected');
    expect(suya.total).toBe(999);
  });

  it('CashService.addMovement NO acepta una contraparte de otra organización', async () => {
    const prisma = { counterparty: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new CashService(prisma as never);

    await expect(
      service.addMovement(ORG, {
        date: '2026-10-05',
        kind: 'WITHDRAWAL',
        amount: 10,
        concept: 'x',
        counterpartyId: 'cp-ajena',
        refundable: true,
        note: null,
      } as never),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.counterparty.findFirst).toHaveBeenCalledWith({
      where: { id: 'cp-ajena', organizationId: ORG },
    });
  });
});

describe('Aislamiento multi-tenant — contrapartes y cuentas', () => {
  it('CounterpartiesService.list filtra por organizationId', async () => {
    const prisma = { counterparty: { findMany: jest.fn().mockResolvedValue([]) } };

    await new CounterpartiesService(prisma as never).list(ORG);

    expect(prisma.counterparty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
  });

  it('CounterpartiesService.remove NO borra una de otra organización', async () => {
    // Simula la DB real: `cp1` es de OTHER y findFirst filtra por las claves que
    // lleguen en el `where`. Si el servicio omite `organizationId`, la encuentra
    // y sigue hasta el delete (el test se cae).
    const ajena = {
      id: 'cp1',
      organizationId: OTHER,
      kind: 'PARTNER',
      name: 'Ana',
      active: true,
      isDefault: false,
    };
    const prisma = {
      counterparty: {
        findFirst: jest.fn(({ where }: never) => {
          const w = where as { id: string; organizationId?: string };
          return w.id === ajena.id && (w.organizationId === undefined || w.organizationId === OTHER)
            ? ajena
            : null;
        }),
        delete: jest.fn(),
      },
      ownerMovement: { count: jest.fn().mockResolvedValue(0) },
      cashAccount: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };

    await expect(new CounterpartiesService(prisma as never).remove(ORG, 'cp1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.counterparty.delete).not.toHaveBeenCalled();
  });

  it('CounterpartiesService.setDefault NO marca una de otra organización', async () => {
    const ajena = { id: 'cp1', organizationId: OTHER, name: 'Ana', active: true };
    const prisma = {
      counterparty: {
        findFirst: jest.fn(({ where }: never) => {
          const w = where as { id: string; organizationId?: string };
          return w.id === ajena.id && (w.organizationId === undefined || w.organizationId === OTHER)
            ? ajena
            : null;
        }),
        updateMany: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };

    await expect(new CounterpartiesService(prisma as never).setDefault(ORG, 'cp1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('CashAccountsService.update NO toca una cuenta de otra organización', async () => {
    const prisma = {
      cashAccount: {
        // La cuenta es de OTHER; findFirst filtra por las claves que lleguen.
        findFirst: jest.fn(({ where }: never) => {
          const w = where as { id: string; organizationId?: string };
          return w.id === 'acc1' && (w.organizationId === undefined || w.organizationId === OTHER)
            ? { id: 'acc1', organizationId: OTHER }
            : null;
        }),
        update: jest.fn(),
      },
    };

    await expect(
      new CashAccountsService(prisma as never).update(ORG, 'acc1', {
        name: 'x',
        kind: 'BANK',
        currency: 'USD',
        shared: false,
        sharedWithId: null,
        autoAttributeShortfall: false,
        active: true,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
  });

  it('⚠️ una cuenta NO se puede atar a la contraparte de OTRA organización', async () => {
    // El IDOR de peor consecuencia: `confirm()` le atribuiría un faltante de
    // plata a la contraparte de otro negocio.
    const prisma = {
      cashAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'acc1' }), update: jest.fn() },
      counterparty: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      new CashAccountsService(prisma as never).update(ORG, 'acc1', {
        name: 'x',
        kind: 'EXCHANGE',
        currency: 'USD',
        shared: true,
        sharedWithId: 'cp-de-otra-org',
        autoAttributeShortfall: true,
        active: true,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.counterparty.findFirst).toHaveBeenCalledWith({
      where: { id: 'cp-de-otra-org', organizationId: ORG },
    });
    expect(prisma.cashAccount.update).not.toHaveBeenCalled();
  });
});

describe('Aislamiento multi-tenant — Metas', () => {
  /**
   * La sugerencia es de solo lectura, pero lee TODA la actividad del negocio
   * para promediarla: si no filtra, una organización vería las ventas de otra
   * convertidas en su propia meta.
   */
  const baseFalsa = (ventas: { organizationId: string; date: Date; amount: number }[]) => {
    const filtrar = (where: Record<string, unknown> = {}) =>
      ventas.filter((v) => {
        for (const [k, cond] of Object.entries(where)) {
          if (k === 'date') {
            const c = cond as { gte?: Date; lt?: Date };
            if (c.gte && v.date < c.gte) return false;
            if (c.lt && v.date >= c.lt) return false;
          } else if ((v as Record<string, unknown>)[k] !== cond) return false;
        }
        return true;
      });
    return {
      sale: {
        findMany: jest.fn(({ where }: never) => Promise.resolve(filtrar(where))),
        findFirst: jest.fn(({ where }: never) =>
          Promise.resolve([...filtrar(where)].sort((a, b) => +a.date - +b.date)[0] ?? null),
        ),
      },
      order: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      client: { findMany: jest.fn().mockResolvedValue([]) },
      goal: { findMany: jest.fn().mockResolvedValue([]) },
    };
  };

  const VENTAS = [
    { organizationId: ORG, date: new Date('2026-09-10T00:00:00.000Z'), amount: 100 },
    { organizationId: OTHER, date: new Date('2026-09-11T00:00:00.000Z'), amount: 9999 },
  ];
  const HOY = new Date('2026-10-07T12:00:00.000Z');

  it('GoalsService.suggestion no sugiere con las ventas de otra organización', async () => {
    const p = baseFalsa(VENTAS);
    const s = await new GoalsService(p as never).suggestion(ORG, { month: '2026-11' }, HOY);

    expect(s.sales.value).toBe(100);
  });

  it('y el mock no es ciego: esas ventas SÍ sugieren para su propio negocio', async () => {
    // Sin este hermano, el test de arriba pasaría aunque el mock devolviera
    // vacío siempre — o sea, con y sin el scope.
    const p = baseFalsa(VENTAS);
    const s = await new GoalsService(p as never).suggestion(OTHER, { month: '2026-11' }, HOY);

    expect(s.sales.value).toBe(9999);
  });

  it('GoalsService.realesPorMes filtra por organizationId', async () => {
    const p = baseFalsa(VENTAS);
    await new GoalsService(p as never).realesPorMes(
      ORG,
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
    );

    expect(p.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
    );
  });
});

describe('Aislamiento multi-tenant — Préstamos', () => {
  /**
   * El acreedor de un préstamo y quien aporta un pago son contrapartes: si no
   * se validan contra la organización, una podría atarle su deuda a la
   * contraparte de otro negocio.
   */
  const baseFalsa = (contrapartes: { id: string; organizationId: string }[]) => ({
    loan: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: never) => Promise.resolve({ ...(data as object), id: 'l1', payments: [] })),
    },
    loanPayment: { findFirst: jest.fn().mockResolvedValue(null) },
    counterparty: {
      findFirst: jest.fn(({ where }: never) =>
        Promise.resolve(
          contrapartes.find((c) =>
            Object.entries(where as Record<string, unknown>).every(
              ([k, v]) => (c as Record<string, unknown>)[k] === v,
            ),
          ) ?? null,
        ),
      ),
    },
  });
  const CPS = [{ id: 'cp-ajena', organizationId: OTHER }];
  const cash = { summary: jest.fn() };
  const nuevo = { name: 'X', principal: 100, monthlyPayment: 0, counterpartyId: 'cp-ajena' } as never;

  it('LoansService.create no acepta un acreedor de otra organización', async () => {
    const p = baseFalsa(CPS);

    await expect(new LoansService(p as never, cash as never).create(ORG, nuevo)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(p.counterparty.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }),
    );
  });

  it('y esa contraparte SÍ sirve para su propio negocio', async () => {
    // Sin este hermano, el de arriba pasaría aunque el mock devolviera null
    // siempre — o sea, con y sin el scope.
    const p = baseFalsa(CPS);

    const l = await new LoansService(p as never, cash as never).create(OTHER, nuevo);

    expect(l.id).toBe('l1');
  });
});
