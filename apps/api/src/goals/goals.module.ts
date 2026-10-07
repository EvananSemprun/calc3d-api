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
  GoalSuggestionQuerySchema,
  GoalUpsertSchema,
  businessDateKey,
  goalProgress,
  goalsSummary,
  monthKey,
  monthStart,
  previousMonth,
  seasonalCheck,
  suggestGoals,
  type GoalSuggestionQueryDto,
  type GoalUpsertDto,
  type HistoricMonth,
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

/**
 * Los meses `AAAA-MM` de `[desde, hasta)`, en orden. Hace falta recorrerlos
 * todos y no solo los que tuvieron movimiento: un mes sin actividad es un 0
 * legítimo y tiene que aparecer en el promedio.
 */
const mesesEntre = (desde: Date, hasta: Date) => {
  const out: string[] = [];
  const d = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1));
  while (d < hasta) {
    out.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lo real de un mes, con la marca de si cada métrica tenía con qué contar.
 *
 * ⚠️ `hayDatos: false` NO es "no pasó nada": es que el mes es ANTERIOR al primer
 * dato de esa métrica, así que no había con qué medirla. La diferencia importa
 * para sugerir: un mes **sin actividad** entra en el promedio como 0, y uno
 * **sin datos** no entra. Tratarlos igual hunde la sugerencia inventando un mes
 * malo que nunca ocurrió — p. ej. los encargos arrancan en 2026-09, así que
 * agosto no tiene 0 encargos: no tiene encargos.
 */
export interface RealesDelMes {
  sales: number;
  orders: number;
  newClients: number;
  hayDatos: { sales: boolean; orders: boolean; newClients: boolean };
}

const VACIO: RealesDelMes = {
  sales: 0,
  orders: 0,
  newClients: 0,
  hayDatos: { sales: false, orders: false, newClients: false },
};

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lo real de cada mes de `[desde, hasta)`, **sin depender de que exista una
   * meta**. Antes esto vivía adentro de `list()` y el rango salía de los meses
   * que ya tenían meta cargada; con eso no se podía ni sugerir (mira meses
   * anteriores, que normalmente no la tienen) ni mostrar un mes sin meta.
   *
   * Trae TODO de una vez y agrupa en memoria: son decenas de filas, y una
   * consulta por mes serían tres por cada uno.
   */
  async realesPorMes(organizationId: string, desde: Date, hasta: Date) {
    const [ventas, pedidos, clientes, primeraVenta, primerPedido] = await Promise.all([
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
      // Desde cuándo hay con qué contar cada métrica. Sin filtro de rango a
      // propósito: la frontera no depende de lo que se esté mirando.
      this.prisma.sale.findFirst({
        where: { organizationId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.order.findFirst({
        where: { organizationId, deliveryDate: { not: null } },
        orderBy: { deliveryDate: 'asc' },
        select: { deliveryDate: true },
      }),
    ]);

    const porMes = new Map<string, RealesDelMes>();
    const bucket = (mes: string) => {
      const b = porMes.get(mes) ?? {
        sales: 0,
        orders: 0,
        newClients: 0,
        hayDatos: { sales: false, orders: false, newClients: false },
      };
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
      const mes = monthKey(primera);
      // Solo cuenta si cae DENTRO del rango pedido: la consulta de clientes no
      // lo filtra porque necesita la historia completa para saber cuál fue la
      // primera compra.
      if (mes >= monthKey(desde) && mes < monthKey(hasta)) bucket(mes).newClients += 1;
    }

    // La frontera de "sin datos", por métrica. Un cliente estrena su primera
    // compra con una venta o con un pedido entregado, así que su frontera es la
    // más temprana de las dos, igual que la de ventas.
    const mesDe = (d?: Date | null) => (d ? monthKey(d) : null);
    const mVenta = mesDe(primeraVenta?.date);
    const mPedido = mesDe(primerPedido?.deliveryDate);
    const primeros = [mVenta, mPedido].filter((x): x is string => x != null).sort();
    const desdeActividad = primeros[0] ?? null;

    const alcanza = (mes: string, frontera: string | null) => frontera != null && mes >= frontera;

    // Todos los meses del rango, aunque no hayan tenido movimiento: un mes sin
    // actividad es un 0 legítimo y tiene que aparecer.
    for (const mes of mesesEntre(desde, hasta)) {
      const b = bucket(mes);
      b.hayDatos = {
        sales: alcanza(mes, desdeActividad),
        orders: alcanza(mes, mPedido),
        newClients: alcanza(mes, desdeActividad),
      };
      b.sales = round2(b.sales);
    }

    return porMes;
  }

  /**
   * Las metas con lo real de cada mes.
   */
  async list(organizationId: string) {
    const metas = await this.prisma.goal.findMany({
      where: { organizationId },
      orderBy: { month: 'asc' },
    });
    if (metas.length === 0) return { months: [], summary: goalsSummary([]) };

    const porMes = await this.realesPorMes(
      organizationId,
      metas[0].month,
      finDe(metas[metas.length - 1].month),
    );

    const months = metas.map((m) => {
      const real = porMes.get(monthKey(m.month)) ?? VACIO;
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

  /**
   * La propuesta para el mes que se está cargando. **NO escribe nada.**
   *
   * ⚠️ La base son los **3 últimos meses completos que existen HOY**, no los 3
   * anteriores al mes elegido. El dueño carga las metas con meses de
   * anticipación —al 2026-10 ya tenía noviembre, diciembre y enero— y los tres
   * meses previos a enero todavía no terminaron: la lectura literal dejaría la
   * sugerencia vacía justo en el caso que más usa.
   *
   * El precio de esa decisión es que la pantalla **tiene que nombrar los meses
   * usados**. Sugerir enero sobre julio-septiembre es defendible, pero solo si
   * el dueño lo ve; un "basado en 3 meses completos" a secas se leería como si
   * fueran octubre a diciembre.
   */
  async suggestion(organizationId: string, dto: GoalSuggestionQueryDto, now = new Date()) {
    // "Completo" = que ya terminó, en hora de Venezuela. El servidor corre en
    // UTC y el último día del mes, desde las 20:00 de Caracas, cree que ya
    // empezó el siguiente: sin esto, el mes en curso se colaría en la base.
    const mesActual = businessDateKey(now).slice(0, 7);
    const ultimoCompleto = previousMonth(mesActual);
    const anteriores = (desde: string, cuantos: number) => {
      const out: string[] = [];
      let m = desde;
      for (let i = 0; i < cuantos; i++) {
        out.push(m);
        m = previousMonth(m);
      }
      return out;
    };

    const base = anteriores(ultimoCompleto, 3);

    // El mismo mes del año anterior y su propia base, para el aviso de
    // temporada. Si caen en el futuro no hay nada que medir.
    const haceUnAnio = anteriores(dto.month, 13).at(-1)!;
    const baseAnterior = anteriores(previousMonth(haceUnAnio), 3);

    const necesarios = [...base, haceUnAnio, ...baseAnterior].filter((m) => m <= ultimoCompleto);
    const porMes = necesarios.length
      ? await this.realesPorMes(
          organizationId,
          monthStart(necesarios.slice().sort()[0]),
          monthStart(mesActual),
        )
      : new Map<string, RealesDelMes>();

    const hist = (mes: string, metrica: 'sales' | 'orders' | 'newClients'): HistoricMonth => {
      const r = porMes.get(mes) ?? VACIO;
      return { month: mes, value: r[metrica], hasData: r.hayDatos[metrica] };
    };
    const serie = (meses: string[], metrica: 'sales' | 'orders' | 'newClients') =>
      meses.filter((m) => m <= ultimoCompleto).map((m) => hist(m, metrica));

    const propuesta = suggestGoals({
      sales: serie(base, 'sales'),
      orders: serie(base, 'orders'),
      newClients: serie(base, 'newClients'),
      growth: dto.growth,
    });

    return {
      month: dto.month,
      ...propuesta,
      /** ⚠️ `SIN_HISTORIA` es "no se pudo medir", NO "no hay riesgo". */
      seasonal:
        haceUnAnio <= ultimoCompleto
          ? seasonalCheck(hist(haceUnAnio, 'sales'), serie(baseAnterior, 'sales'))
          : ({ status: 'SIN_HISTORIA' } as const),
    };
  }

  /** La meta de un mes puntual, para la tarjeta del Dashboard. */
  async forMonth(organizationId: string, month: string) {
    const { months } = await this.list(organizationId);
    return months.find((m) => m.month === month) ?? null;
  }
}


@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private service: GoalsService) {}

  /**
   * La propuesta para un mes. Es de SOLO LECTURA: rellena el formulario y no
   * guarda nada. Va antes de cualquier `@Get(':algo')` que se agregue despues.
   */
  @Get('suggestion')
  suggestion(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GoalSuggestionQuerySchema)) q: GoalSuggestionQueryDto,
  ) {
    return this.service.suggestion(user.organizationId, q);
  }

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
