import { activeSale } from './active-sale';

const start = new Date('2026-10-20T22:00:00.000Z');
const end = new Date('2026-10-27T03:59:00.000Z');
const settings = { saleTitle: 'Oferta', saleStartsAt: start, saleEndsAt: end };

describe('activeSale', () => {
  it('null si falta alguna fecha', () => {
    expect(activeSale({ saleTitle: 'x', saleStartsAt: null, saleEndsAt: end }, start)).toBeNull();
    expect(activeSale({ saleTitle: 'x', saleStartsAt: start, saleEndsAt: null }, start)).toBeNull();
    expect(activeSale({ saleTitle: null, saleStartsAt: null, saleEndsAt: null }, start)).toBeNull();
  });

  it('null antes de empezar', () => {
    expect(activeSale(settings, new Date('2026-10-20T21:59:00.000Z'))).toBeNull();
  });

  it('null después de terminar', () => {
    expect(activeSale(settings, new Date('2026-10-27T04:00:00.000Z'))).toBeNull();
  });

  it('devuelve la ventana dentro del rango (bordes inclusivos), con fechas en ISO', () => {
    const r = activeSale(settings, new Date('2026-10-22T10:00:00.000Z'));
    expect(r).toEqual({
      title: 'Oferta',
      startsAt: '2026-10-20T22:00:00.000Z',
      endsAt: '2026-10-27T03:59:00.000Z',
    });
    expect(activeSale(settings, start)).not.toBeNull(); // inicio inclusivo
    expect(activeSale(settings, end)).not.toBeNull(); // fin inclusivo
  });

  it('conserva title null', () => {
    const r = activeSale({ saleTitle: null, saleStartsAt: start, saleEndsAt: end }, start);
    expect(r?.title).toBeNull();
  });
});
