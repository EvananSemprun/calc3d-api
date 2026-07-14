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
  ClientSchema,
  ClientUpdateSchema,
  orderBalance,
  orderPaid,
  orderTotal,
  type ClientDto,
  type ClientUpdateDto,
  type OrderLine,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.client.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  /** Detalle del contacto con su historial (presupuestos, pedidos y ventas). */
  async get(organizationId: string, id: string) {
    const client = await this.prisma.client.findFirst({ where: { id, organizationId } });
    if (!client) throw new NotFoundException('Contacto no encontrado');

    const [quotes, orders, sales] = await Promise.all([
      this.prisma.quote.findMany({
        where: { organizationId, clientId: id },
        select: { id: true, name: true, status: true, createdAt: true, totals: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.findMany({
        where: { organizationId, clientId: id },
        select: { id: true, code: true, status: true, createdAt: true, lines: true, payments: { select: { amount: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sale.findMany({
        where: { organizationId, clientId: id },
        select: { id: true, date: true, amount: true, kind: true },
        orderBy: { date: 'desc' },
      }),
    ]);

    const orderRows = orders.map((o) => {
      const lines = (o.lines as unknown as OrderLine[]) ?? [];
      const paid = (o.payments ?? []).map((p) => Number(p.amount));
      return {
        id: o.id,
        code: o.code,
        status: o.status,
        createdAt: o.createdAt,
        total: orderTotal(lines),
        paid: orderPaid(paid),
        balance: orderBalance(lines, paid),
      };
    });

    return { ...client, history: { quotes, orders: orderRows, sales } };
  }

  create(organizationId: string, dto: ClientDto) {
    return this.prisma.client.create({ data: { ...dto, organizationId } });
  }

  async update(organizationId: string, id: string, dto: ClientUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.client.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.client.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Contacto no encontrado');
  }
}

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ClientSchema)) dto: ClientDto) {
    return this.service.create(user.organizationId, dto);
  }

  // PATCH parcial: permite fijar solo las coordenadas (click en el mapa) sin
  // reenviar el contacto completo.
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ClientUpdateSchema)) dto: ClientUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
