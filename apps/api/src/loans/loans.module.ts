import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  LoanCreateSchema,
  LoanPaymentCreateSchema,
  LoanUpdateSchema,
  loanBalance,
  loanPaid,
  loanProgress,
  monthsToPayOff,
  type LoanCreateDto,
  type LoanPaymentCreateDto,
  type LoanUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DEUDA — los préstamos con los que se compró equipo, y sus pagos.
 *
 * El **saldo se DERIVA** (capital − abonos) con los helpers puros de
 * `shared/calc/loan.ts`; nunca se almacena, igual que el saldo de un pedido.
 *
 * Un pago de préstamo **no genera un `Expense`**: el equipo ya entró al ledger
 * como inversión, y contar además cada cuota sería contar la misma máquina dos
 * veces. Devolver capital no es un costo.
 */
const incluir = {
  payments: { orderBy: { date: 'asc' } },
  printer: { select: { id: true, name: true } },
} as const;

type LoanConPagos = {
  id: string;
  name: string;
  principal: unknown;
  monthlyPayment: unknown;
  startDate: Date | null;
  closedAt: Date | null;
  notes: string | null;
  printerId: string | null;
  printer: { id: string; name: string } | null;
  payments: { id: string; date: Date; amount: unknown; reference: string | null }[];
};

/** Arma la respuesta campo por campo: nunca se devuelve la fila cruda. */
function serialize(l: LoanConPagos) {
  const principal = Number(l.principal);
  const monthlyPayment = Number(l.monthlyPayment);
  const payments = l.payments.map((p) => ({
    id: p.id,
    date: p.date.toISOString(),
    amount: Number(p.amount),
    reference: p.reference,
  }));
  const balance = loanBalance(principal, payments);

  return {
    id: l.id,
    name: l.name,
    principal,
    monthlyPayment,
    startDate: l.startDate?.toISOString() ?? null,
    closedAt: l.closedAt?.toISOString() ?? null,
    notes: l.notes,
    printer: l.printer,
    payments,
    // Derivados: la única fuente de estos números.
    paid: loanPaid(payments),
    balance,
    progress: loanProgress(principal, payments),
    monthsLeft: monthsToPayOff(balance, monthlyPayment),
  };
}

const fecha = (v?: string | null) => (v ? new Date(v) : null);

@Injectable()
export class LoansService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.loan
      .findMany({ where: { organizationId }, include: incluir, orderBy: { createdAt: 'asc' } })
      .then((ls) => ls.map((l) => serialize(l as LoanConPagos)));
  }

  async get(organizationId: string, id: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id, organizationId },
      include: incluir,
    });
    if (!loan) throw new NotFoundException('No existe ese préstamo');
    return serialize(loan as LoanConPagos);
  }

  async create(organizationId: string, dto: LoanCreateDto) {
    const loan = await this.prisma.loan.create({
      data: {
        organizationId,
        name: dto.name,
        principal: dto.principal,
        monthlyPayment: dto.monthlyPayment ?? 0,
        startDate: fecha(dto.startDate),
        closedAt: fecha(dto.closedAt),
        notes: dto.notes ?? null,
        printerId: dto.printerId ?? null,
      },
      include: incluir,
    });
    return serialize(loan as LoanConPagos);
  }

  async update(organizationId: string, id: string, dto: LoanUpdateDto) {
    await this.get(organizationId, id);
    const loan = await this.prisma.loan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.principal !== undefined && { principal: dto.principal }),
        ...(dto.monthlyPayment !== undefined && { monthlyPayment: dto.monthlyPayment }),
        ...(dto.startDate !== undefined && { startDate: fecha(dto.startDate) }),
        ...(dto.closedAt !== undefined && { closedAt: fecha(dto.closedAt) }),
        ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
        ...(dto.printerId !== undefined && { printerId: dto.printerId ?? null }),
      },
      include: incluir,
    });
    return serialize(loan as LoanConPagos);
  }

  async remove(organizationId: string, id: string) {
    await this.get(organizationId, id);
    await this.prisma.loan.delete({ where: { id } });
    return { ok: true };
  }

  async addPayment(organizationId: string, id: string, dto: LoanPaymentCreateDto) {
    await this.get(organizationId, id);
    await this.prisma.loanPayment.create({
      data: {
        organizationId,
        loanId: id,
        date: new Date(dto.date),
        amount: dto.amount,
        reference: dto.reference ?? null,
      },
    });
    return this.get(organizationId, id);
  }

  async removePayment(organizationId: string, id: string, paymentId: string) {
    const pago = await this.prisma.loanPayment.findFirst({
      where: { id: paymentId, loanId: id, organizationId },
    });
    if (!pago) throw new NotFoundException('No existe ese pago');
    await this.prisma.loanPayment.delete({ where: { id: paymentId } });
    return this.get(organizationId, id);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('loans')
export class LoansController {
  constructor(private service: LoansService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LoanCreateSchema)) dto: LoanCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LoanUpdateSchema)) dto: LoanUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LoanPaymentCreateSchema)) dto: LoanPaymentCreateDto,
  ) {
    return this.service.addPayment(user.organizationId, id, dto);
  }

  @Delete(':id/payments/:paymentId')
  removePayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.service.removePayment(user.organizationId, id, paymentId);
  }
}

@Module({
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
