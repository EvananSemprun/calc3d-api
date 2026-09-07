import { NotFoundException } from '@nestjs/common';
import { BusinessDoc } from './business-doc';
import { DeliveryNoteService } from './delivery-note.service';
import { QuoteNoteService } from './quote-note.service';

/**
 * Contrato de los documentos que SALEN del negocio.
 *
 * El riesgo real de esta feature no es un fallo técnico sino de contenido: que
 * la cotización del cliente termine mostrando el costo o el margen. Estos tests
 * fijan que solo aparezcan precio de venta y total, y que ambos documentos se
 * lean siempre con scope de organización.
 */

const ORG = 'org-A';
const OTHER = 'org-B';

const PRECIO = {
  markup: 0.5,
  suggested: 1.8,
  rounded: 1.85,
  final: 1.85,
  isManual: false,
  marginReal: 0.48,
  profitPerUnit: 0.6,
  diffVsSuggested: 0.05,
  status: 'OK' as const,
};

const TOTALS = {
  quantity: 200,
  currency: 'USD',
  locale: 'en-US',
  costBatch: 250,
  costPerUnit: 1.25,
  price: PRECIO,
  order: {
    units: 200,
    listUnitPrice: 1.85,
    discountPct: 0,
    unitPrice: 1.85,
    fromTier: false,
    total: 370,
    profit: 120,
    status: 'OK' as const,
  },
  breakdown: {
    material: 100,
    wear: 20,
    power: 10,
    supplies: 80,
    labor: 20,
    extras: 20,
    wasteAmount: 10,
  },
  supplies: [],
};

const IDENTITY = {
  emisor: 'Banano Lab',
  rif: '28488961',
  phone: '0412 0366355',
  address: '',
  signer: 'Evanan Semprun',
  logo: null,
};

const identityMock = { load: jest.fn().mockResolvedValue(IDENTITY) };

function quotePrismaMock(quote: Record<string, unknown> | null) {
  return { quote: { findFirst: jest.fn().mockResolvedValue(quote) } };
}

const QUOTE = {
  id: 'q1',
  code: 7,
  name: 'Llaveros de Copa del Mundial',
  version: 2,
  createdAt: new Date('2026-08-22T12:00:00Z'),
  totals: TOTALS,
  exchangeRates: null,
  client: { name: 'Inversiones Theodora', rif: 'J-401234567', phone: '0414 1112233' },
};

describe('Cotización para el cliente', () => {
  afterEach(() => jest.restoreAllMocks());

  it('NUNCA muestra costos, márgenes ni desglose interno', async () => {
    const items = jest.spyOn(BusinessDoc.prototype, 'itemsTable');
    const cabecera = jest.spyOn(BusinessDoc.prototype, 'keyValueTable');
    const parrafo = jest.spyOn(BusinessDoc.prototype, 'paragraph');
    const nota = jest.spyOn(BusinessDoc.prototype, 'note');

    const service = new QuoteNoteService(quotePrismaMock(QUOTE) as any, identityMock as any);
    await service.pdf(ORG, 'q1');

    const visible = JSON.stringify([
      items.mock.calls,
      cabecera.mock.calls,
      parrafo.mock.calls,
      nota.mock.calls,
    ]).toLowerCase();

    for (const prohibido of ['costo', 'margen', 'ganancia', 'desglose', 'markup', 'mayoreo']) {
      expect(visible).not.toContain(prohibido);
    }
    // Y tampoco los NÚMEROS del costo, que delatan el margen igual que la palabra.
    expect(visible).not.toContain('250');
    expect(visible).not.toContain('1.25');
  });

  it('cobra el precio final del motor, no una cuenta propia', async () => {
    const items = jest.spyOn(BusinessDoc.prototype, 'itemsTable');
    const service = new QuoteNoteService(quotePrismaMock(QUOTE) as any, identityMock as any);
    await service.pdf(ORG, 'q1');

    const [, rows, total] = items.mock.calls[0];
    // Un solo renglón: el precio final × las piezas. Los recargos (diseño,
    // urgencia, mínimo) se eliminaron del motor en shared 0.7.0.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['1', QUOTE.name, '200', '$1.85', '$370.00']);
    expect(total).toBe('Total: $370.00');
  });

  /**
   * Si el pedido alcanza un tramo de mayoreo, el cliente paga ESE precio. Y lo
   * ve desglosado: cobrarle $10,68 pelado pierde el argumento de venta —el
   * descuento por cantidad es justamente lo que ganó por comprar más.
   */
  it('con descuento por cantidad lo muestra desglosado y cobra el precio del tramo', async () => {
    const items = jest.spyOn(BusinessDoc.prototype, 'itemsTable');
    const conDescuento = {
      ...QUOTE,
      totals: {
        ...TOTALS,
        order: {
          units: 200,
          listUnitPrice: 1.85,
          discountPct: 0.15,
          unitPrice: 1.6,
          fromTier: true,
          total: 320,
          profit: 70,
          status: 'BELOW_TARGET' as const,
        },
      },
    };
    const service = new QuoteNoteService(quotePrismaMock(conDescuento) as any, identityMock as any);
    await service.pdf(ORG, 'q1');

    const [, rows, total] = items.mock.calls[0];
    expect(rows).toHaveLength(2);
    // Renglón 1: el precio de LISTA, para que se vea de dónde parte.
    expect(rows[0]).toEqual(['1', QUOTE.name, '200', '$1.85', '$370.00']);
    // Renglón 2: lo que se descontó por cantidad.
    expect(rows[1][1]).toContain('Descuento por cantidad');
    expect(rows[1][1]).toContain('15');
    expect(rows[1][4]).toBe('-$50.00');
    // Y el total es el que se va a cobrar de verdad.
    expect(total).toBe('Total: $320.00');
  });

  it('numera el documento con el correlativo y el año', async () => {
    const cabecera = jest.spyOn(BusinessDoc.prototype, 'keyValueTable');
    const service = new QuoteNoteService(quotePrismaMock(QUOTE) as any, identityMock as any);
    await service.pdf(ORG, 'q1');
    expect(cabecera.mock.calls[0][0][0]).toEqual([
      'N.º de cotización:',
      '007-2026',
      'Fecha:',
      expect.any(String),
    ]);
  });

  it('no inventa un número si el presupuesto es anterior al correlativo', async () => {
    const cabecera = jest.spyOn(BusinessDoc.prototype, 'keyValueTable');
    const service = new QuoteNoteService(
      quotePrismaMock({ ...QUOTE, code: null }) as any,
      identityMock as any,
    );
    await service.pdf(ORG, 'q1');
    expect(cabecera.mock.calls[0][0][0][1]).toBe('S/N-2026');
  });

  it('devuelve un PDF real', async () => {
    const service = new QuoteNoteService(quotePrismaMock(QUOTE) as any, identityMock as any);
    const pdf = await service.pdf(ORG, 'q1');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('no emite el documento de una cotización de otra organización', async () => {
    const prisma = {
      quote: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where.organizationId === OTHER ? QUOTE : null),
        ),
      },
    };
    const service = new QuoteNoteService(prisma as any, identityMock as any);
    await expect(service.pdf(ORG, 'q1')).rejects.toThrow(NotFoundException);
    expect(prisma.quote.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'q1', organizationId: ORG } }),
    );
  });
});

describe('Nota de entrega', () => {
  afterEach(() => jest.restoreAllMocks());

  const ORDER = {
    id: 'o1',
    code: 1,
    notes: null,
    deliveryDate: new Date('2026-05-04T12:00:00Z'),
    createdAt: new Date('2026-05-01T12:00:00Z'),
    lines: [{ description: 'Llaveros de Copa del Mundial', quantity: 200, unit: 'Unidad', unitPrice: 2 }],
    client: { name: 'Inversiones Theodora', rif: null, phone: null },
  };

  it('NO lleva precios: es constancia de entrega, no factura', async () => {
    const items = jest.spyOn(BusinessDoc.prototype, 'itemsTable');
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(ORDER) } };
    const service = new DeliveryNoteService(prisma as any, identityMock as any);
    await service.pdf(ORG, 'o1');

    const [columns, rows, total] = items.mock.calls[0];
    expect(columns.map((c: { label: string }) => c.label)).toEqual([
      'Ítem',
      'Descripción',
      'Cantidad',
      'Unidad',
      'Observaciones',
    ]);
    // Ningún renglón trae importes: el precio unitario del pedido no se imprime.
    expect(JSON.stringify(rows)).not.toMatch(/\$|USD/);
    expect(rows[0]).toEqual(['1', 'Llaveros de Copa del Mundial', '200', 'Unidad', 'Entrega completa']);
    expect(total).toBe('Total entregado: 200 unidades');
  });

  it('no emite la nota de un pedido de otra organización', async () => {
    const prisma = {
      order: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where.organizationId === OTHER ? ORDER : null),
        ),
      },
    };
    const service = new DeliveryNoteService(prisma as any, identityMock as any);
    await expect(service.pdf(ORG, 'o1')).rejects.toThrow(NotFoundException);
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', organizationId: ORG } }),
    );
  });
});
