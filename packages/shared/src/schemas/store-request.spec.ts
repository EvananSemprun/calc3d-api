import { StoreOrderRequestSchema, STORE_MAX_OPTION_GROUPS } from './store-request';

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

/**
 * CUÁNTAS OPCIONES PUEDE TRAER UN RENGLÓN (auditoría del 2026-11-05).
 *
 * ⚠️ Cada opción ya estaba acotada en LARGO (clave 40, valor 60) pero no en
 * CANTIDAD: con el cuerpo limitado a 2 MB entraban miles de pares, y validarlos
 * es trabajo que un visitante sin cuenta le puede pedir al servidor.
 *
 * El tope NO es un número elegido a ojo: es el mismo que ya limita los grupos
 * de una ficha (`STORE_MAX_OPTION_GROUPS`). No puede haber más opciones
 * elegidas que grupos donde elegirlas; cualquier extra el servidor lo rechaza
 * igual al comparar contra la ficha, solo que después de haberlo validado.
 * Medido en producción el 2026-11-05: la ficha con más grupos tiene 2.
 */
describe('StoreOrderRequestSchema — cuántas opciones admite un renglón', () => {
  const conOpciones = (cuantas: number) =>
    StoreOrderRequestSchema.safeParse({
      customer: { name: 'Daelis', phone: '04141234567' },
      items: [
        {
          slug: 'llavero',
          qty: 1,
          options: Object.fromEntries(
            Array.from({ length: cuantas }, (_, i) => [`G${i}`, 'X']),
          ),
        },
      ],
    });

  it(`acepta hasta ${STORE_MAX_OPTION_GROUPS} opciones, que es el tope de grupos de una ficha`, () => {
    expect(conOpciones(STORE_MAX_OPTION_GROUPS).success).toBe(true);
  });

  it('rechaza una más', () => {
    expect(conOpciones(STORE_MAX_OPTION_GROUPS + 1).success).toBe(false);
  });

  // ⚠️ El caso real: 2 grupos. Si el tope se bajara por debajo de lo que la
  // ficha permite, un pedido legítimo quedaría afuera.
  it('un pedido normal de 2 opciones pasa', () => {
    expect(conOpciones(2).success).toBe(true);
  });

  it('sin opciones pasa, y queda en objeto vacío', () => {
    const r = conOpciones(0);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0].options).toEqual({});
  });
});
