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
  PrinterSchema,
  equipmentRecovery,
  lifeUsed,
  maintenanceBalance,
  productionStats,
  type OrderLine,
  type PrinterDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrintersService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.printer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  create(organizationId: string, dto: PrinterDto) {
    return this.prisma.printer.create({ data: { ...dto, organizationId } });
  }

  async update(organizationId: string, id: string, dto: Partial<PrinterDto>) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.printer.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.printer.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * REPOSICIÓN DE EQUIPOS — la hoja "Inversion" del Excel.
   *
   * Se calcula ACUMULADO, sobre toda la historia, y por eso vive en el servidor
   * y no en el Dashboard: el filtro de fechas de esa pantalla cambiaría el
   * número, y "cuánto se pagó sola la impresora" no depende del rango que uno
   * esté mirando.
   *
   * **Ganancia acumulada = ingresos − gastos operativos.** Quedan afuera la
   * inversión en equipos (descontarla sería restar dos veces lo mismo que se
   * está tratando de reponer) y los pagos del préstamo, que no son un costo:
   * devolver capital no lo es.
   */
  async recovery(organizationId: string) {
    const [ventas, pedidos, gastos, printers] = await Promise.all([
      this.prisma.sale.findMany({ where: { organizationId }, select: { amount: true } }),
      this.prisma.order.findMany({ where: { organizationId }, select: { lines: true } }),
      this.prisma.expense.findMany({
        where: { organizationId, isInvestment: false },
        select: { amount: true },
      }),
      this.prisma.printer.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          price: true,
          createdAt: true,
          // La compra del equipo: su fecha es la fecha real de compra.
          expenses: {
            where: { isInvestment: true },
            select: { date: true },
            orderBy: { date: 'asc' },
            take: 1,
          },
        },
      }),
    ]);

    const total = (lines: unknown) =>
      ((lines ?? []) as OrderLine[]).reduce((s, l) => s + l.quantity * l.unitPrice, 0);

    const income = round2(
      ventas.reduce((s, v) => s + Number(v.amount), 0) + pedidos.reduce((s, p) => s + total(p.lines), 0),
    );
    const operatingExpenses = round2(gastos.reduce((s, g) => s + Number(g.amount), 0));
    const accumulatedProfit = round2(income - operatingExpenses);

    // La cascada va en ORDEN DE COMPRA: la primera máquina se cubre antes que
    // la segunda. Se usa la fecha de su gasto de inversión, no el alta de la
    // ficha, que puede cargarse mucho después.
    const enOrden = [...printers].sort(
      (a, b) =>
        (a.expenses[0]?.date ?? a.createdAt).getTime() -
        (b.expenses[0]?.date ?? b.createdAt).getTime(),
    );

    return {
      income,
      operatingExpenses,
      accumulatedProfit,
      ...equipmentRecovery(
        accumulatedProfit,
        enOrden.map((p) => ({ id: p.id, name: p.name, cost: Number(p.price) })),
      ),
    };
  }

  /**
   * MEDICIÓN DE LA PRODUCCIÓN (punto 9): horas de máquina acumuladas, tasa real
   * de fallos y mantenimiento cobrado contra gastado.
   *
   * Los tres salen de lo que se anota en cada pedido al imprimirlo. Mientras no
   * se anote, devuelven `null` o cero trabajos medidos: **no se rellena con
   * supuestos**, que es justo lo que estos números vienen a reemplazar.
   */
  async usage(organizationId: string) {
    const [printers, pedidos] = await Promise.all([
      this.prisma.printer.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          lifetimeHours: true,
          maintPerHour: true,
          expenses: {
            where: { category: 'MAINTENANCE' },
            select: { amount: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { organizationId, status: { not: 'CANCELLED' } },
        select: { printerId: true, machineHours: true, reprints: true, lines: true },
      }),
    ]);

    const piezas = (lines: unknown) =>
      ((lines ?? []) as OrderLine[]).reduce((s, l) => s + l.quantity, 0);
    const aTrabajo = (o: (typeof pedidos)[number]) => ({
      machineHours: o.machineHours == null ? null : Number(o.machineHours),
      reprints: o.reprints,
      pieces: piezas(o.lines),
    });

    const rows = printers.map((p) => {
      const suyos = pedidos.filter((o) => o.printerId === p.id).map(aTrabajo);
      const stats = productionStats(suyos);
      const gastado = p.expenses.reduce((s, e) => s + Number(e.amount), 0);
      return {
        id: p.id,
        name: p.name,
        lifetimeHours: p.lifetimeHours,
        maintPerHour: Number(p.maintPerHour),
        jobs: suyos.length,
        ...stats,
        lifeUsed: lifeUsed(stats.hours, p.lifetimeHours),
        maintenance: maintenanceBalance(gastado, Number(p.maintPerHour), stats.hours),
      };
    });

    // El total incluye los trabajos SIN máquina asignada: para la tasa de
    // fallos da igual en cuál se imprimió, y dejarlos afuera perdería medición.
    const total = productionStats(pedidos.map(aTrabajo));

    return {
      printers: rows,
      total: {
        ...total,
        /** Pedidos sin ninguna medición cargada: lo que falta por anotar. */
        unmeasuredJobs: pedidos.filter((o) => o.reprints == null && o.machineHours == null).length,
        jobs: pedidos.length,
      },
    };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.printer.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Impresora no encontrada');
  }
}

@Controller('printers')
@UseGuards(JwtAuthGuard)
export class PrintersController {
  constructor(private readonly service: PrintersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  /** Rutas literales ANTES de cualquier `:id`, o Nest las toma como un id. */
  @Get('recovery')
  recovery(@CurrentUser() user: AuthUser) {
    return this.service.recovery(user.organizationId);
  }

  @Get('usage')
  usage(@CurrentUser() user: AuthUser) {
    return this.service.usage(user.organizationId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(PrinterSchema)) dto: PrinterDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PrinterSchema.partial())) dto: Partial<PrinterDto>,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Module({
  controllers: [PrintersController],
  providers: [PrintersService],
})
export class PrintersModule {}
