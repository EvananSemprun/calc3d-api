import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { monthKey, stockTotal, type MaterialCorrectionDto, type MaterialStatusUpdateDto } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Las fichas con sus compras (para Gastos y el conteo de rollos) y
   * `outAtLastClose`: el mes (`AAAA-MM`) si la ficha cerró el último mes cerrado en
   * 0 y no se volvió a comprar después; si no, null. La calculadora lo usa para
   * avisar "0 al cierre de agosto" sin ocultarla.
   *
   * "Estaba al cierre" = tiene fila de conteo en ese mes: cerrar escribe TODAS las
   * fichas. No sirve `createdAt`: las fichas se importaron después de sus compras.
   */
  async list(organizationId: string) {
    const [materiales, ultimoCierre] = await Promise.all([
      this.prisma.material.findMany({
        where: { organizationId },
        // Incluye las compras (gastos) para calcular rollos y filtrar por fecha de compra.
        include: { expenses: { select: { quantity: true, date: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMonth.findFirst({
        where: { organizationId, closedAt: { not: null } },
        orderBy: { month: 'desc' },
        select: { month: true },
      }),
    ]);
    if (!ultimoCierre) return materiales.map((m) => ({ ...m, outAtLastClose: null as string | null }));

    const mes = ultimoCierre.month;
    const mesSiguiente = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1));
    const conteos = await this.prisma.stockCount.findMany({
      where: { organizationId, month: mes },
      select: { materialId: true, sealed: true, inUse: true, running: true },
    });
    const totalAlCierre = new Map(conteos.map((c) => [c.materialId, stockTotal(c)]));
    const clave = monthKey(mes);

    return materiales.map((m) => {
      const enCero = totalAlCierre.get(m.id) === 0;
      const compradaDespues = m.expenses.some((e) => (e.quantity ?? 0) > 0 && e.date >= mesSiguiente);
      return { ...m, outAtLastClose: enCero && !compradaDespues ? clave : (null as string | null) };
    });
  }

  async update(organizationId: string, id: string, dto: MaterialCorrectionDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: dto });
  }

  /**
   * Descontinuar o reactivar. Una ficha descontinuada no se ofrece al cotizar ni
   * entra en la reposición, pero conserva sus compras y conteos: es la salida para
   * una ficha con compras o conteos, que no se puede borrar.
   */
  async setStatus(organizationId: string, id: string, dto: MaterialStatusUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: { status: dto.status } });
  }

  /**
   * Borrar solo una ficha SIN historial (2026-09-14). Con compras, borrarla las deja
   * huérfanas (`onDelete: SetNull`); con conteos, los borra en cascada — y un
   * conteo de un mes cerrado es un registro que el dueño dio por final. Con
   * historial, la salida es descontinuarla. Sin candado contra un cierre que se
   * cuele en el medio: carrera aceptada (app de un solo dueño).
   */
  async remove(organizationId: string, id: string) {
    const ficha = await this.ensureOwned(organizationId, id);

    const [compras, conteos] = await Promise.all([
      this.prisma.expense.count({ where: { materialId: id, organizationId } }),
      this.prisma.stockCount.count({ where: { materialId: id, organizationId } }),
    ]);
    if (compras > 0 || conteos > 0) {
      throw new ConflictException(
        ficha.status === 'DISCONTINUED'
          ? 'Tiene compras o conteos registrados: se conserva descontinuada.'
          : 'Tiene compras o conteos registrados. Descontinuala en vez de borrarla.',
      );
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
