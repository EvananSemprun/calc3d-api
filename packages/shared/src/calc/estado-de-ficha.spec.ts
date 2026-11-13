import { MaterialStatusSchema, type MaterialStatus } from '../schemas/stock';
import {
  entraEnCalculadora,
  entraEnCompras,
  entraEnConteo,
  entraEnReposicion,
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
