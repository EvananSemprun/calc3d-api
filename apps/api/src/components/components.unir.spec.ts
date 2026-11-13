import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { baseFalsa, type BaseFalsa } from '../common/unir-fichas.fake';
import { ComponentsController, ComponentsService } from './components.module';

const ORG = 'org-A';
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Unir dos insumos (13/11). El caso real: «Argollas» (1 compra de 7,27 por 25) se
 * une dentro de «Argolla llavero» (paquete de 50 por 100 = 0,50 la unidad, un
 * precio escrito a mano que no sale de ninguna compra). Tras unir queda 0,29.
 */
describe('ComponentsService.unir', () => {
  const insumo = (id: string, packagePrice: number, unitsPerPackage: number, org = ORG) => ({
    id, organizationId: org, name: id, packagePrice, unitsPerPackage, scope: 'PER_PIECE',
  });
  const compra = (id: string, componentId: string, amount: number, quantity: number | null, fecha: string, org = ORG) => ({
    id, organizationId: org, componentId, amount, quantity, date: D(fecha), createdAt: D(fecha), description: `compra ${id}`,
  });

  function escenario() {
    return baseFalsa({
      component: [insumo('argollas', 7.27, 25), insumo('llavero', 50, 100), insumo('ajeno', 5, 10, 'org-B')],
      expense: [
        compra('e1', 'argollas', 7.27, 25, '2026-10-02'),
        compra('e2', 'ajeno', 99, 10, '2026-10-03', 'org-B'),
      ],
      storeProduct: [
        { id: 'p1', organizationId: ORG, input: { filament: { name: 'PLA', rollPrice: 20, rollGrams: 1000, grams: 5 }, supplies: [{ name: 'Argollas', unitCost: 0.5, quantity: 1 }] } },
        { id: 'pB', organizationId: 'org-B', input: { filament: {}, supplies: [{ name: 'Argollas', unitCost: 0.5, quantity: 1 }] } },
      ],
      purchaseInvoice: [{ id: 'f1', organizationId: ORG }, { id: 'fB', organizationId: 'org-B' }],
      purchaseInvoiceLine: [
        { id: 'l1', invoiceId: 'f1', componentId: 'argollas' },
        { id: 'lB', invoiceId: 'fB', componentId: 'ajeno' },
      ],
    });
  }
  const unir = (b: BaseFalsa, org = ORG, origen = 'argollas', destino = 'llavero') =>
    new ComponentsService(b.prisma as never).unir(org, origen, { destinoId: destino });
  const ficha = (b: BaseFalsa, id: string) => b.estado().component.find((c) => c.id === id);

  it('repunta compras y líneas de factura, y borra el origen', async () => {
    const b = escenario();

    await unir(b);

    expect(b.estado().expense.find((e) => e.id === 'e1')?.componentId).toBe('llavero');
    expect(b.estado().purchaseInvoiceLine.find((l) => l.id === 'l1')?.componentId).toBe('llavero');
    expect(ficha(b, 'argollas')).toBeUndefined();
    expect(b.escrituras[b.escrituras.length - 1]).toBe('component.deleteMany');
  });

  it('NO cambia el monto, la fecha ni la cantidad de la compra', async () => {
    const b = escenario();
    const foto = () => b.estado().expense.map(({ id, amount, date, quantity }) => ({ id, amount, date, quantity }));
    const antes = foto();

    await unir(b);

    expect(foto()).toEqual(antes);
  });

  it('el costo por unidad pasa de 0,50 escrito a mano a 0,29 de la compra real', async () => {
    const b = escenario();

    const vista = await unir(b);

    expect(vista.precio).toEqual({ antes: 0.5, despues: 0.2908, deLaUltimaCompra: true });
    const destino = ficha(b, 'llavero')!;
    // Se conserva el tamaño de paquete (100): 29,08 / 100 = 0,2908 por unidad.
    expect(destino.unitsPerPackage).toBe(100);
    expect(Number(destino.packagePrice) / Number(destino.unitsPerPackage)).toBeCloseTo(0.2908, 4);
  });

  it('el costeo de la tienda que usaba el insumo pasa a llamarse como el destino, con su costo congelado', async () => {
    const b = escenario();

    await unir(b);

    const supplies = (id: string) => (b.estado().storeProduct.find((p) => p.id === id)?.input as { supplies: unknown[] }).supplies;
    expect(supplies('p1')).toEqual([{ name: 'llavero', unitCost: 0.5, quantity: 1 }]);
    expect(supplies('pB')).toEqual([{ name: 'Argollas', unitCost: 0.5, quantity: 1 }]);
  });

  it('sin compras con cantidad, el destino conserva su precio', async () => {
    const b = escenario();
    b.estado().expense.find((e) => e.id === 'e1')!.quantity = null;

    const vista = await unir(b);

    expect(vista.precio).toEqual({ antes: 0.5, despues: 0.5, deLaUltimaCompra: false });
    expect(Number(ficha(b, 'llavero')?.packagePrice)).toBe(50);
  });

  it('si algo falla a mitad de camino no queda nada a medias', async () => {
    const b = escenario();
    const antes = JSON.stringify(b.estado());
    b.fallarEn('component.updateMany');

    await expect(unir(b)).rejects.toThrow('Falla inyectada');

    expect(JSON.stringify(b.estado())).toBe(antes);
  });

  it('una ficha de OTRA organización se rechaza sin escribir; la propia sí se une', async () => {
    const b = escenario();

    await expect(unir(b, ORG, 'argollas', 'ajeno')).rejects.toThrow('Insumo no encontrado');
    await expect(unir(b, ORG, 'ajeno', 'llavero')).rejects.toThrow('Insumo no encontrado');
    expect(b.escrituras).toEqual([]);

    b.estado().component.push(insumo('ajeno2', 1, 1, 'org-B'));
    await unir(b, 'org-B', 'ajeno2', 'ajeno');
    expect(ficha(b, 'ajeno2')).toBeUndefined();
  });

  describe('segunda capa: la escritura sigue cerrada aunque se afloje la lectura', () => {
    it('un costeo de otra organización que la lectura dejó pasar no se reescribe, y la unión aborta', async () => {
      const b = escenario();
      b.aflojarLectura('storeProduct');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b)).rejects.toThrow('el costeo de un producto');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('un insumo de origen de otra organización que la lectura dejó pasar no se borra', async () => {
      const b = escenario();
      // Sin historial colgando de él, el único freno es el where del borrado.
      b.estado().expense = b.estado().expense.filter((e) => e.id !== 'e2');
      b.estado().purchaseInvoiceLine = b.estado().purchaseInvoiceLine.filter((l) => l.id !== 'lB');
      b.aflojarLectura('component');

      await expect(unir(b, ORG, 'ajeno', 'llavero')).rejects.toThrow('el borrado del insumo de origen');

      expect(ficha(b, 'ajeno')).toBeDefined();
    });

    it('un insumo DESTINO de otra organización que la lectura dejó pasar no recibe el precio', async () => {
      const b = escenario();
      b.aflojarLectura('component');
      const antes = JSON.stringify(b.estado());

      await expect(unir(b, ORG, 'argollas', 'ajeno')).rejects.toThrow('el precio del destino');

      expect(JSON.stringify(b.estado())).toBe(antes);
    });

    it('hermano: con la lectura bien, la unión legítima sí mueve lo suyo', async () => {
      const b = escenario();

      await unir(b);

      expect(ficha(b, 'argollas')).toBeUndefined();
      expect(b.estado().storeProduct.find((p) => p.id === 'p1')?.input).toMatchObject({ supplies: [{ name: 'llavero' }] });
    });
  });

  it('no toca las compras ni líneas de otra organización', async () => {
    const b = escenario();

    await unir(b);

    expect(b.estado().expense.find((e) => e.id === 'e2')?.componentId).toBe('ajeno');
    expect(b.estado().purchaseInvoiceLine.find((l) => l.id === 'lB')?.componentId).toBe('ajeno');
  });

  it('consigo misma se rechaza', async () => {
    const b = escenario();

    const intento = unir(b, ORG, 'argollas', 'argollas');

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('consigo misma');
  });

  it('si queda algo apuntando al origen, aborta y no borra', async () => {
    const b = escenario();
    b.estado().purchaseInvoiceLine.push({ id: 'lx', invoiceId: 'fB', componentId: 'argollas' });

    await expect(unir(b)).rejects.toThrow('Quedó');

    expect(ficha(b, 'argollas')).toBeDefined();
  });

  it('una compra de otra organización que apunta al origen no se repunta (alcance por organización)', async () => {
    const b = escenario();
    b.estado().expense.push(compra('ex', 'argollas', 5, 1, '2026-09-01', 'org-B'));

    await expect(unir(b)).rejects.toThrow('Quedó');

    expect(b.estado().expense.find((e) => e.id === 'ex')?.componentId).toBe('argollas');
  });

  it('la vista previa cuenta lo que se mueve, no escribe y coincide con unir', async () => {
    const b = escenario();
    const vista = await new ComponentsService(b.prisma as never).vistaDeUnion(ORG, 'argollas', 'llavero');

    expect(vista).toMatchObject({ compras: 1, lineasDeFactura: 1, productos: 1, conteos: 0, conteosQueSeSuman: 0 });
    expect(b.escrituras).toEqual([]);
    expect(await unir(b)).toEqual(vista);
  });
});

describe('ComponentsController — unir', () => {
  it('exige sesión y las rutas usan la organización del token', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ComponentsController)).toContain(JwtAuthGuard);
    const service = { unir: jest.fn().mockResolvedValue({}), vistaDeUnion: jest.fn().mockResolvedValue({}) };
    const c = new ComponentsController(service as never);

    await c.unir({ organizationId: 'org-A' } as never, 'a', { destinoId: 'b' });
    await c.vistaDeUnion({ organizationId: 'org-A' } as never, 'a', 'b');

    expect(service.unir).toHaveBeenCalledWith('org-A', 'a', { destinoId: 'b' });
    expect(service.vistaDeUnion).toHaveBeenCalledWith('org-A', 'a', 'b');
    expect(Reflect.getMetadata(METHOD_METADATA, ComponentsController.prototype.unir)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PATH_METADATA, ComponentsController.prototype.unir)).toBe(':id/unir');
  });
});
