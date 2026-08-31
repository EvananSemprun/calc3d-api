import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
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

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly linkInclude = {
    material: { select: { id: true, name: true } },
    printer: { select: { id: true, name: true } },
    component: { select: { id: true, name: true } },
    provider: { select: { id: true, name: true } },
  };

  list(organizationId: string, from?: string, to?: string) {
    return this.prisma.expense.findMany({
      where: { organizationId, ...dateWhere(from, to) },
      include: this.linkInclude,
      orderBy: { date: 'desc' },
    });
  }

  create(organizationId: string, dto: ExpenseCreateDto) {
    return this.prisma.expense.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        isInvestment: dto.isInvestment,
        quantity: dto.quantity ?? null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        providerId: dto.providerId || null,
        materialId: dto.materialId || null,
        printerId: dto.printerId || null,
        componentId: dto.componentId || null,
        campaignId: dto.campaignId || null,
        rate: dto.rate ?? null,
        currencyCode: dto.currencyCode ?? null,
      },
      include: this.linkInclude,
    });
  }

  async createWithDefinition(organizationId: string, dto: ExpenseWithDefinitionDto) {
    const { expense, link } = dto;
    const schemas = {
      material: MaterialSchema,
      printer: PrinterSchema,
      component: ComponentSchema,
    } as const;
    const linkField = `${link.kind}Id` as 'materialId' | 'printerId' | 'componentId';

    return this.prisma.$transaction(async (tx) => {
      const model = (tx as unknown as Record<string, CatalogDelegate>)[link.kind];
      let linkId = link.id ?? undefined;

      if (link.mode === 'new') {
        const data = schemas[link.kind].parse(link.data ?? {});
        const created = await model.create({ data: { ...data, organizationId } });
        linkId = created.id;
      } else {
        if (!linkId) throw new BadRequestException('Falta el item del catálogo');
        const owned = await model.findFirst({ where: { id: linkId, organizationId } });
        if (!owned) throw new NotFoundException('Definición no encontrada');
        if (link.referenceField != null && link.referenceValue != null) {
          await model.update({ where: { id: linkId }, data: { [link.referenceField]: link.referenceValue } });
        }
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
          providerId: expense.providerId || null,
          [linkField]: linkId,
        },
        include: this.linkInclude,
      });
    });
  }

  async update(organizationId: string, id: string, dto: ExpenseUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.category && { category: dto.category }),
        ...(dto.description && { description: dto.description }),
        ...(dto.amount != null && { amount: dto.amount }),
        ...(dto.isInvestment != null && { isInvestment: dto.isInvestment }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity ?? null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.providerId !== undefined && { providerId: dto.providerId || null }),
        ...(dto.materialId !== undefined && { materialId: dto.materialId || null }),
        ...(dto.printerId !== undefined && { printerId: dto.printerId || null }),
        ...(dto.componentId !== undefined && { componentId: dto.componentId || null }),
        ...(dto.campaignId !== undefined && { campaignId: dto.campaignId || null }),
        ...(dto.rate !== undefined && { rate: dto.rate ?? null }),
        ...(dto.currencyCode !== undefined && { currencyCode: dto.currencyCode ?? null }),
      },
      include: this.linkInclude,
    });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.expense.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.expense.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Gasto no encontrado');
  }
}
