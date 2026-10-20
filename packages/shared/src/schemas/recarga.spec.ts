import { ExpenseCreateSchema, ExpenseUpdateSchema, ExpenseWithDefinitionSchema } from './api';

/**
 * RECARGA (sin carrete) o rollo CON CARRETE.
 *
 * ⚠️ **Lo que estos tests protegen son los TRES valores**, no "que el campo
 * exista". `true` es una recarga, `false` es un rollo con carrete y `null` es
 * *no se registró*: tres hechos distintos. La lección es del 2026-10-19, cuando
 * se descubrió que `paidBy` había nacido con `DEFAULT 'BUSINESS'` y 71 gastos
 * quedaron afirmando que los pagó el negocio sin que nadie lo decidiera.
 *
 * ⚠️ Y **va en la COMPRA, no en la ficha**, y está medido: la ficha
 * `PLA Basic Bambu Lab Blanco` tiene dos compras, una normal (31/08) y una
 * recarga (09/10). En la ficha el campo tendría que mentir sobre una de las dos.
 */
const base = { date: '2026-10-20', description: 'PLA Basic Blanco', amount: 17 };

describe('isRefill — recarga o con carrete', () => {
  it('acepta `true`: es una recarga, sin carrete', () => {
    expect(ExpenseCreateSchema.parse({ ...base, isRefill: true }).isRefill).toBe(true);
  });

  it('acepta `false`: vino CON carrete, y es un dato tan verdadero como el otro', () => {
    expect(ExpenseCreateSchema.parse({ ...base, isRefill: false }).isRefill).toBe(false);
  });

  it('acepta `null`: no se registró — y NO se traduce a `false`', () => {
    expect(ExpenseCreateSchema.parse({ ...base, isRefill: null }).isRefill).toBeNull();
  });

  it('ausente queda ausente: tampoco se rellena con un default', () => {
    expect(ExpenseCreateSchema.parse(base).isRefill).toBeUndefined();
  });

  it('un texto no entra: "sí" no es un booleano', () => {
    expect(ExpenseCreateSchema.safeParse({ ...base, isRefill: 'sí' }).success).toBe(false);
  });

  it('se puede BORRAR el dato al corregir (null explícito en el update)', () => {
    expect(ExpenseUpdateSchema.parse({ isRefill: null }).isRefill).toBeNull();
    expect(ExpenseUpdateSchema.parse({ isRefill: false }).isRefill).toBe(false);
  });

  it('viaja también en el alta con ficha nueva (POST /expenses/with-definition)', () => {
    const dto = ExpenseWithDefinitionSchema.parse({
      expense: { ...base, category: 'CONSUMABLE', isRefill: true, quantity: 1 },
      link: { kind: 'material', mode: 'new', data: { name: 'PLA Basic Blanco', rollPrice: 17, rollGrams: 1000 } },
    });
    expect(dto.expense.isRefill).toBe(true);
  });
});
