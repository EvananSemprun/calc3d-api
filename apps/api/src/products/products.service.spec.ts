import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.module';

function makePrisma() {
  return {
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    material: { findMany: jest.fn().mockResolvedValue([]) },
    printer: { findMany: jest.fn().mockResolvedValue([]) },
    component: { findMany: jest.fn().mockResolvedValue([]) },
    settings: { findUnique: jest.fn().mockResolvedValue({ kwhPrice: '0', productAlertMinMarginPct: 0.15 }) },
  };
}

const ratesMock = { snapshotJson: jest.fn().mockResolvedValue(undefined) };
const ORG = 'org-1';

/** Pieza mínima: 100 g de un rollo de 1000 g a $10 → costo unitario = $1 (sin merma). */
const input = {
  quantity: 1,
  materials: [{ name: 'PLA', rollPrice: 10, rollGrams: 1000, grams: 100 }],
  electricity: { enabled: false, kwhPrice: 0 },
  components: [],
  packaging: [],
  labor: [],
  waste: { pct: 0, appliesTo: [] },
  margins: { markups: [0.3], mode: 'MARKUP', rounding: { mode: 'NONE', increment: 1 } },
  wholesale: { tiers: [] },
  batch: { setupCost: 0 },
  surcharges: { designFee: 0, rushPct: 0, minOrderPrice: 0 },
  currency: 'USD',
  locale: 'en-US',
};

describe('ProductsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ProductsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ProductsService(prisma as any, ratesMock as any);
    ratesMock.snapshotJson.mockClear();
  });

  describe('create — el costo lo calcula el motor, no el cliente', () => {
    it('guarda costAtSave derivado del CalcInput y respeta el precio fijado', async () => {
      prisma.product.create.mockResolvedValue({ id: 'p1' });
      await service.create(ORG, { name: 'Llavero', input, priceSet: 1.3 } as any);
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data.costAtSave).toBe(1); // motor: 10 * 100/1000
      expect(data.priceSet).toBe(1.3);
      expect(data.organizationId).toBe(ORG);
    });
  });

  describe('list — recostea contra el catálogo de hoy y marca alerta', () => {
    it('el material subió de precio → margen bajo el mínimo → belowMin', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', input, priceSet: '1.3', costAtSave: '1' },
      ]);
      // Hoy el PLA cuesta $12 el rollo → costo unitario 1.2 → markup (1.3-1.2)/1.2 ≈ 8.3 % < 15 %.
      prisma.material.findMany.mockResolvedValue([{ name: 'PLA', rollPrice: '12', rollGrams: 1000 }]);

      const out = await service.list(ORG);
      expect(out[0].recost.costNow).toBeCloseTo(1.2, 4);
      expect(out[0].recost.status.belowMin).toBe(true);
      expect(out[0].recost.status.costDeltaPct).toBeCloseTo(0.2, 4);
    });

    it('sin cambios de catálogo el costo de hoy = costo al guardar, sin alerta', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', input, priceSet: '1.3', costAtSave: '1' },
      ]);
      prisma.material.findMany.mockResolvedValue([{ name: 'PLA', rollPrice: '10', rollGrams: 1000 }]);

      const out = await service.list(ORG);
      expect(out[0].recost.costNow).toBe(1);
      expect(out[0].recost.status.belowMin).toBe(false);
    });

    it('material renombrado/borrado: no se encuentra → se reporta en unmatched', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', input, priceSet: '1.3', costAtSave: '1' },
      ]);
      prisma.material.findMany.mockResolvedValue([]); // el PLA ya no está por ese nombre
      const out = await service.list(ORG);
      expect(out[0].recost.unmatched).toContain('PLA');
      expect(out[0].recost.costNow).toBe(1); // conserva el precio congelado
    });
  });

  describe('reprice — el dueño acepta el costo nuevo y re-ancla el margen', () => {
    it('fija priceSet y re-ancla costAtSave al costo de hoy', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', input, priceSet: '1.3', costAtSave: '1' });
      prisma.material.findMany.mockResolvedValue([{ name: 'PLA', rollPrice: '12', rollGrams: 1000 }]);
      prisma.product.update.mockResolvedValue({ id: 'p1' });

      await service.reprice(ORG, 'p1', { priceSet: 1.6 } as any);
      const data = prisma.product.update.mock.calls[0][0].data;
      expect(data.priceSet).toBe(1.6);
      expect(data.costAtSave).toBeCloseTo(1.2, 4); // re-anclado al costo recosteado
    });
  });

  describe('get — 404 si no es de la organización', () => {
    it('lanza NotFound', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.get(ORG, 'x')).rejects.toThrow(NotFoundException);
    });
  });
});
