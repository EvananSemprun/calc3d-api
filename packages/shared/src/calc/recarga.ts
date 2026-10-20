/**
 * RECARGA (sin carrete) o rollo CON CARRETE.
 *
 * ⚠️ **Son TRES estados y `null` NO es "con carrete": es *no se registró*.**
 * Es la lección del 2026-10-19: `paidBy` nació con `DEFAULT 'BUSINESS'` y 71
 * gastos quedaron afirmando que los pagó el negocio sin que nadie lo decidiera.
 * Un default se lee después como un dato.
 *
 * ⚠️ **El texto se escribe acá y no en la pantalla**, porque lo leen tres
 * lugares (la tabla de Compras, su tarjeta en móvil y el formulario). Con el
 * texto repetido, el día que una de las tres cambie van a decir cosas distintas
 * del mismo rollo — el mismo bug que este proyecto viene cazando.
 */

/** Lo que significa cada valor, en palabras del dueño. */
export const OPCIONES_DE_RECARGA = [
  { value: 'refill', label: 'Recarga (sin carrete)', isRefill: true },
  { value: 'spool', label: 'Con carrete', isRefill: false },
] as const;

/**
 * La etiqueta para una compra, o `null` si no hay nada que decir.
 *
 * ⚠️ **Con `null` devuelve `null` y no "Con carrete"**: inventar la etiqueta
 * convertiría las 95 compras anteriores al campo en una afirmación que nadie
 * hizo. Sin etiqueta, la fila simplemente no habla del carrete.
 */
export function etiquetaDeRecarga(isRefill: boolean | null | undefined): string | null {
  if (isRefill == null) return null;
  return OPCIONES_DE_RECARGA.find((o) => o.isRefill === isRefill)!.label;
}

/** El valor del desplegable para un dato guardado (`''` = no se registró). */
export function valorDeRecarga(isRefill: boolean | null | undefined): string {
  if (isRefill == null) return '';
  return OPCIONES_DE_RECARGA.find((o) => o.isRefill === isRefill)!.value;
}

/**
 * Lo que el desplegable manda a la API.
 *
 * ⚠️ **`''` vuelve a `null`, que es borrar el dato — y eso tiene que poder
 * hacerse**: si una elección equivocada no se pudiera desandar, el dueño
 * quedaría obligado a sostener una afirmación que ya sabe falsa.
 */
export function recargaDesdeValor(value: string): boolean | null {
  return OPCIONES_DE_RECARGA.find((o) => o.value === value)?.isRefill ?? null;
}
