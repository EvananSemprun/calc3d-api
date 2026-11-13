import type { MaterialStatus } from '../schemas/stock';

/**
 * QUÉ PANTALLA VE UNA FICHA según su estado.
 *
 * Son cuatro preguntas separadas porque el tercer estado, «solo pedido
 * especial», contesta distinto a cada una: sale de lo que se repone y se
 * cuenta, pero SIGUE en el calculador y en compras (se sigue cotizando y
 * comprando el rollo para ese encargo).
 *
 * ⚠️ **CADA `switch` ES EXHAUSTIVO A PROPÓSITO, y eso NO es estilo.** Antes
 * había nueve sitios que comparaban `status === 'DISCONTINUED'` con dos
 * respuestas posibles. Con un tercer valor, el modo de falla no es escribirlo
 * mal: es que UNO de los nueve se quede con la regla vieja y nadie lo note
 * durante meses. Un comentario que avisa no es una guarda: el
 * `const nunca: never` hace que agregar un valor a `MaterialStatus` NO COMPILE
 * hasta que los cuatro predicados decidan. Es el mismo patrón de
 * `categoriaDeLinea` y `columnasDeObligacion` en `cash/helpers-de-caja.ts`.
 *
 * ⚠️ Los consumidores deben llamar a estos predicados, nunca comparar el
 * estado a mano: una comparación suelta es justo lo que la guarda no ve.
 */

/** ¿La ficha se repone (pedido de reposición por color/marca)? */
export function entraEnReposicion(s: MaterialStatus): boolean {
  switch (s) {
    case 'ACTIVE':
      return true;
    case 'DISCONTINUED':
    case 'SOLO_PEDIDO_ESPECIAL':
      // No se repone: el dueño no quiere stock de esto.
      return false;
    default: {
      // Inalcanzable: lanza en vez de adivinar, porque adivinar ES el bug.
      const nunca: never = s;
      throw new Error(`Estado de ficha sin decidir para reposición: ${String(nunca)}`);
    }
  }
}

/** ¿La ficha entra en el conteo mensual de rollos? */
export function entraEnConteo(s: MaterialStatus): boolean {
  switch (s) {
    case 'ACTIVE':
      return true;
    case 'DISCONTINUED':
    case 'SOLO_PEDIDO_ESPECIAL':
      // Sin stock que contar: sacarla evita un conteo en cero que ensucia el mes.
      return false;
    default: {
      const nunca: never = s;
      throw new Error(`Estado de ficha sin decidir para conteo: ${String(nunca)}`);
    }
  }
}

/** ¿La ficha aparece como opción en el calculador? */
export function entraEnCalculadora(s: MaterialStatus): boolean {
  switch (s) {
    case 'ACTIVE':
    case 'SOLO_PEDIDO_ESPECIAL':
      // ⚠️ El tercer estado DEBE estar acá: la ficha existe justo para cotizar
      // el pedido especial. Fuera del calculador no se podría cotizar.
      return true;
    case 'DISCONTINUED':
      return false;
    default: {
      const nunca: never = s;
      throw new Error(`Estado de ficha sin decidir para calculadora: ${String(nunca)}`);
    }
  }
}

/** ¿La ficha se puede elegir al registrar una compra? */
export function entraEnCompras(s: MaterialStatus): boolean {
  switch (s) {
    case 'ACTIVE':
    case 'SOLO_PEDIDO_ESPECIAL':
      // Se sigue comprando el rollo para el encargo.
      return true;
    case 'DISCONTINUED':
      return false;
    default: {
      const nunca: never = s;
      throw new Error(`Estado de ficha sin decidir para compras: ${String(nunca)}`);
    }
  }
}
