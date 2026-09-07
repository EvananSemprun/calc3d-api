import type { FilamentPurchase } from '../schemas/stock';

/**
 * ANALÍTICA DE FILAMENTO — lo que la hoja "Resumen" del Excel calcula sobre las
 * compras: cuántos rollos y cuánto dinero se fue en cada marca, y qué colores se
 * compran más.
 *
 * Agrega sobre las MISMAS compras que muestra la pantalla (`GET
 * /filament/purchases`), no sobre una consulta aparte: dos fuentes para el mismo
 * número terminan discrepando, y el resumen es justo donde no se nota.
 */

/** Lo que no tiene marca o color cargado. Es un grupo real: hay 9 rollos así. */
export const UNSPECIFIED = 'Sin especificar';

export type PurchaseGroupBy = 'brand' | 'type' | 'color';

export interface FilamentGroup {
  /** La marca, el tipo o el color; `UNSPECIFIED` si la ficha no lo tenía. */
  key: string;
  rolls: number;
  invested: number;
  /** Cuántas compras distintas cayeron en el grupo. */
  purchases: number;
  /** Parte de lo invertido que se llevó, como fracción (0.25 = 25 %). */
  share: number;
}

/**
 * Agrupa las compras por marca, tipo o color, de más a menos rollos.
 *
 * Se ordena por ROLLOS y no por dinero a propósito: la pregunta que responde es
 * "¿qué compro más?", y un rollo caro no significa que se use más.
 */
export function groupPurchases(
  purchases: FilamentPurchase[],
  by: PurchaseGroupBy,
): FilamentGroup[] {
  const total = purchases.reduce((s, p) => s + p.amount, 0);
  const grupos = new Map<string, FilamentGroup>();

  for (const p of purchases) {
    const key = p[by]?.trim() || UNSPECIFIED;
    const g = grupos.get(key) ?? { key, rolls: 0, invested: 0, purchases: 0, share: 0 };
    g.rolls += p.quantity;
    g.invested += p.amount;
    g.purchases += 1;
    grupos.set(key, g);
  }

  return [...grupos.values()]
    .map((g) => ({ ...g, share: total > 0 ? g.invested / total : 0 }))
    .sort((a, b) => b.rolls - a.rolls || b.invested - a.invested);
}
