import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canCloseMonth,
  monthCloseDay,
  monthConsumption,
  monthKey,
  monthStart,
  previousMonth,
  purchaseCostPerGram,
  purchaseCostPerRoll,
  stockTotal,
  type FilamentPurchase,
  type MaterialStatus,
  type StockCountRow,
  type StockMonthCloseDto,
  type StockMonthReopenDto,
  type StockMonthStatus,
  restockByColor,
  type RestockGroup,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Fila del conteo tal como sale de la base. */
interface CountRow {
  materialId: string;
  sealed: number;
  inUse: number;
  running: number;
  needsBrandCheck: boolean;
}

export interface FilamentSummary {
  month: string;
  /** rollos del mes cerrado; 0 si está abierto */
  totalRolls: number;
  /** de esos, cuántos están por acabarse */
  running: number;
  /** rollos consumidos en el mes; null si alguno de los dos meses no está cerrado */
  consumption: number | null;
  /** rollos comprados en el mes (entran en el consumo) */
  purchased: number;
  /**
   * Qué comprar, POR TIPO + COLOR (todas las marcas juntas), de más comprado a
   * menos: sin rollos, por acabarse y "conviene reponer" (de los que más se
   * compran y con 1 rollo o menos). Ver `restockByColor` en shared.
   */
  restock: RestockGroup[];
  /** rollos importados del Excel sin saber su marca */
  pendingBrandCheck: number;
  /** colores contados: todos si el mes está cerrado, ninguno si está abierto */
  countedColors: number;
  /** colores que se siguen reponiendo */
  totalColors: number;
  /** rollos comprados por color, en promedio: el umbral de "los que más se compran" */
  averagePurchased: number;
  /** true si el mes está CERRADO: solo entonces el total, el consumo y la reposición son datos finales */
  complete: boolean;
}

/**
 * CONTROL DE FILAMENTO: las dos hojas del Excel, "Inventario" (compras) y
 * "Stock mensual" (conteo físico).
 *
 * El conteo es MANUAL a propósito: no se descuenta lo que consumen los
 * presupuestos porque no todo lo cotizado se imprime, no todo lo impreso sale
 * bien, y la purga del AMS no está en ningún presupuesto. El estante es lo
 * único que no miente.
 */
@Injectable()
export class FilamentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compras de filamento: los gastos ligados a un material. */
  async purchases(organizationId: string, from?: string, to?: string): Promise<FilamentPurchase[]> {
    const gastos = await this.prisma.expense.findMany({
      where: {
        organizationId,
        materialId: { not: null },
        ...dateWhere(from, to),
      },
      include: {
        material: {
          select: { id: true, name: true, rollGrams: true, brand: true, type: true, color: true },
        },
        provider: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    });

    return gastos.map((g) => {
      const amount = Number(g.amount);
      const quantity = g.quantity ?? 0;
      const costPerRoll = purchaseCostPerRoll(amount, quantity);
      return {
        id: g.id,
        date: g.date.toISOString(),
        materialId: g.material?.id ?? null,
        materialName: g.material?.name ?? null,
        brand: g.material?.brand ?? null,
        type: g.material?.type ?? null,
        color: g.material?.color ?? null,
        quantity,
        amount,
        costPerRoll,
        // Con los gramos REALES del rollo: la hoja divide entre 1000 fijo.
        costPerGram: purchaseCostPerGram(costPerRoll, g.material?.rollGrams ?? 0),
        providerName: g.provider?.name ?? null,
        note: g.description ?? null,
        rate: g.rate == null ? null : Number(g.rate),
        currencyCode: g.currencyCode ?? null,
      };
    });
  }

  /** El conteo del mes, con TODOS los materiales (los no contados, en cero). */
  async stock(organizationId: string, month: string): Promise<StockCountRow[]> {
    const [materiales, conteos, cerrado] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.countsOf(organizationId, month),
      this.isClosed(organizationId, month),
    ]);
    const porMaterial = new Map(conteos.map((c) => [c.materialId, c]));

    return materiales.map((m) => {
      const c = porMaterial.get(m.id);
      const partes = { sealed: c?.sealed ?? 0, inUse: c?.inUse ?? 0, running: c?.running ?? 0 };
      return {
        materialId: m.id,
        name: m.name,
        type: m.type,
        brand: m.brand,
        color: m.color,
        status: m.status as MaterialStatus,
        ...partes,
        total: stockTotal(partes),
        needsBrandCheck: c?.needsBrandCheck ?? false,
        // "Contado" = el mes está CERRADO (cierre mensual, 2026-09-13). En un mes
        // cerrado lo que no se marcó es 0; un mes abierto o reabierto no es dato final.
        counted: cerrado,
      };
    });
  }

  /** Si el mes está cerrado y desde cuándo se puede cerrar. */
  async monthStatus(organizationId: string, month: string, now = new Date()): Promise<StockMonthStatus> {
    const fila = await this.monthRow(organizationId, month);
    return {
      month,
      closed: !!fila?.closedAt,
      closedAt: fila?.closedAt?.toISOString() ?? null,
      reopenedAt: fila?.reopenedAt?.toISOString() ?? null,
      canClose: canCloseMonth(month, now),
      closableFrom: monthCloseDay(month),
    };
  }

  /**
   * CIERRA el conteo del mes: la única escritura de conteos. Escribe una fila
   * por CADA ficha (lo que no vino, en 0: casillas vacías = no hay) y marca el
   * mes cerrado, todo en una transacción. Las validaciones van ANTES de
   * escribir: si algo falla, no queda nada a medias.
   */
  async closeMonth(organizationId: string, dto: StockMonthCloseDto, now = new Date()): Promise<StockMonthStatus> {
    if (!canCloseMonth(dto.month, now)) {
      throw new BadRequestException(
        `${etiquetaMes(dto.month)} se puede cerrar desde el ${fechaCorta(monthCloseDay(dto.month))} (hora de Venezuela).`,
      );
    }
    const month = monthStart(dto.month);

    await this.prisma.$transaction(
      async (tx) => {
        const fila = await tx.stockMonth.findUnique({
          where: { organizationId_month: { organizationId, month } },
        });
        if (fila?.closedAt) {
          throw new ConflictException(`${etiquetaMes(dto.month)} ya está cerrado. Reabrilo para corregirlo.`);
        }

        const materiales = await tx.material.findMany({
          where: { organizationId },
          select: { id: true, name: true },
        });
        const nombres = new Map(materiales.map((m) => [m.id, m.name]));
        const vistos = new Set<string>();
        for (const c of dto.counts) {
          if (!nombres.has(c.materialId)) {
            throw new NotFoundException(
              'Una de las fichas ya no existe (se borró o no es de esta cuenta). Recargá el conteo.',
            );
          }
          if (vistos.has(c.materialId)) {
            throw new BadRequestException(`La ficha «${nombres.get(c.materialId)}» viene dos veces.`);
          }
          vistos.add(c.materialId);
        }

        const porFicha = new Map(dto.counts.map((c) => [c.materialId, c]));
        for (const m of materiales) {
          const c = porFicha.get(m.id);
          const partes = { sealed: c?.sealed ?? 0, inUse: c?.inUse ?? 0, running: c?.running ?? 0 };
          await tx.stockCount.upsert({
            where: { materialId_month: { materialId: m.id, month } },
            // Contarlo a mano resuelve la duda de marca que dejó la importación.
            update: { ...partes, needsBrandCheck: false, countedAt: now },
            create: { ...partes, organizationId, materialId: m.id, month, countedAt: now },
          });
        }

        await tx.stockMonth.upsert({
          where: { organizationId_month: { organizationId, month } },
          update: { closedAt: now },
          create: { organizationId, month, closedAt: now },
        });
      },
      // ~50 upserts en serie: contra la base remota, con latencia, el default de 5 s queda justo.
      { timeout: 15_000 },
    );

    return this.monthStatus(organizationId, dto.month, now);
  }

  /** REABRE un mes cerrado para corregirlo. Los conteos no se tocan. */
  async reopenMonth(organizationId: string, dto: StockMonthReopenDto, now = new Date()): Promise<StockMonthStatus> {
    const fila = await this.monthRow(organizationId, dto.month);
    if (!fila?.closedAt) throw new ConflictException(`${etiquetaMes(dto.month)} no está cerrado.`);

    await this.prisma.stockMonth.update({
      where: { organizationId_month: { organizationId, month: monthStart(dto.month) } },
      data: { closedAt: null, reopenedAt: now },
    });
    return this.monthStatus(organizationId, dto.month, now);
  }

  /** El mes cerrado más reciente (`'AAAA-MM'`), o null si todavía no se cerró ninguno. */
  async lastClosedMonth(organizationId: string): Promise<string | null> {
    const fila = await this.prisma.stockMonth.findFirst({
      where: { organizationId, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
    return fila ? monthKey(fila.month) : null;
  }

  /** Totales del mes, consumo contra el mes anterior y qué reponer. */
  async summary(organizationId: string, month: string): Promise<FilamentSummary> {
    const anterior = previousMonth(month);
    const [materiales, actualGuardado, previoGuardado, comprados, historico, cerrado, previoCerrado] =
      await Promise.all([
        this.prisma.material.findMany({ where: { organizationId } }),
        this.countsOf(organizationId, month),
        this.countsOf(organizationId, anterior),
        this.purchasedInMonth(organizationId, month),
        this.purchasedUpTo(organizationId, month),
        this.isClosed(organizationId, month),
        this.isClosed(organizationId, anterior),
      ]);

    // Un mes abierto (nunca cerrado, o reabierto a medio corregir) no da números.
    const actual = cerrado ? actualGuardado : [];
    const previo = previoCerrado ? previoGuardado : null;

    const totalRolls = actual.reduce((s, c) => s + stockTotal(c), 0);
    const running = actual.reduce((s, c) => s + c.running, 0);
    const previoTotal = previo ? previo.reduce((s, c) => s + stockTotal(c), 0) : null;

    // Por tipo + color: la marca cambia de un mes a otro, el color es lo que se
    // maneja. "Completo" ya no depende de contar cada color: depende de que el
    // mes esté CERRADO (cierre mensual, 2026-09-13).
    const reposicion = restockByColor(
      materiales.map((m) => ({
        id: m.id,
        type: m.type,
        color: m.color,
        brand: m.brand,
        status: m.status as MaterialStatus,
      })),
      Object.fromEntries(actual.map((c) => [c.materialId, c])),
      historico,
    );

    return {
      month,
      totalRolls,
      running,
      consumption: monthConsumption(previoTotal, cerrado ? totalRolls : null, comprados),
      purchased: comprados,
      restock: reposicion.groups,
      pendingBrandCheck: actual.filter((c) => c.needsBrandCheck).length,
      countedColors: reposicion.countedColors,
      totalColors: reposicion.totalColors,
      averagePurchased: reposicion.averagePurchased,
      complete: cerrado,
    };
  }

  private monthRow(organizationId: string, month: string) {
    return this.prisma.stockMonth.findUnique({
      where: { organizationId_month: { organizationId, month: monthStart(month) } },
    });
  }

  private async isClosed(organizationId: string, month: string): Promise<boolean> {
    return !!(await this.monthRow(organizationId, month))?.closedAt;
  }

  private countsOf(organizationId: string, month: string): Promise<CountRow[]> {
    return this.prisma.stockCount.findMany({
      where: { organizationId, month: monthStart(month) },
    }) as unknown as Promise<CountRow[]>;
  }

  /**
   * Rollos comprados de cada ficha HASTA EL CIERRE del mes (todo lo anterior
   * incluido): con eso se decide qué colores son "los que más se compran" a esa
   * fecha. Mirar un mes de agosto con compras de octubre sería hacer trampa.
   */
  private async purchasedUpTo(organizationId: string, month: string): Promise<Record<string, number>> {
    const desde = monthStart(month);
    const hasta = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, 1));
    const compras = await this.prisma.expense.findMany({
      where: { organizationId, materialId: { not: null }, date: { lt: hasta } },
      select: { materialId: true, quantity: true },
    });
    const porFicha: Record<string, number> = {};
    for (const c of compras) {
      if (!c.materialId) continue;
      porFicha[c.materialId] = (porFicha[c.materialId] ?? 0) + (c.quantity ?? 0);
    }
    return porFicha;
  }

  /** Rollos que entraron en el mes: sin ellos, un mes con compras daría un
   *  consumo negativo, que es lo que le pasa a la hoja. */
  private async purchasedInMonth(organizationId: string, month: string): Promise<number> {
    const desde = monthStart(month);
    const hasta = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, 1));
    const compras = await this.prisma.expense.findMany({
      where: {
        organizationId,
        materialId: { not: null },
        date: { gte: desde, lt: hasta },
      },
      select: { quantity: true },
    });
    return compras.reduce((s, c) => s + (c.quantity ?? 0), 0);
  }
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** `'2026-08'` → `'Agosto de 2026'`, para los mensajes de error. */
function etiquetaMes(month: string): string {
  const d = monthStart(month);
  const nombre = MESES[d.getUTCMonth()];
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} de ${d.getUTCFullYear()}`;
}

/** `'2026-08-31'` → `'31/08/2026'`. */
function fechaCorta(dia: string): string {
  const [anio, mes, d] = dia.split('-');
  return `${d}/${mes}/${anio}`;
}

/** Rango [from, to] en UTC; el día `to` se incluye completo. Mismo criterio que
 *  el resto de la app: sin la `Z`, una zona al oeste de UTC corre el límite. */
function dateWhere(from?: string, to?: string) {
  if (!from && !to) return {};
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
  return { date: { ...(gte && { gte }), ...(lte && { lte }) } };
}
