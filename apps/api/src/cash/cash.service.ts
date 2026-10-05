import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  applyPayment,
  businessCash,
  loanBalance,
  obligationLedger,
  ownerFinancing,
  reconcile,
  type ApplicationOrder,
  type CashLedger,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
  type ObligationInput,
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
const dia = (d: Date) => d.toISOString().slice(0, 10);
const n = (x: unknown) => Number(x);

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  /** La contraparte por defecto: a quién se le debe si nadie dice otra cosa. */
  private async defaultCounterparty(organizationId: string) {
    const cp = await this.prisma.counterparty.findFirst({
      where: { organizationId, kind: 'OWNER' },
      orderBy: { isDefault: 'desc' },
    });
    if (!cp) throw new NotFoundException('No hay una contraparte configurada');
    return cp;
  }

  /** Todos los datos crudos, una sola vez. */
  private async datos(organizationId: string) {
    const where = { organizationId };
    const [ventas, abonos, gastos, cuotas, movimientos, aplicaciones, prestamos, cuentas, conciliaciones, settings] =
      await Promise.all([
        this.prisma.sale.findMany({ where, select: { date: true, amount: true } }),
        this.prisma.payment.findMany({ where, select: { date: true, amount: true } }),
        this.prisma.expense.findMany({ where }),
        this.prisma.loanPayment.findMany({ where }),
        this.prisma.ownerMovement.findMany({ where, orderBy: { date: 'asc' } }),
        this.prisma.debtApplication.findMany({ where }),
        this.prisma.loan.findMany({
          where: { organizationId, closedAt: null },
          select: { principal: true, payments: { select: { amount: true } } },
        }),
        this.prisma.cashAccount.findMany({ where, orderBy: { isDefault: 'desc' } }),
        this.prisma.cashReconciliation.findMany({
          where,
          orderBy: { date: 'desc' },
          include: { adjustment: { select: { id: true, amount: true, concept: true } } },
        }),
        this.prisma.settings.findUnique({ where: { organizationId } }),
      ]);

    // Lo aplicado a CADA obligación y lo aplicado POR cada pago.
    const porObligacion = new Map<string, number>();
    const porPago = new Map<string, number>();
    for (const a of aplicaciones) {
      const obligacion = a.expenseId ?? a.loanPaymentId ?? a.obligationMovementId;
      if (obligacion) porObligacion.set(obligacion, (porObligacion.get(obligacion) ?? 0) + n(a.amount));
      porPago.set(a.paymentId, (porPago.get(a.paymentId) ?? 0) + n(a.amount));
    }

    const ledger: CashLedger = {
      sales: ventas.map((v) => ({ date: dia(v.date), amount: n(v.amount) })),
      orderPayments: abonos.map((p) => ({ date: dia(p.date), amount: n(p.amount) })),
      expenses: gastos.map((g) => ({
        date: dia(g.date),
        amount: n(g.amount),
        paidBy: g.paidBy,
        isInvestment: g.isInvestment,
        isFilament: g.materialId != null,
        refundable: g.refundable,
      })),
      loanPayments: cuotas.map((c) => ({
        date: dia(c.date),
        amount: n(c.amount),
        paidBy: c.paidBy,
        refundable: c.refundable,
      })),
      movements: movimientos.map((m) => ({
        date: dia(m.date),
        amount: n(m.amount),
        kind: m.kind,
        refundable: m.refundable,
        applied: porPago.get(m.id) ?? 0,
      })),
    };

    return {
      ledger, gastos, cuotas, movimientos, prestamos, cuentas, conciliaciones,
      porObligacion, porPago,
      order: (settings?.debtApplicationOrder ?? 'OLDEST_FIRST') as ApplicationOrder,
    };
  }

  /** Las obligaciones de una contraparte, con lo ya aplicado. */
  private obligaciones(
    d: Awaited<ReturnType<CashService['datos']>>,
    counterpartyId: string,
    hasta?: string,
  ) {
    const vale = (f: Date) => !hasta || dia(f) <= hasta;
    const items: ObligationInput[] = [
      ...d.gastos
        .filter((g) => g.paidBy === 'OWNER' && g.refundable && vale(g.date))
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
        .filter((c) => c.paidBy === 'OWNER' && c.refundable && vale(c.date))
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

  /** Convierte a USD con la tasa congelada. Sin tasa, ya está en USD. */
  private aUsd(monto: number, rate: unknown) {
    const tasa = rate == null ? 1 : n(rate);
    return tasa > 0 ? Math.round((monto / tasa) * 100) / 100 : monto;
  }

  /**
   * Qué va a pasar si se confirma este borrador: contra qué deudas se aplica
   * el faltante y cuánto queda como retiro.
   *
   * Tiene que usar EXACTAMENTE las mismas entradas que `confirm()` —la
   * contraparte de la CUENTA y las obligaciones filtradas HASTA la fecha de la
   * conciliación—, o la pantalla prometería un reparto distinto del que
   * ocurre. Devuelve `null` cuando no habría ajuste.
   */
  private planDe(
    d: Awaited<ReturnType<CashService['datos']>>,
    c: { accountId: string; date: Date; status: string },
    r: { kind: string; differenceUsd: number },
  ) {
    if (c.status !== 'DRAFT' || r.kind !== 'SHORT') return null;
    const cuenta = d.cuentas.find((a) => a.id === c.accountId);
    if (!cuenta?.shared || !cuenta.autoAttributeShortfall || !cuenta.sharedWithId) return null;

    const fecha = dia(c.date);
    const deudas = this.obligaciones(d, cuenta.sharedWithId, fecha);
    const plan = applyPayment(deudas, Math.abs(r.differenceUsd), d.order);
    const porId = new Map(deudas.map((o) => [o.sourceId, o]));

    return {
      applications: plan.applications.map((a) => ({
        sourceId: a.sourceId,
        source: a.source,
        amount: a.amount,
        date: porId.get(a.sourceId)?.date ?? fecha,
        category: porId.get(a.sourceId)?.category ?? null,
      })),
      /** Lo que sobra después de cancelar todo: se registra como retiro. */
      leftover: plan.leftover,
      order: d.order,
    };
  }

  async summary(organizationId: string) {
    const cp = await this.defaultCounterparty(organizationId);
    const d = await this.datos(organizationId);
    const deudas = this.obligaciones(d, cp.id);

    const financing = ownerFinancing({
      obligations: deudas,
      paymentsTotal: d.movimientos
        .filter((m) => m.counterpartyId === cp.id && m.kind === 'WITHDRAWAL')
        .reduce((s, m) => s + n(m.amount), 0),
      lenderBalance: d.prestamos.reduce(
        (s, l) => s + loanBalance(n(l.principal), l.payments.map((p) => ({ amount: n(p.amount) }))),
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
        const totalUsd = congelado ? n(c.totalUsd) : this.aUsd(n(c.totalAmount), c.rate);
        const personalUsd = congelado ? n(c.personalUsd) : this.aUsd(n(c.personalAmount), c.rate);
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
          plan: this.planDe(d, c, resultado),
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
  async saveReconciliation(organizationId: string, dto: CashReconciliationUpsertDto) {
    const cuenta = await this.prisma.cashAccount.findFirst({
      where: { id: dto.accountId, organizationId },
    });
    if (!cuenta) throw new NotFoundException('No existe esa cuenta');

    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const viva = await this.prisma.cashReconciliation.findFirst({
      where: { organizationId, accountId: dto.accountId, date, status: { not: 'VOID' } },
    });
    if (viva?.status === 'CONFIRMED') {
      throw new ConflictException('Esa conciliación ya está confirmada. Anulala y hacé una nueva.');
    }

    const datos = {
      totalAmount: dto.totalAmount,
      personalAmount: dto.personalAmount,
      currency: dto.currency,
      rate: dto.currency === 'USD' ? null : dto.rate,
      note: dto.note ?? null,
    };

    if (viva) {
      await this.prisma.cashReconciliation.update({ where: { id: viva.id }, data: datos });
    } else {
      await this.prisma.cashReconciliation.create({
        data: { organizationId, accountId: dto.accountId, date, status: 'DRAFT', ...datos },
      });
    }
    return this.summary(organizationId);
  }

  /**
   * CONFIRMAR: congela los importes, calcula la diferencia y —si la cuenta lo
   * tiene activado y el dueño no pidió otra cosa— registra el faltante como
   * salida hacia la contraparte, aplicándolo FIFO a sus deudas.
   *
   * ⚠️ Idempotente: solo corre sobre un DRAFT. Re-confirmar da 409, y además
   * `OwnerMovement.cashReconciliationId` es único en la base, así que ni
   * forzándolo se crearía un segundo ajuste.
   *
   * ⚠️ Una diferencia A FAVOR no genera NADA: no se convierte en venta, ni en
   * ganancia, ni en aporte. Su origen no se conoce.
   *
   * ⚠️ El ajuste va fechado el día de la conciliación, no hoy: así baja el
   * saldo esperado A ESA FECHA y la conciliación queda cuadrada.
   */
  async confirm(
    organizationId: string,
    id: string,
    dto: CashReconciliationConfirmDto,
    userId: string,
  ) {
    const c = await this.prisma.cashReconciliation.findFirst({
      where: { id, organizationId },
      include: { account: true },
    });
    if (!c) throw new NotFoundException('No existe esa conciliación');
    if (c.status !== 'DRAFT') {
      throw new ConflictException('Esa conciliación ya se confirmó o se anuló');
    }

    const d = await this.datos(organizationId);
    const fecha = dia(c.date);
    const expectedUsd = businessCash(d.ledger, fecha).balance;
    const totalUsd = this.aUsd(n(c.totalAmount), c.rate);
    const personalUsd = this.aUsd(n(c.personalAmount), c.rate);
    const r = reconcile({ expectedUsd, totalUsd, personalUsd });

    const atribuir =
      r.kind === 'SHORT' &&
      c.account.shared &&
      c.account.autoAttributeShortfall &&
      dto.attributeShortfall &&
      c.account.sharedWithId != null;

    await this.prisma.$transaction(async (tx) => {
      if (atribuir) {
        const contraparte = c.account.sharedWithId!;
        const monto = Math.abs(r.differenceUsd);
        const plan = applyPayment(this.obligaciones(d, contraparte, fecha), monto, d.order);

        const ajuste = await tx.ownerMovement.create({
          data: {
            organizationId,
            date: c.date,
            kind: 'WITHDRAWAL',
            amount: monto,
            concept: `Faltante de la conciliación del ${fecha}`,
            counterpartyId: contraparte,
            refundable: true,
            source: 'RECONCILIATION',
            cashReconciliationId: c.id,
          },
        });

        if (plan.applications.length) {
          await tx.debtApplication.createMany({
            data: plan.applications.map((a) => ({
              organizationId,
              paymentId: ajuste.id,
              amount: a.amount,
              expenseId: a.source === 'EXPENSE' ? a.sourceId : null,
              loanPaymentId: a.source === 'LOAN_PAYMENT' ? a.sourceId : null,
              obligationMovementId: a.source === 'MOVEMENT' ? a.sourceId : null,
            })),
          });
        }
      }

      await tx.cashReconciliation.update({
        where: { id: c.id },
        data: {
          status: 'CONFIRMED',
          expectedUsd,
          totalUsd,
          personalUsd,
          differenceUsd: r.differenceUsd,
          explanation: dto.explanation ?? null,
          confirmedAt: new Date(),
          confirmedByUserId: userId,
        },
      });
    });

    return this.summary(organizationId);
  }

  /**
   * ANULAR: revierte el ajuste y sus aplicaciones (caen en cascada con el
   * movimiento) y deja la fila en el historial. Corregir = anular + nueva.
   */
  async voidReconciliation(organizationId: string, id: string) {
    const c = await this.prisma.cashReconciliation.findFirst({
      where: { id, organizationId },
      include: { adjustment: { select: { id: true } } },
    });
    if (!c) throw new NotFoundException('No existe esa conciliación');
    if (c.status === 'VOID') throw new ConflictException('Esa conciliación ya está anulada');

    await this.prisma.$transaction(async (tx) => {
      if (c.adjustment) {
        await tx.ownerMovement.deleteMany({ where: { id: c.adjustment.id, organizationId } });
      }
      await tx.cashReconciliation.update({
        where: { id: c.id },
        data: { status: 'VOID', voidedAt: new Date() },
      });
    });

    return this.summary(organizationId);
  }
}
