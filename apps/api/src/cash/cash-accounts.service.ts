import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CashAccountUpsertDto } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CUENTAS donde vive la plata.
 *
 * ⚠️ Hoy solo se concilia la cuenta PRINCIPAL. Ninguna venta, gasto, abono ni
 * cuota lleva `accountId`, así que el saldo esperado es uno solo para todo el
 * negocio: compararlo contra una segunda cuenta daría una diferencia inventada.
 * Registrar más cuentas sirve igual (son la base de la multicuenta real) y la
 * pantalla lo explica, pero el número falso no se muestra.
 */
@Injectable()
export class CashAccountsService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.cashAccount.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  private async mine(organizationId: string, id: string) {
    const acc = await this.prisma.cashAccount.findFirst({ where: { id, organizationId } });
    if (!acc) throw new NotFoundException('No existe esa cuenta');
    return acc;
  }

  /**
   * Normaliza el trío compartida / con-quién / atribución, y comprueba que la
   * contraparte sea de ESTA organización: sin eso, un id ajeno en el cuerpo
   * ataría la cuenta a la contraparte de otro negocio y `confirm()` le
   * atribuiría faltantes a un desconocido.
   */
  private async datos(organizationId: string, dto: CashAccountUpsertDto) {
    let sharedWithId: string | null = null;
    if (dto.shared) {
      const cp = await this.prisma.counterparty.findFirst({
        where: { id: dto.sharedWithId!, organizationId },
      });
      if (!cp) throw new NotFoundException('No existe esa contraparte');
      sharedWithId = cp.id;
    }
    return {
      name: dto.name,
      kind: dto.kind,
      currency: dto.currency,
      shared: dto.shared,
      sharedWithId,
      // Una cuenta que no se comparte no le puede atribuir faltantes a nadie.
      autoAttributeShortfall: dto.shared ? dto.autoAttributeShortfall : false,
      active: dto.active,
    };
  }

  async create(organizationId: string, dto: CashAccountUpsertDto) {
    const datos = await this.datos(organizationId, dto);
    // La primera nace principal; las demás no, porque solo puede haber una.
    const cuantas = await this.prisma.cashAccount.count({ where: { organizationId } });
    return this.prisma.cashAccount.create({
      data: { organizationId, ...datos, isDefault: cuantas === 0 },
    });
  }

  async update(organizationId: string, id: string, dto: CashAccountUpsertDto) {
    await this.mine(organizationId, id);
    const datos = await this.datos(organizationId, dto);
    return this.prisma.cashAccount.update({ where: { id }, data: datos });
  }

  /** Una sola principal: desmarcar y marcar van juntas o no van. */
  async setDefault(organizationId: string, id: string) {
    await this.mine(organizationId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.cashAccount.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.cashAccount.update({ where: { id }, data: { isDefault: true } });
    });
    return this.list(organizationId);
  }

  async remove(organizationId: string, id: string) {
    const acc = await this.mine(organizationId, id);

    const conciliaciones = await this.prisma.cashReconciliation.count({
      where: { organizationId, accountId: id },
    });
    if (conciliaciones > 0) {
      throw new ConflictException(
        `${acc.name} tiene ${conciliaciones} conciliación(es). Desactivala en vez de borrarla.`,
      );
    }
    const cuantas = await this.prisma.cashAccount.count({ where: { organizationId } });
    if (cuantas <= 1) {
      throw new ConflictException('Es la única cuenta: la conciliación la necesita.');
    }

    await this.prisma.cashAccount.delete({ where: { id } });
    return this.list(organizationId);
  }
}
