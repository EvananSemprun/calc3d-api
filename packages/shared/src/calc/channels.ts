import Decimal from 'decimal.js';
import { D, toCents } from './money';

/**
 * REPARTO DE LO QUE ENTRÓ, POR CANAL — lo que dibuja la dona "Mostrador vs
 * encargo" del Dashboard.
 *
 * ⚠️ **Un encargo NO genera una venta: genera abonos.** Esa es la regla que la
 * app sostiene a propósito para no contar el mismo dinero dos veces
 * (`SaleCreateSchema` rechaza `kind: 'ENCARGO'` desde 2026-09-14). Las ventas
 * `ENCARGO` que existen son los totales SEMANALES importados del Excel y se
 * cortan el 2026-08-24: son historia, no el canal de hoy.
 *
 * Por eso un reparto que mire solo `Sale.kind` es ciego a los encargos desde
 * que la app tomó el control. Medido en producción el 2026-10-10 con el filtro
 * en octubre: mostrador $26.75, encargos $114.05 en 4 abonos, y la dona decía
 * **100 % mostrador** — faltaba el 81 % de lo que entró y el gráfico afirmaba
 * lo contrario de la verdad (que el negocio vive del mostrador, cuando vive de
 * los encargos).
 *
 * La definición, entonces:
 * - **Mostrador** = ventas `COUNTER`.
 * - **Encargos** = ventas `ENCARGO` (el histórico del Excel) **+ los abonos del
 *   periodo**.
 *
 * Así el total del reparto es exactamente "Ventas + Cobrado de encargos", los
 * dos KPIs que el Dashboard ya muestra arriba en la misma pantalla.
 *
 * ⚠️ **Los abonos no se convierten en ventas ni se suman dos veces**: entran
 * UNA vez, del lado de encargos. El total tiene que dar ventas + abonos clavado.
 */
export type CanalDeIngreso = 'COUNTER' | 'ENCARGO';

/**
 * Un tramo de la dona. `share` es FRACCIÓN (0,81 = 81 %), como el resto de los
 * porcentajes del motor.
 */
export interface TramoDeCanal {
  kind: CanalDeIngreso;
  value: number;
  share: number;
}

export interface RepartoPorCanal {
  /** Ventas `COUNTER`. */
  mostrador: number;
  /** Ventas `ENCARGO` del histórico + abonos del periodo. */
  encargos: number;
  /** mostrador + encargos = "Ventas + Cobrado de encargos". */
  total: number;
  /**
   * Para la dona: un tramo por canal CON plata, en orden fijo (mostrador,
   * encargos). Los canales en cero quedan afuera — un tramo de $0 no se dibuja
   * y solo ensucia la leyenda. Con un periodo vacío la lista es vacía, no un
   * reparto de `NaN`.
   */
  tramos: TramoDeCanal[];
}

/** Precisión de las fracciones: 6 decimales alcanzan para un porcentaje. */
const SHARE_DP = 6;

export function repartoPorCanal(
  ventas: readonly { kind: CanalDeIngreso; amount: number }[],
  abonos: readonly { amount: number }[],
): RepartoPorCanal {
  let mostrador = new Decimal(0);
  let encargos = new Decimal(0);

  for (const v of ventas) {
    if (v.kind === 'COUNTER') mostrador = mostrador.plus(D(v.amount));
    else encargos = encargos.plus(D(v.amount));
  }
  // Los abonos son el canal de encargos de HOY; sin ellos la dona queda ciega.
  for (const a of abonos) encargos = encargos.plus(D(a.amount));

  const total = mostrador.plus(encargos);
  const share = (v: Decimal): number =>
    total.isZero() ? 0 : v.div(total).toDecimalPlaces(SHARE_DP).toNumber();

  const tramos: TramoDeCanal[] = [];
  if (!mostrador.isZero()) {
    tramos.push({ kind: 'COUNTER', value: toCents(mostrador), share: share(mostrador) });
  }
  if (!encargos.isZero()) {
    tramos.push({ kind: 'ENCARGO', value: toCents(encargos), share: share(encargos) });
  }

  return {
    mostrador: toCents(mostrador),
    encargos: toCents(encargos),
    total: toCents(total),
    tramos,
  };
}
