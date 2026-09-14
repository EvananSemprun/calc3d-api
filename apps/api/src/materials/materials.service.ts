import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MaterialDto, MaterialStatusUpdateDto } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.material.findMany({
      where: { organizationId },
      // Incluye las compras (gastos) para calcular rollos y filtrar por fecha de compra.
      include: { expenses: { select: { quantity: true, date: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(organizationId: string, dto: MaterialDto) {
    return this.prisma.material.create({ data: { ...dto, organizationId } });
  }

  async update(organizationId: string, id: string, dto: Partial<MaterialDto>) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: dto });
  }

  /**
   * Descontinuar o reactivar. Una ficha descontinuada no se ofrece al cotizar ni
   * entra en la reposición, pero conserva sus compras y conteos: es la salida para
   * una ficha que no se puede borrar porque tiene conteos en meses cerrados.
   */
  async setStatus(organizationId: string, id: string, dto: MaterialStatusUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: { status: dto.status } });
  }

  async remove(organizationId: string, id: string) {
    const ficha = await this.ensureOwned(organizationId, id);

    // Borrar la ficha borra en CASCADA sus conteos: si alguno es de un mes
    // cerrado, borrarla modificaría un registro que el dueño dio por final.
    // Sin candado: un cierre del mes que se cuele entre este chequeo y el
    // borrado es una carrera aceptada (app de un solo dueño).
    const cerrados = await this.prisma.stockMonth.findMany({
      where: { organizationId, closedAt: { not: null } },
      select: { month: true },
    });
    if (cerrados.length > 0) {
      const conteo = await this.prisma.stockCount.findFirst({
        where: { materialId: id, month: { in: cerrados.map((c) => c.month) } },
        orderBy: { month: 'desc' },
        select: { month: true },
      });
      if (conteo) {
        const mes = conteo.month.toLocaleDateString('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        // Sugerir descontinuar una ficha ya descontinuada es una salida que no existe.
        const salida =
          ficha.status === 'DISCONTINUED'
            ? 'Ya está descontinuada: se conserva para no perder esos conteos.'
            : 'Descontinuala en vez de borrarla.';
        throw new ConflictException(`Esta ficha tiene conteos en meses cerrados (${mes}). ${salida}`);
      }
    }

    await this.prisma.material.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.material.findFirst({ where: { id, organizationId }, select: { status: true } });
    if (!found) throw new NotFoundException('Material no encontrado');
    return found;
  }
}
