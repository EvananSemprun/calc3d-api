import { CatalogOptionsService } from './catalog-options.module';

const ORG = 'org-A';
const OTRA = 'org-B';

/**
 * LA LISTA ADMINISTRADA UNIDA A LO QUE DE VERDAD SE USA.
 *
 * El importador del Excel escribió marcas, tipos y colores directo en
 * `Material` sin registrarlos como opción, así que el desplegable NO ofrecía
 * tipos que el dueño ya usa. Los volvía a tipear y aparecían variantes
 * ("PLA Pure" junto a "PLA PURE") que rompen el agrupado del análisis.
 */
describe('CatalogOptionsService.list', () => {
  /**
   * ⚠️ El mock MODELA la base: filtra por organización y por `kind`, y el
   * `distinct` se aplica de verdad. Uno que devolviera siempre todo haría pasar
   * el test de aislamiento con y sin el filtro.
   */
  const baseFalsa = (
    opciones: { id: string; organizationId: string; kind: string; value: string }[],
    fichas: { organizationId: string; brand?: string | null; type?: string | null; color?: string | null }[],
  ) => ({
    catalogOption: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          opciones.filter(
            (o) => o.organizationId === where.organizationId && (!where.kind || o.kind === where.kind),
          ),
        ),
      ),
    },
    material: {
      findMany: jest.fn(({ where, select, distinct }: any) => {
        const columna = Object.keys(select)[0] as 'brand' | 'type' | 'color';
        const vistos = new Set<unknown>();
        const filas = fichas
          .filter((f) => f.organizationId === where.organizationId && f[columna] != null)
          .map((f) => ({ [columna]: f[columna] }))
          .filter((f) => {
            if (!distinct) return true;
            if (vistos.has(f[columna])) return false;
            vistos.add(f[columna]);
            return true;
          });
        return Promise.resolve(filas);
      }),
    },
  });

  const servicio = (p: ReturnType<typeof baseFalsa>) => new CatalogOptionsService(p as never);

  it('ofrece un tipo que una ficha ya usa aunque no esté registrado', async () => {
    const p = baseFalsa([], [{ organizationId: ORG, type: 'PLA PURE' }]);

    const r = await servicio(p).list(ORG, 'MATERIAL_TYPE');

    expect(r).toEqual([{ id: null, kind: 'MATERIAL_TYPE', value: 'PLA PURE' }]);
  });

  // El hermano alcanzable: sin esto, lo de arriba pasaría con un servicio que
  // devolviera SIEMPRE lo de las fichas e ignorara la lista administrada.
  it('y también los registrados, con su id', async () => {
    const p = baseFalsa([{ id: 'o1', organizationId: ORG, kind: 'MATERIAL_TYPE', value: 'PETG' }], []);

    const r = await servicio(p).list(ORG, 'MATERIAL_TYPE');

    expect(r).toEqual([{ id: 'o1', kind: 'MATERIAL_TYPE', value: 'PETG' }]);
  });

  /** Registrado y en uso son el MISMO valor: una sola fila, la que se puede borrar. */
  it('no duplica un valor que está registrado y además en uso', async () => {
    const p = baseFalsa(
      [{ id: 'o1', organizationId: ORG, kind: 'MATERIAL_TYPE', value: 'PLA' }],
      [{ organizationId: ORG, type: 'PLA' }],
    );

    const r = await servicio(p).list(ORG, 'MATERIAL_TYPE');

    expect(r).toEqual([{ id: 'o1', kind: 'MATERIAL_TYPE', value: 'PLA' }]);
  });

  /** Si no, "PLA" registrado y "pla" en una ficha se ofrecerían como dos. */
  it('tampoco si solo cambian las mayúsculas', async () => {
    const p = baseFalsa(
      [{ id: 'o1', organizationId: ORG, kind: 'MATERIAL_TYPE', value: 'PLA' }],
      [{ organizationId: ORG, type: 'pla' }],
    );

    expect(await servicio(p).list(ORG, 'MATERIAL_TYPE')).toHaveLength(1);
  });

  it('un tipo que usa OTRA organización no se ofrece acá', async () => {
    const p = baseFalsa([], [{ organizationId: OTRA, type: 'Secreto ajeno' }]);

    expect(await servicio(p).list(ORG, 'MATERIAL_TYPE')).toEqual([]);
  });

  it('…y su hermano: pedido por su propia organización, sí aparece', async () => {
    const p = baseFalsa([], [{ organizationId: OTRA, type: 'Secreto ajeno' }]);

    expect(await servicio(p).list(OTRA, 'MATERIAL_TYPE')).toEqual([
      { id: null, kind: 'MATERIAL_TYPE', value: 'Secreto ajeno' },
    ]);
  });

  it('el color de una ficha no se cuela en la lista de tipos', async () => {
    const p = baseFalsa([], [{ organizationId: ORG, type: 'PLA', color: 'Negro' }]);

    expect(await servicio(p).list(ORG, 'MATERIAL_TYPE')).toEqual([
      { id: null, kind: 'MATERIAL_TYPE', value: 'PLA' },
    ]);
  });

  it('sin `kind` devuelve las tres listas', async () => {
    const p = baseFalsa([], [{ organizationId: ORG, brand: 'Bambu', type: 'PLA', color: 'Negro' }]);

    const r = await servicio(p).list(ORG);

    expect(r.map((o) => `${o.kind}:${o.value}`).sort()).toEqual([
      'MATERIAL_BRAND:Bambu',
      'MATERIAL_COLOR:Negro',
      'MATERIAL_TYPE:PLA',
    ]);
  });
});
