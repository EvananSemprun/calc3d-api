import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  GoalUpsertSchema,
  goalProgress,
  goalsSummary,
  monthKey,
  monthStart,
  type GoalUpsertDto,
  type OrderLine,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * METAS MENSUALES — la hoja "Metas" del Excel.
 *
 * Se guarda SOLO lo que el dueño se propone. Las tres cifras reales se DERIVAN,
 * con las mismas definiciones que usa la hoja (verificadas contra septiembre
 * 2026: $68,50 · 5 encargos · 4 clientes nuevos):
 *
 *  - **ventas**: las ventas del mes MÁS los pedidos entregados en el mes. Es la
 *    misma cuenta que el Dashboard llama ingresos; si acá se contara distinto,
 *    la meta diría una cosa y el Dashboard otra.
 *  - **encargos**: cuántos pedidos se entregaron en el mes.
 *  - **clientes nuevos**: los que tuvieron su PRIMERA compra en el mes. Un
 *    cliente que ya te compró antes no vuelve a ser nuevo, aunque compre otra
 *    vez — por eso no alcanza con contar clientes con actividad.
 */
const total = (lines: unknown) =>
  ((lines ?? []) as OrderLine[]).reduce((s, l) => s + l.quantity * l.unitPrice, 0);

const finDe = (inicio: Date) => {
  const d = new Date(inicio);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Las metas con lo real de cada mes. Trae TODO de una vez y agrupa en memoria:
   * son decenas de filas, y una consulta por mes serían tres por cada uno.
   */
  async list(organizationId: string) {
    const metas = await this.prisma.goal.findMany({
      where: { organizationId },
      orderBy: { month: 'asc' },
    });
    if (metas.length === 0) return { months: [], summary: goalsSummary([]) };

    const desde = metas[0].month;
    const hasta = finDe(metas[metas.length - 1].month);

    const [ventas, pedidos, clientes] = await Promise.all([
      this.prisma.sale.findMany({
        where: { organizationId, date: { gte: desde, lt: hasta } },
        select: { date: true, amount: true },
      }),
      this.prisma.order.findMany({
        where: { organizationId, deliveryDate: { gte: desde, lt: hasta } },
        select: { deliveryDate: true, lines: true },
      }),
      // Para "cliente nuevo" hace falta TODA su historia, no solo la del rango:
      // si su primera compra fue antes, en este mes no es nuevo.
      this.prisma.client.findMany({
        where: { organizationId },
        select: {
          orders: { select: { deliveryDate: true } },
          sales: { select: { date: true } },
        },
      }),
    ]);

    const porMes = new Map<string, { sales: number; orders: number; newClients: number }>();
    const bucket = (mes: string) => {
      const b = porMes.get(mes) ?? { sales: 0, orders: 0, newClients: 0 };
      porMes.set(mes, b);
      return b;
    };

    for (const v of ventas) bucket(monthKey(v.date)).sales += Number(v.amount);
    for (const p of pedidos) {
      if (!p.deliveryDate) continue;
      const b = bucket(monthKey(p.deliveryDate));
      b.sales += total(p.lines);
      b.orders += 1;
    }
    for (const c of clientes) {
      const fechas = [
        ...c.orders.map((o) => o.deliveryDate),
        ...c.sales.map((s) => s.date),
      ].filter((f): f is Date => !!f);
      if (!fechas.length) continue;
      const primera = new Date(Math.min(...fechas.map((f) => f.getTime())));
      bucket(monthKey(primera)).newClients += 1;
    }

    const months = metas.map((m) => {
      const real = porMes.get(monthKey(m.month)) ?? { sales: 0, orders: 0, newClients: 0 };
      const salesTarget = Number(m.salesTarget);
      return {
        id: m.id,
        month: monthKey(m.month),
        salesTarget,
        ordersTarget: m.ordersTarget,
        newClientsTarget: m.newClientsTarget,
        notes: m.notes,
        sales: round2(real.sales),
        orders: real.orders,
        newClients: real.newClients,
        salesProgress: goalProgress(real.sales, salesTarget),
        ordersProgress: goalProgress(real.orders, m.ordersTarget),
        newClientsProgress: goalProgress(real.newClients, m.newClientsTarget),
      };
    });

    return { months, summary: goalsSummary(months) };
  }

  /** Una meta por mes: volver a guardar el mismo mes lo pisa, no lo duplica. */
  async upsert(organizationId: string, dto: GoalUpsertDto) {
    const month = monthStart(dto.month);
    await this.prisma.goal.upsert({
      where: { organizationId_month: { organizationId, month } },
      create: {
        organizationId,
        month,
        salesTarget: dto.salesTarget,
        ordersTarget: dto.ordersTarget,
        newClientsTarget: dto.newClientsTarget,
        notes: dto.notes ?? null,
      },
      update: {
        salesTarget: dto.salesTarget,
        ordersTarget: dto.ordersTarget,
        newClientsTarget: dto.newClientsTarget,
        notes: dto.notes ?? null,
      },
    });
    return this.list(organizationId);
  }

  async remove(organizationId: string, id: string) {
    const meta = await this.prisma.goal.findFirst({ where: { id, organizationId } });
    if (!meta) throw new NotFoundException('No existe esa meta');
    await this.prisma.goal.delete({ where: { id } });
    return this.list(organizationId);
  }

  /** La meta de un mes puntual, para la tarjeta del Dashboard. */
  async forMonth(organizationId: string, month: string) {
    const { months } = await this.list(organizationId);
    return months.find((m) => m.month === month) ?? null;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private service: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('month') month?: string) {
    if (month) return this.service.forMonth(user.organizationId, month);
    return this.service.list(user.organizationId);
  }

  @Put()
  upsert(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(GoalUpsertSchema)) dto: GoalUpsertDto,
  ) {
    return this.service.upsert(user.organizationId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
