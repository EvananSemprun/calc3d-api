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

  /** Ruta literal ANTES de cualquier `:id`, o Nest la toma como un id. */
  @Get('recovery')
  recovery(@CurrentUser() user: AuthUser) {
    return this.service.recovery(user.organizationId);
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
