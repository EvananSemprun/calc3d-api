import { RATE_LABELS } from '@calc3d/shared';
import { RecostService } from './recost.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * EL MARGEN SE MIDE EN USDT, NO EN LA ETIQUETA DE LA TIENDA (2026-11-08).
 *
 * El costo se calcula en USDT (el dólar real con el que se compra el filamento) pero el
 * precio se publica en dólares BCV, que valen menos. Dividir uno por el otro infla el
 * margen y, peor, **apaga la alerta**: un producto que ya no da el piso lo sigue
 * aparentando.
 *
 * La cuenta vive en `shared` (`productStatus`) y tiene sus propios tests. Lo que se fija
 * ACÁ es el cableado, que es lo que se rompe en silencio:
 *
 * - que el servicio BUSQUE las dos tasas (hasta hoy no leía ninguna),
 * - que la de los precios salga de la etiqueta y la de referencia de `protectionRateLabel`,
 * - que tome la fila MÁS NUEVA (`ExchangeRate` es un historial, no una fila por tasa),
 * - y que sin alguna de las dos informe el margen nominal **declarándolo**, en vez de
 *   convertir con una tasa inventada.
 */

const ORG = 'org-A';

/** Costeo mínimo: 1 pieza de 100 g de un rollo de $20 → costo unitario $2. */
const COSTEO = {
  quantity: 1,
  piecesPerBatch: 1,
  filament: { name: 'PLA', rollPrice: 20, rollGrams: 1000, grams: 100 },
  waste: { pct: 0 },
  supplies: [],
  printer: undefined,
  electricity: { enabled: false, kwhPrice: 0 },
  parallelPrinters: 1,
  labor: { minutes: 0, hourlyRate: 0 },
  extras: { packagingPerPiece: 0, otherPerOrder: 0 },
  margins: { markup: 1, minMarginPct: 0.6, rounding: { mode: 'NONE' as const, increment: 1 } },
  manualPrice: null,
  wholesale: { tiers: [] },
  currency: 'USD',
  locale: 'en-US',
};

/** Tasas del 2026-11-08: el dólar BCV vale menos que el USDT. */
const TASAS: Record<string, number> = {
  [RATE_LABELS.BCV_USD]: 900,
  'Binance / USDT': 1026,
};

function makeService(opts: { tasas?: Record<string, number>; protectionRateLabel?: string | null } = {}) {
  const tasas = opts.tasas ?? TASAS;
  const findFirst = jest.fn(({ where }: { where: { label: string } }) =>
    Promise.resolve(tasas[where.label] === undefined ? null : { rate: tasas[where.label] }),
  );
  const prisma = {
    material: { findMany: jest.fn().mockResolvedValue([]) },
    printer: { findMany: jest.fn().mockResolvedValue([]) },
    component: { findMany: jest.fn().mockResolvedValue([]) },
    settings: {
      findUnique: jest.fn().mockResolvedValue({
        kwhPrice: 0,
        productAlertMinMarginPct: 0.8,
        protectionRateLabel:
          opts.protectionRateLabel === undefined ? 'Binance / USDT' : opts.protectionRateLabel,
      }),
    },
    expense: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    exchangeRate: { findFirst },
  } as unknown as PrismaService;
  return { service: new RecostService(prisma), findFirst };
}

/** Recostea una ficha de precio `priceUsd` (en dólares BCV) con costo congelado $2. */
const recostear = (service: RecostService, priceUsd: number) =>
  service.recost(ORG, { input: COSTEO, priceUsd, costAtPublish: 2 });

describe('recosteo — el margen y la alerta en USDT', () => {
  it('convierte el precio publicado: $12 BCV no son $12 que entren', () => {
    expect.assertions(3);
    const { service } = makeService();
    return recostear(service, 12).then((r) => {
      // 12 × 900 / 1026 = 10.53 USDT
      expect(r!.status.priceUsdt).toBe(10.53);
      expect(r!.status.converted).toBe(true);
      // Real: (10.53 − 2) / 2 = 4.265. Nominal: (12 − 2) / 2 = 5.
      expect(r!.status.markupNow).toBeLessThan(r!.status.markupNominal);
    });
  });

  it('LA ALERTA mira el margen convertido: el nominal la dejaba apagada', async () => {
    const { service } = makeService();
    // Precio 4 BCV = 3.51 USDT con costo 2 → real 75,5 %, por debajo del piso de 80 %.
    // Nominal sería (4 − 2) / 2 = 100 % y no alertaría.
    const r = await recostear(service, 4);
    expect(r!.status.markupNominal).toBe(1);
    expect(r!.status.markupNow).toBeLessThan(0.8);
    expect(r!.status.belowMin).toBe(true);
  });

  it('pide la tasa de los precios por su etiqueta y la de referencia por la configurada', async () => {
    const { service, findFirst } = makeService({ protectionRateLabel: 'Mi tasa real' });
    await service.loadCatalog(ORG);
    const etiquetas = findFirst.mock.calls.map((c) => (c[0] as { where: { label: string } }).where.label);
    expect(etiquetas).toContain(RATE_LABELS.BCV_USD);
    expect(etiquetas).toContain('Mi tasa real');
  });

  it('toma la tasa MÁS NUEVA: ExchangeRate es un historial', async () => {
    const { service, findFirst } = makeService();
    await service.loadCatalog(ORG);
    for (const [args] of findFirst.mock.calls) {
      expect((args as unknown as { orderBy: unknown }).orderBy).toEqual({ createdAt: 'desc' });
    }
  });

  it('sin tasa de referencia cae a la de protección por defecto', async () => {
    const { service, findFirst } = makeService({ protectionRateLabel: null });
    await service.loadCatalog(ORG);
    const etiquetas = findFirst.mock.calls.map((c) => (c[0] as { where: { label: string } }).where.label);
    expect(etiquetas).toContain('Binance / USDT');
  });

  it('si falta una tasa NO inventa la conversión: informa nominal y lo declara', async () => {
    const { service } = makeService({ tasas: { [RATE_LABELS.BCV_USD]: 900 } });
    const r = await recostear(service, 12);
    expect(r!.status.converted).toBe(false);
    expect(r!.status.priceUsdt).toBe(12);
    expect(r!.status.markupNow).toBe(r!.status.markupNominal);
  });

  it('una tasa en 0 cuenta como faltante (dividir por ella daría infinito)', async () => {
    const { service } = makeService({ tasas: { ...TASAS, 'Binance / USDT': 0 } });
    const r = await recostear(service, 12);
    expect(r!.status.converted).toBe(false);
  });
});
