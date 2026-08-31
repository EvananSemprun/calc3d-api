import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreOrderRequestSchema, StoreCustomRequestSchema } from '@calc3d/shared';
import { StoreRequestsService } from './store-requests.service';

/**
 * Regresión de seguridad de la PRIMERA escritura sin sesión del sistema.
 *
 * Cada test de acá intenta un ataque concreto. Si alguno se pone verde por las
 * razones equivocadas (o rojo tras un cambio), es que se reabrió una puerta:
 *
 * - comprar barato mandando el precio en el cuerpo;
 * - comprar un borrador que no está publicado;
 * - saltarse el mínimo de compra desde fuera del front;
 * - inventar una opción para pagar menos;
 * - crear un pedido/cliente sin que el dueño confirme;
 * - tocar la bandeja de otra organización.
 */

const ORG = 'org-1';
const OTRA_ORG = 'org-2';

function hacerPrisma() {
  const prisma = {
    storeProduct: { findMany: jest.fn() },
    storeRequest: {
      create: jest.fn().mockResolvedValue({ createdAt: new Date('2026-08-22T12:00:00Z') }),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    client: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    order: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  // Se asigna después del literal para poder referenciar `prisma` sin ciclo.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function hacerServicio(prisma: ReturnType<typeof hacerPrisma>, orgId: string | null = ORG) {
  // Ojo: pasar `undefined` activaría el valor por defecto. `null` = sin configurar.
  const config = { get: jest.fn().mockReturnValue(orgId ?? undefined) };
  return new StoreRequestsService(prisma as never, config as never);
}

/** Llavero a $24 con "Grande" (+$1.50) obligatorio y mínimo 2. */
const LLAVERO = {
  slug: 'llavero',
  name: 'Llavero',
  priceUsd: 24,
  minQty: 2,
  optionGroups: [
    {
      name: 'Tamaño',
      required: true,
      options: [
        { value: 'Chico', priceDeltaUsd: 0 },
        { value: 'Grande', priceDeltaUsd: 1.5 },
      ],
    },
  ],
};

describe('StoreRequestsService — escritura pública', () => {
  it('IGNORA el precio que mande el cliente y cobra el de la ficha', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    // El atacante manda su propio precio y su propio total.
    const cuerpo = {
      customer: { name: 'Ana', phone: '04121234567' },
      items: [
        {
          slug: 'llavero',
          qty: 2,
          options: { Tamaño: 'Grande' },
          unitPrice: 0.01,
          price: 0.01,
          totalUsd: 0.02,
        },
      ],
      totalUsd: 0.02,
    };
    // El pipe de Zod es la primera barrera: los campos de precio ni siquiera
    // sobreviven al parseo del contrato.
    const dto = StoreOrderRequestSchema.parse(cuerpo);
    expect(dto.items[0]).not.toHaveProperty('unitPrice');
    expect(dto).not.toHaveProperty('totalUsd');

    const res = await service.submitOrder(dto);

    // Y el servicio cobra 2 × ($24 + $1.50), no $0.02.
    expect(res.totalUsd).toBe(51);
    const guardado = prisma.storeRequest.create.mock.calls[0][0].data;
    expect(guardado.lines[0].unitPrice).toBe(25.5);
    expect(Number(guardado.totalUsd)).toBe(51);
  });

  it('nace siempre en NEW: el estado no sale del cuerpo', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    const dto = StoreOrderRequestSchema.parse({
      customer: { name: 'Ana', phone: '04121234567' },
      items: [{ slug: 'llavero', qty: 2, options: { Tamaño: 'Chico' } }],
      status: 'CONFIRMED',
      clientId: 'cliente-ajeno',
      orderId: 'pedido-ajeno',
    });
    await service.submitOrder(dto);

    const guardado = prisma.storeRequest.create.mock.calls[0][0].data;
    expect(guardado.status).toBeUndefined(); // lo pone el default de Prisma
    expect(guardado.clientId).toBeUndefined();
    expect(guardado.orderId).toBeUndefined();
  });

  it('no deja comprar un producto que no está publicado', async () => {
    const prisma = hacerPrisma();
    // La consulta filtra por `visible: true`, así que un borrador no vuelve.
    prisma.storeProduct.findMany.mockResolvedValue([]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          items: [{ slug: 'borrador', qty: 1, options: {} }],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.storeProduct.findMany.mock.calls[0][0].where.visible).toBe(true);
    expect(prisma.storeRequest.create).not.toHaveBeenCalled();
  });

  it('hace respetar el mínimo de compra aunque se saltee el front', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          items: [{ slug: 'llavero', qty: 1, options: { Tamaño: 'Chico' } }],
        }),
      ),
    ).rejects.toThrow(/mínimo/i);
  });

  it('rechaza una opción inventada en vez de cobrarla como base', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          items: [{ slug: 'llavero', qty: 2, options: { Tamaño: 'Gigante gratis' } }],
        }),
      ),
    ).rejects.toThrow(/no existe/i);
  });

  it('exige elegir los grupos obligatorios', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          items: [{ slug: 'llavero', qty: 2, options: {} }],
        }),
      ),
    ).rejects.toThrow(/Falta elegir/i);
  });

  // Antes esto se DESCARTABA en silencio. Se cambió a rechazo porque el mismo
  // camino cubre el caso peligroso: un nombre de grupo que llega apenas distinto
  // (una ñ mal codificada, un grupo renombrado con la página abierta) hacía
  // desaparecer el recargo — ficha en $25.50, pedido en $24, y nadie se entera.
  it('rechaza un grupo de opciones que la ficha no tiene', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          items: [
            { slug: 'llavero', qty: 2, options: { Tamaño: 'Chico', 'Descuento VIP': '-90%' } },
          ],
        }),
      ),
    ).rejects.toThrow(/no tiene la opción/i);
    expect(prisma.storeRequest.create).not.toHaveBeenCalled();
  });

  it('un grupo con el nombre mal escrito NO pierde el recargo en silencio', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await expect(
      service.submitOrder(
        StoreOrderRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          // "Tamano" sin la ñ: es el grupo de verdad, mal codificado.
          items: [{ slug: 'llavero', qty: 2, options: { Tamano: 'Grande' } }],
        }),
      ),
    ).rejects.toThrow(/no tiene la opción/i);
  });

  it('un pedido público NO crea pedido ni cliente: solo entra a la bandeja', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    await service.submitOrder(
      StoreOrderRequestSchema.parse({
        customer: { name: 'Ana', phone: '04121234567' },
        items: [{ slug: 'llavero', qty: 2, options: { Tamaño: 'Chico' } }],
      }),
    );

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it('no responde nada interno de la bandeja', async () => {
    const prisma = hacerPrisma();
    prisma.storeProduct.findMany.mockResolvedValue([LLAVERO]);
    const service = hacerServicio(prisma);

    const res = await service.submitOrder(
      StoreOrderRequestSchema.parse({
        customer: { name: 'Ana', phone: '04121234567' },
        items: [{ slug: 'llavero', qty: 2, options: { Tamaño: 'Chico' } }],
      }),
    );

    expect(Object.keys(res).sort()).toEqual(['ok', 'receivedAt', 'totalUsd']);
  });

  it('sin STORE_ORGANIZATION_ID no escribe nada', async () => {
    const prisma = hacerPrisma();
    const service = hacerServicio(prisma, null);
    await expect(
      service.submitCustom(
        StoreCustomRequestSchema.parse({
          customer: { name: 'Ana', phone: '04121234567' },
          description: 'Quiero un llavero con mi logo grabado.',
        }),
      ),
    ).rejects.toThrow(/no está configurada/i);
    expect(prisma.storeRequest.create).not.toHaveBeenCalled();
  });
});

describe('StoreRequestsService — bandeja del panel', () => {
  const solicitud = {
    id: 'req-1',
    organizationId: ORG,
    kind: 'ORDER' as const,
    status: 'NEW' as const,
    customerName: 'Ana',
    customerPhone: '0412-1234567',
    customerPhoneKey: '584121234567',
    customerNote: null,
    description: null,
    lines: [{ slug: 'llavero', description: 'Llavero', quantity: 2, options: {}, unitPrice: 24 }],
  };

  it('no deja tocar la solicitud de otra organización', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue(null); // el where incluye organizationId
    const service = hacerServicio(prisma);

    await expect(service.confirm(OTRA_ORG, 'req-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.storeRequest.findFirst.mock.calls[0][0].where.organizationId).toBe(OTRA_ORG);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('al confirmar crea el pedido con origen STORE y las líneas del servidor', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue(solicitud);
    prisma.client.create.mockResolvedValue({ id: 'cli-nuevo' });
    prisma.order.findFirst.mockResolvedValue({ code: 7 });
    prisma.order.create.mockResolvedValue({ id: 'ord-1', code: 8 });
    const service = hacerServicio(prisma);

    const res = await service.confirm(ORG, 'req-1');

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.originChannel).toBe('STORE');
    expect(data.status).toBe('QUOTED');
    expect(data.code).toBe(8);
    // Las líneas se traducen al formato de PEDIDO (description/quantity/unit/
    // unitPrice), que es el que leen el pedido y la nota de entrega.
    expect(data.lines).toEqual([
      { description: 'Llavero', quantity: 2, unit: 'u', unitPrice: 24 },
    ]);
    expect(res).toEqual({ ok: true, orderId: 'ord-1', orderCode: 8, clientId: 'cli-nuevo' });
  });

  it('mete las opciones elegidas en la descripción de la línea', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue({
      ...solicitud,
      lines: [
        {
          slug: 'llavero',
          description: 'Llavero',
          quantity: 2,
          options: { Color: 'Rojo', Tamaño: 'Grande' },
          unitPrice: 25.5,
        },
      ],
    });
    prisma.client.create.mockResolvedValue({ id: 'cli-nuevo' });
    prisma.order.findFirst.mockResolvedValue({ code: 0 });
    prisma.order.create.mockResolvedValue({ id: 'ord-1', code: 1 });
    const service = hacerServicio(prisma);

    await service.confirm(ORG, 'req-1');

    // Sin esto el dueño imprime la nota de entrega sin saber de qué color
    // producir: el pedido solo muestra la descripción.
    expect(prisma.order.create.mock.calls[0][0].data.lines[0].description).toBe(
      'Llavero (Color: Rojo · Tamaño: Grande)',
    );
  });

  it('enlaza con el contacto existente cuando el teléfono es el mismo escrito distinto', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue(solicitud);
    // Guardado como "+58 412 123 45 67": otro formato, mismo teléfono.
    prisma.client.findMany.mockResolvedValue([{ id: 'cli-viejo', phone: '+58 412 123 45 67' }]);
    prisma.order.findFirst.mockResolvedValue({ code: 0 });
    prisma.order.create.mockResolvedValue({ id: 'ord-1', code: 1 });
    const service = hacerServicio(prisma);

    const res = await service.confirm(ORG, 'req-1');

    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(res.clientId).toBe('cli-viejo');
    // Y busca contactos SOLO de esta organización.
    expect(prisma.client.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
  });

  it('no confirma dos veces (ni crea dos pedidos por la misma solicitud)', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue({ ...solicitud, status: 'CONFIRMED' });
    const service = hacerServicio(prisma);

    await expect(service.confirm(ORG, 'req-1')).rejects.toThrow(/ya fue revisada/i);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('una pieza a medida se confirma sin líneas y con la descripción en notas', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue({
      ...solicitud,
      kind: 'CUSTOM',
      lines: [],
      description: 'Un llavero con mi logo',
      customerNote: 'Para el viernes',
    });
    prisma.client.create.mockResolvedValue({ id: 'cli-nuevo' });
    prisma.order.findFirst.mockResolvedValue({ code: 3 });
    prisma.order.create.mockResolvedValue({ id: 'ord-2', code: 4 });
    const service = hacerServicio(prisma);

    await service.confirm(ORG, 'req-1');

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.lines).toEqual([]);
    expect(data.notes).toContain('Un llavero con mi logo');
    expect(data.notes).toContain('Para el viernes');
  });

  it('descartar no crea nada', async () => {
    const prisma = hacerPrisma();
    prisma.storeRequest.findFirst.mockResolvedValue(solicitud);
    const service = hacerServicio(prisma);

    await service.discard(ORG, 'req-1');

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.storeRequest.update.mock.calls[0][0].data.status).toBe('DISCARDED');
  });
});
