import { StoreCategorySchema } from './store';

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
});
