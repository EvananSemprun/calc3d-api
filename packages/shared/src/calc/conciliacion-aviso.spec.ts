import {
  conciliacionesQueSeInvalidan,
  mensajeDeConciliacionAfectada,
  type ConciliacionParaAviso,
} from './conciliacion-aviso';

const c = (id: string, date: string, status: ConciliacionParaAviso['status']): ConciliacionParaAviso => ({
  id,
  date,
  status,
});

describe('conciliacionesQueSeInvalidan', () => {
  it('una fecha anterior a una conciliación CONFIRMADA la invalida', () => {
    const r = conciliacionesQueSeInvalidan(['2026-11-01'], [c('a', '2026-11-05', 'CONFIRMED')]);
    expect(r.map((x) => x.id)).toEqual(['a']);
  });

  it('una conciliación en DRAFT también', () => {
    const r = conciliacionesQueSeInvalidan(['2026-11-01'], [c('a', '2026-11-05', 'DRAFT')]);
    expect(r.map((x) => x.id)).toEqual(['a']);
  });

  it('la MISMA fecha cuenta: el esperado incluye el día de la conciliación', () => {
    const r = conciliacionesQueSeInvalidan(['2026-11-05'], [c('a', '2026-11-05', 'CONFIRMED')]);
    expect(r).toHaveLength(1);
  });

  it('una fecha POSTERIOR no pide nada', () => {
    const r = conciliacionesQueSeInvalidan(['2026-11-06'], [c('a', '2026-11-05', 'CONFIRMED')]);
    expect(r).toEqual([]);
  });

  it('una conciliación ANULADA ya no cuenta para nadie', () => {
    const r = conciliacionesQueSeInvalidan(['2026-11-01'], [c('a', '2026-11-05', 'VOID')]);
    expect(r).toEqual([]);
  });

  it('con varias fechas (editar mueve un movimiento) basta con que una caiga adentro', () => {
    const r = conciliacionesQueSeInvalidan(
      ['2026-11-20', '2026-11-01'],
      [c('a', '2026-11-05', 'CONFIRMED')],
    );
    expect(r).toHaveLength(1);
  });

  it('una Date (fecha de negocio guardada a medianoche UTC) se lee por su día UTC', () => {
    const r = conciliacionesQueSeInvalidan(
      [new Date('2026-11-05T00:00:00.000Z')],
      [c('a', '2026-11-05', 'CONFIRMED')],
    );
    expect(r).toHaveLength(1);
  });
});

describe('mensajeDeConciliacionAfectada', () => {
  it('distingue la confirmada de la borrador y dice cómo seguir', () => {
    const m = mensajeDeConciliacionAfectada([
      c('a', '2026-11-05', 'CONFIRMED'),
      c('b', '2026-11-08', 'DRAFT'),
    ]);
    expect(m).toContain('2026-11-05');
    expect(m).toContain('confirmada');
    expect(m).toContain('borrador');
    expect(m).toContain('confirmando');
    expect(m).toContain('anula');
  });
});
