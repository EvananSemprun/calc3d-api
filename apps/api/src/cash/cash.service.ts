import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  businessCash,
  cashEntries,
  loanBalance,
  ownerFinancing,
  reconcile,
  type CashCategory,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
  type CashShortfallPlanQueryDto,
  type OwnerMovementCreateDto,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CAJA — la hoja "Caja" del Excel y el bloque "Quién puso la plata" de
 * "Inversion".
 *
 * Nada de lo que muestra se guarda: el saldo del negocio, lo que se le debe a
 * la contraparte y el reparto de cada pago se DERIVAN de las ventas, los
 * abonos, los gastos (con quién los pagó), las cuotas, los movimientos y las
 * aplicaciones de deuda. Lo único persistido es el hecho: la plata pura que
 * entra o sale del bolsillo de la contraparte, a qué deuda fue cada pago y lo
 * que decía la cuenta el día que se concilió.
 */
import {
  aUsd,
  planDe,
  planDeFaltante,
} from './conciliacion';
import {
  anularConciliacion,
  confirmarConciliacion,
  guardarConciliacion,
} from './escribir-conciliacion';
import {
  cargarDatosDeCaja,
  etiquetasDe,
  obligacionesDe,
} from './datos-de-caja';
import {
  dia,
  n,
  round2,
  SIN_DETALLE,
} from './helpers-de-caja';

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  /** La contraparte por defecto: a quién se le debe si nadie dice otra cosa. */
  private async defaultCounterparty(organizationId: string) {
    // Una ACTIVA gana sobre la marcada por defecto: atribuirle la deuda a una
    // que el dueño dio de baja sería peor que elegir otra. El ABM de
    // contrapartes impide llegar a ese estado; esto lo cubre si ya se llegó.
    const cp = await this.prisma.counterparty.findFirst({
      where: { organizationId, kind: 'OWNER' },
      orderBy: [{ active: 'desc' }, { isDefault: 'desc' }],
    });
    if (!cp) throw new NotFoundException('No hay una contraparte configurada');
    return cp;
  }

  async balanceAt(organizationId: string, at: string) {
    const d = await cargarDatosDeCaja(this.prisma, organizationId);
    return { at, balance: businessCash(d.ledger, at) };
  }

  /**
   * El detalle de UNA línea de "De dónde sale el saldo".
   *
   * ⚠️ NO reclasifica: le pide los asientos a `cashEntries`, el MISMO que usa
   * `businessCash`. Si acá hubiera filtros propios (`isInvestment`, la contraparte,
   * `isFilament`…) habría dos clasificaciones que tendrían que coincidir para
   * siempre, y el día que una cambiara la pantalla mostraría un detalle que
   * suma distinto que la línea de arriba. Una pantalla de dinero que se
   * contradice a sí misma es peor que no tener desplegable.
   */
  async breakdown(organizationId: string, category: CashCategory) {
    const d = await cargarDatosDeCaja(this.prisma, organizationId);
    const etiquetas = etiquetasDe(d);

    const entries = cashEntries(d.ledger)
      .filter((e) => e.category === category)
      // Más nuevo primero: es el orden en el que el dueño busca una fila.
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .map((e) => ({
        date: e.date,
        amount: e.amount,
        ...((e.id && etiquetas.get(e.id)) || SIN_DETALLE),
      }));

    return {
      category,
      /**
       * ⚠️ El total se RECALCULA sobre los asientos que se devuelven; no se
       * copia de `businessCash`. Si alguna vez divergieran, la diferencia se
       * ve en pantalla en vez de quedar tapada por un número prestado.
       *
       * Se redondea igual que la línea del resumen (`round2` por categoría),
       * o el ruido de coma flotante haría que dos cifras iguales se vieran
       * distintas.
       */
      total: round2(entries.reduce((sum, e) => sum + e.amount, 0)),
      entries,
    };
  }

  /** Convierte a USD con la tasa congelada. Sin tasa, ya está en USD. */
  /**
   * EL PLAN DEL FALTANTE, para previsualizar antes de confirmar. La cuenta
   * vive en `conciliacion.ts`; acá queda la puerta del endpoint.
   */
  async shortfallPlan(organizationId: string, id: string, query: CashShortfallPlanQueryDto) {
    return planDeFaltante(this.prisma, organizationId, id, query);
  }

  async summary(organizationId: string) {
    const cp = await this.defaultCounterparty(organizationId);
    const d = await cargarDatosDeCaja(this.prisma, organizationId);

    /**
     * La deuda de TODOS los que ponen plata de su bolsillo, no solo la de la
     * contraparte por defecto.
     *
     * ⚠️ Sin esto, un gasto que el dueño le atribuya a un socio desde la
     * pantalla de Gastos **desaparecería de Caja**: ya no se le cuenta al
     * propietario (que es lo correcto) y nadie más lo pregunta. Antes se le
     * atribuía al propietario, que era mentira pero al menos se veía.
     *
     * ⚠️ El encabezado sigue nombrando SOLO a la contraparte por defecto. Con
     * un socio real hay que mostrar la deuda de cada uno por separado; hoy no
     * hay ninguno, así que el total y las filas son exactamente los mismos.
     */
    const deTodos = d.contrapartes.filter((c) => c.kind === 'OWNER' || c.kind === 'PARTNER');
    const deudas = deTodos.length
      ? deTodos.flatMap((c) => obligacionesDe(d, c.id))
      : obligacionesDe(d, cp.id);
    const bolsillos = new Set(deTodos.length ? deTodos.map((c) => c.id) : [cp.id]);

    const financing = ownerFinancing({
      obligations: deudas,
      paymentsTotal: d.movimientos
        .filter((m) => m.counterpartyId && bolsillos.has(m.counterpartyId) && m.kind === 'WITHDRAWAL')
        .reduce((s, m) => s + n(m.amount), 0),
      /**
       * ⚠️ Este número tiene que ser el MISMO que el `totals.prestamista` de
       * Deuda. Antes lo garantizaba un `vigentes()` acá; desde 2026-10-11 lo
       * garantiza `loanPaid`, que ignora las anuladas: la marca viaja y el
       * motor decide. Sin eso, anular una cuota subía el saldo en Deuda y no
       * en Caja, y Caja le decía al dueño que debía menos de lo que debe.
       */
      lenderBalance: d.prestamos.reduce(
        (s, l) =>
          s +
          loanBalance(
            n(l.principal),
            l.payments.map((p) => ({ amount: n(p.amount), voided: p.voidedAt != null })),
          ),
        0,
      ),
    });

    return {
      counterparty: { id: cp.id, name: cp.name, kind: cp.kind },
      accounts: d.cuentas.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        shared: a.shared,
        sharedWithId: a.sharedWithId,
        autoAttributeShortfall: a.autoAttributeShortfall,
        isDefault: a.isDefault,
      })),
      applicationOrder: d.order,
      balance: businessCash(d.ledger),
      financing,
      obligations: deudas,
      movements: [...d.movimientos].reverse().map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        kind: m.kind,
        amount: n(m.amount),
        concept: m.concept,
        note: m.note,
        refundable: m.refundable,
        source: m.source,
        counterpartyId: m.counterpartyId,
        applied: d.porPago.get(m.id) ?? 0,
        cashReconciliationId: m.cashReconciliationId,
      })),
      /**
       * ⚠️ Una conciliación CONFIRMADA muestra lo CONGELADO, no lo recalculado:
       * es un documento. `expectedNow` deja ver si entraron movimientos con
       * fecha anterior después de conciliar.
       */
      reconciliations: d.conciliaciones.map((c) => {
        const esperadoHoy = businessCash(d.ledger, dia(c.date)).balance;
        const congelado = c.status === 'CONFIRMED' && c.expectedUsd != null;
        /**
         * ⚠️ El ajuste que generó ESTA conciliación no la vuelve vieja.
         *
         * `expectedUsd` se congela ANTES de crear el ajuste, y el ajuste se
         * fecha ese mismo día: por eso `esperadoHoy` ya viene con el faltante
         * descontado y siempre difiere del congelado, en exactamente el monto
         * del ajuste. Sin sumarlo de vuelta, `stale` se encendería en TODA
         * conciliación ajustada y el aviso dejaría de significar algo.
         */
        const ajuste = c.adjustment ? n(c.adjustment.amount) : 0;
        const expectedUsd = congelado ? n(c.expectedUsd) : esperadoHoy;
        const totalUsd = congelado ? n(c.totalUsd) : aUsd(n(c.totalAmount), c.rate);
        const personalUsd = congelado ? n(c.personalUsd) : aUsd(n(c.personalAmount), c.rate);
        const resultado = reconcile({ expectedUsd, totalUsd, personalUsd });

        return {
          id: c.id,
          accountId: c.accountId,
          date: c.date.toISOString(),
          status: c.status,
          currency: c.currency,
          rate: c.rate == null ? null : n(c.rate),
          totalAmount: n(c.totalAmount),
          personalAmount: n(c.personalAmount),
          expectedUsd,
          totalUsd,
          personalUsd,
          ...resultado,
          /**
           * EL REPARTO QUE SE VA A HACER si se confirma, calculado por el
           * MISMO camino que `confirm()`.
           *
           * ⚠️ No lo puede previsualizar el front con `obligations`: esa lista
           * sale sin filtro de fecha y con la contraparte por defecto de la
           * organización, mientras que `confirm()` filtra hasta la fecha de la
           * conciliación y usa la contraparte de la CUENTA. Conciliar con
           * retraso —el caso normal— le mostraría al dueño deudas posteriores
           * que el servidor va a ignorar, y firmaría un reparto que no es el
           * que ocurre. Esta pantalla existe justamente para que eso no pase.
           */
          plan: planDe(d, c, resultado),
          /** Lo que daría hoy, sin contar el ajuste propio de esta conciliación. */
          expectedNow: Math.round((esperadoHoy + ajuste) * 100) / 100,
          /** De verdad entraron movimientos con fecha anterior después de conciliar. */
          stale: congelado && Math.abs(esperadoHoy + ajuste - expectedUsd) > 0.01,
          explanation: c.explanation,
          note: c.note,
          source: c.source,
          confirmedAt: c.confirmedAt?.toISOString() ?? null,
          voidedAt: c.voidedAt?.toISOString() ?? null,
          adjustment: c.adjustment
            ? { id: c.adjustment.id, amount: n(c.adjustment.amount), concept: c.adjustment.concept }
            : null,
        };
      }),
    };
  }

  async addMovement(organizationId: string, dto: OwnerMovementCreateDto) {
    // ⚠️ IDOR: una contraparte pedida por el cliente tiene que ser de ESTA
    // organización. Sin este chequeo, un id ajeno escribiría deuda en otra.
    const contraparte = dto.counterpartyId
      ? await this.prisma.counterparty.findFirst({
          where: { id: dto.counterpartyId, organizationId },
        })
      : await this.defaultCounterparty(organizationId);
    if (!contraparte) throw new NotFoundException('No existe esa contraparte');

    await this.prisma.ownerMovement.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        kind: dto.kind,
        amount: dto.amount,
        concept: dto.concept,
        counterpartyId: contraparte.id,
        refundable: dto.refundable,
        source: 'MANUAL',
        note: dto.note ?? null,
      },
    });
    return this.summary(organizationId);
  }

  async removeMovement(organizationId: string, id: string) {
    const { count } = await this.prisma.ownerMovement.deleteMany({ where: { id, organizationId } });
    if (!count) throw new NotFoundException('No existe ese movimiento');
    return this.summary(organizationId);
  }

  /** Crea o corrige un BORRADOR. Una conciliación confirmada no se edita. */
  /**
   * LAS TRES PUERTAS DE LA CONCILIACIÓN. La escritura vive en
   * `escribir-conciliacion.ts`; acá queda lo único que no podía irse con
   * ella: **devolver el resumen**. Escribir y responder son dos cosas
   * distintas, y separarlas es lo que dejó salir esas 169 líneas.
   */
  async saveReconciliation(organizationId: string, dto: CashReconciliationUpsertDto) {
    await guardarConciliacion(this.prisma, organizationId, dto);
    return this.summary(organizationId);
  }

  async confirm(
    organizationId: string,
    id: string,
    dto: CashReconciliationConfirmDto,
    userId: string,
  ) {
    await confirmarConciliacion(this.prisma, organizationId, id, dto, userId);
    return this.summary(organizationId);
  }

  async voidReconciliation(organizationId: string, id: string) {
    await anularConciliacion(this.prisma, organizationId, id);
    return this.summary(organizationId);
  }
}
