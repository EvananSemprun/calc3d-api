import { GROWTH_LEVELS } from '../calc/goal';
import { GoalSuggestionQuerySchema, GrowthLevelSchema } from './api';

describe('contrato de la sugerencia de metas', () => {
  it('el enum de crecimiento sale de GROWTH_LEVELS y no de una lista aparte', () => {
    // Si alguien agrega un nivel al motor y no al schema, el porcentaje que se
    // muestra deja de ser el que se aplica. Este test lo caza.
    expect([...GrowthLevelSchema.options].sort()).toEqual(Object.keys(GROWTH_LEVELS).sort());
  });

  it('acepta un mes bien formado, con y sin crecimiento', () => {
    expect(GoalSuggestionQuerySchema.parse({ month: '2027-01' })).toEqual({ month: '2027-01' });
    expect(GoalSuggestionQuerySchema.parse({ month: '2027-01', growth: 'AMBICIOSO' })).toMatchObject({
      growth: 'AMBICIOSO',
    });
  });

  it('rechaza un mes mal formado', () => {
    for (const month of ['2027-1', '2027-13', 'enero', '', '2027-00']) {
      expect(GoalSuggestionQuerySchema.safeParse({ month }).success).toBe(false);
    }
  });

  it('rechaza un nivel de crecimiento inventado', () => {
    expect(
      GoalSuggestionQuerySchema.safeParse({ month: '2027-01', growth: 'AGRESIVO' }).success,
    ).toBe(false);
  });
});
