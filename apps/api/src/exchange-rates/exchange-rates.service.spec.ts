import { ExchangeRatesService, RETRY_COOLDOWN_MS, STALE_AFTER_MS } from './exchange-rates.service';

/** Prisma mockeado: cada método usado por el servicio es un jest.fn() plano. */
function makePrisma() {
  return {
    exchangeRate: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    settings: {
      findUnique: jest.fn().mockResolvedValue({ defaultRateLabel: 'Bolívar (BCV)' }),
    },
  };
}

const ORG = 'org-1';
const NOW = new Date('2026-07-06T12:00:00Z');

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-1',
    organizationId: ORG,
    label: 'Bolívar (BCV)',
    currencyCode: 'VES',
    rate: '667.05', // Prisma Decimal serializa a string; el service normaliza con Number()
    source: 'MANUAL',
    createdAt: NOW,
    ...over,
  };
}

describe('ExchangeRatesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let fetchBcv: jest.Mock;
  let fetchBcvEuro: jest.Mock;
  let service: ExchangeRatesService;

  beforeEach(() => {
    prisma = makePrisma();
    fetchBcv = jest.fn();
    fetchBcvEuro = jest.fn();
    service = new ExchangeRatesService(prisma as any, fetchBcv, fetchBcvEuro);
  });

  describe('latest', () => {
    it('pide la fila más reciente por NOMBRE (distinct label) y normaliza rate + label', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([
        row({ rate: '700' }),
        row({ label: 'Euro neto', currencyCode: 'EUR', rate: '0.9' }),
      ]);

      const out = await service.latest(ORG);

      expect(out).toHaveLength(2);
      expect(out.find((r) => r.label === 'Bolívar (BCV)')?.rate).toBe(700);
      expect(out.find((r) => r.label === 'Euro neto')).toMatchObject({ currencyCode: 'EUR', rate: 0.9 });
      expect(prisma.exchangeRate.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        orderBy: { createdAt: 'desc' },
        distinct: ['label'],
      });
    });
  });

  describe('setManual', () => {
    it('crea fila MANUAL con etiqueta + moneda y no llama al proveedor', async () => {
      prisma.exchangeRate.create.mockResolvedValue(row());
      await service.setManual(ORG, { label: 'Dólar paralelo', currencyCode: 'VES', rate: 45 });
      expect(prisma.exchangeRate.create).toHaveBeenCalledWith({
        data: { organizationId: ORG, label: 'Dólar paralelo', currencyCode: 'VES', rate: 45, source: 'MANUAL' },
      });
      expect(fetchBcv).not.toHaveBeenCalled();
    });
  });

  describe('refresh (forzado)', () => {
    it('sin tasas siembra el dólar→Bs desde el BCV', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([]);
      fetchBcv.mockResolvedValue({ rate: 667.05 });
      prisma.exchangeRate.create.mockResolvedValue(row({ source: 'AUTO' }));

      const out = await service.refresh(ORG);

      expect(out.refreshError).toBeUndefined();
      expect(prisma.exchangeRate.create).toHaveBeenCalledWith({
        data: { organizationId: ORG, label: 'Bolívar (BCV)', currencyCode: 'VES', rate: 667.05, source: 'AUTO' },
      });
    });

    it('con proveedor caído devuelve refreshError y no revienta', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([]);
      fetchBcv.mockRejectedValue(new Error('ENOTFOUND'));
      const out = await service.refresh(ORG);
      expect(out.refreshError).toMatch(/No se pudo/);
    });

    it('refresca el euro con el fetcher de euro (moneda EUR → cruce)', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([
        row({ label: 'Euro BCV', currencyCode: 'EUR', source: 'AUTO' }),
      ]);
      fetchBcvEuro.mockResolvedValue({ rate: 0.92 });
      await service.refresh(ORG);
      expect(fetchBcvEuro).toHaveBeenCalled();
      expect(fetchBcv).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('re-consulta si la tasa AUTO está vencida (>12h) y sirve la vieja si el fetch falla', async () => {
      const stale = new Date(Date.now() - STALE_AFTER_MS - 1000);
      prisma.exchangeRate.findMany.mockResolvedValue([row({ source: 'AUTO', createdAt: stale })]);
      fetchBcv.mockRejectedValue(new Error('down'));

      const out = await service.list(ORG);

      expect(fetchBcv).toHaveBeenCalled();
      expect(out.rates[0].rate).toBe(667.05); // sirvió la última conocida
      expect(out.refreshError).toMatch(/No se pudo/);
    });

    it('tras un fallo NO reintenta hasta pasado el cooldown', async () => {
      const stale = new Date(Date.now() - STALE_AFTER_MS - 1000);
      prisma.exchangeRate.findMany.mockResolvedValue([row({ source: 'AUTO', createdAt: stale })]);
      fetchBcv.mockRejectedValue(new Error('down'));

      await service.list(ORG);
      await service.list(ORG);

      expect(fetchBcv).toHaveBeenCalledTimes(1);
      expect(RETRY_COOLDOWN_MS).toBeGreaterThan(0);
    });

    it('sin tasas siembra el dólar BCV', async () => {
      prisma.exchangeRate.findMany
        .mockResolvedValueOnce([]) // primera lectura: vacío → siembra
        .mockResolvedValueOnce([row({ source: 'AUTO' })]); // relee tras sembrar
      fetchBcv.mockResolvedValue({ rate: 667.05 });
      prisma.exchangeRate.create.mockResolvedValue(row({ source: 'AUTO' }));

      const out = await service.list(ORG);

      expect(fetchBcv).toHaveBeenCalled();
      expect(out.rates[0]).toMatchObject({ currencyCode: 'VES', rate: 667.05, source: 'AUTO' });
    });

    it('NO re-consulta si la última tasa es MANUAL aunque sea vieja', async () => {
      const stale = new Date(Date.now() - STALE_AFTER_MS - 1000);
      prisma.exchangeRate.findMany.mockResolvedValue([row({ source: 'MANUAL', createdAt: stale })]);
      await service.list(ORG);
      expect(fetchBcv).not.toHaveBeenCalled();
    });

    it('NO re-consulta si la tasa AUTO es fresca', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([row({ source: 'AUTO', createdAt: new Date() })]);
      await service.list(ORG);
      expect(fetchBcv).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('con etiqueta elegida congela SOLO esa tasa (keyed por su moneda, con label)', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([
        row(),
        row({ label: 'Euro neto', currencyCode: 'EUR', rate: '0.9' }),
      ]);

      const snap = await service.snapshot(ORG, 'Euro neto');

      expect(snap).toEqual({
        EUR: { rate: 0.9, source: 'MANUAL', at: NOW.toISOString(), label: 'Euro neto' },
      });
    });

    it('con label null devuelve null (solo USD)', async () => {
      expect(await service.snapshot(ORG, null)).toBeNull();
    });

    it('sin label usa la tasa por defecto de la organización', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([row()]);
      const snap = await service.snapshot(ORG);
      expect(snap).toEqual({
        VES: { rate: 667.05, source: 'MANUAL', at: NOW.toISOString(), label: 'Bolívar (BCV)' },
      });
    });

    it('devuelve null si no hay default configurado', async () => {
      prisma.settings.findUnique.mockResolvedValue({ defaultRateLabel: null });
      prisma.exchangeRate.findMany.mockResolvedValue([row()]);
      expect(await service.snapshot(ORG)).toBeNull();
    });

    it('devuelve null si la etiqueta elegida no existe', async () => {
      prisma.exchangeRate.findMany.mockResolvedValue([row()]);
      expect(await service.snapshot(ORG, 'Inexistente')).toBeNull();
    });
  });
});
