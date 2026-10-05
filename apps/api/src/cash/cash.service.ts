import { Injectable, NotFoundException } from '@nestjs/common';
import {
  businessCash,
  loanBalance,
  obligationLedger,
  ownerFinancing,
  reconcile,
  type ApplicationOrder,
  type CashLedger,
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
        const expectedUsd = congelado ? n(c.expectedUsd) : esperadoHoy;
        const totalUsd = congelado ? n(c.totalUsd) : this.aUsd(n(c.totalAmount), c.rate);
        const personalUsd = congelado ? n(c.personalUsd) : this.aUsd(n(c.personalAmount), c.rate);

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
          ...reconcile({ expectedUsd, totalUsd, personalUsd }),
          /** Lo que daría hoy. Si difiere de `expectedUsd`, entraron movimientos viejos. */
          expectedNow: esperadoHoy,
          stale: congelado && Math.abs(esperadoHoy - expectedUsd) > 0.01,
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
}
