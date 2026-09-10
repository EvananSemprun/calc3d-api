import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type PriceResult,
  type SaleCreateDto,
  type SaleUpdateDto,
} from '@calc3d/shared';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';

/** Rango de fechas opcional [from, to] en ISO; el día `to` se incluye completo.
 *  Las fechas date-only (`YYYY-MM-DD`) se tratan como UTC en ambos extremos:
 *  `from` ya se parsea como medianoche UTC, y `to` se cierra al fin del día EN
 *  UTC (sufijo `Z`). Sin la `Z`, `to` se parsearía en la hora local del servidor
 *  y en una zona al oeste de UTC (p. ej. UTC-4) el límite se correría al día
 *  siguiente, incluyendo ventas ajenas al rango (guardadas como medianoche UTC). */
function dateWhere(from?: string, to?: string) {
  if (!from && !to) return {};
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
  return { date: { ...(gte && { gte }), ...(lte && { lte }) } };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
  ) {}

  list(organizationId: string, from?: string, to?: string) {
    return this.prisma.sale.findMany({
      where: { organizationId, ...dateWhere(from, to) },
      include: { client: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async create(organizationId: string, dto: SaleCreateDto) {
    return this.prisma.sale.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        amount: dto.amount,
        kind: dto.kind,
        clientId: dto.clientId || null,
        note: dto.note || null,
        exchangeRates: await this.rates.snapshotJson(organizationId),
        originChannel: dto.originChannel ?? null,
        campaignId: dto.campaignId ?? null,
      },
    });
  }



  async update(organizationId: string, id: string, dto: SaleUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.sale.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.amount != null && { amount: dto.amount }),
        ...(dto.kind && { kind: dto.kind }),
        ...(dto.clientId !== undefined && { clientId: dto.clientId || null }),
        ...(dto.note !== undefined && { note: dto.note || null }),
        ...(dto.originChannel !== undefined && { originChannel: dto.originChannel ?? null }),
        ...(dto.campaignId !== undefined && { campaignId: dto.campaignId ?? null }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.sale.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.sale.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Venta no encontrada');
  }
}

/** Precio de venta total de un presupuesto: el total del pedido que quedó
 *  guardado en el snapshot; si el snapshot no lo trae, el precio final por la
 *  cantidad; y sin ningún precio, el costo del lote. */
function sellingTotal(totals: Record<string, unknown> | null, quantity: number): number {
  if (!totals) return 0;

  const order = totals.order as { total?: number } | undefined;
  if (order?.total) return Number(order.total);

  const price = totals.price as PriceResult | undefined;
  if (price?.final) return Number(price.final) * quantity;

  // Snapshot anterior a shared 0.7.0: traía `prices[]` y ningún precio final.
  // Caer al costo registraría una venta a pérdida sin que nadie se entere.
  if (Array.isArray(totals.prices)) {
    throw new BadRequestException(
      'Este presupuesto se guardó con una versión anterior de la calculadora. Ábrelo, guárdalo de nuevo y registra la venta.',
    );
  }

  return Number(totals.costBatch ?? 0);
}
