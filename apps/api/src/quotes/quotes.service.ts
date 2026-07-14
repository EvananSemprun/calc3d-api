import { Injectable, NotFoundException } from '@nestjs/common';
import {
  calculateQuote,
  CalcInputSchema,
  type CalcInput,
  type QuoteCreateDto,
  type QuoteStatusDto,
  type QuoteUpdateDto,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
  ) {}

  list(organizationId: string) {
    return this.prisma.quote.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      include: { client: { select: { id: true, name: true } } },
    });
  }

  async get(organizationId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id, organizationId },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');
    return quote;
  }

  /** Todas las versiones del mismo presupuesto (para comparar historial). */
  async versions(organizationId: string, id: string) {
    const quote = await this.get(organizationId, id);
    const groupKey = quote.originalQuoteId ?? quote.id;
    return this.prisma.quote.findMany({
      where: {
        organizationId,
        OR: [{ id: groupKey }, { originalQuoteId: groupKey }],
      },
      orderBy: { version: 'asc' },
    });
  }

  async create(organizationId: string, dto: QuoteCreateDto) {
    const input = CalcInputSchema.parse(dto.input);
    const totals = calculateQuote(input);
    return this.prisma.quote.create({
      data: {
        organizationId,
        clientId: dto.clientId ?? null,
        name: dto.name,
        quantity: input.quantity,
        status: dto.status ?? 'DRAFT',
        version: 1,
        input: input as unknown as Prisma.InputJsonValue,
        totals: totals as unknown as Prisma.InputJsonValue,
        currencyLabel: dto.currencyLabel ?? null,
        exchangeRates: await this.rates.snapshotJson(organizationId, dto.currencyLabel),
        originChannel: dto.originChannel ?? null,
        campaignId: dto.campaignId ?? null,
      },
    });
  }

  async update(organizationId: string, id: string, dto: QuoteUpdateDto) {
    const current = await this.get(organizationId, id);
    const input: CalcInput = dto.input
      ? CalcInputSchema.parse(dto.input)
      : CalcInputSchema.parse(current.input);
    const totals = calculateQuote(input);
    return this.prisma.quote.update({
      where: { id },
      data: {
        name: dto.name ?? current.name,
        clientId: dto.clientId === undefined ? current.clientId : dto.clientId,
        status: dto.status ?? current.status,
        ...(dto.originChannel !== undefined ? { originChannel: dto.originChannel ?? null } : {}),
        ...(dto.campaignId !== undefined ? { campaignId: dto.campaignId ?? null } : {}),
        quantity: input.quantity,
        input: input as unknown as Prisma.InputJsonValue,
        totals: totals as unknown as Prisma.InputJsonValue,
        ...(dto.currencyLabel !== undefined ? { currencyLabel: dto.currencyLabel } : {}),
        // Se re-congela la tasa si cambió el CÁLCULO o la MONEDA elegida; renombrar
        // o cambiar cliente/estado NO toca la tasa histórica del documento.
        ...(dto.input !== undefined || dto.currencyLabel !== undefined
          ? {
              exchangeRates:
                (await this.rates.snapshotJson(
                  organizationId,
                  dto.currencyLabel !== undefined ? dto.currencyLabel : current.currencyLabel,
                )) ?? Prisma.DbNull,
            }
          : {}),
      },
    });
  }

  /** Duplica un presupuesto como una nueva VERSIÓN del mismo grupo. */
  async duplicate(organizationId: string, id: string) {
    const source = await this.get(organizationId, id);
    const groupKey = source.originalQuoteId ?? source.id;
    const last = await this.prisma.quote.findFirst({
      where: { organizationId, OR: [{ id: groupKey }, { originalQuoteId: groupKey }] },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (last?.version ?? source.version) + 1;
    return this.prisma.quote.create({
      data: {
        organizationId,
        clientId: source.clientId,
        name: source.name,
        quantity: source.quantity,
        status: 'DRAFT',
        version: nextVersion,
        originalQuoteId: groupKey,
        input: source.input as Prisma.InputJsonValue,
        totals: source.totals as Prisma.InputJsonValue,
        // La copia hereda la tasa del origen (mismos números, misma tasa).
        exchangeRates: (source.exchangeRates as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async setStatus(organizationId: string, id: string, status: QuoteStatusDto) {
    await this.get(organizationId, id);
    return this.prisma.quote.update({ where: { id }, data: { status } });
  }

  async remove(organizationId: string, id: string) {
    await this.get(organizationId, id);
    await this.prisma.quote.delete({ where: { id } });
    return { ok: true };
  }
}
