import { MaterialStatusSchema, type MaterialStatus } from '../schemas/stock';
import {
  ETIQUETA_DE_ESTADO,
  SUFIJO_DE_ESTADO,
  entraEnCalculadora,
  entraEnConteo,
  accionesDeEstado,
  entraEnReposicion,
  estadoTrasComprar,
} from './estado-de-ficha';

const PREDICADOS = [entraEnReposicion, entraEnConteo, entraEnCalculadora];

describe('estado de la ficha: qué pantalla la ve', () => {
  it('ACTIVE entra en las tres', () => {
    for (const p of PREDICADOS) expect(p('ACTIVE')).toBe(true);
  });

  it('DISCONTINUED no entra en ninguna', () => {
    for (const p of PREDICADOS) expect(p('DISCONTINUED')).toBe(false);
  });

  // ⚠️ Este es el punto entero del tercer estado: la ficha existe para poder
  // cotizar el pedido especial. Si saliera del calculador, no se podría.
  it('SOLO_PEDIDO_ESPECIAL: fuera de reposición y conteo, DENTRO de calculadora', () => {
    expect(entraEnReposicion('SOLO_PEDIDO_ESPECIAL')).toBe(false);
    expect(entraEnConteo('SOLO_PEDIDO_ESPECIAL')).toBe(false);
    expect(entraEnCalculadora('SOLO_PEDIDO_ESPECIAL')).toBe(true);
  });

  it('el esquema acepta el tercer valor y rechaza uno inventado', () => {
    expect(MaterialStatusSchema.safeParse('SOLO_PEDIDO_ESPECIAL').success).toBe(true);
    expect(MaterialStatusSchema.safeParse('BORRADO').success).toBe(false);
  });

  it('cada valor del enum tiene respuesta en los tres predicados', () => {
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

describe('accionesDeEstado: la escalera de acciones', () => {
  // Compras NO filtra por estado (se ofrecen las tres fichas: volver a comprar es la
  // señal de que el filamento volvió, ver `estadoTrasComprar`). Ningún texto puede
  // prometer lo contrario: ya pasó, y la afirmación sobre compras no la ataba nadie.
  it('ningún efecto afirma que una ficha deja de aparecer al registrar compras', () => {
    for (const origen of MaterialStatusSchema.options) {
      for (const a of accionesDeEstado(origen)) {
        expect(a.efecto).not.toMatch(/(deja|dejan) de aparecer[^.]*compras/i);
      }
    }
  });

  // Las dos que llevan a DISCONTINUED describen el MISMO estado: no pueden contradecirse.
  it('las acciones que llevan a DISCONTINUED dicen lo mismo de las compras', () => {
    const frase = 'Se reactiva sola al registrar una compra con rollos';
    const haciaDescontinuada = (['ACTIVE', 'SOLO_PEDIDO_ESPECIAL'] as const)
      .flatMap((o) => accionesDeEstado(o))
      .filter((a) => a.destino === 'DISCONTINUED');
    expect(haciaDescontinuada).toHaveLength(2);
    for (const a of haciaDescontinuada) expect(a.efecto).toContain(frase);
  });

  const destinos = (s: MaterialStatus) => accionesDeEstado(s).map((a) => a.destino);

  it('cada estado ofrece las acciones que le tocan y ninguna más', () => {
    expect(destinos('ACTIVE')).toEqual(['SOLO_PEDIDO_ESPECIAL', 'DISCONTINUED']);
    expect(destinos('SOLO_PEDIDO_ESPECIAL')).toEqual(['ACTIVE', 'DISCONTINUED']);
    expect(destinos('DISCONTINUED')).toEqual(['ACTIVE']);
  });

  it('ninguna acción lleva al estado en el que ya está', () => {
    for (const s of MaterialStatusSchema.options) expect(destinos(s)).not.toContain(s);
  });

  // Los textos no pueden afirmar un cambio que ya había pasado: se cruzan con los predicados.
  it('cada efecto menciona SOLO lo que cambia entre origen y destino', () => {
    for (const origen of MaterialStatusSchema.options) {
      for (const a of accionesDeEstado(origen)) {
        const cambia = {
          cotizar: entraEnCalculadora(origen) !== entraEnCalculadora(a.destino),
          reposicion: entraEnReposicion(origen) !== entraEnReposicion(a.destino),
        };
        // La frase de «deja/vuelve a aparecer al cotizar» solo si el calculador cambia.
        expect(/(Deja de|Vuelve a) aparecer al cotizar/.test(a.efecto)).toBe(cambia.cotizar);
        // «Sale de / Vuelve a la / en la reposición» solo si la reposición cambia.
        const hablaDeReposicion = /(Sale de la|Vuelve a la|en la) reposición/.test(a.efecto.replace('Ya estaba fuera de la reposición', ''));
        expect(hablaDeReposicion).toBe(cambia.reposicion);
      }
    }
  });
});
