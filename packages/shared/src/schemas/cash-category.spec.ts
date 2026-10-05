import { CASH_SIGN, type CashCategory } from '../calc/cash';
import { CashCategorySchema, type CashCategoryDto } from './api';

/**
 * Las nueve líneas de la caja están declaradas DOS veces: como tipo
 * (`CashCategory`, en el motor) y como enum Zod (`CashCategorySchema`, en los
 * contratos). No es duplicación evitable — el tipo se borra al compilar y lo
 * único que frena una categoría inventada en `GET /cash/breakdown/:category`
 * es la validación en tiempo de ejecución.
 *
 * Lo que sí es evitable es que DIVERJAN. Si alguien suma una línea al saldo y
 * se olvida del enum, el desplegable de esa línea devuelve 400 y la pantalla
 * muestra un error en vez de plata; al revés, el enum acepta una categoría que
 * el motor no clasifica y el desplegable sale vacío con la línea en rojo
 * arriba. Los dos casos se ven como "un bug raro de la pantalla", no como lo
 * que son. Este test los convierte en un test rojo.
 */
describe('CashCategorySchema está anclado a CASH_SIGN', () => {
  it('declara exactamente las mismas categorías, en el mismo orden', () => {
    expect(CashCategorySchema.options).toEqual(Object.keys(CASH_SIGN));
  });

  it('una categoría inventada no pasa la validación', () => {
    for (const basura of ['balance', '', '../../etc', 'COLLECTED', 'collected ']) {
      expect(CashCategorySchema.safeParse(basura).success).toBe(false);
    }
  });

  it('los dos tipos son intercambiables', () => {
    // Si los conjuntos divergieran, una de las dos asignaciones no compilaría.
    const delMotor: CashCategory = 'ownerDraws';
    const delContrato: CashCategoryDto = delMotor;
    const vuelta: CashCategory = delContrato;

    expect(vuelta).toBe('ownerDraws');
  });
});
