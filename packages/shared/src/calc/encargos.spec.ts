import {
  avisosDeEncargos,
  totalDeAvisos,
  DIAS_COTIZACION_FRIA,
  DIAS_ENTREGA_PROXIMA,
  type EncargoParaAviso,
} from './encargos';

/**
 * AVISOS DE ENCARGOS (2026-10-12).
 *
 * ⚠️ Medido en producción el día que se escribió esto: 24 encargos, 23
 * entregados y uno en producción con fecha futura. **Cero casos en las cuatro
 * categorías**, así que —como con las procedencias de los abonos— estos tests
 * son la única evidencia de que funcionan. No hay pantalla donde ir a mirarlo.
 *
 * "Hoy" entra como parámetro en todos: un test que leyera el reloj pasaría hoy
 * y fallaría solo algún día.
 */

const HOY = '2026-10-12';

const encargo = (over: Partial<EncargoParaAviso> = {}): EncargoParaAviso => ({
  id: 'e1',
  code: 25,
  status: 'IN_PRODUCTION',
  deliveryDate: '2026-10-14',
  balance: 0,
  createdAt: '2026-10-09',
  ...over,
});

describe('avisosDeEncargos', () => {
  /** El caso real de producción: nada que decir. */
  it('con todo entregado y cobrado no avisa de nada', () => {
    const a = avisosDeEncargos(
      [
        encargo({ id: 'a', status: 'DELIVERED', deliveryDate: '2026-09-30', balance: 0 }),
        encargo({ id: 'b', status: 'DELIVERED', deliveryDate: '2026-10-02', balance: 0 }),
      ],
      HOY,
    );
    expect(totalDeAvisos(a)).toBe(0);
  });

  describe('vencidos', () => {
    it('la fecha pasó y sigue abierto: avisa', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: '2026-10-11' })], HOY);
      expect(a.vencidos.map((e) => e.id)).toEqual(['e1']);
    });

    /** ⚠️ El hermano alcanzable: HOY no está vencido, vence hoy. */
    it('la fecha es HOY: todavía no está vencido', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: HOY })], HOY);
      expect(a.vencidos).toEqual([]);
      expect(a.proximos.map((e) => e.id)).toEqual(['e1']);
    });

    it('entregado con la fecha pasada NO está vencido: ya se entregó', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'DELIVERED', deliveryDate: '2026-09-01' })],
        HOY,
      );
      expect(a.vencidos).toEqual([]);
    });

    it('cancelado con la fecha pasada tampoco: no hay nada que hacer', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'CANCELLED', deliveryDate: '2026-09-01' })],
        HOY,
      );
      expect(totalDeAvisos(a)).toBe(0);
    });

    it('sin fecha de entrega no puede estar vencido', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: null })], HOY);
      expect(a.vencidos).toEqual([]);
      expect(a.proximos).toEqual([]);
    });
  });

  describe('entregados sin cobrar', () => {
    it('entregado con saldo: es plata tuya que está afuera', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'DELIVERED', deliveryDate: '2026-10-02', balance: 15 })],
        HOY,
      );
      expect(a.sinCobrar.map((e) => e.id)).toEqual(['e1']);
    });

    it('entregado y cobrado entero no dice nada', () => {
      const a = avisosDeEncargos([encargo({ status: 'DELIVERED', balance: 0 })], HOY);
      expect(a.sinCobrar).toEqual([]);
    });

    /** Un resto de división no es una deuda. */
    it('un saldo por debajo del centavo no cuenta', () => {
      const a = avisosDeEncargos([encargo({ status: 'DELIVERED', balance: 0.004 })], HOY);
      expect(a.sinCobrar).toEqual([]);
    });

    /**
     * ⚠️ Un encargo ABIERTO con saldo no entra acá: lo normal es que falte
     * plata hasta entregarlo. Avisar de eso sería avisar de todos.
     */
    it('un encargo en producción con saldo no es "sin cobrar"', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'IN_PRODUCTION', balance: 15, deliveryDate: '2026-10-14' })],
        HOY,
      );
      expect(a.sinCobrar).toEqual([]);
      expect(a.proximos.map((e) => e.id)).toEqual(['e1']);
    });
  });

  describe('se entregan pronto', () => {
    it(`entra justo en el borde de ${DIAS_ENTREGA_PROXIMA} días`, () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: '2026-10-15' })], HOY);
      expect(a.proximos.map((e) => e.id)).toEqual(['e1']);
    });

    /** ⚠️ El hermano alcanzable del borde: un día más y ya no avisa. */
    it('un día más allá del borde ya no avisa', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: '2026-10-16' })], HOY);
      expect(a.proximos).toEqual([]);
    });

    it('un encargo LISTO que se entrega pronto también avisa: falta entregarlo', () => {
      const a = avisosDeEncargos([encargo({ status: 'READY', deliveryDate: '2026-10-13' })], HOY);
      expect(a.proximos.map((e) => e.id)).toEqual(['e1']);
    });
  });

  describe('cotizaciones frías', () => {
    it(`una cotización de hace ${DIAS_COTIZACION_FRIA} días está fría`, () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'QUOTED', createdAt: '2026-09-28', deliveryDate: null })],
        HOY,
      );
      expect(a.cotizacionesFrias.map((e) => e.id)).toEqual(['e1']);
    });

    it('un día antes del umbral todavía está en curso', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'QUOTED', createdAt: '2026-09-29', deliveryDate: null })],
        HOY,
      );
      expect(a.cotizacionesFrias).toEqual([]);
    });

    it('solo las COTIZADAS se enfrían: una confirmada vieja no es lo mismo', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'CONFIRMED', createdAt: '2026-08-01', deliveryDate: null })],
        HOY,
      );
      expect(a.cotizacionesFrias).toEqual([]);
    });

    /**
     * ⚠️ **UN ENCARGO AVISA UNA SOLA VEZ.** Esta cotización es vieja Y se pasó
     * de fecha: contarla dos veces infla el renglón y manda al dueño a la
     * misma fila por dos caminos. Gana lo más urgente.
     */
    it('una cotización vieja Y vencida avisa solo como vencida', () => {
      const a = avisosDeEncargos(
        [encargo({ status: 'QUOTED', createdAt: '2026-09-01', deliveryDate: '2026-10-05' })],
        HOY,
      );
      expect(a.vencidos.map((e) => e.id)).toEqual(['e1']);
      expect(a.cotizacionesFrias).toEqual([]);
      expect(totalDeAvisos(a)).toBe(1);
    });
  });

  describe('fechas que no existen', () => {
    /** Un aviso no puede tumbar el Dashboard: `daysBetween` lanzaría. */
    it('una fecha de entrega imposible se ignora en vez de romper', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: '2026-02-30' })], HOY);
      expect(totalDeAvisos(a)).toBe(0);
    });

    it('un "hoy" que no existe no avisa nada en vez de inventar cuentas', () => {
      const a = avisosDeEncargos([encargo({ deliveryDate: '2026-01-01' })], '2026-02-30');
      expect(totalDeAvisos(a)).toBe(0);
    });
  });

  it('cada encargo cae en UNA sola lista', () => {
    const a = avisosDeEncargos(
      [
        encargo({ id: 'vencido', deliveryDate: '2026-10-01' }),
        encargo({ id: 'pronto', deliveryDate: '2026-10-13' }),
        encargo({ id: 'debe', status: 'DELIVERED', deliveryDate: '2026-10-02', balance: 20 }),
        encargo({ id: 'fria', status: 'QUOTED', createdAt: '2026-09-01', deliveryDate: null }),
        encargo({ id: 'sano', status: 'DELIVERED', deliveryDate: '2026-10-02', balance: 0 }),
      ],
      HOY,
    );

    expect(a.vencidos.map((e) => e.id)).toEqual(['vencido']);
    expect(a.proximos.map((e) => e.id)).toEqual(['pronto']);
    expect(a.sinCobrar.map((e) => e.id)).toEqual(['debe']);
    expect(a.cotizacionesFrias.map((e) => e.id)).toEqual(['fria']);
    expect(totalDeAvisos(a)).toBe(4);
  });

  it('sin encargos no devuelve nada, y no explota', () => {
    expect(totalDeAvisos(avisosDeEncargos([], HOY))).toBe(0);
  });
});
