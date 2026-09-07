import { Injectable, NotFoundException } from '@nestjs/common';
import {
  monthConsumption,
  monthStart,
  previousMonth,
  purchaseCostPerGram,
  purchaseCostPerRoll,
  restockStatus,
  stockTotal,
  type FilamentPurchase,
  type MaterialStatus,
  type RestockStatus,
  type StockCountRow,
  type StockCountUpsertDto,
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
  /** rollos contados este mes */
  totalRolls: number;
  /** de esos, cuántos están por acabarse */
  running: number;
  /** rollos consumidos en el mes; null si falta alguno de los dos conteos */
  consumption: number | null;
  /** rollos comprados en el mes (entran en el consumo) */
  purchased: number;
  /** qué hay que reponer */
  restock: { materialId: string; name: string; status: RestockStatus }[];
  /** rollos importados del Excel sin saber su marca */
  pendingBrandCheck: number;
  /** fichas contadas este mes */
  countedMaterials: number;
  /** fichas que hay para contar */
  totalMaterials: number;
  /**
   * true si se contaron todas. Con un conteo PARCIAL el total del mes es la suma
   * de lo poco que se contó, y el consumo sale disparatado ("consumiste 28
   * rollos" sin haber contado). La hoja tiene el mismo defecto; acá se avisa.
   */
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
        material: { select: { id: true, name: true, rollGrams: true } },
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
    const [materiales, conteos] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.countsOf(organizationId, month),
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
        // Sin fila guardada, ese mes todavía no se contó: no es "cero rollos".
        counted: !!c,
      };
    });
  }

  /** Guarda el conteo de un material en un mes (uno por material y mes). */
  async saveCount(organizationId: string, dto: StockCountUpsertDto) {
    const material = await this.prisma.material.findFirst({
      where: { id: dto.materialId, organizationId },
    });
    if (!material) throw new NotFoundException('Material no encontrado');

    const month = monthStart(dto.month);
    const partes = { sealed: dto.sealed, inUse: dto.inUse, running: dto.running };

    return this.prisma.stockCount.upsert({
      where: { materialId_month: { materialId: dto.materialId, month } },
      // Contarlo a mano resuelve la duda de marca que dejó la importación.
      update: { ...partes, needsBrandCheck: false, countedAt: new Date() },
      create: { ...partes, organizationId, materialId: dto.materialId, month },
    });
  }

  /** Totales del mes, consumo contra el mes anterior y qué reponer. */
  async summary(organizationId: string, month: string): Promise<FilamentSummary> {
    const anterior = previousMonth(month);
    const [materiales, actual, previo, comprados] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId } }),
      this.countsOf(organizationId, month),
      this.countsOf(organizationId, anterior),
      this.purchasedInMonth(organizationId, month),
    ]);

    const totalRolls = actual.reduce((s, c) => s + stockTotal(c), 0);
    const running = actual.reduce((s, c) => s + c.running, 0);
    const previoTotal = previo.length ? previo.reduce((s, c) => s + stockTotal(c), 0) : null;

    const porMaterial = new Map(actual.map((c) => [c.materialId, c]));
    const restock = materiales
      .map((m) => ({
        materialId: m.id,
        name: m.name,
        status: restockStatus({ status: m.status as MaterialStatus }, porMaterial.get(m.id) ?? null),
      }))
      .filter((x): x is { materialId: string; name: string; status: RestockStatus } =>
        x.status === 'OUT' || x.status === 'LOW',
      );

    return {
      month,
      totalRolls,
      running,
      consumption: monthConsumption(previoTotal, actual.length ? totalRolls : null, comprados),
      purchased: comprados,
      restock,
      pendingBrandCheck: actual.filter((c) => c.needsBrandCheck).length,
      countedMaterials: actual.length,
      totalMaterials: materiales.length,
      complete: materiales.length > 0 && actual.length >= materiales.length,
    };
  }

  private countsOf(organizationId: string, month: string): Promise<CountRow[]> {
    return this.prisma.stockCount.findMany({
      where: { organizationId, month: monthStart(month) },
    }) as unknown as Promise<CountRow[]>;
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

/** Rango [from, to] en UTC; el día `to` se incluye completo. Mismo criterio que
 *  el resto de la app: sin la `Z`, una zona al oeste de UTC corre el límite. */
function dateWhere(from?: string, to?: string) {
  if (!from && !to) return {};
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
  return { date: { ...(gte && { gte }), ...(lte && { lte }) } };
}
