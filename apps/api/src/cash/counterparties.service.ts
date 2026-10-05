import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CounterpartyUpsertDto } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CONTRAPARTES: el dueño, los socios y los prestamistas externos.
 *
 * Existe para que "Le debe a Vanan" sea "Le debe a <nombre>" y para que un
 * negocio con dos socios lleve la deuda de cada uno por separado.
 *
 * ⚠️ Borrar una contraparte con historial destruiría deuda, así que las guardas
 * de `remove` no son cosméticas. La salida para una que ya no participa es
 * DESACTIVARLA, igual que una ficha de filamento descontinuada.
 */
@Injectable()
export class CounterpartiesService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.counterparty.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  private async mine(organizationId: string, id: string) {
    const cp = await this.prisma.counterparty.findFirst({ where: { id, organizationId } });
    if (!cp) throw new NotFoundException('No existe esa contraparte');
    return cp;
  }

  async create(organizationId: string, dto: CounterpartyUpsertDto) {
    // La primera de la organización nace por defecto; las demás no, porque el
    // índice único parcial `Counterparty_org_default_key` solo admite una y
    // reventaría con un error de constraint en vez de un mensaje útil.
    const cuantas = await this.prisma.counterparty.count({ where: { organizationId } });
    return this.prisma.counterparty.create({
      data: {
        organizationId,
        name: dto.name,
        kind: dto.kind,
        active: dto.active,
        notes: dto.notes ?? null,
        isDefault: cuantas === 0,
      },
    });
  }

  async update(organizationId: string, id: string, dto: CounterpartyUpsertDto) {
    const cp = await this.mine(organizationId, id);

    // ⚠️ Desactivar esquivaría la guarda de `remove`: la contraparte seguiría
    // existiendo —así que `summary()` no tira 404— pero el dueño la ve dada de
    // baja y la caja le sigue atribuyendo la deuda. Mismo motivo, misma guarda.
    const seDesactiva = cp.active && !dto.active;
    const dejaDeSerPropietaria = cp.kind === 'OWNER' && dto.kind !== 'OWNER';
    if (seDesactiva || dejaDeSerPropietaria) {
      await this.exigirOtraPropietaria(organizationId, cp);
    }

    return this.prisma.counterparty.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        active: dto.active,
        notes: dto.notes ?? null,
      },
    });
  }

  /**
   * La caja necesita SIEMPRE una contraparte propietaria activa: es a quien le
   * atribuye la deuda. Sin ella, `CashService.summary()` deja de poder decir a
   * quién se le debe.
   */
  private async exigirOtraPropietaria(
    organizationId: string,
    cp: { id: string; kind: string; name: string },
  ) {
    if (cp.kind !== 'OWNER' || !(await this.esLaUnicaPropietaria(organizationId, cp.id))) return;
    throw new ConflictException(
      `${cp.name} es la única contraparte propietaria activa: la caja la necesita para saber a quién se le debe.`,
    );
  }

  private async esLaUnicaPropietaria(organizationId: string, id: string) {
    const otras = await this.prisma.counterparty.count({
      where: { organizationId, kind: 'OWNER', active: true, id: { not: id } },
    });
    return otras === 0;
  }

  /** Una sola por defecto: desmarcar y marcar van juntas o no van. */
  async setDefault(organizationId: string, id: string) {
    const cp = await this.mine(organizationId, id);
    // Poner por defecto una desactivada deja la caja atribuyéndole la deuda a
    // alguien que el dueño dio de baja.
    if (!cp.active) {
      throw new ConflictException(`${cp.name} está desactivada: activala antes de ponerla por defecto.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.counterparty.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.counterparty.update({ where: { id }, data: { isDefault: true } });
    });
    return this.list(organizationId);
  }

  async remove(organizationId: string, id: string) {
    const cp = await this.mine(organizationId, id);

    const [movimientos, cuentas] = await Promise.all([
      this.prisma.ownerMovement.count({ where: { organizationId, counterpartyId: id } }),
      this.prisma.cashAccount.count({ where: { organizationId, sharedWithId: id } }),
    ]);
    if (movimientos > 0) {
      throw new ConflictException(
        `${cp.name} tiene ${movimientos} movimiento(s) de caja. Desactivala en vez de borrarla.`,
      );
    }
    if (cuentas > 0) {
      throw new ConflictException(
        `${cp.name} es con quien se comparte una cuenta. Cambiá eso antes de borrarla.`,
      );
    }
    if (cp.kind === 'OWNER') {
      const duenos = await this.prisma.counterparty.count({
        where: { organizationId, kind: 'OWNER' },
      });
      if (duenos <= 1) {
        throw new ConflictException(
          'Es la única contraparte propietaria: la caja la necesita para saber a quién se le debe.',
        );
      }
    }

    // Mismo cuidado que en las cuentas: borrar la que estaba por defecto sin
    // traspasar el título deja a la organización sin ninguna. Borrar primero y
    // promover después, o el índice único parcial rechaza el instante con dos.
    await this.prisma.$transaction(async (tx) => {
      await tx.counterparty.delete({ where: { id } });
      if (!cp.isDefault) return;
      const siguiente = await tx.counterparty.findFirst({
        where: { organizationId },
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      });
      if (siguiente) {
        await tx.counterparty.update({ where: { id: siguiente.id }, data: { isDefault: true } });
      }
    });

    return this.list(organizationId);
  }
}
