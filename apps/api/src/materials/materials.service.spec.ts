import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { baseFalsa, type BaseFalsa } from '../common/unir-fichas.fake';

const ORG = 'org-A';
const AGOSTO = new Date('2026-08-01T00:00:00Z');

type Ficha = { id: string; organizationId: string; status: 'ACTIVE' | 'DISCONTINUED' | 'SOLO_PEDIDO_ESPECIAL' };

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
    await expect(intento).rejects.toThrow('Descontinúala en vez de borrarla');
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

  it('si ya está descontinuada, el 409 no sugiere descontinuarla (se conserva)', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'DISCONTINUED' });
    prisma.expense.count.mockResolvedValue(3);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toThrow('se conserva fuera de circulación');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  // El tercer estado tampoco es «activa»: no tiene sentido sugerir descontinuarla
  // como si siguiera circulando con normalidad. Su hermano (ACTIVA → sí sugiere) está arriba.
  it('si es «solo pedido especial», el 409 tampoco sugiere descontinuarla', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'SOLO_PEDIDO_ESPECIAL' });
    prisma.expense.count.mockResolvedValue(3);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toThrow('se conserva fuera de circulación');
    await expect(intento).rejects.not.toThrow('Descontinúala');
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

/**
 * Descontinuar VARIAS fichas de una vez (13/11, «descontinuar toda la marca»).
 *
 * ⚠️ El IDOR tiene su HERMANO alcanzable: un lote con fichas propias Y una ajena.
 * Probar solo «todas ajenas» deja pasar un `updateMany` sin `organizationId`, que
 * con ids mezclados tocaría la ajena. Y el lote es ATÓMICO a propósito: una sola
 * ficha ajena lo rechaza entero, no se escribe «las que sí».
 */
describe('MaterialsService.setStatusBatch', () => {
  type Fila = { id: string; organizationId: string };
  const FICHAS: Fila[] = [
    { id: 'm1', organizationId: ORG },
    { id: 'm2', organizationId: ORG },
    { id: 'x9', organizationId: 'org-B' },
  ];

  // Un prisma que RESPETA el `where`: si el servicio olvida la organización, la ajena aparece.
  function prismaConFichas() {
    const prisma = makePrisma();
    const coincide = (where: { id: { in: string[] }; organizationId?: string }) =>
      FICHAS.filter((f) => where.id.in.includes(f.id) && (where.organizationId === undefined || f.organizationId === where.organizationId));
    prisma.material.findMany.mockImplementation(({ where }: { where: { id: { in: string[] }; organizationId?: string } }) =>
      Promise.resolve(coincide(where)),
    );
    const updateMany = jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] }; organizationId?: string } }) =>
      Promise.resolve({ count: coincide(where).length }),
    );
    return { prisma: Object.assign(prisma, { material: { ...prisma.material, updateMany } }), updateMany };
  }

  it('cambia solo las fichas elegidas, de la organización del token', async () => {
    const { prisma, updateMany } = prismaConFichas();

    const r = await service(prisma as never).setStatusBatch(ORG, { ids: ['m1', 'm2'], status: 'DISCONTINUED' });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, organizationId: ORG },
      data: { status: 'DISCONTINUED' },
    });
    expect(r).toEqual({ updated: 2 });
  });

  it('hermano: la propia SÍ se toca (un lote de una sola ficha propia funciona)', async () => {
    const { prisma, updateMany } = prismaConFichas();

    await service(prisma as never).setStatusBatch(ORG, { ids: ['m1'], status: 'ACTIVE' });

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('una ficha de otra organización mezclada con propias rechaza TODO el lote y no escribe', async () => {
    const { prisma, updateMany } = prismaConFichas();

    await expect(
      service(prisma as never).setStatusBatch(ORG, { ids: ['m1', 'x9'], status: 'DISCONTINUED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('un id repetido no hace creer que falta una ficha', async () => {
    const { prisma, updateMany } = prismaConFichas();

    await service(prisma as never).setStatusBatch(ORG, { ids: ['m1', 'm1', 'm2'], status: 'DISCONTINUED' });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] }, organizationId: ORG },
      data: { status: 'DISCONTINUED' },
    });
  });
});

/**
 * UNIR dos fichas de filamento (13/11). Se prueba contra una base en memoria que
 * respeta las claves foráneas, la única `(materialId, month)` y el rollback de la
 * transacción: con un mock suelto no se podría afirmar nada de lo importante.
 */
describe('MaterialsService.unir', () => {
  const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const mat = (id: string, extra: Record<string, unknown> = {}) => ({
    id, organizationId: ORG, name: id, rollPrice: 20, rollGrams: 1000, status: 'ACTIVE', ...extra,
  });
  const compra = (id: string, materialId: string | null, amount: number, fecha: string, extra: Record<string, unknown> = {}) => ({
    id, organizationId: ORG, materialId, amount, quantity: 1, date: D(fecha), description: `compra ${id}`, createdAt: D(fecha), ...extra,
  });
  const conteo = (id: string, materialId: string, month: string, sealed: number, inUse = 0, running = 0) => ({
    id, organizationId: ORG, materialId, month: D(month), sealed, inUse, running, needsBrandCheck: false,
  });

  function escenario() {
    return baseFalsa({
      material: [
        mat('m1', { rollPrice: 20 }), // origen
        mat('m2', { rollPrice: 25 }), // destino
        mat('mB', { organizationId: 'org-B' }),
      ],
      expense: [
        compra('e1', 'm1', 20, '2026-08-10'),
        compra('e2', 'm2', 25, '2026-07-01'),
        compra('e3', 'm1', 22, '2026-09-05'), // la ÚLTIMA del conjunto, y es del origen
        compra('eB', 'mB', 99, '2026-09-30', { organizationId: 'org-B' }),
      ],
      purchaseInvoice: [{ id: 'f1', organizationId: ORG }, { id: 'fB', organizationId: 'org-B' }],
      purchaseInvoiceLine: [
        { id: 'l1', invoiceId: 'f1', materialId: 'm1' },
        { id: 'lB', invoiceId: 'fB', materialId: 'mB' },
      ],
      storeProduct: [
        { id: 'p1', organizationId: ORG, input: { filament: { name: 'M1', rollPrice: 20, rollGrams: 1000, grams: 5 }, supplies: [] } },
        { id: 'p2', organizationId: ORG, input: { filament: { name: 'otra', rollPrice: 9, rollGrams: 1000, grams: 5 }, supplies: [] } },
        { id: 'p3', organizationId: ORG, input: null },
        { id: 'pB', organizationId: 'org-B', input: { filament: { name: 'm1', rollPrice: 9, rollGrams: 1000, grams: 5 }, supplies: [] } },
      ],
      stockCount: [
        conteo('c1', 'm1', '2026-08-01', 1),
        conteo('c2', 'm1', '2026-09-01', 2, 1),
        conteo('c3', 'm2', '2026-08-01', 3, 0, 1), // mismo mes que c1: choca
      ],
    });
  }
  const unir = (b: BaseFalsa, org = ORG, origen = 'm1', destino = 'm2') =>
    new MaterialsService(b.prisma as never).unir(org, origen, { destinoId: destino });
  const ficha = (b: BaseFalsa, id: string) => b.estado().material.find((m) => m.id === id);

  it('repunta compras, líneas de factura y conteos a la ficha destino', async () => {
    const b = escenario();

    await unir(b);

    expect(b.estado().expense.filter((e) => e.materialId === 'm2').map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(b.estado().purchaseInvoiceLine.find((l) => l.id === 'l1')?.materialId).toBe('m2');
    expect(b.estado().stockCount.every((c) => c.materialId === 'm2')).toBe(true);
    expect(ficha(b, 'm1')).toBeUndefined();
  });

  it('NO cambia el monto, la fecha ni la cantidad de ninguna compra pasada', async () => {
    const b = escenario();
    const foto = () => b.estado().expense.map(({ id, amount, date, quantity, description }) => ({ id, amount, date, quantity, description }));
    const antes = foto();

    await unir(b);

    expect(foto()).toEqual(antes);
  });

  it('el precio queda en el de la ÚLTIMA compra del conjunto, sea de la ficha que sea', async () => {
    const b = escenario();
    await unir(b);
    expect(Number(ficha(b, 'm2')?.rollPrice)).toBe(22); // e3, del origen, no los 25 guardados en el destino

    const c = escenario();
    c.estado().expense.find((e) => e.id === 'e2')!.date = D('2026-09-20'); // ahora la última es del destino
    await unir(c);
    expect(Number(ficha(c, 'm2')?.rollPrice)).toBe(25);
  });

  it('sin ninguna compra con rollos, el destino conserva su precio', async () => {
    const b = escenario();
    b.estado().expense.forEach((e) => { if (e.organizationId === ORG) e.quantity = null; });

    await unir(b);

    expect(Number(ficha(b, 'm2')?.rollPrice)).toBe(25);
  });

  it('donde las dos tenían conteo del mismo mes, se suman; los demás pasan tal cual', async () => {
    const b = escenario();

    await unir(b);

    const agosto = b.estado().stockCount.filter((c) => (c.month as Date).getTime() === D('2026-08-01').getTime());
    expect(agosto).toHaveLength(1);
    expect(agosto[0]).toMatchObject({ materialId: 'm2', sealed: 4, inUse: 0, running: 1 });
    const septiembre = b.estado().stockCount.find((c) => c.id === 'c2');
    expect(septiembre).toMatchObject({ materialId: 'm2', sealed: 2, inUse: 1 });
  });

  it('el costeo de la tienda que usaba el origen pasa a llamarse como el destino, sin tocar su costo congelado', async () => {
    const b = escenario();

    await unir(b);

    const input = (id: string) => b.estado().storeProduct.find((p) => p.id === id)?.input as { filament: { name: string; rollPrice: number } } | null;
    expect(input('p1')?.filament).toEqual({ name: 'm2', rollPrice: 20, rollGrams: 1000, grams: 5 });
    expect(input('p2')?.filament.name).toBe('otra');
    expect(input('p3')).toBeNull();
    expect(input('pB')?.filament.name).toBe('m1'); // de otra organización: no se toca
  });

  it('la ficha de origen se borra al final, después de repuntar todo', async () => {
    const b = escenario();

    await unir(b);

    expect(b.escrituras[b.escrituras.length - 1]).toBe('material.deleteMany');
    expect(b.escrituras.filter((e) => e === 'material.deleteMany')).toHaveLength(1);
  });

  it('si algo falla a mitad de camino NO queda nada a medias (una sola transacción)', async () => {
    const b = escenario();
    const antes = JSON.stringify(b.estado());
    b.fallarEn('stockCount.updateMany');

    await expect(unir(b)).rejects.toThrow('Falla inyectada');

    expect(JSON.stringify(b.estado())).toBe(antes);
    expect(ficha(b, 'm1')).toBeDefined();
  });

  it('si queda algo apuntando al origen, aborta y no borra (no deja huérfanos)', async () => {
    const b = escenario();
    // Una línea de otra organización que apunta al origen: el repunte (con alcance
    // de organización) no la toca, y borrar la ficha la dejaría colgando.
    b.estado().purchaseInvoiceLine.push({ id: 'lx', invoiceId: 'fB', materialId: 'm1' });

    await expect(unir(b)).rejects.toThrow('Quedó');

    expect(ficha(b, 'm1')).toBeDefined();
    expect(b.estado().expense.find((e) => e.id === 'e1')?.materialId).toBe('m1');
  });

  it('una compra de otra organización que apunta al origen tampoco se repunta (el alcance es por organización)', async () => {
    const b = escenario();
    b.estado().expense.push(compra('ex', 'm1', 5, '2026-09-01', { organizationId: 'org-B' }));

    await expect(unir(b)).rejects.toThrow('Quedó');

    expect(b.estado().expense.find((e) => e.id === 'ex')?.materialId).toBe('m1');
  });

  describe('segunda capa: la escritura sigue cerrada aunque se afloje la lectura', () => {
    it('un costeo de otra organización que la lectura dejó pasar no se reescribe, y la unión aborta', async () => {
      const b = escenario();
      b.aflojarLectura('storeProduct');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b)).rejects.toThrow('el costeo de un producto');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('un conteo de otra organización que la lectura dejó pasar no se mueve, y la unión aborta', async () => {
      const b = escenario();
      b.estado().stockCount.push({ ...conteo('cx', 'm1', '2026-10-01', 7), organizationId: 'org-B' });
      b.aflojarLectura('stockCount');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b)).rejects.toThrow('un conteo');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('el conteo de DESTINO de otra organización que la lectura dejó pasar no recibe la suma, y la unión aborta', async () => {
      const b = escenario();
      b.estado().stockCount = [
        conteo('c1', 'm1', '2026-08-01', 1),
        { ...conteo('cy', 'm2', '2026-08-01', 3), organizationId: 'org-B' },
      ];
      b.aflojarLectura('stockCount');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b)).rejects.toThrow('la suma de un conteo');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('el conteo de ORIGEN de otra organización que la lectura dejó pasar no se borra al sumarse', async () => {
      const b = escenario();
      b.estado().stockCount = [
        { ...conteo('cx', 'm1', '2026-08-01', 1), organizationId: 'org-B' },
        conteo('c3', 'm2', '2026-08-01', 3),
      ];
      b.aflojarLectura('stockCount');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b)).rejects.toThrow('el borrado de un conteo');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('una ficha de origen de otra organización que la lectura dejó pasar no se borra', async () => {
      const b = escenario();
      // Sin historial colgando de ella, el único freno es el where del borrado.
      b.estado().expense = b.estado().expense.filter((e) => e.id !== 'eB');
      b.estado().purchaseInvoiceLine = b.estado().purchaseInvoiceLine.filter((l) => l.id !== 'lB');
      b.aflojarLectura('material');

      await expect(unir(b, ORG, 'mB', 'm2')).rejects.toThrow('el borrado de la ficha de origen');

      expect(ficha(b, 'mB')).toBeDefined();
    });

    it('hermano: con la lectura bien, la unión legítima sí mueve lo suyo', async () => {
      const b = escenario();

      await unir(b);

      expect(b.estado().storeProduct.find((p) => p.id === 'p1')?.input).toMatchObject({ filament: { name: 'm2' } });
      expect(b.estado().stockCount.every((c) => c.materialId === 'm2')).toBe(true);
      expect(ficha(b, 'm1')).toBeUndefined();
    });
  });

  it('con una ficha de OTRA organización se rechaza y no se escribe nada', async () => {
    const b = escenario();

    await expect(unir(b, ORG, 'm1', 'mB')).rejects.toThrow('Material no encontrado');
    await expect(unir(b, ORG, 'mB', 'm2')).rejects.toThrow('Material no encontrado');

    expect(b.escrituras).toEqual([]);
  });

  it('hermano: la MISMA ficha sí se une desde su propia organización', async () => {
    const b = escenario();
    b.estado().material.push(mat('mB2', { organizationId: 'org-B' }));

    await unir(b, 'org-B', 'mB2', 'mB');

    expect(ficha(b, 'mB2')).toBeUndefined();
    expect(ficha(b, 'mB')).toBeDefined();
  });

  it('no toca las compras de otra organización', async () => {
    const b = escenario();

    await unir(b);

    expect(b.estado().expense.find((e) => e.id === 'eB')?.materialId).toBe('mB');
    expect(b.estado().purchaseInvoiceLine.find((l) => l.id === 'lB')?.materialId).toBe('mB');
  });

  it('unir una ficha consigo misma se rechaza', async () => {
    const b = escenario();

    const intento = unir(b, ORG, 'm1', 'm1');

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('consigo misma');
    expect(b.escrituras).toEqual([]);
  });

  it('rollos de distinto peso no se unen: reescribiría el costo por gramo del histórico', async () => {
    const b = escenario();
    ficha(b, 'm2')!.rollGrams = 750;

    const intento = unir(b);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('1000 g');
    expect(b.escrituras).toEqual([]);
    // hermano: con el mismo peso sí se une
    ficha(b, 'm2')!.rollGrams = 1000;
    await unir(b);
    expect(ficha(b, 'm1')).toBeUndefined();
  });

  it('no cambia el estado del destino (una descontinuada sigue descontinuada)', async () => {
    const b = escenario();
    ficha(b, 'm2')!.status = 'DISCONTINUED';

    await unir(b);

    expect(ficha(b, 'm2')?.status).toBe('DISCONTINUED');
  });

  describe('vista previa', () => {
    it('cuenta lo que se va a mover, dice el precio que queda y NO escribe', async () => {
      const b = escenario();

      const vista = await new MaterialsService(b.prisma as never).vistaDeUnion(ORG, 'm1', 'm2');

      expect(vista).toEqual({
        origen: { id: 'm1', name: 'm1' },
        destino: { id: 'm2', name: 'm2' },
        compras: 2,
        lineasDeFactura: 1,
        conteos: 2,
        conteosQueSeSuman: 1,
        productos: 1,
        precio: { antes: 25, despues: 22, deLaUltimaCompra: true },
      });
      expect(b.escrituras).toEqual([]);
    });

    it('es lo mismo que devuelve unir (el número que se confirma es el que se ejecuta)', async () => {
      const b = escenario();
      const vista = await new MaterialsService(b.prisma as never).vistaDeUnion(ORG, 'm1', 'm2');

      expect(await unir(b)).toEqual(vista);
    });

    it('con una ficha ajena se rechaza; con la propia, no', async () => {
      const b = escenario();
      const s = new MaterialsService(b.prisma as never);

      await expect(s.vistaDeUnion(ORG, 'm1', 'mB')).rejects.toThrow('Material no encontrado');
      await expect(s.vistaDeUnion(ORG, 'm1', 'm2')).resolves.toBeDefined();
    });
  });
});
