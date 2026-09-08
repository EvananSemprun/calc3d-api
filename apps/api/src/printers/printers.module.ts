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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PrinterReadingUpsertSchema,
  PrinterSchema,
  equipmentRecovery,
  hoursThisMonth,
  latestReading,
  lifeUsed,
  maintenanceBalance,
  monthKey,
  monthStart,
  productionStats,
  type OrderLine,
  type PrinterDto,
  type PrinterReadingUpsertDto,
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
          readings: { select: { month: true, hours: true }, orderBy: { month: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { organizationId, status: { not: 'CANCELLED' } },
        select: { printerId: true, reprints: true, lines: true },
      }),
    ]);

    const piezas = (lines: unknown) =>
      ((lines ?? []) as OrderLine[]).reduce((s, l) => s + l.quantity, 0);
    const aTrabajo = (o: (typeof pedidos)[number]) => ({
      reprints: o.reprints,
      pieces: piezas(o.lines),
    });
    const mes = monthKey(new Date());

    const rows = printers.map((p) => {
      const suyos = pedidos.filter((o) => o.printerId === p.id).map(aTrabajo);
      const gastado = p.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const lecturas = p.readings.map((r) => ({
        month: monthKey(r.month),
        hours: Number(r.hours),
      }));
      // Las horas salen del CONTADOR de la máquina, no de los pedidos: también
      // se imprime fuera del negocio, y eso gasta vida útil igual.
      const ultima = latestReading(lecturas);
      const horas = ultima?.hours ?? 0;

      return {
        id: p.id,
        name: p.name,
        lifetimeHours: p.lifetimeHours,
        maintPerHour: Number(p.maintPerHour),
        jobs: suyos.length,
        ...productionStats(suyos),
        hours: horas,
        lastReading: ultima,
        hoursThisMonth: hoursThisMonth(lecturas, mes),
        // null (y no 0 %) mientras no haya ninguna lectura: no se sabe.
        lifeUsed: ultima ? lifeUsed(horas, p.lifetimeHours) : null,
        maintenance: maintenanceBalance(gastado, Number(p.maintPerHour), horas),
      };
    });

    // El total incluye los trabajos SIN máquina asignada: para la tasa de
    // fallos da igual en cuál se imprimió, y dejarlos afuera perdería medición.
    const total = productionStats(pedidos.map(aTrabajo));

    return {
      printers: rows,
      month: mes,
      total: {
        ...total,
        hours: rows.reduce((s, r) => s + r.hours, 0),
        /** Máquinas que todavía no tienen ninguna lectura del contador. */
        printersWithoutReading: rows.filter((r) => !r.lastReading).length,
        /** Pedidos sin los fallos anotados: lo que falta por medir. */
        unmeasuredJobs: pedidos.filter((o) => o.reprints == null).length,
        jobs: pedidos.length,
      },
    };
  }

  /**
   * Las lecturas de un mes, con TODAS las impresoras — las leídas y las que no.
   * Igual que el conteo de rollos: `hours` en null significa **sin leer**, que
   * no es lo mismo que cero horas.
   */
  async readings(organizationId: string, month: string) {
    const printers = await this.prisma.printer.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        lifetimeHours: true,
        readings: { select: { month: true, hours: true, note: true }, orderBy: { month: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return printers.map((p) => {
      const lecturas = p.readings.map((r) => ({
        month: monthKey(r.month),
        hours: Number(r.hours),
        note: r.note,
      }));
      const delMes = lecturas.find((r) => r.month === month) ?? null;
      return {
        printerId: p.id,
        name: p.name,
        lifetimeHours: p.lifetimeHours,
        hours: delMes?.hours ?? null,
        note: delMes?.note ?? null,
        previous: latestReading(lecturas.filter((r) => r.month < month)),
        hoursThisMonth: hoursThisMonth(lecturas, month),
        lifeUsed: delMes ? lifeUsed(delMes.hours, p.lifetimeHours) : null,
      };
    });
  }

  async saveReading(organizationId: string, dto: PrinterReadingUpsertDto) {
    await this.ensureOwned(organizationId, dto.printerId);
    const month = monthStart(dto.month);
    await this.prisma.printerReading.upsert({
      where: { printerId_month: { printerId: dto.printerId, month } },
      create: {
        organizationId,
        printerId: dto.printerId,
        month,
        hours: dto.hours,
        note: dto.note ?? null,
      },
      update: { hours: dto.hours, note: dto.note ?? null },
    });
    return this.readings(organizationId, dto.month);
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

  @Get('readings')
  readings(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.readings(user.organizationId, month);
  }

  @Put('readings')
  saveReading(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PrinterReadingUpsertSchema)) dto: PrinterReadingUpsertDto,
  ) {
    return this.service.saveReading(user.organizationId, dto);
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
  exports: [PrintersService],
})
export class PrintersModule {}
