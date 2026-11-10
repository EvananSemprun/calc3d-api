import { D, sum, toMoney } from './money';

/**
 * CUÁNTO VALE EN DINERO EL FILAMENTO QUE QUEDA, al cierre de un mes.
 *
 * ⚠️ Es una ESTIMACIÓN, y conviene no disfrazarla de medición. El conteo
 * físico distingue tres estados —sellado, en uso, por acabarse— pero NO sabe
 * gramos: cuánto vale un rollo abierto es una convención del negocio, no un
 * dato. Por eso, además del total, se devuelve el rango honesto (`piso` y
 * `techo`): el valor real está ahí adentro.
 *
 * ⚠️ El precio que entra acá es el de la ÚLTIMA compra de esa ficha, así que
 * esto es COSTO DE REPOSICIÓN ("cuánto costaría volver a tener esto"), no lo
 * que se pagó en su momento. Para saber con cuánto material cuentas, sirve;
 * como valuación contable histórica, no es lo mismo.
 */

/** Las tres casillas del conteo de una ficha, con el precio de un rollo entero. */
export interface RolloValorizable {
  sealed: number;
  inUse: number;
  running: number;
  /**
   * Precio de un rollo entero. `null` = la ficha nunca se compró, así que no
   * hay precio que usar. Poner 0 diría "vale nada" en vez de "no sé": sus
   * rollos se cuentan aparte, en `sinPrecio`.
   */
  lastRollPrice: number | null;
}

/**
 * Cuánto del precio de un rollo entero vale cada estado.
 *
 * `running` es "menos de un cuarto" (ver `StockCount` en el schema), o sea
 * algo entre 0 y 0.25: 0.125 es el punto medio de ese rango, no un número
 * elegido a ojo. Se exporta para poder MOSTRAR la convención en pantalla:
 * una estimación que no dice de dónde sale es una caja negra.
 */
export const FRACCIONES_DE_ROLLO = { sealed: 1, inUse: 0.5, running: 0.125 } as const;

export interface ValorDelInventario {
  /** Ya con la fracción de su estado aplicada. */
  sellados: number;
  enUso: number;
  porAcabarse: number;
  total: number;
  /** Si los abiertos no valieran nada: solo los sellados. */
  piso: number;
  /** Si todos los abiertos estuvieran llenos: todo a precio completo. */
  techo: number;
  /** ROLLOS (no dinero) que no se pudieron valorar por no tener precio. */
  sinPrecio: number;
}

export function valorDelInventario(fichas: RolloValorizable[]): ValorDelInventario {
  const sellados = [];
  const enUso = [];
  const porAcabarse = [];
  const completos = [];
  let sinPrecio = 0;

  for (const f of fichas) {
    if (f.lastRollPrice === null) {
      sinPrecio += f.sealed + f.inUse + f.running;
      continue;
    }
    const precio = D(f.lastRollPrice);
    sellados.push(precio.times(f.sealed).times(FRACCIONES_DE_ROLLO.sealed));
    enUso.push(precio.times(f.inUse).times(FRACCIONES_DE_ROLLO.inUse));
    porAcabarse.push(precio.times(f.running).times(FRACCIONES_DE_ROLLO.running));
    completos.push(precio.times(f.sealed + f.inUse + f.running));
  }

  const vSellados = sum(sellados);
  const vEnUso = sum(enUso);
  const vPorAcabarse = sum(porAcabarse);

  return {
    sellados: toMoney(vSellados),
    enUso: toMoney(vEnUso),
    porAcabarse: toMoney(vPorAcabarse),
    total: toMoney(vSellados.plus(vEnUso).plus(vPorAcabarse)),
    piso: toMoney(vSellados),
    techo: toMoney(sum(completos)),
    sinPrecio,
  };
}
