import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ExchangeRateSetDto, ExchangeRateSnapshot, ExchangeRateView } from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BcvFetcher, fetchBcvRate, fetchBcvEuroRate } from './bcv.provider';

/** Una tasa AUTO más vieja que esto se intenta refrescar al listar. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
/** Tras un fallo del proveedor no se reintenta antes de esto (no martillar al BCV caído). */
export const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
/** Nombre por defecto de la tasa dólar→Bs (coincide con el backfill de la migración). */
const DEFAULT_VES_LABEL = 'Bolívar (BCV)';
/** Monedas destino que sabemos refrescar automáticamente desde el BCV. */
const AUTO_FEEDS = new Set(['VES', 'EUR']);

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly fetchBcv: BcvFetcher;
  private readonly fetchBcvEuro: BcvFetcher;
  /** Último fallo de fetch por organización (en memoria, por proceso). */
  private readonly lastFailureAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() fetchBcv?: BcvFetcher,
    @Optional() fetchBcvEuro?: BcvFetcher,
  ) {
    this.fetchBcv = fetchBcv ?? fetchBcvRate;
    this.fetchBcvEuro = fetchBcvEuro ?? fetchBcvEuroRate;
  }

  /** Tasa vigente por cada NOMBRE (label) de la organización. */
  async latest(organizationId: string): Promise<ExchangeRateView[]> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      distinct: ['label'],
    });
    return rows.map((r) => ({
      label: r.label,
      currencyCode: r.currencyCode,
      rate: Number(r.rate),
      source: r.source as 'AUTO' | 'MANUAL',
      updatedAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Lista las tasas vigentes, refrescando las AUTO vencidas desde el BCV (dólar y
   * euro). Un fallo de red NUNCA bloquea: se sirve la última tasa conocida, se
   * informa el error y no se reintenta hasta pasado el cooldown. Si la organización
   * no tiene ninguna tasa aún, se intenta sembrar la del dólar→Bs.
   */
  async list(organizationId: string): Promise<{ rates: ExchangeRateView[]; refreshError?: string }> {
    let rates = await this.latest(organizationId);
    let refreshError: string | undefined;
    const canRetry = Date.now() - (this.lastFailureAt.get(organizationId) ?? 0) > RETRY_COOLDOWN_MS;

    if (rates.length === 0 && canRetry) {
      // Org nueva sin tasas: sembrar el dólar BCV para que el dual funcione de una.
      const out = await this.refreshRate(organizationId, DEFAULT_VES_LABEL, 'VES');
      if (out.error) refreshError = out.error;
      else rates = await this.latest(organizationId);
      return { rates, refreshError };
    }

    const stale = rates.filter(
      (r) =>
        r.source === 'AUTO' &&
        AUTO_FEEDS.has(r.currencyCode) &&
        Date.now() - new Date(r.updatedAt).getTime() > STALE_AFTER_MS,
    );
    if (stale.length && canRetry) {
      for (const r of stale) {
        const out = await this.refreshRate(organizationId, r.label, r.currencyCode);
        if (out.error) {
          refreshError = out.error;
          break; // ya se anotó el fallo; no seguir martillando en el mismo request
        }
        if (out.rate != null) {
          rates = rates.map((x) =>
            x.label === r.label
              ? { ...x, rate: out.rate as number, source: 'AUTO', updatedAt: new Date().toISOString() }
              : x,
          );
        }
      }
    }
    return { rates, refreshError };
  }

  /** Registra/actualiza una tasa con nombre puesta a mano (fila nueva; conserva histórico). */
  setManual(organizationId: string, dto: ExchangeRateSetDto) {
    return this.prisma.exchangeRate.create({
      data: {
        organizationId,
        label: dto.label,
        currencyCode: dto.currencyCode,
        rate: dto.rate,
        source: 'MANUAL',
      },
    });
  }

  /** Elimina TODAS las filas (histórico incluido) de una tasa con nombre. */
  async remove(organizationId: string, label: string) {
    await this.prisma.exchangeRate.deleteMany({ where: { organizationId, label } });
    return { ok: true };
  }

  /** Fuerza el refresco de todas las tasas AUTO (o siembra el dólar si no hay ninguna). */
  async refresh(organizationId: string): Promise<{ refreshError?: string }> {
    const rates = await this.latest(organizationId);
    const autos = rates.filter((r) => r.source === 'AUTO' && AUTO_FEEDS.has(r.currencyCode));
    const targets = autos.length ? autos : [{ label: DEFAULT_VES_LABEL, currencyCode: 'VES' }];
    let refreshError: string | undefined;
    for (const t of targets) {
      const out = await this.refreshRate(organizationId, t.label, t.currencyCode);
      if (out.error) refreshError = out.error;
    }
    return { refreshError };
  }

  /** Consulta el BCV para una tasa (por su moneda destino) y la registra como AUTO. */
  private async refreshRate(
    organizationId: string,
    label: string,
    currencyCode: string,
  ): Promise<{ rate?: number; error?: string }> {
    try {
      const { rate } = currencyCode === 'EUR' ? await this.fetchBcvEuro() : await this.fetchBcv();
      await this.prisma.exchangeRate.create({
        data: { organizationId, label, currencyCode, rate, source: 'AUTO' },
      });
      this.lastFailureAt.delete(organizationId);
      return { rate };
    } catch (e) {
      this.lastFailureAt.set(organizationId, Date.now());
      this.logger.warn(
        `Fallo al consultar la tasa BCV (${currencyCode}, org ${organizationId}): ${e instanceof Error ? e.message : e}`,
      );
      return { error: 'No se pudo obtener la tasa BCV; se mantiene la última registrada.' };
    }
  }

  /**
   * Snapshot congelable para un documento: SOLO la tasa elegida.
   * - `label` string → esa tasa; `label` null → USD only (sin snapshot);
   * - `label` undefined → la tasa por defecto de la organización.
   */
  async snapshot(
    organizationId: string,
    label?: string | null,
  ): Promise<ExchangeRateSnapshot | null> {
    let chosenLabel = label ?? undefined;
    if (label === undefined) {
      const settings = await this.prisma.settings.findUnique({
        where: { organizationId },
        select: { defaultRateLabel: true },
      });
      chosenLabel = settings?.defaultRateLabel ?? undefined;
    }
    if (label === null || !chosenLabel) return null;

    const rates = await this.latest(organizationId);
    const match = rates.find((r) => r.label === chosenLabel);
    if (!match) return null;
    return {
      [match.currencyCode]: {
        rate: match.rate,
        source: match.source,
        at: match.updatedAt,
        label: match.label,
      },
    };
  }

  /** snapshot() ya tipado para columnas Json de Prisma (un solo cast, un solo sitio). */
  async snapshotJson(
    organizationId: string,
    label?: string | null,
  ): Promise<Prisma.InputJsonValue | undefined> {
    const snap = await this.snapshot(organizationId, label);
    return snap ? (snap as unknown as Prisma.InputJsonValue) : undefined;
  }
}
