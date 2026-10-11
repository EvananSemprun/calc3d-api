/**
 * QUIÉN PUSO LA PLATA DE UNA COMPRA DE FILAMENTO (2026-10-11).
 *
 * La pantalla de Compras listaba $202 en octubre de 2026 y la caja del negocio
 * solo había soltado $142. Los $60 de diferencia estaban todos a la vista en la
 * base y en ninguna parte en la tabla: dos rollos los pagó el dueño de su
 * bolsillo (el negocio se los debe) y un tercero entró por una factura que se
 * abonó a medias. Mirando la tabla era imposible saberlo, así que la caja
 * parecía mentir.
 *
 * ⚠️ **EL SILENCIO ES EL CASO NORMAL.** Una compra que pagó la caja y está
 * saldada no dice nada. Si todas las filas llevaran etiqueta, ninguna se vería
 * y el aviso no avisaría de nada: hablan solo las excepciones.
 *
 * ⚠️ **NO SE REPARTE EL SALDO DE UNA FACTURA ENTRE SUS LÍNEAS.** Un rollo que
 * entró por factura **no tiene pagador propio**: lo que se paga es la factura.
 * Si una factura de $100 con cuatro líneas tiene $60 abonados, decir "a este
 * rollo le faltan $10" es una convención inventada escrita como si fuera un
 * hecho — y de esas sale alguien cuadrando una caja con un número que nadie
 * calculó. Por eso el texto nombra a la FACTURA como sujeto, y cuando tiene más
 * de una línea lo dice de frente.
 */
import type { FilamentPurchase } from '../schemas/stock';

/** Lo único que hace falta saber de una compra para contar quién la pagó. */
export type CompraParaPagador = Pick<
  FilamentPurchase,
  'counterpartyId' | 'counterpartyName' | 'invoice'
>;

/** Cómo se escribe un monto: lo pone quien llama (el panel formatea con la moneda del dueño). */
export type FormatoDeMonto = (n: number) => string;

/** Cuando no se sabe el nombre de quien puso la plata, pero sí que no fue la caja. */
const ALGUIEN = 'otra persona';

/**
 * La línea chica que va debajo del proveedor, o `null` si no hay nada que decir.
 *
 * Los cuatro casos, en este orden:
 * 1. **Entró por una factura con saldo** → el estado de la FACTURA:
 *    `"Faltan $10.00 de esta factura"`. Con varias líneas, `"Faltan $40.00 de
 *    la factura entera (4 líneas)"`: el monto cubre más que este rollo y el
 *    texto no puede dejar que se lea de otra manera.
 * 2. **Entró por una factura saldada** → `null`. Ya no falta plata, y decirlo
 *    sería justo el ruido que esconde a las filas que sí tienen algo que contar.
 * 3. **Compra directa que puso una persona** → `"Lo puso Evanan · el negocio se
 *    lo debe"`. Acá sí hay pagador propio: es `Expense.counterpartyId`.
 * 4. **Compra directa de la caja** → `null`, el caso normal.
 *
 * ⚠️ **La factura gana sobre la contraparte** si por algún camino llegaran las
 * dos: la plata de una compra nacida de una factura la movieron los abonos de
 * esa factura, así que es su estado el que explica la caja. (Hoy no puede
 * pasar: el gasto que nace al recibir una línea no lleva contraparte.)
 */
export function notaDePagador(c: CompraParaPagador, money: FormatoDeMonto): string | null {
  if (c.invoice) {
    // ⚠️ `saldo` NO se recalcula acá: viene de `invoiceTotals`, que es la única
    // definición de "lo que falta pagar" en el proyecto.
    if (c.invoice.saldo <= 0) return null;

    // ⚠️ **No se repite el nombre del proveedor**: la nota va justo DEBAJO de
    // ese nombre, en la misma celda, y repetirlo triplicaba el alto de la fila
    // (medido: 3 renglones en el caso de varias líneas). Lo que no puede
    // faltar es el SUJETO, que es la factura.
    return c.invoice.lineas > 1
      ? `Faltan ${money(c.invoice.saldo)} de la factura entera (${c.invoice.lineas} líneas)`
      : `Faltan ${money(c.invoice.saldo)} de esta factura`;
  }

  if (c.counterpartyId == null) return null;
  return `Lo puso ${c.counterpartyName ?? ALGUIEN} · el negocio se lo debe`;
}
