import { SaleCreateSchema, SaleUpdateSchema } from './api';

/**
 * Encargo = pedido (decisión del dueño, 2026-09-14). Un encargo se registra
 * SOLO como pedido, con su cliente, abonos y saldo. Si además se pudiera anotar
 * como venta tipo ENCARGO, el mismo dinero entraría dos veces a los ingresos
 * (ventas + abonos). Las ventas ENCARGO que existen son el historial semanal del
 * Excel (sin detalle) y se conservan, pero no se crean nuevas.
 */
describe('SaleCreateSchema: encargo = pedido', () => {
  it('rechaza una venta nueva de tipo ENCARGO', () => {
    const r = SaleCreateSchema.safeParse({ date: '2026-09-14', amount: 12, kind: 'ENCARGO' });

    expect(r.success).toBe(false);
  });

  it('una venta sin tipo es de mostrador', () => {
    expect(SaleCreateSchema.parse({ date: '2026-09-14', amount: 3 }).kind).toBe('COUNTER');
  });

  it('acepta la venta de mostrador explícita', () => {
    expect(SaleCreateSchema.parse({ date: '2026-09-14', amount: 3, kind: 'COUNTER' }).kind).toBe(
      'COUNTER',
    );
  });
});

describe('SaleUpdateSchema: encargo = pedido', () => {
  it('no deja convertir una venta en ENCARGO al editarla', () => {
    expect(SaleUpdateSchema.safeParse({ kind: 'ENCARGO' }).success).toBe(false);
  });

  it('editar un encargo viejo sin tocar el tipo sigue funcionando', () => {
    expect(SaleUpdateSchema.parse({ note: 'corrección' })).toEqual({ note: 'corrección' });
  });
});
