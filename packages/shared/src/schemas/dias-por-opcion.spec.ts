/**
 * DÍAS DE ENTREGA POR OPCIÓN (2026-11-09).
 *
 * El plazo era del producto entero, así que el dueño lo venía escribiendo a mano DENTRO
 * del nombre de la opción («20 cm · 3 días»): un texto que la ficha no puede sumar ni
 * comparar. Ahora cada opción puede traer sus propios días.
 *
 * ⚠️ `null` y `undefined` NO son lo mismo que `0`. Null significa «esta opción no
 * cambia el plazo» y manda el del producto; un 0 sería prometer entrega el mismo día.
 */
import { StoreOptionSchema } from './store';

describe('StoreOptionSchema — días propios de la opción', () => {
  const base = { value: '20 cm', priceDeltaUsd: 4 };

  it('acepta los días de esa opción', () => {
    const r = StoreOptionSchema.parse({ ...base, leadTimeDays: 3 });
    expect(r.leadTimeDays).toBe(3);
  });

  it('sin días, la opción no cambia el plazo del producto', () => {
    const r = StoreOptionSchema.parse(base);
    expect(r.leadTimeDays ?? null).toBeNull();
  });

  it('null es un valor válido: sirve para BORRAR los días de una opción', () => {
    const r = StoreOptionSchema.parse({ ...base, leadTimeDays: null });
    expect(r.leadTimeDays).toBeNull();
  });

  it('rechaza días negativos', () => {
    expect(StoreOptionSchema.safeParse({ ...base, leadTimeDays: -1 }).success).toBe(false);
  });

  it('rechaza medio día: son días enteros', () => {
    expect(StoreOptionSchema.safeParse({ ...base, leadTimeDays: 1.5 }).success).toBe(false);
  });

  it('rechaza un plazo absurdo, que casi siempre es un dedo de más', () => {
    expect(StoreOptionSchema.safeParse({ ...base, leadTimeDays: 400 }).success).toBe(false);
  });
});
