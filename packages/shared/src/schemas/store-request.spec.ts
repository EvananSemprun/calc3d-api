import { StoreOrderRequestSchema } from './store-request';

/**
 * Contrato del pedido de la tienda con personalización del cliente (Feature C):
 * cada ítem puede traer una nota corta y la clave de una foto ya subida a R2.
 * Las dos son opcionales; el servidor revalida la clave contra el almacenamiento.
 */

const CLIENTE = { name: 'Ana', phone: '04120000000' };

describe('StoreOrderRequestSchema — personalización', () => {
  it('un ítem acepta customNote y customImageKey opcionales', () => {
    const r = StoreOrderRequestSchema.safeParse({
      customer: CLIENTE,
      items: [
        {
          slug: 'llavero',
          qty: 1,
          options: {},
          customNote: 'con mi logo',
          customImageKey: 'org/custom-uploads/2026-10/x.png',
        },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[0].customNote).toBe('con mi logo');
      expect(r.data.items[0].customImageKey).toBe('org/custom-uploads/2026-10/x.png');
    }
  });

  it('un ítem sin personalización sigue siendo válido', () => {
    const r = StoreOrderRequestSchema.safeParse({
      customer: CLIENTE,
      items: [{ slug: 'llavero', qty: 1, options: {} }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[0].customNote).toBeUndefined();
      expect(r.data.items[0].customImageKey).toBeUndefined();
    }
  });

  it('una nota demasiado larga se rechaza', () => {
    const r = StoreOrderRequestSchema.safeParse({
      customer: CLIENTE,
      items: [{ slug: 'llavero', qty: 1, options: {}, customNote: 'x'.repeat(501) }],
    });
    expect(r.success).toBe(false);
  });
});
