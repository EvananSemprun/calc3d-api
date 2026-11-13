import { ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { baseFalsa, type BaseFalsa } from '../common/unir-fichas.fake';

const ORG = 'org-A';

/**
 * Borrar una ficha: solo si no tiene historial (2026-09-14) — y desde el 13/11, con
 * el rechazo DICIENDO cuántas cosas la usan, cuáles productos, y la SALIDA con las
 * palabras de los botones («Descontinuar», «Unir con otra ficha…»). Va contra la
 * base falsa con claves foráneas reales: una línea de factura es `Restrict` (borrar
 * la ficha reventaba en un 500 sin explicación) y los productos la nombran por nombre.
 */
describe('MaterialsService.remove', () => {
  const mat = (id: string, extra: Record<string, unknown> = {}) => ({
    id, organizationId: ORG, name: `Ficha ${id}`, rollPrice: 20, rollGrams: 1000, status: 'ACTIVE', ...extra,
  });
  const producto = (id: string, nombreDeFicha: string, extra: Record<string, unknown> = {}) => ({
    id, organizationId: ORG, name: `Producto ${id}`,
    input: { filament: { name: nombreDeFicha, rollPrice: 20, rollGrams: 1000, grams: 5 }, supplies: [] }, ...extra,
  });
  const compra = (id: string, materialId: string) => ({ id, organizationId: ORG, materialId });
  const borrar = (b: BaseFalsa, id = 'm1', org = ORG) => new MaterialsService(b.prisma as never).remove(org, id);
  const intentoRechazado = async (b: BaseFalsa, id = 'm1') => {
    try {
      await borrar(b, id);
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      return (e as ConflictException).message;
    }
    throw new Error('Se esperaba un rechazo y se borró');
  };
  const hay = (b: BaseFalsa, id = 'm1') => b.estado().material.some((m) => m.id === id);

  it('sin nada asociado SÍ se borra (hermano alcanzable de todos los rechazos)', async () => {
    const b = baseFalsa({ material: [mat('m1')] });

    await expect(borrar(b)).resolves.toEqual({ ok: true });

    expect(hay(b)).toBe(false);
  });

  it('con compras se rechaza y dice CUÁNTAS', async () => {
    const b = baseFalsa({ material: [mat('m1')], expense: [compra('e1', 'm1'), compra('e2', 'm1'), compra('e3', 'm1')] });

    const msg = await intentoRechazado(b);

    expect(msg).toContain('tiene 3 compras');
    expect(hay(b)).toBe(true);
    expect(b.estado().expense.every((e) => e.materialId === 'm1')).toBe(true); // nada quedó huérfano
  });

  it('con una sola compra habla en singular', async () => {
    const b = baseFalsa({ material: [mat('m1')], expense: [compra('e1', 'm1')] });

    const msg = await intentoRechazado(b);

    expect(msg).toContain('tiene 1 compra.');
  });

  it('con conteos de rollos, aunque el mes siga abierto, se rechaza y dice cuántos', async () => {
    const b = baseFalsa({
      material: [mat('m1')],
      stockCount: [
        { id: 'c1', organizationId: ORG, materialId: 'm1', month: new Date('2026-08-01T00:00:00Z') },
        { id: 'c2', organizationId: ORG, materialId: 'm1', month: new Date('2026-09-01T00:00:00Z') },
      ],
    });

    expect(await intentoRechazado(b)).toContain('tiene 2 conteos de rollos');
    expect(b.estado().stockCount).toHaveLength(2); // el Cascade no llegó a borrarlos
  });

  it('con líneas de factura se rechaza con mensaje (antes era un 500 de clave foránea)', async () => {
    const b = baseFalsa({
      material: [mat('m1')],
      purchaseInvoice: [{ id: 'f1', organizationId: ORG }],
      purchaseInvoiceLine: [{ id: 'l1', invoiceId: 'f1', materialId: 'm1' }],
    });

    expect(await intentoRechazado(b)).toContain('1 línea de factura');
  });

  it('si la usa un producto de la tienda se rechaza y dice CUÁLES', async () => {
    const b = baseFalsa({
      material: [mat('m1', { name: 'PLA Rojo' })],
      storeProduct: [producto('p1', 'pla rojo'), producto('p2', 'PLA Rojo'), producto('p3', 'otra ficha')],
    });

    const msg = await intentoRechazado(b);

    expect(msg).toContain('la usan 2 productos de la tienda');
    expect(msg).toContain('«Producto p1»');
    expect(msg).toContain('«Producto p2»');
    expect(msg).not.toContain('Producto p3'); // hermano: el que NO la usa no se nombra
    expect(hay(b)).toBe(true);
  });

  it('con compras Y productos dice las dos cosas', async () => {
    const b = baseFalsa({
      material: [mat('m1', { name: 'PLA Rojo' })],
      expense: [compra('e1', 'm1')],
      storeProduct: [producto('p1', 'PLA Rojo')],
    });

    const msg = await intentoRechazado(b);

    expect(msg).toContain('tiene 1 compra y la usa 1 producto de la tienda («Producto p1»)');
  });

  it('un producto de OTRA organización con el mismo nombre ni bloquea ni se nombra (la lectura de productos lleva la organización: es su única capa)', async () => {
    const b = baseFalsa({
      material: [mat('m1', { name: 'PLA Rojo' })],
      storeProduct: [producto('pB', 'PLA Rojo', { organizationId: 'org-B' })],
    });

    await expect(borrar(b)).resolves.toEqual({ ok: true }); // hermano alcanzable del siguiente
  });

  it('el rechazo OFRECE LA SALIDA con las palabras de los botones: «Descontinuar» y «Unir con otra ficha…»', async () => {
    const b = baseFalsa({ material: [mat('m1')], expense: [compra('e1', 'm1')] });

    const msg = await intentoRechazado(b);

    expect(msg).toContain('«Descontinuar»');
    expect(msg).toContain('«Unir con otra ficha…»');
  });

  it('una ficha «solo pedido especial» sí puede descontinuarse: se le ofrece', async () => {
    const b = baseFalsa({ material: [mat('m1', { status: 'SOLO_PEDIDO_ESPECIAL' })], expense: [compra('e1', 'm1')] });

    expect(await intentoRechazado(b)).toContain('«Descontinuar»');
  });

  it('una ya descontinuada NO se manda a «Descontinuar» (esa puerta no existe): solo a unir', async () => {
    const b = baseFalsa({ material: [mat('m1', { status: 'DISCONTINUED' })], expense: [compra('e1', 'm1')] });

    const msg = await intentoRechazado(b);

    expect(msg).not.toContain('«Descontinuar»');
    expect(msg).toContain('Ya está descontinuada');
    expect(msg).toContain('«Unir con otra ficha…»');
  });

  it('el rechazo nombra la ficha', async () => {
    const b = baseFalsa({ material: [mat('m1', { name: 'PLA Rojo' })], expense: [compra('e1', 'm1')] });

    expect(await intentoRechazado(b)).toContain('No se puede borrar «PLA Rojo»');
  });

  it('una ficha de otra organización es 404 y no se toca', async () => {
    const b = baseFalsa({ material: [mat('mB', { organizationId: 'org-B' })] });

    await expect(borrar(b, 'mB')).rejects.toBeInstanceOf(NotFoundException);

    expect(hay(b, 'mB')).toBe(true);
  });

  it('la ESCRITURA también lleva la organización: con la lectura aflojada no borra la ficha ajena', async () => {
    const b = baseFalsa({ material: [mat('mB', { organizationId: 'org-B' })] });
    b.aflojarLectura('material');

    // La lectura aflojada «encuentra» la ficha ajena; el deleteMany acotado afecta 0 y se exige 1.
    await expect(borrar(b, 'mB')).rejects.not.toBeInstanceOf(NotFoundException);

    expect(hay(b, 'mB')).toBe(true);
  });
});
