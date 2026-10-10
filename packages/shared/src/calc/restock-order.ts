import type { MaterialStatus } from '../schemas/stock';
import { restockKey, type RestockGroup } from './stock';

/**
 * ARMAR EL PEDIDO CON LO QUE FALTA — el eslabón que faltaba entre Stock del
 * mes y Compras.
 *
 * La app ya sabía qué colores están agotados o por acabarse (`restockByColor`)
 * y las facturas de compra ya existían: lo que no existía era el paso del
 * medio, así que el dueño miraba los faltantes en una pantalla y tipeaba el
 * pedido a mano en la otra.
 *
 * ⚠️ **Esto devuelve una PROPUESTA, no un pedido.** Nada se escribe acá: la
 * pantalla abre el diálogo de la factura nueva con estas líneas cargadas, y el
 * dueño saca las que no quiere, cambia cantidades y recién entonces guarda.
 *
 * ⚠️ **Una línea por COLOR, no por ficha.** Lo que se maneja en el estante es
 * el TIPO + COLOR, y la marca cambia de un mes a otro (decisión del dueño,
 * 2026-09-13; es la razón de ser de `restockByColor`). Medido contra la base
 * local: 10 de los 34 colores tienen más de una ficha activa y el PLA Negro
 * tiene CUATRO marcas. Una línea por ficha habría pedido el negro cuatro
 * veces, y habría pedido negro teniendo negro de otra marca en el estante.
 *
 * ⚠️ Y los grupos entran **tal como los devuelve `restockByColor`**: esa es la
 * lista que el dueño está mirando cuando toca el botón. Volver a clasificar
 * acá sería una segunda opinión sobre lo mismo, y el día que una de las dos
 * cambie la propuesta diría algo distinto de la lista de arriba.
 */

/** Una ficha candidata a representar a su color en el pedido. */
export interface RestockOrderSource {
  materialId: string;
  /** El nombre de la ficha: "PLA Creality Negro". */
  name: string;
  type: string | null;
  color: string | null;
  status: MaterialStatus;
  /**
   * Lo que costó el rollo la última vez. `null` si la ficha nunca se compró:
   * ahí no hay último precio que proponer.
   */
  lastRollPrice: number | null;
}

/** Una línea sugerida, lista para cargar en el diálogo de la factura nueva. */
export interface SuggestedPurchaseLine {
  /**
   * La ficha que se va a comprar (una línea de factura pide una ficha).
   *
   * Su NOMBRE no viaja a propósito: lo resuelve el catálogo en el diálogo, y
   * copiarlo acá sería una segunda versión del mismo dato, que el día que se
   * corrija la ficha diría otra cosa que el desplegable de al lado.
   */
  materialId: string;
  /** El color, como lo nombra la lista de reposición: "PLA Negro". */
  label: string;
  /** Por qué entró: sin ninguno (`OUT`) o con alguno por acabarse (`LOW`). */
  status: 'OUT' | 'LOW';
  quantity: number;
  /**
   * El último precio pagado, o `null` para que la línea entre **en blanco** y
   * el formulario lo pida. Proponer 0 sería cargar la compra como si el rollo
   * fuera gratis: un total que parece bueno y miente.
   */
  unitPrice: number | null;
}

/**
 * Cuántos rollos propone por color.
 *
 * **Uno.** Es la unidad con la que se compra y con la que se cuenta el
 * estante, y el riesgo es asimétrico: subir la cantidad en el diálogo es un
 * click, pero comprar un rollo que no se quería es plata quieta en una
 * repisa. Mientras no haya un consumo por color en el que confiar —hoy solo se
 * puede derivar si DOS meses seguidos están cerrados—, una cantidad
 * "inteligente" sería adivinada, y una propuesta que hay que corregir siempre
 * es peor que una que se queda corta a propósito.
 */
export const ROLLOS_SUGERIDOS = 1;

/** Un precio que se puede proponer: existe, es un número y es mayor que cero. */
const precioProponible = (p: number | null): p is number =>
  p != null && Number.isFinite(p) && p > 0;

/**
 * Las líneas sugeridas: una por color **agotado o por acabarse**.
 *
 * - Un grupo `SUGGEST` ("de los que más se compran y queda uno") NO entra: eso
 *   no es un faltante, y la pantalla ya lo muestra aparte de los urgentes.
 * - La ficha que representa al color es una **activa**: una descontinuada no se
 *   propone nunca, que es la razón por la que `restockStatus` la devuelve como
 *   `IGNORED`. Si un color solo tiene fichas descontinuadas, no hay línea.
 * - Entre varias marcas gana la que **ya se compró alguna vez** (tiene último
 *   precio); a igualdad, la primera por nombre, para que la propuesta sea
 *   reproducible y no dependa del orden en que vinieron las fichas.
 */
export function suggestRestockLines(
  groups: RestockGroup[],
  fichas: RestockOrderSource[],
): SuggestedPurchaseLine[] {
  const porColor = new Map<string, RestockOrderSource[]>();
  for (const f of fichas) {
    if (f.status === 'DISCONTINUED') continue;
    const key = restockKey(f);
    const grupo = porColor.get(key);
    if (grupo) grupo.push(f);
    else porColor.set(key, [f]);
  }

  const lineas: SuggestedPurchaseLine[] = [];
  for (const g of groups) {
    if (g.status !== 'OUT' && g.status !== 'LOW') continue;
    const candidatas = [...(porColor.get(g.key) ?? [])].sort(
      (a, b) =>
        Number(precioProponible(b.lastRollPrice)) - Number(precioProponible(a.lastRollPrice)) ||
        a.name.localeCompare(b.name, 'es'),
    );
    const elegida = candidatas[0];
    // Sin ficha activa de ese color no hay nada que pedir: una línea de factura
    // necesita una ficha, e inventar un nombre nuevo crearía una ficha repetida.
    if (!elegida) continue;
    lineas.push({
      materialId: elegida.materialId,
      label: g.label,
      status: g.status,
      quantity: ROLLOS_SUGERIDOS,
      unitPrice: precioProponible(elegida.lastRollPrice) ? elegida.lastRollPrice : null,
    });
  }
  return lineas;
}
