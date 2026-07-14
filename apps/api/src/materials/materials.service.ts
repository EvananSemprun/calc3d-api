import { Injectable, NotFoundException } from '@nestjs/common';
import type { MaterialDto } from '@calc3d/shared';
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

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.material.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.material.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Material no encontrado');
  }
}
