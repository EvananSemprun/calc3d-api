import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  normalizePhone,
  type StoreCustomRequestDto,
  type StoreOrderRequestDto,
  type OrderLine,
  type StoreRequestStatus,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bandeja de la tienda: lo que llega SIN sesión y lo que el dueño hace con eso.
 *
 * Las tres reglas que sostienen todo el módulo:
 *
 * 1. **El precio lo pone el servidor.** El cuerpo dice qué producto y qué
 *    opciones; acá se busca la ficha, se validan las opciones y se suman los
 *    recargos. Nada de lo que llegue como "precio" o "total" se mira siquiera.
 * 2. **Nada entra a la operación solo.** Una solicitud vive en su propia tabla
 *    hasta que el dueño la confirma. Sin eso, cualquiera con un `curl` escribiría
 *    pedidos y contactos en el negocio.
 * 3. **La organización sale del entorno**, igual que en el catálogo público:
 *    jamás de un parámetro, o sería escribir en la organización que se pida.
 */

/** Un renglón ya valorizado por el servidor. Es lo que se guarda y lo que
 *  después se copia como línea del pedido real. */
export interface PricedLine {
  slug: string;
  /** Nombre al momento del pedido: si después se renombra la ficha, la
   *  solicitud tiene que seguir diciendo lo que el cliente pidió. */
  description: string;
  quantity: number;
  /** { "Color": "Rojo" } — las opciones que eligió, ya validadas. */
  options: Record<string, string>;
  /** Precio unitario CON los recargos de las opciones. */
  unitPrice: number;
}

@Injectable()
export class StoreRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Organización que publica la tienda. Del entorno, nunca del cliente. */
  private get storeOrganizationId(): string {
    const id = this.config.get<string>('STORE_ORGANIZATION_ID');
    if (!id) throw new ServiceUnavailableException('La tienda no está configurada');
    return id;
  }

  // ===================== Lado público (sin sesión) =====================

  /**
   * Pedido llegado del carrito. Devuelve lo MÍNIMO: que se recibió y el total
   * que calculó el servidor (para que la tienda lo muestre y el cliente pueda
   * comparar). Nada de ids internos ni del estado de la bandeja.
   */
  async submitOrder(dto: StoreOrderRequestDto) {
    const organizationId = this.storeOrganizationId;
    const lines = await this.priceItems(organizationId, dto.items);
    const totalUsd = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    const request = await this.prisma.storeRequest.create({
      data: {
        organizationId,
        kind: 'ORDER',
        // `status` NO sale del cuerpo: toda solicitud nace en NEW.
        customerName: dto.customer.name,
        customerPhone: dto.customer.phone,
        customerPhoneKey: normalizePhone(dto.customer.phone),
        customerNote: dto.customer.note ?? null,
        lines: lines as unknown as Prisma.InputJsonValue,
        totalUsd: new Prisma.Decimal(totalUsd.toFixed(4)),
      },
      select: { createdAt: true },
    });

    return { ok: true, totalUsd, receivedAt: request.createdAt };
  }

  /** Solicitud de pieza a medida: no tiene producto ni precio. */
  async submitCustom(dto: StoreCustomRequestDto) {
    const organizationId = this.storeOrganizationId;
    const request = await this.prisma.storeRequest.create({
      data: {
        organizationId,
        kind: 'CUSTOM',
        customerName: dto.customer.name,
        customerPhone: dto.customer.phone,
        customerPhoneKey: normalizePhone(dto.customer.phone),
        customerNote: dto.customer.note ?? null,
        description: dto.description,
      },
      select: { createdAt: true },
    });
    return { ok: true, receivedAt: request.createdAt };
  }

  /**
   * Valoriza el carrito contra las fichas REALES. Acá es donde se cae todo
   * intento de comprar barato: el precio no se lee, se calcula.
   */
  private async priceItems(
    organizationId: string,
    items: StoreOrderRequestDto['items'],
  ): Promise<PricedLine[]> {
    const slugs = [...new Set(items.map((i) => i.slug))];
    const products = await this.prisma.storeProduct.findMany({
      // `visible: true` también acá: un borrador no se compra por conocer su enlace.
      where: { organizationId, slug: { in: slugs }, visible: true },
      include: {
        optionGroups: { include: { options: true } },
      },
    });
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    return items.map((item) => {
      const product = bySlug.get(item.slug);
      if (!product) {
        throw new BadRequestException(`El producto "${item.slug}" ya no está disponible`);
      }
      if (item.qty < product.minQty) {
        throw new BadRequestException(
          `"${product.name}" se pide de a ${product.minQty} como mínimo`,
        );
      }

      let unitPrice = Number(product.priceUsd);
      const chosen: Record<string, string> = {};

      // Un grupo que la ficha NO tiene se rechaza, no se ignora. Ignorarlo
      // parece más amable, pero si el nombre llega apenas distinto (una ñ mal
      // codificada, un grupo renombrado mientras el cliente tenía la página
      // abierta) el recargo desaparece sin que nadie se entere: la ficha diría
      // $25.50 y el pedido llegaría en $24. Mejor un error claro que un precio
      // equivocado en silencio.
      const conocidos = new Set(product.optionGroups.map((g) => g.name));
      for (const nombre of Object.keys(item.options)) {
        if (!conocidos.has(nombre)) {
          throw new BadRequestException(
            `"${product.name}" no tiene la opción "${nombre}". Recargá la página y probá de nuevo.`,
          );
        }
      }

      for (const group of product.optionGroups) {
        const value = item.options[group.name];
        if (value === undefined) {
          if (group.required) {
            throw new BadRequestException(`Falta elegir "${group.name}" en "${product.name}"`);
          }
          continue;
        }
        const option = group.options.find((o) => o.value === value);
        if (!option) {
          throw new BadRequestException(
            `La opción "${value}" no existe en "${group.name}" de "${product.name}"`,
          );
        }
        chosen[group.name] = option.value;
        unitPrice += Number(option.priceDeltaUsd);
      }

      return {
        slug: product.slug,
        description: product.name,
        quantity: item.qty,
        options: chosen,
        unitPrice: Number(unitPrice.toFixed(4)),
      };
    });
  }

  // ===================== Lado del panel (con sesión) =====================

  list(organizationId: string, status?: StoreRequestStatus) {
    return this.prisma.storeRequest.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        order: { select: { id: true, code: true, status: true } },
      },
    });
  }

  /** Cuántas quedan sin revisar (para la insignia del menú). */
  async pendingCount(organizationId: string) {
    const pending = await this.prisma.storeRequest.count({
      where: { organizationId, status: 'NEW' },
    });
    return { pending };
  }

  async get(organizationId: string, id: string) {
    const request = await this.prisma.storeRequest.findFirst({
      where: { id, organizationId },
      include: {
        client: { select: { id: true, name: true } },
        order: { select: { id: true, code: true, status: true } },
      },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    return request;
  }

  /**
   * Confirmar: recién acá la solicitud toca el negocio.
   *
   * - Enlaza con el contacto que ya tenga ese teléfono, o crea uno nuevo. Es lo
   *   que da el historial por cliente sin necesidad de cuentas ni contraseñas.
   * - Crea el pedido con las líneas que calculó el servidor, en `QUOTED` y con
   *   `originChannel: STORE` para que la atribución por campaña lo vea.
   * - Una solicitud A MEDIDA se convierte igual en pedido, pero SIN líneas: no
   *   tiene precio todavía. La descripción va a las notas y el dueño la cotiza.
   *   No puede ser un `Quote` porque un presupuesto exige el snapshot completo
   *   del `CalcInput`, y "quiero un llavero con mi logo" no lo tiene.
   */
  async confirm(organizationId: string, id: string) {
    const request = await this.get(organizationId, id);
    if (request.status !== 'NEW') {
      throw new BadRequestException('Esta solicitud ya fue revisada');
    }

    return this.prisma.$transaction(async (tx) => {
      const phoneKey = request.customerPhoneKey;
      // Se busca por el teléfono normalizado, pero comparando contra los
      // contactos de ESTA organización: el CRM no se cruza entre negocios.
      const candidates = await tx.client.findMany({
        where: { organizationId, phone: { not: null } },
        select: { id: true, phone: true },
      });
      const match = phoneKey
        ? candidates.find((c) => normalizePhone(c.phone ?? '') === phoneKey)
        : undefined;

      const clientId =
        match?.id ??
        (
          await tx.client.create({
            data: {
              organizationId,
              name: request.customerName,
              phone: request.customerPhone,
              notes: 'Alta automática desde un pedido de la tienda.',
            },
            select: { id: true },
          })
        ).id;

      const last = await tx.order.findFirst({
        where: { organizationId },
        orderBy: { code: 'desc' },
        select: { code: true },
      });

      const notes = [
        request.kind === 'CUSTOM' ? `Pieza a medida: ${request.description ?? ''}`.trim() : '',
        request.customerNote ? `Nota del cliente: ${request.customerNote}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const order = await tx.order.create({
        data: {
          organizationId,
          clientId,
          code: (last?.code ?? 0) + 1,
          status: 'QUOTED',
          notes: notes || null,
          lines: toOrderLines(request.lines) as unknown as Prisma.InputJsonValue,
          originChannel: 'STORE',
        },
        select: { id: true, code: true },
      });

      await tx.storeRequest.update({
        where: { id: request.id },
        data: {
          status: 'CONFIRMED',
          reviewedAt: new Date(),
          clientId,
          orderId: order.id,
        },
      });

      return { ok: true, orderId: order.id, orderCode: order.code, clientId };
    });
  }

  /** Descartar: spam o pruebas. No crea nada; queda el registro de que se vio. */
  async discard(organizationId: string, id: string) {
    const request = await this.get(organizationId, id);
    if (request.status !== 'NEW') {
      throw new BadRequestException('Esta solicitud ya fue revisada');
    }
    await this.prisma.storeRequest.update({
      where: { id: request.id },
      data: { status: 'DISCARDED', reviewedAt: new Date() },
    });
    return { ok: true };
  }

  async remove(organizationId: string, id: string) {
    await this.get(organizationId, id);
    await this.prisma.storeRequest.delete({ where: { id } });
    return { ok: true };
  }
}

/**
 * Pasa los renglones de la bandeja al formato de línea de PEDIDO
 * (`{description, quantity, unit, unitPrice}`, ver `shared/calc/order.ts`).
 *
 * Las opciones se meten DENTRO de la descripción a propósito: el pedido y su
 * nota de entrega solo muestran la descripción, así que dejarlas en un campo
 * aparte equivalía a producir sin saber de qué color ni de qué tamaño.
 */
function toOrderLines(lines: unknown): OrderLine[] {
  if (!Array.isArray(lines)) return [];
  return (lines as PricedLine[]).map((l) => {
    const opciones = Object.entries(l.options ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
    return {
      description: opciones ? `${l.description} (${opciones})` : l.description,
      quantity: l.quantity,
      unit: 'u',
      unitPrice: l.unitPrice,
    };
  });
}
