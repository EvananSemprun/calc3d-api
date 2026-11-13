import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { monthKey, purchaseCostPerRoll, stockTotal, type MaterialCorrectionDto, type MaterialStatus, type MaterialStatusBatchDto, type MaterialStatusUpdateDto, type UnionVista, type UnirFichaDto } from '@calc3d/shared';
import { costeoUsaFicha, rechazoDeBorrado, tieneHistorial } from '../common/borrar-ficha';
import { exigirAfectadas, exigirAmbasPropias, exigirFichasDistintas, renombrarEnCosteo } from '../common/unir-fichas';
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
   * Cambiar el estado de VARIAS fichas (13/11: «descontinuar toda la marca»).
   *
   * ⚠️ **Atómico a propósito.** Si UNA sola ficha no es de esta organización, se
   * rechaza TODO el lote y no se escribe nada: aplicar «las que sí» dejaría al
   * dueño creyendo que descontinuó la marca entera. Y la organización va también
   * en el `updateMany`, no solo en la comprobación: si alguien quita una de las
   * dos, la otra sigue cerrando el IDOR.
   */
  async setStatusBatch(organizationId: string, dto: MaterialStatusBatchDto) {
    const ids = [...new Set(dto.ids)];
    const propias = await this.prisma.material.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true },
    });
    if (propias.length !== ids.length) throw new NotFoundException('Material no encontrado');
    await this.prisma.material.updateMany({
      where: { id: { in: ids }, organizationId },
      data: { status: dto.status },
    });
    return { updated: ids.length };
  }

  /**
   * Borrar solo una ficha SIN historial (2026-09-14). Con compras, borrarla las deja
   * huérfanas (`onDelete: SetNull`); con conteos, los borra en cascada — y un
   * conteo de un mes cerrado es un registro que el dueño dio por final; con líneas de
   * factura la base lo impide (`Restrict`, antes un 500 mudo); y los productos de la
   * tienda la nombran en su costeo, así que borrarla los deja con líneas «sin
   * encontrar». Desde el 13/11 el rechazo dice CUÁNTAS y CUÁLES y ofrece la salida
   * (`rechazoDeBorrado`). Sin candado contra un cierre que se cuele en el medio:
   * carrera aceptada (app de un solo dueño).
   */
  async remove(organizationId: string, id: string) {
    const ficha = await this.prisma.material.findFirst({ where: { id, organizationId }, select: { name: true, status: true } });
    if (!ficha) throw new NotFoundException('Material no encontrado');

    const [compras, lineasDeFactura, conteos, productos] = await Promise.all([
      this.prisma.expense.count({ where: { materialId: id, organizationId } }),
      this.prisma.purchaseInvoiceLine.count({ where: { materialId: id, invoice: { organizationId } } }),
      this.prisma.stockCount.count({ where: { materialId: id, organizationId } }),
      this.prisma.storeProduct.findMany({ where: { organizationId }, select: { name: true, input: true } }),
    ]);
    const historial = {
      compras,
      lineasDeFactura,
      conteos,
      productos: productos.filter((p) => costeoUsaFicha(p.input, 'material', ficha.name)).map((p) => p.name),
    };
    if (tieneHistorial(historial)) {
      throw rechazoDeBorrado({ nombre: ficha.name, tipo: 'material', estado: ficha.status as MaterialStatus }, historial);
    }

    // La organización va TAMBIÉN en la escritura (segunda capa) y se mira el count:
    // deleteMany no lanza si no borra nada.
    exigirAfectadas(await this.prisma.material.deleteMany({ where: { id, organizationId } }), 1, 'el borrado de la ficha');
    return { ok: true };
  }

  /**
   * Lo que unir `origenId` dentro de `destinoId` va a mover, SIN escribir nada. Es
   * la vista previa de la confirmación: la misma `planearUnion` que usa `unir`, así
   * que el número que el dueño confirma es el que se ejecuta.
   */
  async vistaDeUnion(organizationId: string, origenId: string, destinoId: string): Promise<UnionVista> {
    exigirFichasDistintas(origenId, destinoId);
    return (await this.planearUnion(this.prisma, organizationId, origenId, destinoId)).vista;
  }

  /**
   * UNIR dos fichas duplicadas (13/11): todo lo de `origenId` pasa a `destinoId` y
   * la de origen se borra.
   *
   * ⚠️ **Repunta, no reescribe.** Solo cambia a qué ficha apunta cada compra,
   * línea de factura y conteo; ningún monto ni fecha se toca. Lo único que se
   * recalcula es el precio de la ficha que sobrevive, desde la ÚLTIMA compra del
   * conjunto unido (la regla de siempre: el precio sigue a la última compra).
   *
   * ⚠️ **Una sola transacción**: una unión a medias deja compras apuntando a una
   * ficha borrada. Y la de origen se borra AL FINAL, después de comprobar que
   * nada quedó apuntándole; si algo quedó, se aborta todo en vez de borrar.
   *
   * ⚠️ Toda escritura lleva organizationId en el where (updateMany/deleteMany) y se
   * comprueba su count: segunda capa tras la lectura acotada, la misma regla que
   * setStatusBatch. Si alguien toca la lectura, la escritura sigue cerrada.
   *
   * No cambia el estado del destino (una descontinuada sigue descontinuada): unir
   * no es comprar, así que no pasa por `estadoTrasComprar`.
   */
  async unir(organizationId: string, origenId: string, dto: UnirFichaDto): Promise<UnionVista> {
    const destinoId = dto.destinoId;
    exigirFichasDistintas(origenId, destinoId);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as Prisma.TransactionClient;
      const { vista, conteosPorMover, costeosPorRenombrar } = await this.planearUnion(db, organizationId, origenId, destinoId);

      await db.expense.updateMany({ where: { materialId: origenId, organizationId }, data: { materialId: destinoId } });
      await db.purchaseInvoiceLine.updateMany({
        where: { materialId: origenId, invoice: { organizationId } },
        data: { materialId: destinoId },
      });
      // El recosteo busca la línea POR NOMBRE: sin esto el costeo de cada ficha de la
      // tienda que usaba la de origen quedaría «sin encontrar» y con un precio viejo.
      for (const p of costeosPorRenombrar) {
        exigirAfectadas(
          await db.storeProduct.updateMany({ where: { id: p.id, organizationId }, data: { input: p.input as Prisma.InputJsonValue } }),
          1,
          'el costeo de un producto',
        );
      }
      for (const c of conteosPorMover) {
        if (c.suma) {
          // El destino ya contó ese mes: los rollos son de una sola ficha ahora, se suman.
          exigirAfectadas(
            await db.stockCount.updateMany({
              where: { id: c.suma.id, organizationId },
              data: {
                sealed: c.suma.sealed + c.sealed,
                inUse: c.suma.inUse + c.inUse,
                running: c.suma.running + c.running,
                needsBrandCheck: c.suma.needsBrandCheck || c.needsBrandCheck,
              },
            }),
            1,
            'la suma de un conteo',
          );
          exigirAfectadas(await db.stockCount.deleteMany({ where: { id: c.id, organizationId } }), 1, 'el borrado de un conteo');
        } else {
          exigirAfectadas(
            await db.stockCount.updateMany({ where: { id: c.id, organizationId }, data: { materialId: destinoId } }),
            1,
            'el repunte de un conteo',
          );
        }
      }
      if (vista.precio.deLaUltimaCompra) {
        await db.material.updateMany({
          where: { id: destinoId, organizationId },
          data: { rollPrice: vista.precio.despues },
        });
      }

      const quedan = await Promise.all([
        db.expense.count({ where: { materialId: origenId } }),
        db.purchaseInvoiceLine.count({ where: { materialId: origenId } }),
        db.stockCount.count({ where: { materialId: origenId } }),
      ]);
      if (quedan.some((n) => n > 0)) {
        throw new InternalServerErrorException('Quedó historial apuntando a la ficha de origen: no se unió nada');
      }
      exigirAfectadas(
        await db.material.deleteMany({ where: { id: origenId, organizationId } }),
        1,
        'el borrado de la ficha de origen',
      );
      return vista;
    });
  }

  /** Lee lo que una unión movería; sirve a la vista previa y a la unión (con `db` = la transacción). */
  private async planearUnion(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    origenId: string,
    destinoId: string,
  ) {
    const encontradas = await db.material.findMany({
      where: { id: { in: [origenId, destinoId] }, organizationId },
    });
    const { origen, destino } = exigirAmbasPropias(encontradas, origenId, destinoId, 'Material no encontrado');
    // El costo por gramo de cada compra pasada sale de los gramos de SU ficha: unir
    // rollos de distinto peso reescribiría ese costo (por eso tampoco se pueden corregir).
    if (origen.rollGrams !== destino.rollGrams) {
      throw new BadRequestException(
        `Los rollos pesan distinto (${origen.rollGrams} g y ${destino.rollGrams} g): unirlas cambiaría el costo por gramo de las compras pasadas`,
      );
    }

    const [compras, lineasDeFactura, conteosDeLasDos, ultima] = await Promise.all([
      db.expense.count({ where: { materialId: origenId, organizationId } }),
      db.purchaseInvoiceLine.count({ where: { materialId: origenId, invoice: { organizationId } } }),
      db.stockCount.findMany({ where: { materialId: { in: [origenId, destinoId] }, organizationId } }),
      db.expense.findFirst({
        where: { organizationId, materialId: { in: [origenId, destinoId] }, quantity: { gt: 0 } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { amount: true, quantity: true },
      }),
    ]);

    const productos = await db.storeProduct.findMany({ where: { organizationId }, select: { id: true, input: true } });
    const costeosPorRenombrar = productos
      .map((p) => ({ id: p.id, ...renombrarEnCosteo(p.input, 'material', origen.name, destino.name) }))
      .filter((p) => p.cambios > 0);

    const delDestino = new Map(conteosDeLasDos.filter((c) => c.materialId === destinoId).map((c) => [c.month.getTime(), c]));
    const conteosPorMover = conteosDeLasDos
      .filter((c) => c.materialId === origenId)
      .map((c) => ({ ...c, suma: delDestino.get(c.month.getTime()) ?? null }));

    const antes = Number(destino.rollPrice);
    const deLaUltimaCompra = !!ultima?.quantity;
    const despues = ultima?.quantity ? purchaseCostPerRoll(Number(ultima.amount), ultima.quantity) : antes;

    const vista: UnionVista = {
      origen: { id: origen.id, name: origen.name },
      destino: { id: destino.id, name: destino.name },
      compras,
      lineasDeFactura,
      productos: costeosPorRenombrar.length,
      conteos: conteosPorMover.length,
      conteosQueSeSuman: conteosPorMover.filter((c) => c.suma).length,
      precio: { antes, despues, deLaUltimaCompra },
    };
    return { vista, conteosPorMover, costeosPorRenombrar };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.material.findFirst({ where: { id, organizationId }, select: { status: true } });
    if (!found) throw new NotFoundException('Material no encontrado');
    return found;
  }
}
