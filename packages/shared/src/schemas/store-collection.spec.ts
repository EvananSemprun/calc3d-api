import { StoreCollectionUpsertSchema } from './store';

const base = { nombre: 'Navidad', titulo: 'Colección Navidad 2026' };
const ok = (v: unknown) => StoreCollectionUpsertSchema.safeParse(v);

describe('StoreCollectionUpsertSchema', () => {
  it('acepta una colección mínima y rellena los defaults', () => {
    const r = ok(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.verTodoTipo).toBe('NONE');
      expect(r.data.visible).toBe(true);
      expect(r.data.items).toEqual([]);
      expect(r.data.exclusiones).toEqual([]);
    }
  });

  it('un item es categoría O producto: las dos juntas se rechazan', () => {
    expect(ok({ ...base, items: [{ categoryId: 'c1', productId: 'p1', position: 0 }] }).success).toBe(false);
  });
  it('...y ninguna también (su hermano: solo categoría y solo producto sí pasan)', () => {
    expect(ok({ ...base, items: [{ position: 0 }] }).success).toBe(false);
    expect(ok({ ...base, items: [{ categoryId: 'c1', position: 0 }, { productId: 'p1', position: 1 }] }).success).toBe(true);
  });

  it('la misma categoría dos veces se rechaza', () => {
    expect(
      ok({ ...base, items: [{ categoryId: 'c1', position: 0 }, { categoryId: 'c1', position: 1 }] }).success,
    ).toBe(false);
  });

  it('«Ver todo» exige destino salvo NONE, y NONE lo prohíbe', () => {
    expect(ok({ ...base, verTodoTipo: 'CATEGORIA' }).success).toBe(false);
    expect(ok({ ...base, verTodoTipo: 'CATEGORIA', verTodoValor: 'navidad' }).success).toBe(true);
    expect(ok({ ...base, verTodoTipo: 'NONE', verTodoValor: 'navidad' }).success).toBe(false);
  });

  it('las fechas tienen que existir en el calendario (el 30 de febrero no)', () => {
    expect(ok({ ...base, startsAt: '2026-02-30' }).success).toBe(false);
    expect(ok({ ...base, endsAt: '2026-13-01' }).success).toBe(false);
    expect(ok({ ...base, startsAt: '2026-12-01', endsAt: '2026-12-31' }).success).toBe(true);
  });

  it('termina antes de empezar se rechaza, pero un solo día (mismo día) vale', () => {
    expect(ok({ ...base, startsAt: '2026-12-31', endsAt: '2026-12-01' }).success).toBe(false);
    expect(ok({ ...base, startsAt: '2026-12-24', endsAt: '2026-12-24' }).success).toBe(true);
  });

  it('el slug tiene la forma del de categoría: minúsculas, números y guiones', () => {
    expect(ok({ ...base, slug: 'navidad-2026' }).success).toBe(true);
    expect(ok({ ...base, slug: 'Navidad 2026' }).success).toBe(false);
    expect(ok({ ...base, slug: '' }).success).toBe(false);
  });

  it('esPrincipal NO entra por el cuerpo: se descarta', () => {
    const r = ok({ ...base, esPrincipal: true });
    expect(r.success).toBe(true);
    if (r.success) expect('esPrincipal' in r.data).toBe(false);
  });
});
