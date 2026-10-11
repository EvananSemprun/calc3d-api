import {
  obligationLedger,
  type ApplicationOrder,
  type CashLedger,
  type ObligationInput,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  dia,
  n,
  proporcionDeFilamento,
  texto,
  tipoPagador,
  vigentes,
  type EtiquetaAsiento,
} from './helpers-de-caja';

/**
 * DE DÓNDE SALEN LOS DATOS DE CAJA, y qué se deriva de ellos antes de que
 * ningún endpoint los mire.
 *
 * Salió de `cash.service.ts` el 2026-10-11, cuando ese archivo pasó las 900
 * líneas; su propia nota pedía partirlo a las 480 y nadie lo hizo. Lo que vive
 * acá responde una sola pregunta —**qué hay**— y lo que quedó allá responde la
 * otra: **qué hace cada endpoint con eso**.
 *
 * ⚠️ **Son funciones, no un servicio de Nest**, a propósito: no hay estado que
 * inyectar (el `prisma` viaja como parámetro) y así `cash.service.spec.ts`
 * sigue construyendo `new CashService(prisma)` sin tocar nada. Un provider más
 * en el módulo habría obligado a cambiar el controller y todos los specs para
 * mover código que no cambia de comportamiento.
 *
 * ⚠️ **La consulta es UNA sola** (`Promise.all`): con una por entidad, cada
 * pantalla de Caja eran doce viajes a la base.
 */
export type DatosDeCaja = Awaited<ReturnType<typeof cargarDatosDeCaja>>;

/** Todos los datos crudos, una sola vez. */
export async function cargarDatosDeCaja(prisma: PrismaService, organizationId: string) {
  const where = { organizationId };
  const [ventas, abonos, gastos, cuotasTodas, movimientos, aplicaciones, prestamos, cuentas, conciliaciones, settings, contrapartes, abonosDeCompra] =
    await Promise.all([
      // El desplegable necesita además el id (para el join con la etiqueta),
      // el texto de cada fila y su origen (la insignia "Importado").
      prisma.sale.findMany({
        where,
        select: { id: true, date: true, amount: true, kind: true, note: true, source: true },
      }),
      prisma.payment.findMany({
        where,
        select: { id: true, date: true, amount: true, note: true, source: true },
      }),
      prisma.expense.findMany({ where }),
      prisma.loanPayment.findMany({ where }),
      prisma.ownerMovement.findMany({ where, orderBy: { date: 'asc' } }),
      prisma.debtApplication.findMany({ where }),
      prisma.loan.findMany({
        where: { organizationId, closedAt: null },
        // `voidedAt` VIAJA con cada cuota: a quién amortiza lo decide
        // `vigentes`, no el `where`. Ver su comentario.
        select: { principal: true, payments: { select: { amount: true, voidedAt: true } } },
      }),
      prisma.cashAccount.findMany({ where, orderBy: { isDefault: 'desc' } }),
      prisma.cashReconciliation.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { adjustment: { select: { id: true, amount: true, concept: true } } },
      }),
      prisma.settings.findUnique({ where: { organizationId } }),
      // Hacen falta para saber A QUIÉN se le debe cada fila, no solo de qué
      // TIPO era quien pagó. Ver `idPagador`.
      prisma.counterparty.findMany({ where }),
      // Los abonos a facturas son lo que mueve la plata de una compra
      // encargada. Vienen con las líneas de SU factura porque el reparto
      // entre filamento y equipo sale de ahí.
      prisma.purchaseInvoicePayment.findMany({
        where: { organizationId, voidedAt: null, invoice: { voidedAt: null } },
        include: { invoice: { select: { lines: { select: { quantity: true, unitPrice: true, printerId: true } } } } },
      }),
    ]);

  /**
   * ⚠️ Las cuotas anuladas se van ACÁ para lo que NO es el motor: las
   * obligaciones con quien la puso de su bolsillo y las etiquetas del
   * desplegable. Lo que sí es el motor —la línea "Cuotas del préstamo" del
   * saldo— ya no se filtra antes: desde 2026-10-11 la regla vive adentro
   * (`voided` en `CashLedger.loanPayments` y en `LoanPaymentLike`), para que
   * cualquier consumidor del motor la herede sin tener que acordarse.
   *
   * ⚠️ Que queden dos filtros es deliberado y no una duplicación: este
   * decide qué se MUESTRA en dos listas de esta pantalla, y el del motor
   * decide qué AMORTIZA. Si alguna vez se junta todo en el motor, estas dos
   * listas tienen que seguir sin mostrar lo anulado.
   */
  const cuotas = vigentes(cuotasTodas);

  // Lo aplicado a CADA obligación y lo aplicado POR cada pago.
  const porObligacion = new Map<string, number>();
  const porPago = new Map<string, number>();
  for (const a of aplicaciones) {
    const obligacion = a.expenseId ?? a.loanPaymentId ?? a.obligationMovementId;
    if (obligacion) porObligacion.set(obligacion, (porObligacion.get(obligacion) ?? 0) + n(a.amount));
    porPago.set(a.paymentId, (porPago.get(a.paymentId) ?? 0) + n(a.amount));
  }

  const ledger: CashLedger = {
    // El `id` viaja en los cinco arrays: el motor no lo mira, solo lo
    // arrastra hasta `cashEntries` para que acá se le pueda pegar la etiqueta.
    sales: ventas.map((v) => ({ id: v.id, date: dia(v.date), amount: n(v.amount) })),
    orderPayments: abonos.map((p) => ({ id: p.id, date: dia(p.date), amount: n(p.amount) })),
    expenses: gastos.map((g) => ({
      id: g.id,
      date: dia(g.date),
      amount: n(g.amount),
      payer: tipoPagador(g, contrapartes),
      isInvestment: g.isInvestment,
      isFilament: g.materialId != null,
      refundable: g.refundable,
      // Su plata ya se contó al abonar la factura.
      fromInvoice: g.purchaseInvoiceLineId != null,
    })),
    purchasePayments: abonosDeCompra.map((a) => ({
      id: a.id,
      date: dia(a.date),
      amount: n(a.amount),
      payer: tipoPagador(a, contrapartes),
      refundable: true,
      filamentShare: proporcionDeFilamento(a.invoice.lines),
      // ⚠️ Tomado del saldo a favor con el proveedor: **no mueve la caja**.
      // Esa plata ya salió el día que se pagó de más; contarla otra vez es la
      // misma doble carga que el gasto nacido de una factura, por la otra
      // puerta. Lo guardado es de qué factura sale; el saldo se deriva.
      fromCredit: a.tomadoDeFacturaId != null,
    })),
    // ⚠️ **Acá van TODAS, anuladas incluidas, con su marca.** No es un
    // descuido: desde 2026-10-11 la regla vive en el motor (`voided` en
    // `CashLedger.loanPayments`), y filtrarlas antes la dejaría sin
    // ejercer —una guarda que parece puesta y que borrarla no tumba ningún
    // test es peor que no tenerla—.
    loanPayments: cuotasTodas.map((c) => ({
      id: c.id,
      date: dia(c.date),
      amount: n(c.amount),
      payer: tipoPagador(c, contrapartes),
      refundable: c.refundable,
      voided: c.voidedAt != null,
    })),
    movements: movimientos.map((m) => ({
      id: m.id,
      date: dia(m.date),
      amount: n(m.amount),
      kind: m.kind,
      refundable: m.refundable,
      applied: porPago.get(m.id) ?? 0,
    })),
  };

  return {
    ledger, ventas, abonos, gastos, cuotas, movimientos, prestamos, cuentas, conciliaciones,
    contrapartes, abonosDeCompra, porObligacion, porPago,
    order: (settings?.debtApplicationOrder ?? 'OLDEST_FIRST') as ApplicationOrder,
  };
}

/** Las obligaciones de una contraparte, con lo ya aplicado. */
export function obligacionesDe(
d: DatosDeCaja,
counterpartyId: string,
hasta?: string,
) {
  const vale = (f: Date) => !hasta || dia(f) <= hasta;
  // Quien puso la plata es a quien se le debe, sea el dueño, un socio o el
  // prestamista. No hace falta excluir al prestamista aparte: `summary()`
  // pregunta por la contraparte PROPIETARIA, así que sus gastos no entran
  // por el id, y su préstamo se cuenta por el saldo, no por acá.
  const loPuso = (fila: { counterpartyId: string | null }) =>
    fila.counterpartyId === counterpartyId;
  const items: ObligationInput[] = [
    ...d.gastos
      .filter((g) => loPuso(g) && g.refundable && vale(g.date))
      .map((g) => ({
        source: 'EXPENSE' as const,
        sourceId: g.id,
        date: dia(g.date),
        category: g.isInvestment
          ? ('EQUIPMENT' as const)
          : g.category === 'DESIGN'
            ? ('DESIGN' as const)
            : ('PURCHASE' as const),
        amount: n(g.amount),
        applied: d.porObligacion.get(g.id) ?? 0,
      })),
    ...d.cuotas
      .filter((c) => loPuso(c) && c.refundable && vale(c.date))
      .map((c) => ({
        source: 'LOAN_PAYMENT' as const,
        sourceId: c.id,
        date: dia(c.date),
        category: 'LOAN_PAYMENT' as const,
        amount: n(c.amount),
        applied: d.porObligacion.get(c.id) ?? 0,
      })),
    ...d.movimientos
      .filter(
        (m) =>
          m.counterpartyId === counterpartyId &&
          m.kind === 'CONTRIBUTION' &&
          m.refundable &&
          vale(m.date),
      )
      .map((m) => ({
        source: 'MOVEMENT' as const,
        sourceId: m.id,
        date: dia(m.date),
        category: 'CONTRIBUTION' as const,
        amount: n(m.amount),
        applied: d.porObligacion.get(m.id) ?? 0,
      })),
  ];
  return obligationLedger(items);
}

/**
 * El join `id → texto` de los cinco orígenes del ledger.
 *
 * Vive acá y no en `shared` a propósito: el motor es puro y no conoce los
 * nombres de columna de Prisma (`description`, `concept`, `reference`).
 * Meterle etiquetas lo ataría al esquema de la base.
 *
 * ⚠️ Los ids son cuid de tablas distintas, así que no chocan entre sí. Un
 * mismo id SÍ puede aparecer en dos asientos —un retiro se parte en
 * devolución y retiro, un gasto de la contraparte es gasto y aporte—, y eso
 * es correcto: las dos mitades llevan la misma etiqueta porque son el mismo
 * registro visto por sus dos caras.
 */
export function etiquetasDe(d: DatosDeCaja) {
  const m = new Map<string, EtiquetaAsiento>();

  for (const v of d.ventas) {
    m.set(v.id, {
      label: texto(v.note) ?? (v.kind === 'ENCARGO' ? 'Venta por encargo' : 'Venta de mostrador'),
      source: v.source,
    });
  }
  for (const p of d.abonos) m.set(p.id, { label: texto(p.note) ?? 'Abono de pedido', source: p.source });
  for (const g of d.gastos) m.set(g.id, { label: texto(g.description) ?? 'Gasto sin descripción', source: g.source });
  for (const c of d.cuotas) m.set(c.id, { label: texto(c.reference) ?? 'Cuota del préstamo', source: c.source });
  for (const mv of d.movimientos) m.set(mv.id, { label: texto(mv.concept) ?? 'Movimiento', source: mv.source });

  return m;
}

/**
 * EL SALDO DEL NEGOCIO HASTA UN DÍA (inclusive): con cuánta plata venía el
 * negocio al cerrar esa fecha.
 *
 * Es lo que hace posible la cadena del Dashboard —"venías con $X · este mes
 * $Y · te queda $Z"— con UNA sola definición de caja. El motor ya sabía
 * recortar por fecha (`businessCash(ledger, hasta)`, el mismo corte que usa
 * el esperado de una conciliación); lo que faltaba era exponerlo.
 *
 * ⚠️ `at` llega del cliente y se valida en el PIPE. Si una fecha inválida
 * cayera acá, el recorte compara TEXTO y devolvería el saldo entero: un
 * número que parece bueno. Por eso el schema exige un día que exista, y por
 * eso la fecha NO es opcional — faltarla no puede valer por "toda la
 * historia".
 *
 * ⚠️ Pasa el `at` a `businessCash`. Sin eso devuelve el saldo de toda la
 * historia, la pantalla muestra el mismo número dos veces y la cadena da
 * $0 de movimiento en el periodo.
 */
