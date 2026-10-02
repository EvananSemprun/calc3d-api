import { CampaignCreateSchema, CampaignUpdateSchema } from './api';

const base = { name: 'Identificadores de lapices', startDate: '2026-09-24' };

describe('CampaignCreateSchema — métricas de la plataforma', () => {
  it('guarda los seguidores ganados (columna "Seguidores" de Publicidad)', () => {
    const dto = CampaignCreateSchema.parse({ ...base, followers: 24 });
    expect(dto.followers).toBe(24);
  });

  it('acepta una campaña sin seguidores medidos', () => {
    expect(CampaignCreateSchema.parse(base).followers).toBeUndefined();
    expect(CampaignCreateSchema.parse({ ...base, followers: null }).followers).toBeNull();
  });

  it('rechaza seguidores negativos o con decimales', () => {
    expect(() => CampaignCreateSchema.parse({ ...base, followers: -1 })).toThrow();
    expect(() => CampaignCreateSchema.parse({ ...base, followers: 2.5 })).toThrow();
  });

  it('el PATCH puede cambiar solo los seguidores', () => {
    expect(CampaignUpdateSchema.parse({ followers: 30 })).toEqual({ followers: 30 });
  });
});
