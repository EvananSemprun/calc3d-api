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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  OrderCreateSchema,
  OrderUpdateSchema,
  PaymentCreateSchema,
  orderBalance,
  orderPaid,
  orderTotal,
  type OrderCreateDto,
  type OrderLine,
  type OrderUpdateDto,
  type PaymentCreateDto,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { EmailVerifiedGuard } from '../common/email-verified.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryNoteService } from './delivery-note.service';

/** Añade total/abonado/saldo (derivados) a un pedido con sus pagos incluidos. */
function withTotals<T extends { lines: unknown; payments: { amount: unknown }[] }>(order: T) {
  const lines = (order.lines as OrderLine[]) ?? [];
  const paid = (order.payments ?? []).map((p) => Number(p.amount));
  return {
    ...order,
    total: orderTotal(lines),
    paid: orderPaid(paid),
    balance: orderBalance(lines, paid),
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
  ) {}

  async list(organizationId: string) {
    const orders = await this.prisma.order.findMany({
      where: { organizationId },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        payments: { select: { amount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(withTotals);
  }

  /** Abonos de la organización en un rango [from, to] (para el dashboard de caja). */
  listPayments(organizationId: string, from?: string, to?: string) {
    const gte = from ? new Date(from) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
    return this.prisma.payment.findMany({
      where: {
        organizationId,
        ...(gte || lte ? { date: { ...(gte && { gte }), ...(lte && { lte }) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: {
        client: true,
        payments: { orderBy: { date: 'desc' } },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return withTotals(order);
  }

  async create(organizationId: string, dto: OrderCreateDto) {
    // Correlativo por organización a prueba de concurrencia: el mayor code + 1.
    const last = await this.prisma.order.findFirst({
      where: { organizationId },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const code = (last?.code ?? 0) + 1;
    const exchangeRates = await this.rates.snapshotJson(organizationId, dto.currencyLabel);
    return this.prisma.order.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        code,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        status: dto.status,
        notes: dto.notes ?? null,
        lines: (dto.lines as unknown as Prisma.InputJsonValue) ?? [],
        currencyLabel: dto.currencyLabel ?? null,
        exchangeRates,
        originChannel: dto.originChannel ?? null,
        campaignId: dto.campaignId ?? null,
      },
    });
  }

  async update(organizationId: string, id: string, dto: OrderUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.clientId && { clientId: dto.clientId }),
        ...(dto.deliveryDate !== undefined && {
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        }),
        ...(dto.status && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
        ...(dto.originChannel !== undefined && { originChannel: dto.originChannel ?? null }),
        ...(dto.campaignId !== undefined && { campaignId: dto.campaignId ?? null }),
        ...(dto.lines && { lines: dto.lines as unknown as Prisma.InputJsonValue }),
        // Cambiar la moneda elegida re-congela la tasa del documento.
        ...(dto.currencyLabel !== undefined && {
          currencyLabel: dto.currencyLabel,
          exchangeRates:
            (await this.rates.snapshotJson(organizationId, dto.currencyLabel)) ?? Prisma.DbNull,
        }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.order.delete({ where: { id } });
    return { ok: true };
  }

  async addPayment(organizationId: string, orderId: string, dto: PaymentCreateDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: { currencyLabel: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    // Congelar en el abono la tasa VIGENTE de la moneda del pedido (para reconciliar
    // en Bs aunque el total/saldo se muestren en vivo). Null si el pedido es solo USD.
    const frozen = order.currencyLabel
      ? await this.rateForLabel(organizationId, order.currencyLabel)
      : null;
    await this.prisma.payment.create({
      data: {
        orderId,
        organizationId,
        date: new Date(dto.date),
        amount: dto.amount,
        note: dto.note ?? null,
        rate: frozen?.rate ?? null,
        currencyCode: frozen?.currencyCode ?? null,
        currencyLabel: frozen?.label ?? null,
      },
    });
    return this.get(organizationId, orderId);
  }

  /** Tasa vigente de una moneda con nombre, o null si ya no existe. */
  private async rateForLabel(organizationId: string, label: string) {
    const live = await this.rates.latest(organizationId);
    return live.find((r) => r.label === label) ?? null;
  }

  /**
   * Cierra el pedido en bolívares: re-congela `exchangeRates` a la tasa de HOY de
   * la moneda elegida y marca `settledAt`. A partir de aquí los Bs dejan de ser en
   * vivo y quedan finales. Idempotente: si ya está cerrado, no re-congela.
   */
  async settle(organizationId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, organizationId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.settledAt) return this.get(organizationId, id);
    const exchangeRates = await this.rates.snapshotJson(organizationId, order.currencyLabel);
    await this.prisma.order.update({
      where: { id },
      data: { settledAt: new Date(), ...(exchangeRates ? { exchangeRates } : {}) },
    });
    return this.get(organizationId, id);
  }

  async removePayment(organizationId: string, orderId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, orderId, organizationId },
    });
    if (!payment) throw new NotFoundException('Abono no encontrado');
    await this.prisma.payment.delete({ where: { id: paymentId } });
    return this.get(organizationId, orderId);
  }

  /** Genera (o reusa) el token del link público de solo lectura del pedido. */
  async ensurePublicToken(organizationId: string, id: string): Promise<{ token: string }> {
    const order = await this.prisma.order.findFirst({ where: { id, organizationId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.publicToken) return { token: order.publicToken };
    const token = randomBytes(24).toString('hex'); // 192 bits, no enumerable
    await this.prisma.order.update({ where: { id }, data: { publicToken: token } });
    return { token };
  }

  /** Vista pública de SOLO LECTURA por token (el token es la credencial). */
  async getByToken(token: string) {
    const order = await this.prisma.order.findUnique({
      where: { publicToken: token },
      include: { client: { select: { name: true } }, payments: { select: { amount: true } } },
    });
    if (!order) throw new NotFoundException('Enlace no válido');
    const org = await this.prisma.organization.findUnique({
      where: { id: order.organizationId },
      select: { name: true },
    });
    const t = withTotals(order);
    // Bs: si el pedido está CERRADO, se sirve la tasa congelada; si sigue vivo, la
    // tasa de HOY para su moneda (el público no puede consultar /exchange-rates).
    const liveRate =
      order.currencyLabel && !order.settledAt
        ? await this.rateForLabel(order.organizationId, order.currencyLabel)
        : null;
    // Solo se exponen los campos del documento; nada de la organización ni de otros pedidos.
    return {
      code: order.code,
      businessName: org?.name ?? '',
      clientName: order.client.name,
      deliveryDate: order.deliveryDate,
      status: order.status,
      lines: order.lines,
      total: t.total,
      paid: t.paid,
      balance: t.balance,
      exchangeRates: order.exchangeRates,
      liveRate: liveRate
        ? { rate: liveRate.rate, currencyCode: liveRate.currencyCode, label: liveRate.label }
        : null,
      settled: !!order.settledAt,
      createdAt: order.createdAt,
    };
  }

  /** El cliente acepta el presupuesto desde el link (QUOTED → CONFIRMED). */
  async acceptByToken(token: string) {
    const order = await this.prisma.order.findUnique({ where: { publicToken: token } });
    if (!order) throw new NotFoundException('Enlace no válido');
    if (order.status === 'QUOTED') {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
    }
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.order.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Pedido no encontrado');
  }
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly service: OrdersService,
    private readonly deliveryNote: DeliveryNoteService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  // Ruta literal ANTES de ':id' para que no la capture como id='payments'.
  @Get('payments')
  listPayments(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listPayments(user.organizationId, from, to);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OrderCreateSchema)) dto: OrderCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OrderUpdateSchema)) dto: OrderUpdateDto,
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
    @Body(new ZodValidationPipe(PaymentCreateSchema)) dto: PaymentCreateDto,
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

  // Exponer un pedido a internet (link público) exige correo verificado.
  @Post(':id/public-link')
  @UseGuards(EmailVerifiedGuard)
  publicLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.ensurePublicToken(user.organizationId, id);
  }

  // Cerrar el pedido en bolívares (congela la tasa final). Lo dispara el front al
  // emitir la nota de entrega, con confirmación del usuario.
  @Post(':id/settle')
  settle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.settle(user.organizationId, id);
  }

  @Get(':id/delivery-note.pdf')
  async deliveryNotePdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.deliveryNote.pdf(user.organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="nota-entrega-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}

/** Controlador PÚBLICO: sin JwtAuthGuard. El token del pedido es la credencial;
 *  solo expone ese documento en modo lectura + aceptar. */
@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string) {
    return this.service.acceptByToken(token);
  }
}

@Module({
  imports: [ExchangeRatesModule],
  controllers: [OrdersController, PublicOrdersController],
  providers: [OrdersService, DeliveryNoteService],
  exports: [OrdersService],
})
export class OrdersModule {}
