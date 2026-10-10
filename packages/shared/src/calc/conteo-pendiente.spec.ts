import { conteoDeStockPendiente } from './stock';

/**
 * EL RECORDATORIO DEL CONTEO — cuándo hay que avisar que falta cerrar un mes.
 *
 * El dueño no contó el mes pasado porque **no entró** a la pantalla de Stock,
 * así que el aviso vive en el Dashboard y esta función es la que decide si
 * aparece. Todo lo que se prueba acá son los casos en que **NO** tiene que
 * aparecer: un aviso que sale cuando no hay nada que hacer entrena a ignorarlo,
 * y el que se pierde después es el que importaba.
 */
describe('conteoDeStockPendiente: cuándo avisa', () => {
  it('empezó un mes nuevo y el anterior quedó sin cerrar', () => {
    // Hoy 10 de octubre, el último cierre es agosto: septiembre quedó sin contar.
    expect(conteoDeStockPendiente('2026-08', '2026-10-10')).toEqual({
      mes: '2026-09',
      ultimoCerrado: '2026-08',
      meses: 1,
    });
  });

  it('avisa desde el PRIMER día del mes nuevo: el mes anterior ya terminó', () => {
    expect(conteoDeStockPendiente('2026-08', '2026-10-01')).toMatchObject({ mes: '2026-09' });
  });

  it('dice cuántos meses se saltaron, no solo el último', () => {
    // Último cierre en junio, hoy en octubre: julio, agosto y septiembre.
    expect(conteoDeStockPendiente('2026-06', '2026-10-10')).toEqual({
      mes: '2026-09',
      ultimoCerrado: '2026-06',
      meses: 3,
    });
  });

  it('cruza el año sin inventar un mes 13', () => {
    expect(conteoDeStockPendiente('2026-11', '2027-01-05')).toEqual({
      mes: '2026-12',
      ultimoCerrado: '2026-11',
      meses: 1,
    });
  });
});

describe('conteoDeStockPendiente: cuándo NO avisa', () => {
  it('el mes anterior ya está cerrado', () => {
    // Hoy 10 de octubre y septiembre cerrado: no hay nada que contar hasta el 1/11.
    expect(conteoDeStockPendiente('2026-09', '2026-10-10')).toBeNull();

    // HERMANO ALCANZABLE: el mismo libro con el cierre un mes antes SÍ avisa,
    // así que el null de arriba es la regla y no un "siempre null".
    expect(conteoDeStockPendiente('2026-08', '2026-10-10')).not.toBeNull();
  });

  it('no hay NINGÚN mes cerrado todavía: un negocio que arranca no tiene nada que contar', () => {
    // El primer conteo de la historia no es un olvido: no hay con qué comparar
    // y el aviso aparecería el día uno, antes de que exista un estante.
    expect(conteoDeStockPendiente(null, '2026-10-10')).toBeNull();

    // HERMANO ALCANZABLE: con un solo cierre viejo ya avisa.
    expect(conteoDeStockPendiente('2026-08', '2026-10-10')).not.toBeNull();
  });

  it('el mes EN CURSO ya se cerró (se cerró adelantado): no se pide contarlo de nuevo', () => {
    expect(conteoDeStockPendiente('2026-10', '2026-10-10')).toBeNull();

    // HERMANO ALCANZABLE: con el cierre en el mes anterior al anterior, avisa.
    expect(conteoDeStockPendiente('2026-08', '2026-10-10')).not.toBeNull();
  });

  it('el mes anterior se cerró el mismo día que empezó el nuevo', () => {
    // Caso REAL: septiembre se cerró el 1/10/2026 a las 8:20. Ese 1 de octubre
    // el aviso ya no tiene que estar.
    expect(conteoDeStockPendiente('2026-09', '2026-10-01')).toBeNull();
    expect(conteoDeStockPendiente('2026-08', '2026-10-01')).not.toBeNull();
  });
});

describe('conteoDeStockPendiente: el "hoy" es un parámetro', () => {
  /**
   * ⚠️ El reloj NO se lee adentro. Un test que dependa de la fecha de la
   * máquina pasa hoy y falla solo algún día; y con el reloj adentro no habría
   * manera de probar el borde del cambio de mes. Convención ya usada por
   * `cashChainCuts`, `facturasAtrasadas`, `preciosPorTipo` y `campaignLifecycle`.
   */
  it('el mismo libro avisa o no según el día que se le pase', () => {
    expect(conteoDeStockPendiente('2026-09', '2026-10-31')).toBeNull();
    expect(conteoDeStockPendiente('2026-09', '2026-11-01')).toEqual({
      mes: '2026-10',
      ultimoCerrado: '2026-09',
      meses: 1,
    });
  });

  it('un día que no existe LANZA en vez de devolver un aviso corrido', () => {
    // `'2026-02-30'` pasa cualquier regex y JS lo corre al 2 de marzo: el aviso
    // hablaría de otro mes y nadie se enteraría.
    expect(() => conteoDeStockPendiente('2026-01', '2026-02-30')).toThrow(/2026-02-30/);
    expect(() => conteoDeStockPendiente('2026-01', '2026-13-01')).toThrow();
  });

  it('un mes de cierre inválido LANZA: comparar textos dejaría entrar un 2026-13', () => {
    expect(() => conteoDeStockPendiente('2026-13', '2026-10-10')).toThrow();
  });
});
