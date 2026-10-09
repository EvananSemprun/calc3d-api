import {
  BadRequestException,
  Body,
  ConflictException,
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
  LoanPaymentVoidSchema,
  LoanUpdateSchema,
  loanBalance,
  loanPaid,
  loanProgress,
  payOffEstimate,
  type LoanCreateDto,
  type LoanPaymentVoidDto,
  type PaymentFrequency,
  type LoanPaymentCreateDto,
  type LoanUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CashModule } from '../cash/cash.module';
import { CashService } from '../cash/cash.service';

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
  // El NOMBRE de quien puso cada cuota viaja con el pago: sin esto, la
  // pantalla y el reporte de Excel tendrían que ir a buscarlo por separado y
  // podrían mostrar cosas distintas sobre el mismo pago.
  payments: {
    orderBy: { date: 'asc' },
    include: { counterparty: { select: { id: true, name: true } } },
  },
  printer: { select: { id: true, name: true } },
  counterparty: { select: { id: true, name: true, kind: true } },
} as const;

type LoanConPagos = {
  id: string;
  name: string;
  principal: unknown;
  monthlyPayment: unknown;
  paymentFrequency: PaymentFrequency;
  concept: string | null;
  nextDueDate: Date | null;
  startDate: Date | null;
  closedAt: Date | null;
  notes: string | null;
  printerId: string | null;
  printer: { id: string; name: string } | null;
  counterparty: { id: string; name: string; kind: string } | null;
  payments: {
    id: string;
    date: Date;
    amount: unknown;
    reference: string | null;
    counterpartyId: string | null;
    counterparty: { id: string; name: string } | null;
    accountId: string | null;
    refundable: boolean;
    source: string;
    voidedAt: Date | null;
    voidReason: string | null;
  }[];
};

/** Arma la respuesta campo por campo: nunca se devuelve la fila cruda. */
function serialize(l: LoanConPagos, now = new Date()) {
  const principal = Number(l.principal);
  const monthlyPayment = Number(l.monthlyPayment);
  const payments = l.payments.map((p) => ({
    id: p.id,
    date: p.date.toISOString(),
    amount: Number(p.amount),
    reference: p.reference,
    counterpartyId: p.counterpartyId,
    counterparty: p.counterparty,
    accountId: p.accountId,
    /** Si el que lo pagó de su bolsillo queda con una deuda a favor. */
    generatesDebt: p.refundable,
    source: p.source,
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidReason: p.voidReason,
  }));

  /**
   * ⚠️ Un pago ANULADO no baja el saldo, pero **no se borra de la lista**: el
   * historial tiene que mostrar que existió y que se anuló. Por eso el saldo se
   * calcula sobre los vigentes y la pantalla recibe los dos.
   */
  const vigentes = payments.filter((p) => p.voidedAt == null);
  const balance = loanBalance(principal, vigentes);
  const frequency = l.paymentFrequency;

  return {
    id: l.id,
    name: l.name,
    concept: l.concept,
    principal,
    /** La cuota OBJETIVO, en su frecuencia. No es un promedio ni un compromiso. */
    installmentTarget: monthlyPayment,
    paymentFrequency: frequency,
    counterparty: l.counterparty,
    nextDueDate: l.nextDueDate?.toISOString() ?? null,
    startDate: l.startDate?.toISOString() ?? null,
    closedAt: l.closedAt?.toISOString() ?? null,
    notes: l.notes,
    printer: l.printer,
    payments,
    // Derivados: la única fuente de estos números.
    paid: loanPaid(vigentes),
    balance,
    progress: loanProgress(principal, vigentes),
    /** Activo o Pagado, derivado del saldo. No hay "Cancelado". */
    status: balance <= 0 || l.closedAt ? ('PAGADO' as const) : ('ACTIVO' as const),
    /** Las DOS lecturas: al ritmo objetivo y al ritmo real. */
    estimate: payOffEstimate({
      balance,
      installment: monthlyPayment,
      frequency,
      payments: vigentes,
      startDate: l.startDate,
      now,
    }),
  };
}

const fecha = (v?: string | null) => (v ? new Date(v) : null);

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private cash: CashService,
  ) {}

  list(organizationId: string) {
    return this.prisma.loan
      .findMany({ where: { organizationId }, include: incluir, orderBy: { createdAt: 'asc' } })
      .then((ls) => ls.map((l) => serialize(l as LoanConPagos)));
  }

  /**
   * LAS DOS DEUDAS de la pantalla.
   *
   * Son cosas distintas que comparten la palabra "préstamo": lo que le debés al
   * **prestamista** (capital menos pagos) y lo que el negocio le debe al
   * **propietario** por lo que puso (equipos, diseñador, aportes). Los pagos
   * por conciliación caen en la segunda, que es donde de verdad se aplican.
   *
   * ⚠️ Las obligaciones se piden al **mismo servicio que usa Caja**. Si acá se
   * recalcularan, el día que un filtro cambie las dos pantallas van a decir
   * cosas distintas sobre la misma deuda — es el motivo por el que el reporte
   * de Excel también reusa `CashService`.
   */
  async overview(organizationId: string) {
    const [loans, caja] = await Promise.all([
      this.list(organizationId),
      this.cash.summary(organizationId),
    ]);
    return {
      loans,
      /** Lo que el negocio le debe a la contraparte, obligación por obligación. */
      owner: {
        counterparty: caja.counterparty,
        obligations: caja.obligations,
        total: caja.financing.owedToOwner,
        applicationOrder: caja.applicationOrder,
      },
    };
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
        paymentFrequency: dto.paymentFrequency ?? 'MONTHLY',
        counterpartyId: await this.acreedor(organizationId, dto.counterpartyId),
        concept: dto.concept ?? null,
        nextDueDate: fecha(dto.nextDueDate),
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
        ...(dto.paymentFrequency !== undefined && { paymentFrequency: dto.paymentFrequency }),
        ...(dto.counterpartyId !== undefined && {
          counterpartyId: await this.acreedor(organizationId, dto.counterpartyId),
        }),
        ...(dto.concept !== undefined && { concept: dto.concept ?? null }),
        ...(dto.nextDueDate !== undefined && { nextDueDate: fecha(dto.nextDueDate) }),
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
    const loan = await this.get(organizationId, id);

    // ⚠️ No se puede amortizar mas que el saldo: el capital devuelto de mas no
    // es un saldo a favor, es un error de carga. `loanBalance` lo recorta en 0
    // y el exceso quedaria invisible.
    if (dto.amount > loan.balance + 0.005) {
      throw new BadRequestException(
        `Ese pago ($${dto.amount}) es mayor que el saldo pendiente ($${loan.balance}).`,
      );
    }

    const counterpartyId = await this.pagador(organizationId, dto);
    await this.prisma.loanPayment.create({
      data: {
        organizationId,
        loanId: id,
        date: new Date(dto.date),
        amount: dto.amount,
        reference: dto.reference ?? null,
        counterpartyId,
        accountId: dto.accountId ?? null,
        // Solo significa algo si lo puso alguien: si pago la caja, no hay a
        // quien deberle.
        refundable: counterpartyId != null && dto.generatesDebt,
      },
    });
    return this.get(organizationId, id);
  }

  /**
   * Anular NO borra: el pago queda en el historial con su motivo y el saldo se
   * recalcula sobre los vigentes. Mismo patron que `CashReconciliation`.
   */
  async voidPayment(organizationId: string, id: string, paymentId: string, dto: LoanPaymentVoidDto) {
    const pago = await this.prisma.loanPayment.findFirst({
      where: { id: paymentId, loanId: id, organizationId },
    });
    if (!pago) throw new NotFoundException('No existe ese pago');
    // Anular dos veces no puede mover el saldo dos veces.
    if (pago.voidedAt) throw new ConflictException('Ese pago ya está anulado');

    await this.prisma.loanPayment.update({
      where: { id: paymentId },
      data: { voidedAt: new Date(), voidReason: dto.reason },
    });
    return this.get(organizationId, id);
  }

  /** La contraparte tiene que ser de ESTA organizacion. Es el IDOR obvio. */
  private async acreedor(organizationId: string, counterpartyId?: string | null) {
    if (!counterpartyId) return null;
    const cp = await this.prisma.counterparty.findFirst({
      where: { id: counterpartyId, organizationId },
      select: { id: true },
    });
    if (!cp) throw new NotFoundException('No existe esa contraparte');
    return cp.id;
  }

  /**
   * Quien aporto la plata del pago. Sin contraparte la puso la caja; con
   * contraparte se valida contra la organizacion.
   */
  private async pagador(organizationId: string, dto: LoanPaymentCreateDto) {
    return dto.counterpartyId ? this.acreedor(organizationId, dto.counterpartyId) : null;
  }
}

@UseGuards(JwtAuthGuard)
@Controller('loans')
export class LoansController {
  constructor(private service: LoansService) {}

  /**
   * Las dos deudas. Va ANTES de `@Get(':id')`: con una ruta literal después,
   * Nest la tomaría como un id.
   */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.service.overview(user.organizationId);
  }

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

  /**
   * Anular, no borrar. El pago queda en el historial con su motivo.
   *
   * ⚠️ Es `POST` y no `DELETE` a proposito: `DELETE` promete que la fila
   * desaparece, y acá no desaparece.
   */
  @Post(':id/payments/:paymentId/void')
  voidPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(LoanPaymentVoidSchema)) dto: LoanPaymentVoidDto,
  ) {
    return this.service.voidPayment(user.organizationId, id, paymentId, dto);
  }
}

@Module({
  imports: [CashModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
