import { Injectable, NotFoundException } from '@nestjs/common';
import {
  businessCash,
  cashCountCheck,
  loanBalance,
  ownerFinancing,
  type CashCountUpsertDto,
  type CashLedger,
  type OwnerMovementCreateDto,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CAJA — la hoja "Caja" del Excel, y el bloque "Quién puso la plata" de la
 * hoja "Inversion".
 *
 * Nada de lo que muestra se guarda: el saldo del negocio, lo que es personal en
 * cada conteo y lo que se le debe a Vanan se DERIVAN de las ventas, los abonos,
 * los gastos (con quién los pagó), las cuotas y los movimientos. Solo se
 * guardan dos cosas que no salen de ningún otro lado: la plata pura que entra o
 * sale del bolsillo de Vanan, y lo que dice Binance cada lunes.
 */
const dia = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  /** Todos los movimientos de plata del negocio, en la forma que usa `shared`. */
  private async ledger(organizationId: string) {
    const where = { organizationId };
    const [ventas, abonos, gastos, cuotas, movimientos, prestamos] = await Promise.all([
      this.prisma.sale.findMany({ where, select: { date: true, amount: true } }),
      this.prisma.payment.findMany({ where, select: { date: true, amount: true } }),
      this.prisma.expense.findMany({
        where,
        select: {
          date: true,
          amount: true,
          paidBy: true,
          isInvestment: true,
          category: true,
          materialId: true,
        },
      }),
      this.prisma.loanPayment.findMany({ where, select: { date: true, amount: true, paidBy: true } }),
      this.prisma.ownerMovement.findMany({ where, orderBy: { date: 'asc' } }),
      this.prisma.loan.findMany({
        where: { organizationId, closedAt: null },
        select: { principal: true, payments: { select: { amount: true } } },
      }),
    ]);

    const ledger: CashLedger = {
      sales: ventas.map((v) => ({ date: dia(v.date), amount: Number(v.amount) })),
      orderPayments: abonos.map((p) => ({ date: dia(p.date), amount: Number(p.amount) })),
      expenses: gastos.map((g) => ({
        date: dia(g.date),
        amount: Number(g.amount),
        paidBy: g.paidBy,
        isInvestment: g.isInvestment,
        isFilament: g.materialId != null,
      })),
      loanPayments: cuotas.map((c) => ({
        date: dia(c.date),
        amount: Number(c.amount),
        paidBy: c.paidBy,
      })),
      movements: movimientos.map((m) => ({
        date: dia(m.date),
        amount: Number(m.amount),
        kind: m.kind,
      })),
    };

    return { ledger, gastos, cuotas, movimientos, prestamos };
  }

  async summary(organizationId: string) {
    const { ledger, gastos, cuotas, movimientos, prestamos } = await this.ledger(organizationId);
    const conteos = await this.prisma.cashCount.findMany({
      where: { organizationId },
      orderBy: { date: 'desc' },
    });

    const deVanan = gastos.filter((g) => g.paidBy === 'OWNER');
    const suma = (xs: { amount: unknown }[]) => xs.reduce((s, x) => s + Number(x.amount), 0);

    const financing = ownerFinancing({
      designer: suma(deVanan.filter((g) => !g.isInvestment && g.category === 'DESIGN')),
      purchases:
        suma(deVanan.filter((g) => !g.isInvestment && g.category !== 'DESIGN')) +
        suma(movimientos.filter((m) => m.kind === 'CONTRIBUTION')),
      loanPayments: suma(cuotas.filter((c) => c.paidBy === 'OWNER')),
      equipment: suma(deVanan.filter((g) => g.isInvestment)),
      withdrawals: suma(movimientos.filter((m) => m.kind === 'WITHDRAWAL')),
      lenderBalance: prestamos.reduce(
        (s, l) =>
          s + loanBalance(Number(l.principal), l.payments.map((p) => ({ amount: Number(p.amount) }))),
        0,
      ),
    });

    return {
      balance: businessCash(ledger),
      financing,
      movements: [...movimientos].reverse().map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        kind: m.kind,
        amount: Number(m.amount),
        concept: m.concept,
        note: m.note,
      })),
      // Cada conteo se compara con lo que era del negocio ESE día, no hoy: una
      // venta de después no puede tapar un faltante de antes.
      counts: conteos.map((c) => {
        const business = businessCash(ledger, dia(c.date)).balance;
        return {
          id: c.id,
          date: c.date.toISOString(),
          total: Number(c.total),
          note: c.note,
          business,
          ...cashCountCheck(Number(c.total), business),
        };
      }),
    };
  }

  async addMovement(organizationId: string, dto: OwnerMovementCreateDto) {
    await this.prisma.ownerMovement.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        kind: dto.kind,
        amount: dto.amount,
        concept: dto.concept,
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

  /** Un conteo por día: volver a contar el mismo lunes corrige el anterior. */
  async saveCount(organizationId: string, dto: CashCountUpsertDto) {
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    await this.prisma.cashCount.upsert({
      where: { organizationId_date: { organizationId, date } },
      create: { organizationId, date, total: dto.total, note: dto.note ?? null },
      update: { total: dto.total, note: dto.note ?? null },
    });
    return this.summary(organizationId);
  }

  async removeCount(organizationId: string, id: string) {
    const { count } = await this.prisma.cashCount.deleteMany({ where: { id, organizationId } });
    if (!count) throw new NotFoundException('No existe ese conteo');
    return this.summary(organizationId);
  }
}
