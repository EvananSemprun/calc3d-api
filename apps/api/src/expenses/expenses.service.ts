import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  purchaseCostPerRoll,
  MaterialSchema,
  PrinterSchema,
  ComponentSchema,
  type ExpenseCreateDto,
  type ExpenseUpdateDto,
  type ExpenseWithDefinitionDto,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Rango de fechas opcional [from, to]. Las fechas date-only (`YYYY-MM-DD`) se
 *  tratan como UTC en ambos extremos: `from` es medianoche UTC y `to` se cierra
 *  al fin del día EN UTC (sufijo `Z`). Sin la `Z`, en una zona al oeste de UTC
 *  el límite superior se correría al día siguiente e incluiría gastos ajenos. */
function dateWhere(from?: string, to?: string) {
  if (!from && !to) return {};
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
  return { date: { ...(gte && { gte }), ...(lte && { lte }) } };
}

/**
 * Vista mínima de un delegado de Prisma (material / printer / component) para
 * poder elegirlo POR NOMBRE dentro de la transacción — que es justo lo que el
 * cliente tipado de Prisma no deja hacer. Declara solo los 3 métodos que se usan
 * y con su firma real: el tipo `Function` aceptaba cualquier cosa y no avisaba
 * de un argumento mal armado.
 */
interface CatalogDelegate {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
}

/** El único campo de referencia que puede escribir un gasto sobre cada tipo de ficha: su precio. */
const PRICE_FIELD = { material: 'rollPrice', printer: 'price', component: 'packagePrice' } as const;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly linkInclude = {
    material: { select: { id: true, name: true } },
    printer: { select: { id: true, name: true } },
    component: { select: { id: true, name: true } },
    provider: { select: { id: true, name: true } },
    counterparty: { select: { id: true, name: true, kind: true } },
  };

  list(organizationId: string, from?: string, to?: string) {
    return this.prisma.expense.findMany({
      where: { organizationId, ...dateWhere(from, to) },
      include: this.linkInclude,
      orderBy: { date: 'desc' },
    });
  }

  /**
   * EL PROVEEDOR, resuelto contra el directorio.
   *
   * ⚠️ `providerId` viaja en el body y hasta 2026-10-09 se escribía CRUDO. Con
   * el id de otro negocio, el nombre de SU contacto salía a la vista en
   * Compras de filamento y en la hoja de Gastos del Excel. Por eso el
   * `findFirst` con la organización.
   *
   * `providerName` es el alta al vuelo: si el proveedor todavía no existe se
   * crea como contacto en vez de cortarte el formulario para mandarte al
   * directorio. Se busca por nombre sin distinguir mayúsculas para no terminar
   * con "StratoFill" y "stratofill" como dos proveedores distintos.
   */
  private async resolverProveedor(
    organizationId: string,
    dto: { providerId?: string | null; providerName?: string | null },
  ): Promise<{ providerId: string | null } | undefined> {
    if (dto.providerId) {
      const cp = await this.prisma.client.findFirst({
        where: { id: dto.providerId, organizationId, type: 'SUPPLIER' },
      });
      if (!cp) throw new NotFoundException('No existe ese proveedor');
      return { providerId: cp.id };
    }

    const nombre = dto.providerName?.trim();
    if (nombre) {
      const existente = await this.prisma.client.findFirst({
        where: { organizationId, type: 'SUPPLIER', name: { equals: nombre, mode: 'insensitive' } },
      });
      if (existente) return { providerId: existente.id };
      const creado = await this.prisma.client.create({
        data: { organizationId, name: nombre, type: 'SUPPLIER' },
      });
      return { providerId: creado.id };
    }

    // `null` explícito = sacarle el proveedor; ausente = no tocarlo.
    return dto.providerId === undefined && dto.providerName === undefined
      ? undefined
      : { providerId: null };
  }

  /**
   * QUIÉN pagó, validado contra el directorio de contrapartes.
   *
   * ⚠️ `counterpartyId` viaja en el body: sin el filtro por organización, el
   * id de otro negocio ataría el gasto —y la deuda que genera— a alguien de
   * afuera.
   *
   * Devuelve `undefined` cuando el DTO no habla del tema (un PATCH parcial),
   * para no pisar la contraparte que ya tenía.
   */
  private async quienPago(
    organizationId: string,
    dto: { counterpartyId?: string | null },
  ): Promise<{ counterpartyId: string | null } | undefined> {
    if (dto.counterpartyId === undefined) return undefined;
    if (!dto.counterpartyId) return { counterpartyId: null };

    const cp = await this.prisma.counterparty.findFirst({
      where: { id: dto.counterpartyId, organizationId },
    });
    if (!cp) throw new NotFoundException('No existe esa contraparte');
    return { counterpartyId: cp.id };
  }

  async create(organizationId: string, dto: ExpenseCreateDto) {
    const quien = await this.quienPago(organizationId, dto);
    const proveedor = await this.resolverProveedor(organizationId, dto);
    const gasto = await this.prisma.expense.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        isInvestment: dto.isInvestment,
        quantity: dto.quantity ?? null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        ...(proveedor ?? { providerId: null }),
        materialId: dto.materialId || null,
        printerId: dto.printerId || null,
        componentId: dto.componentId || null,
        campaignId: dto.campaignId || null,
        rate: dto.rate ?? null,
        currencyCode: dto.currencyCode ?? null,
        ...quien,
      },
      include: this.linkInclude,
    });

    await this.recalcularPrecioDelRollo(organizationId, dto.materialId);
    return gasto;
  }

  /**
   * "La última compra manda": el precio del rollo con el que se cotiza es lo que
   * costó reponerlo la última vez. Lo fija el SERVIDOR y no una casilla del
   * formulario — si dependiera de que alguien la marque, el día que se olvide se
   * seguiría cotizando con un precio viejo, que es como se pierde margen sin
   * darse cuenta. Sin cantidad no hay precio por rollo que calcular.
   *
   * ⚠️ Lee **LA ÚLTIMA COMPRA POR FECHA**, no la que se acaba de tocar. Eso
   * importa en tres momentos:
   * - al **corregir** una compra vieja: el precio no tiene por qué moverse;
   * - al **corregir la última**: tiene que moverse, y antes NO se movía —
   *   arreglabas un monto mal tipeado y la calculadora seguía con el viejo;
   * - al **borrar** la última: el precio vuelve al de la anterior en vez de
   *   quedar congelado en una compra que ya no existe.
   *
   * Comprar rollos de una ficha descontinuada la vuelve a ACTIVA: si se volvió a
   * comprar, se sigue manejando. `updateMany` con la organización: con el id de
   * una ficha ajena no escribe nada.
   */
  async recalcularPrecioDelRollo(
    organizationId: string,
    materialId: string | null | undefined,
  ) {
    if (!materialId) return;
    const ultima = await this.prisma.expense.findFirst({
      where: { organizationId, materialId, quantity: { gt: 0 } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { amount: true, quantity: true },
    });
    // Sin compras con rollos no hay precio que calcular: se deja el que tenía.
    // Ponerlo en 0 haría cotizar gratis, que es peor que un precio viejo.
    if (!ultima?.quantity) return;
    await this.prisma.material.updateMany({
      where: { id: materialId, organizationId },
      data: {
        rollPrice: purchaseCostPerRoll(Number(ultima.amount), ultima.quantity),
        status: 'ACTIVE',
      },
    });
  }

  async createWithDefinition(organizationId: string, dto: ExpenseWithDefinitionDto) {
    const { expense, link } = dto;
    // Filamento: el precio del rollo sale SOLO de la compra (monto ÷ rollos). Sin
    // rollos no hay precio que calcular, y aceptarla dejaba entrar uno a mano.
    const rollos = expense.quantity ?? 0;
    if (link.kind === 'material' && rollos <= 0) {
      throw new BadRequestException('Indicá cuántos rollos compraste');
    }
    const schemas = {
      material: MaterialSchema,
      printer: PrinterSchema,
      component: ComponentSchema,
    } as const;
    const linkField = `${link.kind}Id` as 'materialId' | 'printerId' | 'componentId';
    // Fuera de la transacción a propósito: solo LEE, y resolver la contraparte
    // adentro alargaría la transacción sin ganar nada.
    const quien = await this.quienPago(organizationId, expense);
    const proveedor = await this.resolverProveedor(organizationId, expense);

    return this.prisma.$transaction(async (tx) => {
      const model = (tx as unknown as Record<string, CatalogDelegate>)[link.kind];
      let linkId = link.id ?? undefined;

      if (link.mode === 'new') {
        // Filamento: lo que venga en `data.rollPrice` se pisa con el de la compra.
        const crudo =
          link.kind === 'material'
            ? { ...(link.data ?? {}), rollPrice: purchaseCostPerRoll(expense.amount, rollos) }
            : (link.data ?? {});
        const data = schemas[link.kind].parse(crudo);
        const created = await model.create({ data: { ...data, organizationId } });
        linkId = created.id;
      } else {
        if (!linkId) throw new BadRequestException('Falta el item del catálogo');
        const owned = await model.findFirst({ where: { id: linkId, organizationId } });
        if (!owned) throw new NotFoundException('Definición no encontrada');
        // El precio de referencia es de impresoras e insumos. En filamento se
        // ignora (sin 400: un panel viejo lo sigue mandando durante el deploy).
        if (link.kind !== 'material' && link.referenceField != null && link.referenceValue != null) {
          // `referenceField` viaja en el body: solo puede ser el precio de este tipo
          // de ficha y no negativo. Si no, escribiría cualquier campo numérico
          // (vida útil, unidades por paquete…) sin las reglas de su schema.
          if (link.referenceField !== PRICE_FIELD[link.kind] || link.referenceValue < 0) {
            throw new BadRequestException('Campo de referencia inválido');
          }
          await model.update({ where: { id: linkId }, data: { [link.referenceField]: link.referenceValue } });
        }
      }

      // Una compra de filamento fija el precio del rollo y reactiva la ficha si
      // estaba descontinuada. La ficha ya se validó como propia arriba.
      if (link.kind === 'material' && linkId) {
        await model.update({
          where: { id: linkId },
          data: { rollPrice: purchaseCostPerRoll(expense.amount, rollos), status: 'ACTIVE' },
        });
      }

      return tx.expense.create({
        data: {
          organizationId,
          date: new Date(expense.date),
          category: expense.category,
          description: expense.description,
          amount: expense.amount,
          isInvestment: expense.isInvestment,
          quantity: expense.quantity ?? null,
          ...(proveedor ?? { providerId: null }),
          ...quien,
          [linkField]: linkId,
        },
        include: this.linkInclude,
      });
    });
  }

  async update(organizationId: string, id: string, dto: ExpenseUpdateDto) {
    const antes = await this.ensureOwned(organizationId, id);
    const quien = await this.quienPago(organizationId, dto);
    const proveedor = await this.resolverProveedor(organizationId, dto);
    const gasto = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.category && { category: dto.category }),
        ...(dto.description && { description: dto.description }),
        ...(dto.amount != null && { amount: dto.amount }),
        ...(dto.isInvestment != null && { isInvestment: dto.isInvestment }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity ?? null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...proveedor,
        ...(dto.materialId !== undefined && { materialId: dto.materialId || null }),
        ...(dto.printerId !== undefined && { printerId: dto.printerId || null }),
        ...(dto.componentId !== undefined && { componentId: dto.componentId || null }),
        ...(dto.campaignId !== undefined && { campaignId: dto.campaignId || null }),
        ...(dto.rate !== undefined && { rate: dto.rate ?? null }),
        ...(dto.currencyCode !== undefined && { currencyCode: dto.currencyCode ?? null }),
        // Los dos campos se escriben JUNTOS o no se escribe ninguno: tocar uno
        // solo es lo que los dejaría contradiciéndose.
        ...quien,
      },
      include: this.linkInclude,
    });

    // Los DOS materiales: si la compra cambió de ficha, la que la pierde
    // también tiene que volver a mirar cuál es ahora su última compra.
    for (const material of new Set([antes.materialId, gasto.materialId])) {
      await this.recalcularPrecioDelRollo(organizationId, material);
    }
    return gasto;
  }

  async remove(organizationId: string, id: string) {
    const gasto = await this.ensureOwned(organizationId, id);
    await this.prisma.expense.delete({ where: { id } });
    // Borrar la última compra deja el precio congelado en una que ya no existe.
    await this.recalcularPrecioDelRollo(organizationId, gasto.materialId);
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.expense.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Gasto no encontrado');
    return found;
  }
}
