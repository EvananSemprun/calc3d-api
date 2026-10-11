import { DIAS_SIN_LECTURA, lecturaDeHorasPendiente } from './production';

/**
 * EL RECORDATORIO DE LA LECTURA DEL CONTADOR.
 *
 * Hay DOS lecturas desde que existe la pantalla, las dos del mismo mes
 * (2026-09, cargadas el 26/09/2026): no era una pantalla de más, era una
 * pantalla sin aviso. Decisión del dueño (2026-10-10): va el recordatorio y la
 * pantalla se queda.
 *
 * Lo que se prueba acá, además de cuándo avisa: que **no moleste mientras la
 * lectura del mes en curso todavía está a tiempo** y que **sin ninguna lectura
 * no pueda decir "hace N días"**.
 */
describe('lecturaDeHorasPendiente: el umbral', () => {
  it('son 35 días, no un número suelto en medio de un if', () => {
    // El valor en sí se justifica en el comentario de `production.ts`; lo que
    // este test fija es que sea UNA constante exportada y no un literal
    // escondido: el día que se discuta "cuánto es mucho", se discute un lugar.
    expect(DIAS_SIN_LECTURA).toBe(35);
  });

  /**
   * ⚠️ **EL CASO QUE DECIDE EL NÚMERO.** La lectura es MENSUAL y se anota al
   * cierre, así que durante TODO el mes siguiente la próxima todavía está a
   * tiempo: desde el último día de un mes hasta el último del siguiente hay 31
   * días como máximo. Un umbral de 30 avisaría el 29 de octubre, con la lectura
   * de octubre legítimamente pendiente — y un aviso que aparece cuando no hay
   * nada que hacer entrena a ignorar los demás.
   */
  it('no avisa en NINGÚN día del mes siguiente a la última lectura', () => {
    const maquinas = [{ lastReading: { month: '2026-09' } }];

    for (const dia of ['2026-10-01', '2026-10-15', '2026-10-30', '2026-10-31']) {
      expect(lecturaDeHorasPendiente(maquinas, dia)).toBeNull();
    }
    // HERMANO ALCANZABLE: ya entrado noviembre, con el mes de octubre saltado, sí avisa.
    expect(lecturaDeHorasPendiente(maquinas, '2026-11-10')).not.toBeNull();
  });

  it('avisa recién pasados los 35 días desde el cierre del mes leído', () => {
    const maquinas = [{ lastReading: { month: '2026-09' } }];

    // Del 30/09 al 03/11 hay 34 días: todavía no.
    expect(lecturaDeHorasPendiente(maquinas, '2026-11-03')).toBeNull();
    // Del 30/09 al 04/11 hay 35: ahí sí, y dice cuántos son.
    expect(lecturaDeHorasPendiente(maquinas, '2026-11-04')).toEqual({
      ultimoMes: '2026-09',
      dias: 35,
    });
  });

  it('los días se cuentan desde el CIERRE del mes leído, no desde su día 1', () => {
    // La lectura es del contador al cerrar septiembre: contar desde el 1/9
    // sumaría un mes de más y el aviso saldría un mes antes de lo que debe.
    expect(lecturaDeHorasPendiente([{ lastReading: { month: '2026-09' } }], '2026-11-20')).toEqual({
      ultimoMes: '2026-09',
      dias: 51,
    });
  });
});

describe('lecturaDeHorasPendiente: cuándo NO avisa', () => {
  it('sin impresoras cargadas no hay nada que leer', () => {
    expect(lecturaDeHorasPendiente([], '2026-12-31')).toBeNull();

    // HERMANO ALCANZABLE: con una impresora, ese mismo día avisa.
    expect(lecturaDeHorasPendiente([{ lastReading: null }], '2026-12-31')).not.toBeNull();
  });

  it('toma la lectura MÁS RECIENTE de todas las máquinas', () => {
    // Una máquina leída en julio y otra en septiembre: lo que mide el hábito es
    // la más reciente. (Las máquinas sin lectura propia las cuenta
    // `printersWithoutReading`, en la pantalla de Producción.)
    const maquinas = [
      { lastReading: { month: '2026-07' } },
      { lastReading: { month: '2026-09' } },
      { lastReading: null },
    ];

    expect(lecturaDeHorasPendiente(maquinas, '2026-10-20')).toBeNull();
    // HERMANO ALCANZABLE: con las dos en julio, ese mismo día avisa.
    expect(
      lecturaDeHorasPendiente([{ lastReading: { month: '2026-07' } }], '2026-10-20'),
    ).toMatchObject({ ultimoMes: '2026-07' });
  });
});

describe('lecturaDeHorasPendiente: cuando NUNCA se leyó un contador', () => {
  /**
   * ⚠️ Sin ninguna lectura **no hay desde cuándo contar**, así que el aviso no
   * puede decir "pasaron N días desde la última". Devuelve `ultimoMes: null` y
   * `dias: null` para que la pantalla diga otra cosa.
   */
  it('avisa, pero sin mes y sin días: no hay "última"', () => {
    expect(lecturaDeHorasPendiente([{ lastReading: null }], '2026-10-10')).toEqual({
      ultimoMes: null,
      dias: null,
    });
  });

  it('con una máquina leída y otra nunca, manda la leída', () => {
    // La que nunca se leyó no vuelve el aviso "nunca": el hábito existe.
    expect(
      lecturaDeHorasPendiente(
        [{ lastReading: null }, { lastReading: { month: '2026-07' } }],
        '2026-10-20',
      ),
    ).toMatchObject({ ultimoMes: '2026-07' });
  });
});

describe('lecturaDeHorasPendiente: el "hoy" es un parámetro', () => {
  it('el mismo parque de máquinas avisa o no según el día que se le pase', () => {
    const maquinas = [{ lastReading: { month: '2026-09' } }];

    expect(lecturaDeHorasPendiente(maquinas, '2026-11-03')).toBeNull();
    expect(lecturaDeHorasPendiente(maquinas, '2026-11-04')).not.toBeNull();
  });

  it('un día que no existe LANZA en vez de devolver una cuenta corrida', () => {
    expect(() =>
      lecturaDeHorasPendiente([{ lastReading: { month: '2026-09' } }], '2026-02-30'),
    ).toThrow();
  });

  it('un mes de lectura inválido LANZA: comparar textos dejaría entrar un 2026-13', () => {
    expect(() => lecturaDeHorasPendiente([{ lastReading: { month: '2026-13' } }], '2026-11-04')).toThrow();
  });
});
