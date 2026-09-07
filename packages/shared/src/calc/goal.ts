/**
 * METAS MENSUALES — la hoja "Metas" del Excel: ventas, encargos y clientes
 * nuevos que el dueño se propone cada mes, contra lo que realmente pasó.
 *
 * **Lo real NUNCA se guarda**: se deriva de las ventas, los pedidos y los
 * clientes del mes. Una meta es un dato que se escribe; el cumplimiento es una
 * consecuencia, y guardarlo lo dejaría viejo en cuanto entre una venta.
 *
 * Las metas se cargan **a mano, mes a mes**, y no se proyectan. Los números del
 * Excel (250 → 325 → 450 → 600 → enero 350) llevan adentro una decisión sobre
 * la temporada: diciembre sube y enero cae. Una proyección automática borraría
 * justo eso.
 */

export interface GoalMonthLike {
  salesTarget: number;
  sales: number;
  ordersTarget: number;
  orders: number;
  newClientsTarget: number;
  newClients: number;
}

/**
 * Fracción de la meta cumplida. `null` cuando no hay meta: sin meta no hay nada
 * que cumplir, y un 0 % ahí se leería como un fracaso que nadie se propuso.
 *
 * **No se recorta arriba de 1**, a diferencia del punto de equilibrio: pasarse
 * de la meta es información, y un 100 % pelado escondería que se vendió el
 * doble.
 */
export function goalProgress(real: number, target: number): number | null {
  if (!(target > 0)) return null;
  return real / target;
}

export interface GoalsSummary extends GoalMonthLike {
  salesProgress: number | null;
  ordersProgress: number | null;
  newClientsProgress: number | null;
}

/**
 * Acumulado de varios meses. El avance total sale de los **totales**, no del
 * promedio de los avances: promediar un 27 % con un 0 % daría 13,7 %, que no es
 * lo que se lleva cumplido.
 */
export function goalsSummary(months: GoalMonthLike[]): GoalsSummary {
  const sumar = (k: keyof GoalMonthLike) => months.reduce((s, m) => s + (m[k] || 0), 0);

  const total = {
    salesTarget: sumar('salesTarget'),
    sales: sumar('sales'),
    ordersTarget: sumar('ordersTarget'),
    orders: sumar('orders'),
    newClientsTarget: sumar('newClientsTarget'),
    newClients: sumar('newClients'),
  };

  return {
    ...total,
    salesProgress: goalProgress(total.sales, total.salesTarget),
    ordersProgress: goalProgress(total.orders, total.ordersTarget),
    newClientsProgress: goalProgress(total.newClients, total.newClientsTarget),
  };
}
