import type { MaterialStatus } from '../schemas/stock';

/**
 * QUÉ PANTALLA VE UNA FICHA según su estado.
 *
 * Son tres preguntas separadas porque el tercer estado, «solo pedido
 * especial», contesta distinto a cada una: sale de lo que se repone y se
 * cuenta, pero SIGUE en el calculador (se sigue cotizando el pedido especial).
 *
 * ⚠️ «¿Se puede elegir al registrar una compra?» NO es una pregunta: las tres se
 * ofrecen SIEMPRE (ver `estadoTrasComprar`). Hubo un predicado `entraEnCompras`
 * y se borró: nadie lo llamaba y su `false` para DISCONTINUED afirmaba una regla
 * que nunca se decidió y que contradice la reactivación por compra.
 *
 * ⚠️ **CADA `switch` ES EXHAUSTIVO A PROPÓSITO, y eso NO es estilo.** Antes
 * había nueve sitios que comparaban `status === 'DISCONTINUED'` con dos
 * respuestas posibles. Con un tercer valor, el modo de falla no es escribirlo
 * mal: es que UNO de los nueve se quede con la regla vieja y nadie lo note
 * durante meses. Un comentario que avisa no es una guarda: el
 * `const nunca: never` hace que agregar un valor a `MaterialStatus` NO COMPILE
 * hasta que los tres predicados decidan. Es el mismo patrón de
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

/**
 * ¿En qué estado queda una ficha después de COMPRARLE rollos?
 *
 * Una descontinuada vuelve a activa (si se volvió a comprar, se sigue
 * manejando). ⚠️ «Solo pedido especial» NO: el dueño la marcó así a propósito y
 * comprar un rollo para un encargo puntual no debería cambiárselo. Reactivar es
 * un acto explícito (la acción «Reactivar» del panel), no un efecto lateral.
 * Es un `switch` exhaustivo por la misma razón que los tres de arriba.
 *
 * ⚠️ **POR QUÉ COMPRAS NO FILTRA POR ESTADO** (decidido a propósito): el
 * desplegable de compras ofrece las TRES fichas, también la descontinuada,
 * porque **volver a comprar es la señal de que el filamento volvió**: para eso
 * existe la rama DISCONTINUED → ACTIVE de acá abajo (y el aviso
 * `elegidaDescontinuada` del modal de compra). Filtrarlas «para que no ofrezca
 * una descontinuada» rompería esa reactivación; medido el 13/11, además, ahorraría
 * 2 filas de 53. No lo «arregles».
 */
export function estadoTrasComprar(s: MaterialStatus): MaterialStatus {
  switch (s) {
    case 'ACTIVE':
    case 'DISCONTINUED':
      return 'ACTIVE';
    case 'SOLO_PEDIDO_ESPECIAL':
      return 'SOLO_PEDIDO_ESPECIAL';
    default: {
      const nunca: never = s;
      throw new Error(`Estado de ficha sin decidir para compras: ${String(nunca)}`);
    }
  }
}

/**
 * El texto con que se rotula cada estado (hoja del Excel, insignias del panel).
 *
 * Es un `Record` y NO un ternario sobre `'ACTIVE'`: un ternario manda al
 * «else» todo valor nuevo (así el tercer estado salía rotulado
 * «Descontinuado» en el Excel) y ninguna comparación contra DISCONTINUED lo
 * ve. Con un `Record<MaterialStatus, …>` un cuarto valor NO compila hasta que
 * alguien le escribe su rótulo.
 */
export const ETIQUETA_DE_ESTADO: Record<MaterialStatus, string> = {
  ACTIVE: 'Activo',
  DISCONTINUED: 'Descontinuado',
  SOLO_PEDIDO_ESPECIAL: 'Solo pedido especial',
};

/**
 * Lo que se le agrega al nombre de una ficha cuando aparece en una LISTA de
 * elección (el desplegable de compras): nada si está activa, y el estado si no.
 * `Record` por lo mismo que `ETIQUETA_DE_ESTADO`: un valor nuevo no compila sin
 * decidir su sufijo, y no hay que comparar contra ACTIVE para saber si poner uno.
 */
export const SUFIJO_DE_ESTADO: Record<MaterialStatus, string> = {
  ACTIVE: '',
  DISCONTINUED: ' (descontinuado)',
  SOLO_PEDIDO_ESPECIAL: ' (solo pedido especial)',
};

/**
 * UNA ACCIÓN que el panel ofrece sobre una ficha: a qué estado lleva, cómo se
 * llama el botón, cómo se pregunta y QUÉ CAMBIA DE VERDAD.
 */
export interface AccionDeEstado {
  destino: MaterialStatus;
  /** Texto del botón y de la confirmación. */
  etiqueta: string;
  /** El título de la confirmación, con el nombre de la ficha. */
  pregunta: (nombre: string) => string;
  /** Lo que cambia de verdad al aplicarla: ni más ni menos (no afirma lo que ya estaba así). */
  efecto: string;
}

/**
 * LAS ACCIONES QUE SE OFRECEN SEGÚN EL ESTADO ACTUAL: una escalera, cada peldaño un
 * acto explícito.
 *
 *   ACTIVE               → «Solo pedido especial» y «Descontinuar»
 *   SOLO_PEDIDO_ESPECIAL → «Reactivar» y «Descontinuar»
 *   DISCONTINUED         → «Reactivar»
 *
 * ⚠️ Es un `switch` EXHAUSTIVO por la misma razón que los predicados: con un
 * interruptor binario («¿se repone? entonces Descontinuar, si no Reactivar») el
 * tercer estado no tenía puerta de entrada y, para retirar del todo una ficha
 * «solo pedido especial», había que reactivarla primero —devolviéndola al
 * calculador y a la reposición, justo donde no va—. Un cuarto estado NO COMPILA
 * hasta que alguien decida qué acciones tiene.
 *
 * ⚠️ Cada `efecto` dice lo que cambia DE VERDAD en esa transición. Descontinuar
 * una «solo pedido especial» la saca del calculador y de las compras, pero NO de
 * la reposición ni del conteo: ya estaba afuera, y decirlo como si cambiara sería
 * mentir. Los textos salen de los predicados (`entraEn…`): ver el spec.
 */
export function accionesDeEstado(s: MaterialStatus): AccionDeEstado[] {
  const descontinuarDesdeActiva: AccionDeEstado = {
    destino: 'DISCONTINUED',
    etiqueta: 'Descontinuar',
    pregunta: (n) => `¿Descontinuar «${n}»?`,
    efecto:
      'Deja de aparecer al cotizar, en la reposición y en el conteo de rollos (al cerrar el mes se guarda igual). Sus compras y conteos no se tocan. Se reactiva sola al registrar una compra con rollos, o con «Reactivar».',
  };
  switch (s) {
    case 'ACTIVE':
      return [
        {
          destino: 'SOLO_PEDIDO_ESPECIAL',
          etiqueta: 'Solo pedido especial',
          pregunta: (n) => `¿Dejar «${n}» solo para pedido especial?`,
          efecto:
            'Sale de la reposición y del conteo de rollos (al cerrar el mes se guarda igual). Sigue disponible al cotizar y al registrar compras. Registrar una compra NO la reactiva: se vuelve a la normalidad con «Reactivar».',
        },
        descontinuarDesdeActiva,
      ];
    case 'SOLO_PEDIDO_ESPECIAL':
      return [
        {
          destino: 'ACTIVE',
          etiqueta: 'Reactivar',
          pregunta: (n) => `¿Reactivar «${n}»?`,
          // Nunca salió del calculador: no se dice que vuelva a él.
          efecto: 'Vuelve a la reposición y al conteo de rollos.',
        },
        {
          destino: 'DISCONTINUED',
          etiqueta: 'Descontinuar',
          pregunta: (n) => `¿Descontinuar «${n}»?`,
          // Ya estaba fuera de la reposición y del conteo: el cambio real es el calculador y las compras.
          efecto:
            'Deja de aparecer al cotizar y al registrar compras. Sus compras y conteos no se tocan. Se vuelve a usar con «Reactivar».',
        },
      ];
    case 'DISCONTINUED':
      return [
        {
          destino: 'ACTIVE',
          etiqueta: 'Reactivar',
          pregunta: (n) => `¿Reactivar «${n}»?`,
          efecto: 'Vuelve a aparecer al cotizar, en la reposición y en el conteo de rollos.',
        },
      ];
    default: {
      const nunca: never = s;
      throw new Error(`Estado de ficha sin acciones decididas: ${String(nunca)}`);
    }
  }
}
