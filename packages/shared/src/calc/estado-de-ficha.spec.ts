import { MaterialStatusSchema, type MaterialStatus } from '../schemas/stock';
import {
  ETIQUETA_DE_ESTADO,
  SUFIJO_DE_ESTADO,
  entraEnCalculadora,
  entraEnCompras,
  entraEnConteo,
  entraEnReposicion,
  estadoTrasComprar,
} from './estado-de-ficha';

const PREDICADOS = [entraEnReposicion, entraEnConteo, entraEnCalculadora, entraEnCompras];

describe('estado de la ficha: qué pantalla la ve', () => {
  it('ACTIVE entra en las cuatro', () => {
    for (const p of PREDICADOS) expect(p('ACTIVE')).toBe(true);
  });

  it('DISCONTINUED no entra en ninguna', () => {
    for (const p of PREDICADOS) expect(p('DISCONTINUED')).toBe(false);
  });

  // ⚠️ Este es el punto entero del tercer estado: la ficha existe para poder
  // cotizar el pedido especial. Si saliera del calculador, no se podría.
  it('SOLO_PEDIDO_ESPECIAL: fuera de reposición y conteo, DENTRO de calculadora y compras', () => {
    expect(entraEnReposicion('SOLO_PEDIDO_ESPECIAL')).toBe(false);
    expect(entraEnConteo('SOLO_PEDIDO_ESPECIAL')).toBe(false);
    expect(entraEnCalculadora('SOLO_PEDIDO_ESPECIAL')).toBe(true);
    expect(entraEnCompras('SOLO_PEDIDO_ESPECIAL')).toBe(true);
  });

  it('el esquema acepta el tercer valor y rechaza uno inventado', () => {
    expect(MaterialStatusSchema.safeParse('SOLO_PEDIDO_ESPECIAL').success).toBe(true);
    expect(MaterialStatusSchema.safeParse('BORRADO').success).toBe(false);
  });

  it('cada valor del enum tiene respuesta en los cuatro predicados', () => {
    for (const s of MaterialStatusSchema.options as MaterialStatus[]) {
      for (const p of PREDICADOS) expect(typeof p(s)).toBe('boolean');
    }
  });
});

describe('estadoTrasComprar: qué le pasa al estado de una ficha cuando se le compra', () => {
  it('una descontinuada vuelve a ACTIVE (se volvió a comprar: se sigue manejando)', () => {
    expect(estadoTrasComprar('DISCONTINUED')).toBe('ACTIVE');
  });

  it('una activa sigue activa', () => {
    expect(estadoTrasComprar('ACTIVE')).toBe('ACTIVE');
  });

  // ⚠️ Comprar un rollo para un encargo puntual NO cambia lo que el dueño decidió:
  // reactivar es un acto explícito, no un efecto secundario de una compra.
  it('«solo pedido especial» NO se reactiva sola', () => {
    expect(estadoTrasComprar('SOLO_PEDIDO_ESPECIAL')).toBe('SOLO_PEDIDO_ESPECIAL');
  });
});

describe('ETIQUETA_DE_ESTADO', () => {
  it('cada valor del enum tiene un rótulo propio y distinto', () => {
    const rotulos = MaterialStatusSchema.options.map((s) => ETIQUETA_DE_ESTADO[s]);
    expect(rotulos).toEqual(['Activo', 'Descontinuado', 'Solo pedido especial']);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });
});

describe('SUFIJO_DE_ESTADO', () => {
  it('la activa no lleva sufijo y las otras dos llevan el suyo, distinto', () => {
    expect(SUFIJO_DE_ESTADO.ACTIVE).toBe('');
    expect(SUFIJO_DE_ESTADO.DISCONTINUED).toBe(' (descontinuado)');
    expect(SUFIJO_DE_ESTADO.SOLO_PEDIDO_ESPECIAL).toBe(' (solo pedido especial)');
  });
});
