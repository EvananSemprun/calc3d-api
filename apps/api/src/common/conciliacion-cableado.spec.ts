import { BadRequestException } from '@nestjs/common';
import { CashService } from '../cash/cash.service';
import { ExpensesService } from '../expenses/expenses.service';
import { LoansService } from '../loans/loans.module';
import { OrdersService } from '../orders/orders.module';
import { PurchaseInvoicesService } from '../purchase-invoices/purchase-invoices.module';
import { SalesService } from '../sales/sales.service';

/**
 * EL CABLEADO DEL AVISO DE CONCILIACIÓN, servicio por servicio
 * (2026-11-12, fase B tarea 8).
 *
 * `conciliacion-guard.spec.ts` prueba la REGLA. Esto prueba lo que ese spec no
 * puede: que cada puerta que mueve la caja la llama. Borrar la línea del
 * servicio no tumba ni un test de la regla, pero sí uno de acá.
 *
 * Para cada puerta, los mismos cuatro casos:
 *   1. fecha dentro de una conciliación CONFIRMADA → 400 y NO escribe;
 *   2. lo mismo con una DRAFT (el caso que motivó el pedido: una confirmada
 *      congela importes, una borrador cambia su esperado EN SILENCIO);
 *   3. con `confirmoConciliacion` → escribe;
 *   4. fecha POSTERIOR a la conciliación → escribe sin pedir nada.
 * Y en los `update`, que mover un registro FUERA de una conciliación también
 * avise (se pasa la fecha vieja, no solo la nueva).
 */
const ORG = 'org-1';
const CONCILIACION = '2026-09-30';
const DENTRO = '2026-09-10';
const FUERA = '2026-10-15';

type Estado = 'CONFIRMED' | 'DRAFT';

const conciliaciones = (status: Estado) => ({
  findMany: jest
    .fn()
    .mockResolvedValue([
      { id: 'c1', organizationId: ORG, date: new Date(`${CONCILIACION}T00:00:00.000Z`), status },
    ]),
});

/** Corre `p` y se traga lo que falle DESPUÉS del guard: acá solo importa si cortó. */
async function corte(p: Promise<unknown>): Promise<'cortó' | 'pasó'> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BadRequestException && /conciliaci/i.test(e.message)) return 'cortó';
  }
  return 'pasó';
}

interface Puerta {
  escribe: jest.Mock;
  llamar: (fecha: string, confirmo?: boolean) => Promise<unknown>;
}

const MOV = (fecha: string) => ({
  id: 'x1',
  organizationId: ORG,
  date: new Date(`${fecha}T00:00:00.000Z`),
});

function ventas(status: Estado, metodo: 'create' | 'update' | 'remove', viejo = DENTRO): Puerta {
  const sale = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(MOV(viejo)),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  };
  const prisma = { cashReconciliation: conciliaciones(status), sale };
  const s = new SalesService(
    prisma as never,
    { snapshotJson: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return {
    escribe: metodo === 'create' ? sale.create : metodo === 'update' ? sale.update : sale.delete,
    llamar: (fecha, confirmo) =>
      metodo === 'create'
        ? s.create(ORG, { date: fecha, amount: 10, kind: 'RETAIL', confirmoConciliacion: confirmo } as never)
        : metodo === 'update'
          ? s.update(ORG, 'x1', { date: fecha, confirmoConciliacion: confirmo } as never)
          : s.remove(ORG, 'x1', confirmo),
  };
}

function gastos(
  status: Estado,
  metodo: 'create' | 'createWithDefinition' | 'update' | 'remove',
  viejo = DENTRO,
): Puerta {
  const expense = {
    create: jest.fn().mockResolvedValue({ id: 'g1' }),
    findFirst: jest
      .fn()
      .mockResolvedValue({ ...MOV(viejo), purchaseInvoiceLineId: null, materialId: null }),
    update: jest.fn().mockResolvedValue({ materialId: null }),
    delete: jest.fn().mockResolvedValue({}),
  };
  const tx = {
    expense,
    material: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }), update: jest.fn() },
  };
  const prisma = {
    cashReconciliation: conciliaciones(status),
    expense,
    material: { updateMany: jest.fn() },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const s = new ExpensesService(prisma as never);
  const base = (fecha: string, confirmo?: boolean) => ({
    date: fecha,
    category: 'OTHER',
    description: 'x',
    amount: 10,
    isInvestment: false,
    quantity: 1,
    confirmoConciliacion: confirmo,
  });
  return {
    escribe: expense[metodo === 'update' ? 'update' : metodo === 'remove' ? 'delete' : 'create'],
    llamar: (fecha, confirmo) => {
      switch (metodo) {
        case 'create':
          return s.create(ORG, base(fecha, confirmo) as never);
        case 'createWithDefinition':
          return s.createWithDefinition(ORG, {
            expense: base(fecha), // la fecha va en el gasto, el flag en la raíz
            link: { kind: 'material', mode: 'existing', id: 'm1' },
            confirmoConciliacion: confirmo,
          } as never);
        case 'update':
          return s.update(ORG, 'x1', { date: fecha, confirmoConciliacion: confirmo } as never);
        default:
          return s.remove(ORG, 'x1', confirmo);
      }
    },
  };
}

function pedidos(status: Estado, metodo: 'addPayment' | 'removePayment', viejo = DENTRO): Puerta {
  const payment = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(MOV(viejo)),
    delete: jest.fn().mockResolvedValue({}),
  };
  const order = {
    findFirst: jest.fn().mockResolvedValue({ id: 'p1', currencyLabel: null, lines: [], payments: [] }),
  };
  const prisma = { cashReconciliation: conciliaciones(status), order, payment };
  const s = new OrdersService(prisma as never, { latest: jest.fn().mockResolvedValue([]) } as never);
  return {
    escribe: metodo === 'addPayment' ? payment.create : payment.delete,
    llamar: (fecha, confirmo) =>
      metodo === 'addPayment'
        ? s.addPayment(ORG, 'p1', { date: fecha, amount: 5, confirmoConciliacion: confirmo } as never)
        : s.removePayment(ORG, 'p1', 'x1', confirmo),
  };
}

function prestamos(status: Estado, metodo: 'addPayment' | 'voidPayment', viejo = DENTRO): Puerta {
  const loanPayment = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue({ ...MOV(viejo), voidedAt: null }),
    update: jest.fn().mockResolvedValue({}),
  };
  const loan = {
    findFirst: jest.fn().mockResolvedValue({
      id: 'l1',
      organizationId: ORG,
      name: 'P',
      principal: 1000,
      monthlyPayment: null,
      paymentFrequency: 'MONTHLY',
      counterpartyId: null,
      concept: null,
      nextDueDate: null,
      startDate: null,
      closedAt: null,
      notes: null,
      printerId: null,
      payments: [],
    }),
  };
  const prisma = {
    cashReconciliation: conciliaciones(status),
    loan,
    loanPayment,
    counterparty: { findFirst: jest.fn() },
  };
  const s = new LoansService(prisma as never, {} as never, {} as never);
  return {
    escribe: metodo === 'addPayment' ? loanPayment.create : loanPayment.update,
    llamar: (fecha, confirmo) =>
      metodo === 'addPayment'
        ? s.addPayment(ORG, 'l1', {
            date: fecha,
            amount: 10,
            generatesDebt: false,
            confirmoConciliacion: confirmo,
          } as never)
        : s.voidPayment(ORG, 'l1', 'x1', { reason: 'x', confirmoConciliacion: confirmo }),
  };
}

function caja(status: Estado, metodo: 'addMovement' | 'removeMovement', viejo = DENTRO): Puerta {
  const ownerMovement = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(MOV(viejo)),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    cashReconciliation: conciliaciones(status),
    ownerMovement,
    counterparty: { findFirst: jest.fn().mockResolvedValue({ id: 'cp1' }) },
  };
  const s = new CashService(prisma as never);
  return {
    escribe: metodo === 'addMovement' ? ownerMovement.create : ownerMovement.deleteMany,
    llamar: (fecha, confirmo) =>
      metodo === 'addMovement'
        ? s.addMovement(ORG, {
            date: fecha,
            kind: 'WITHDRAWAL',
            amount: 10,
            concept: 'x',
            counterpartyId: 'cp1',
            refundable: true,
            confirmoConciliacion: confirmo,
          } as never)
        : s.removeMovement(ORG, 'x1', confirmo),
  };
}

function compras(
  status: Estado,
  metodo: 'addPayment' | 'voidPayment' | 'void',
  viejo = DENTRO,
): Puerta {
  const abono = {
    id: 'x1',
    invoiceId: 'f1',
    organizationId: ORG,
    date: new Date(`${viejo}T00:00:00.000Z`),
    voidedAt: null,
    tomadoDeFacturaId: null,
    createdAt: new Date(),
  };
  const factura = {
    id: 'f1',
    organizationId: ORG,
    voidedAt: null,
    createdAt: new Date(),
    lines: [],
    payments: [abono],
  };
  const purchaseInvoicePayment = {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(abono),
    update: jest.fn().mockResolvedValue({}),
  };
  const purchaseInvoice = {
    findFirst: jest.fn().mockResolvedValue(factura),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = {
    cashReconciliation: conciliaciones(status),
    purchaseInvoice,
    purchaseInvoicePayment,
    counterparty: { findFirst: jest.fn() },
    cashAccount: { findFirst: jest.fn() },
  };
  const s = new PurchaseInvoicesService(prisma as never, {} as never);
  return {
    escribe:
      metodo === 'addPayment'
        ? purchaseInvoicePayment.create
        : metodo === 'voidPayment'
          ? purchaseInvoicePayment.update
          : purchaseInvoice.update,
    llamar: (fecha, confirmo) =>
      metodo === 'addPayment'
        ? s.addPayment(ORG, 'f1', { date: fecha, amount: 5, confirmoConciliacion: confirmo } as never)
        : metodo === 'voidPayment'
          ? s.voidPayment(ORG, 'f1', 'x1', { reason: 'x', confirmoConciliacion: confirmo })
          : s.void(ORG, 'f1', { reason: 'x', confirmoConciliacion: confirmo }),
  };
}

/**
 * `create`/`add*` toman la fecha del DTO; `remove`/`void*` la del registro
 * guardado. Por eso la tabla dice de dónde sale la fecha: en las primeras el
 * registro "viejo" no importa, en las segundas es lo único que cuenta.
 */
type Fabrica = (status: Estado, viejo?: string) => Puerta;
const puertas: Array<{ nombre: string; fabrica: Fabrica; fechaViene: 'dto' | 'registro' }> = [
  { nombre: 'ventas.create', fabrica: (s, v) => ventas(s, 'create', v), fechaViene: 'dto' },
  { nombre: 'ventas.remove', fabrica: (s, v) => ventas(s, 'remove', v), fechaViene: 'registro' },
  { nombre: 'gastos.create', fabrica: (s, v) => gastos(s, 'create', v), fechaViene: 'dto' },
  {
    nombre: 'gastos.createWithDefinition',
    fabrica: (s, v) => gastos(s, 'createWithDefinition', v),
    fechaViene: 'dto',
  },
  { nombre: 'gastos.remove', fabrica: (s, v) => gastos(s, 'remove', v), fechaViene: 'registro' },
  { nombre: 'pedidos.addPayment', fabrica: (s, v) => pedidos(s, 'addPayment', v), fechaViene: 'dto' },
  {
    nombre: 'pedidos.removePayment',
    fabrica: (s, v) => pedidos(s, 'removePayment', v),
    fechaViene: 'registro',
  },
  { nombre: 'préstamos.addPayment', fabrica: (s, v) => prestamos(s, 'addPayment', v), fechaViene: 'dto' },
  {
    nombre: 'préstamos.voidPayment (anular devuelve plata)',
    fabrica: (s, v) => prestamos(s, 'voidPayment', v),
    fechaViene: 'registro',
  },
  { nombre: 'caja.addMovement', fabrica: (s, v) => caja(s, 'addMovement', v), fechaViene: 'dto' },
  { nombre: 'caja.removeMovement', fabrica: (s, v) => caja(s, 'removeMovement', v), fechaViene: 'registro' },
  { nombre: 'compras.addPayment', fabrica: (s, v) => compras(s, 'addPayment', v), fechaViene: 'dto' },
  { nombre: 'compras.voidPayment', fabrica: (s, v) => compras(s, 'voidPayment', v), fechaViene: 'registro' },
  {
    nombre: 'compras.void (factura con abonos)',
    fabrica: (s, v) => compras(s, 'void', v),
    fechaViene: 'registro',
  },
];

describe.each(puertas)('aviso de conciliación: $nombre', ({ fabrica, fechaViene }) => {
  // Si la fecha viene del registro, el registro es el que cae DENTRO.
  const conFechaDentro = (status: Estado) =>
    fechaViene === 'dto' ? fabrica(status, FUERA) : fabrica(status, DENTRO);

  it('fecha dentro de una conciliación CONFIRMADA: corta con 400 y no escribe', async () => {
    const p = conFechaDentro('CONFIRMED');
    expect(await corte(p.llamar(DENTRO))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('una conciliación en DRAFT también avisa (cambia su esperado en silencio)', async () => {
    const p = conFechaDentro('DRAFT');
    expect(await corte(p.llamar(DENTRO))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('con confirmoConciliacion guarda', async () => {
    const p = conFechaDentro('CONFIRMED');
    expect(await corte(p.llamar(DENTRO, true))).toBe('pasó');
    expect(p.escribe).toHaveBeenCalled();
  });

  it('una fecha POSTERIOR a la conciliación no pide nada', async () => {
    const p = fabrica('CONFIRMED', FUERA);
    expect(await corte(p.llamar(FUERA))).toBe('pasó');
    expect(p.escribe).toHaveBeenCalled();
  });
});

describe('aviso de conciliación: editar pasa la fecha VIEJA y la nueva', () => {
  it('ventas.update: mover un registro de DENTRO a FUERA de la conciliación también avisa', async () => {
    const p = ventas('CONFIRMED', 'update', DENTRO);
    expect(await corte(p.llamar(FUERA))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('ventas.update: mover de FUERA a DENTRO avisa (la fecha nueva)', async () => {
    const p = ventas('CONFIRMED', 'update', FUERA);
    expect(await corte(p.llamar(DENTRO))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('ventas.update: con ambas fechas posteriores no pide nada', async () => {
    const p = ventas('CONFIRMED', 'update', FUERA);
    expect(await corte(p.llamar('2026-11-01'))).toBe('pasó');
    expect(p.escribe).toHaveBeenCalled();
  });

  it('gastos.update: mover un gasto de DENTRO a FUERA también avisa', async () => {
    const p = gastos('CONFIRMED', 'update', DENTRO);
    expect(await corte(p.llamar(FUERA))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('gastos.update: mover de FUERA a DENTRO avisa, también con DRAFT', async () => {
    const p = gastos('DRAFT', 'update', FUERA);
    expect(await corte(p.llamar(DENTRO))).toBe('cortó');
    expect(p.escribe).not.toHaveBeenCalled();
  });

  it('gastos.update: con el flag guarda', async () => {
    const p = gastos('CONFIRMED', 'update', DENTRO);
    expect(await corte(p.llamar(FUERA, true))).toBe('pasó');
    expect(p.escribe).toHaveBeenCalled();
  });
});

describe('aviso de conciliación: lo que NO mueve la caja', () => {
  it('anular un abono tomado de un saldo a favor no pide confirmación', async () => {
    const abono = {
      id: 'x1',
      invoiceId: 'f1',
      organizationId: ORG,
      date: new Date(`${DENTRO}T00:00:00.000Z`),
      voidedAt: null,
      tomadoDeFacturaId: 'f0',
      createdAt: new Date(),
    };
    const prisma = {
      cashReconciliation: conciliaciones('CONFIRMED'),
      purchaseInvoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'f1', voidedAt: null, createdAt: new Date(), lines: [], payments: [abono] }),
        update: jest.fn(),
      },
      purchaseInvoicePayment: {
        findFirst: jest.fn().mockResolvedValue(abono),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const s = new PurchaseInvoicesService(prisma as never, {} as never);
    expect(await corte(s.voidPayment(ORG, 'f1', 'x1', { reason: 'x' }))).toBe('pasó');
    expect(prisma.purchaseInvoicePayment.update).toHaveBeenCalled();
  });

  it('anular una factura sin abonos vigentes no pide confirmación', async () => {
    const prisma = {
      cashReconciliation: conciliaciones('CONFIRMED'),
      purchaseInvoice: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'f1', voidedAt: null, createdAt: new Date(), lines: [], payments: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const s = new PurchaseInvoicesService(prisma as never, {} as never);
    expect(await corte(s.void(ORG, 'f1', { reason: 'x' }))).toBe('pasó');
    expect(prisma.purchaseInvoice.update).toHaveBeenCalled();
  });
});
