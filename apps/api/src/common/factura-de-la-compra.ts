import {
  D,
  invoiceTotals,
  purchaseCostPerRoll,
  toCents,
  type AbonadoPorOrigen,
  type FilamentPurchaseInvoice,
} from '@calc3d/shared';

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
  payments: {
    amount: unknown;
    voidedAt: Date | null;
    /** Tomado del saldo a favor con ese proveedor: no movió plata. */
    tomadoDeFacturaId: string | null;
    /** Quién lo puso. `null` = la caja del negocio. */
    counterparty: { name: string; kind: string } | null;
  }[];
}

/**
 * DE DÓNDE SALIÓ CADA ABONO.
 *
 * ⚠️ **El orden de las preguntas NO se elige acá: es el de `cashEntries`**
 * (`shared/calc/cash.ts`), que es quien mueve la caja de verdad. Primero
 * `fromCredit` (ahí hace `continue` antes que nada), después el prestamista,
 * después la contraparte. Un abono tomado del saldo a favor que ADEMÁS tenga
 * contraparte es **saldo a favor**: la plata ya había salido, y quien figure
 * como pagador no puso nada esta vez.
 *
 * Cambiar este orden hace que Caja y el Dashboard cuenten el mismo abono de
 * dos maneras, y la diferencia no se ve hasta que es grande.
 */
function origenDelAbono(p: FacturaCruda['payments'][number]): keyof AbonadoPorOrigen | 'caja' {
  if (p.tomadoDeFacturaId != null) return 'saldoAFavor';
  if (p.counterparty?.kind === 'EXTERNAL_LENDER') return 'prestamista';
  if (p.counterparty != null) return 'bolsillo';
  return 'caja';
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
        payments: {
          select: {
            amount: true,
            voidedAt: true,
            // ⚠️ Los dos que deciden si esa plata salió de la caja. Sin ellos
            // todo abono se leía como "de la caja", y el diálogo de Abonar
            // deja elegir otra cosa desde que existe.
            tomadoDeFacturaId: true,
            counterparty: { select: { name: true, kind: true } },
          },
        },
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

  // ⚠️ **Los anulados quedan fuera acá también**, con el MISMO criterio que
  // `invoiceTotals` usa dos líneas más arriba. Si uno de los dos los contara,
  // `abonado.total` y `total − saldo` dejarían de ser el mismo número y el
  // prorrateo del pie repartiría plata que nadie puso.
  // ⚠️ Se acumula en Decimal y se redondea UNA sola vez al final, como el
  // resto del proyecto: redondear cada abono y después sumarlos arrastra el
  // error de cada uno.
  const acc = { total: D(0), bolsillo: D(0), saldoAFavor: D(0), prestamista: D(0) };
  const bolsillos: string[] = [];
  for (const p of f.payments) {
    if (p.voidedAt != null) continue;
    // Un abono negativo no existe; `invoiceTotals` lo recorta igual (`Math.max`).
    const monto = Math.max(Number(p.amount), 0);
    if (monto === 0) continue;
    acc.total = acc.total.plus(monto);
    const origen = origenDelAbono(p);
    if (origen === 'caja') continue;
    acc[origen] = acc[origen].plus(monto);
    if (origen === 'bolsillo' && p.counterparty && !bolsillos.includes(p.counterparty.name)) {
      bolsillos.push(p.counterparty.name);
    }
  }
  const abonado: AbonadoPorOrigen = {
    total: toCents(acc.total),
    bolsillo: toCents(acc.bolsillo),
    saldoAFavor: toCents(acc.saldoAFavor),
    prestamista: toCents(acc.prestamista),
  };

  return {
    id: f.id,
    saldo: totals.saldo,
    total: totals.total,
    lineas: f.lines.length,
    abonado,
    bolsillos,
  };
}
