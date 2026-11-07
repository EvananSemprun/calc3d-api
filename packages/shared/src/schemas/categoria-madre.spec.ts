import { StoreCategorySchema, StoreCategoryUpdateSchema } from './store';

describe('StoreCategorySchema.parentId', () => {
  const base = { name: 'Llaveros' };

  it('acepta parentId con un id', () => {
    expect(StoreCategorySchema.parse({ ...base, parentId: 'abc' }).parentId).toBe('abc');
  });
  it('acepta parentId null (mover a la raíz)', () => {
    expect(StoreCategorySchema.parse({ ...base, parentId: null }).parentId).toBeNull();
  });
  it('acepta que parentId no venga', () => {
    expect(StoreCategorySchema.parse(base).parentId).toBeUndefined();
  });
  it('rechaza parentId numérico', () => {
    expect(StoreCategorySchema.safeParse({ ...base, parentId: 5 }).success).toBe(false);
  });
  it('⚠️ rechaza parentId "" (saltaba las guardas del servicio y reventaba la FK)', () => {
    expect(StoreCategorySchema.safeParse({ ...base, parentId: '' }).success).toBe(false);
    expect(StoreCategoryUpdateSchema.safeParse({ parentId: '' }).success).toBe(false);
  });
});

describe('StoreCategoryUpdateSchema (PATCH parcial)', () => {
  it('⚠️ acepta mover sin mandar name', () => {
    const r = StoreCategoryUpdateSchema.safeParse({ parentId: 'abc' });
    expect(r.success).toBe(true);
    expect(r.success && 'name' in r.data).toBe(false);
  });
  it('acepta renombrar sin mandar parentId', () => {
    expect(StoreCategoryUpdateSchema.safeParse({ name: 'Otro' }).success).toBe(true);
  });
  it('sigue rechazando un name vacío si viene', () => {
    expect(StoreCategoryUpdateSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
