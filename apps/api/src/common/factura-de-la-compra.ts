import { invoiceTotals, purchaseCostPerRoll, type FilamentPurchaseInvoice } from '@calc3d/shared';

/**
 * LA FACTURA DE LA QUE NACIÓ UN GASTO, vista por una sola pregunta: ¿queda
 * plata por pagarle al proveedor?
 *
 * ⚠️ **Vive acá y no en un servicio porque la leen DOS**: `FilamentService`
 * (la línea de cada compra en Filamento → Compras) y `ExpensesService` (el pie
 * del KPI de Gastos del Dashboard, que es lo mismo sumado). Cada uno con su
 * copia, el día que una cambie las dos pantallas dirían números distintos del
 * mismo hecho — que es justo el bug que este trabajo vino a cerrar.
 *
 * ⚠️ **El saldo y el total salen de `invoiceTotals`, no de una cuenta propia.**
 * Esa función es la única definición de "lo que falta pagar" en el proyecto:
 * cobra lo ya recibido al precio REAL de cada entrega, recorta los sobrepagos
 * en 0 (lo pagado de más es `aFavor`) e ignora los abonos anulados. Medido:
 * `Σ cantidad × precio pedido − abonos` daba $4 donde `invoiceTotals` da $5.
 *
 * ⚠️ **No se reparte el saldo entre las líneas acá.** El saldo es de la
 * factura; `lineas` y `total` viajan para que quien muestre el número pueda
 * decir de qué es. (El prorrateo del pie del KPI es una convención declarada,
 * y vive en `repartoDePagadores`, en shared.)
 */
export interface FacturaCruda {
  id: string;
  lines: {
    quantity: number;
    /** `Decimal` de Prisma. */
    unitPrice: unknown;
    received: number;
    /** Las recepciones: cada una ES el gasto que nació al recibir. */
    expenses: { quantity: number | null; amount: unknown }[];
  }[];
  payments: { amount: unknown; voidedAt: Date | null }[];
}

/**
 * El `select` de Prisma que trae esa factura colgada del gasto.
 *
 * ⚠️ **Va en el `include` del `findMany`, no en una consulta por fila**: con 40
 * gastos en pantalla, una por fila son 40 viajes a la base para dibujar una
 * línea de texto.
 */
export const INCLUIR_FACTURA = {
  select: {
    invoice: {
      select: {
        id: true,
        lines: {
          select: {
            quantity: true,
            unitPrice: true,
            received: true,
            expenses: { select: { quantity: true, amount: true } },
          },
        },
        payments: { select: { amount: true, voidedAt: true } },
      },
    },
  },
} as const;

export function facturaDeLaCompra(f: FacturaCruda | null | undefined): FilamentPurchaseInvoice | null {
  if (!f) return null;

  const totals = invoiceTotals(
    f.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: Number(l.unitPrice),
      received: l.received,
      // Mismo criterio que la pantalla de Compras: la recepción ES el gasto
      // que nació al recibir, con el precio que de verdad te cobraron.
      recepciones: l.expenses.map((e) => ({
        quantity: e.quantity ?? 0,
        unitPrice: purchaseCostPerRoll(Number(e.amount), e.quantity ?? 0),
      })),
    })),
    f.payments.map((p) => ({ amount: Number(p.amount), voided: p.voidedAt != null })),
  );

  return { id: f.id, saldo: totals.saldo, total: totals.total, lineas: f.lines.length };
}
