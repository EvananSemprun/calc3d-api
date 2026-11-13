import { ConflictException, NotFoundException } from '@nestjs/common';
import { baseFalsa, type BaseFalsa } from '../common/unir-fichas.fake';
import { ComponentsService } from './components.module';

const ORG = 'org-A';

/**
 * Borrar un insumo (13/11). Antes NO miraba nada: con compras las dejaba huérfanas
 * (`SetNull`), con líneas de factura reventaba en un 500 de clave foránea, y los
 * productos que lo usan quedaban con líneas «sin encontrar».
 *
 * ⚠️ Un insumo NO tiene estado, así que «Descontinuar» no existe para él: la única
 * salida que el mensaje puede ofrecer es «Unir con otro insumo». Ofrecer la otra sería
 * mandar a una puerta que no existe.
 */
describe('ComponentsService.remove', () => {
  const insumo = (id: string, extra: Record<string, unknown> = {}) => ({
    id, organizationId: ORG, name: `Insumo ${id}`, packagePrice: 5, unitsPerPackage: 10, scope: 'PER_PIECE', ...extra,
  });
  const compra = (id: string, componentId: string) => ({ id, organizationId: ORG, componentId });
  const producto = (id: string, nombreDeInsumo: string, org = ORG) => ({
    id, organizationId: org, name: `Producto ${id}`,
    input: { filament: { name: 'PLA' }, supplies: [{ name: 'otro', unitCost: 1, quantity: 1 }, { name: nombreDeInsumo, unitCost: 0.5, quantity: 1 }] },
  });
  const borrar = (b: BaseFalsa, id = 'i1', org = ORG) => new ComponentsService(b.prisma as never).remove(org, id);
  const rechazo = async (b: BaseFalsa, id = 'i1') => {
    try {
      await borrar(b, id);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      return (e as ConflictException).message;
    }
    throw new Error('Se esperaba un rechazo y se borró');
  };
  const hay = (b: BaseFalsa, id = 'i1') => b.estado().component.some((c) => c.id === id);

  it('sin nada asociado SÍ se borra (hermano alcanzable de los rechazos)', async () => {
    const b = baseFalsa({ component: [insumo('i1')] });

    await expect(borrar(b)).resolves.toEqual({ ok: true });

    expect(hay(b)).toBe(false);
  });

  it('con compras se rechaza y dice CUÁNTAS; no queda nada huérfano', async () => {
    const b = baseFalsa({ component: [insumo('i1')], expense: [compra('e1', 'i1'), compra('e2', 'i1')] });

    const msg = await rechazo(b);

    expect(msg).toContain('tiene 2 compras');
    expect(hay(b)).toBe(true);
    expect(b.estado().expense.every((e) => e.componentId === 'i1')).toBe(true);
  });

  it('con líneas de factura se rechaza con mensaje (antes, un 500 de clave foránea)', async () => {
    const b = baseFalsa({
      component: [insumo('i1')],
      purchaseInvoice: [{ id: 'f1', organizationId: ORG }],
      purchaseInvoiceLine: [{ id: 'l1', invoiceId: 'f1', componentId: 'i1' }],
    });

    expect(await rechazo(b)).toContain('1 línea de factura');
  });

  it('si lo usa un producto de la tienda se rechaza y dice CUÁLES (y no nombra al que no lo usa)', async () => {
    const b = baseFalsa({
      component: [insumo('i1', { name: 'Argollas' })],
      storeProduct: [producto('p1', 'argollas'), producto('p2', 'Otra cosa')],
    });

    const msg = await rechazo(b);

    expect(msg).toContain('lo usa 1 producto de la tienda («Producto p1»)');
    expect(msg).not.toContain('Producto p2');
  });

  it('un producto de otra organización con el mismo insumo ni bloquea ni se nombra', async () => {
    const b = baseFalsa({ component: [insumo('i1', { name: 'Argollas' })], storeProduct: [producto('pB', 'Argollas', 'org-B')] });

    await expect(borrar(b)).resolves.toEqual({ ok: true });
  });

  it('la ÚNICA salida que ofrece es «Unir con otro insumo»: «Descontinuar» no existe para un insumo', async () => {
    const b = baseFalsa({ component: [insumo('i1', { name: 'Argollas' })], expense: [compra('e1', 'i1')] });

    const msg = await rechazo(b);

    expect(msg).toContain('No se puede borrar «Argollas»');
    expect(msg).toContain('«Unir con otro insumo»');
    expect(msg).not.toContain('«Descontinuar»');
    expect(msg).toContain('Un insumo no se descontinúa');
  });

  it('un insumo de otra organización es 404 y no se toca', async () => {
    const b = baseFalsa({ component: [insumo('iB', { organizationId: 'org-B' })] });

    await expect(borrar(b, 'iB')).rejects.toBeInstanceOf(NotFoundException);

    expect(hay(b, 'iB')).toBe(true);
  });

  it('la ESCRITURA también lleva la organización: con la lectura aflojada no borra el insumo ajeno', async () => {
    const b = baseFalsa({ component: [insumo('iB', { organizationId: 'org-B' })] });
    b.aflojarLectura('component');

    await expect(borrar(b, 'iB')).rejects.not.toBeInstanceOf(NotFoundException);

    expect(hay(b, 'iB')).toBe(true);
  });
});
