import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  InternalServerErrorException,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ComponentSchema,
  UnirFichaSchema,
  costoPorUnidadDeInsumo,
  paquetePrecioDesdeCompra,
  type ComponentDto,
  type UnionVista,
  type UnirFichaDto,
} from '@calc3d/shared';
import { exigirAfectadas, exigirAmbasPropias, exigirFichasDistintas, renombrarEnCosteo } from '../common/unir-fichas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ComponentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.component.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  create(organizationId: string, dto: ComponentDto) {
    return this.prisma.component.create({ data: { ...dto, organizationId } });
  }

  async update(organizationId: string, id: string, dto: Partial<ComponentDto>) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.component.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.component.delete({ where: { id } });
    return { ok: true };
  }

  /** Lo que unir `origenId` dentro de `destinoId` movería, sin escribir (vista previa de la confirmación). */
  async vistaDeUnion(organizationId: string, origenId: string, destinoId: string): Promise<UnionVista> {
    exigirFichasDistintas(origenId, destinoId);
    return (await this.planearUnion(this.prisma, organizationId, origenId, destinoId)).vista;
  }

  /**
   * UNIR dos insumos duplicados (13/11). Toda escritura lleva organizationId en el where y se
   * comprueba su count (misma regla que MaterialsService.setStatusBatch): segunda capa tras la lectura acotada.
   * Mismas reglas que unir filamentos
   * (`MaterialsService.unir`): repunta sin tocar montos ni fechas, UNA transacción,
   * el origen se borra al final y solo si nada quedó apuntándole.
   *
   * El costo por unidad queda en el de la ÚLTIMA compra del conjunto (decisión del
   * dueño: el precio guardado a mano no sale de ninguna compra). Se conserva el
   * tamaño de paquete del destino y se ajusta el precio del paquete.
   */
  async unir(organizationId: string, origenId: string, dto: UnirFichaDto): Promise<UnionVista> {
    const destinoId = dto.destinoId;
    exigirFichasDistintas(origenId, destinoId);
    return this.prisma.$transaction(async (tx) => {
      const db = tx as Prisma.TransactionClient;
      const { vista, nuevoPaquete, costeosPorRenombrar } = await this.planearUnion(db, organizationId, origenId, destinoId);

      await db.expense.updateMany({ where: { componentId: origenId, organizationId }, data: { componentId: destinoId } });
      await db.purchaseInvoiceLine.updateMany({
        where: { componentId: origenId, invoice: { organizationId } },
        data: { componentId: destinoId },
      });
      // El recosteo busca la línea POR NOMBRE: sin esto el costeo de cada ficha de la
      // tienda que usaba el insumo de origen quedaría «sin encontrar» y con un precio viejo.
      for (const p of costeosPorRenombrar) {
        exigirAfectadas(
          await db.storeProduct.updateMany({ where: { id: p.id, organizationId }, data: { input: p.input as Prisma.InputJsonValue } }),
          1,
          'el costeo de un producto',
        );
      }
      if (nuevoPaquete !== null) {
        exigirAfectadas(
          await db.component.updateMany({ where: { id: destinoId, organizationId }, data: { packagePrice: nuevoPaquete } }),
          1,
          'el precio del destino',
        );
      }

      const quedan = await Promise.all([
        db.expense.count({ where: { componentId: origenId } }),
        db.purchaseInvoiceLine.count({ where: { componentId: origenId } }),
      ]);
      if (quedan.some((n) => n > 0)) {
        throw new InternalServerErrorException('Quedó historial apuntando al insumo de origen: no se unió nada');
      }
      exigirAfectadas(
        await db.component.deleteMany({ where: { id: origenId, organizationId } }),
        1,
        'el borrado del insumo de origen',
      );
      return vista;
    });
  }

  private async planearUnion(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    origenId: string,
    destinoId: string,
  ) {
    const encontradas = await db.component.findMany({ where: { id: { in: [origenId, destinoId] }, organizationId } });
    const { origen, destino } = exigirAmbasPropias(encontradas, origenId, destinoId, 'Insumo no encontrado');
    const [compras, lineasDeFactura, ultima] = await Promise.all([
      db.expense.count({ where: { componentId: origenId, organizationId } }),
      db.purchaseInvoiceLine.count({ where: { componentId: origenId, invoice: { organizationId } } }),
      db.expense.findFirst({
        where: { organizationId, componentId: { in: [origenId, destinoId] }, quantity: { gt: 0 } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { amount: true, quantity: true },
      }),
    ]);
    const productos = await db.storeProduct.findMany({ where: { organizationId }, select: { id: true, input: true } });
    const costeosPorRenombrar = productos
      .map((p) => ({ id: p.id, ...renombrarEnCosteo(p.input, 'insumo', origen.name, destino.name) }))
      .filter((p) => p.cambios > 0);
    const antes = costoPorUnidadDeInsumo(Number(destino.packagePrice), destino.unitsPerPackage);
    const nuevoPaquete = ultima?.quantity
      ? paquetePrecioDesdeCompra(Number(ultima.amount), ultima.quantity, destino.unitsPerPackage)
      : null;
    const despues = nuevoPaquete === null ? antes : costoPorUnidadDeInsumo(nuevoPaquete, destino.unitsPerPackage);
    const vista: UnionVista = {
      origen: { id: origen.id, name: origen.name },
      destino: { id: destino.id, name: destino.name },
      compras,
      lineasDeFactura,
      productos: costeosPorRenombrar.length,
      conteos: 0,
      conteosQueSeSuman: 0,
      precio: { antes, despues, deLaUltimaCompra: nuevoPaquete !== null },
    };
    return { vista, nuevoPaquete, costeosPorRenombrar };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.component.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Componente no encontrado');
  }
}

@Controller('components')
@UseGuards(JwtAuthGuard)
export class ComponentsController {
  constructor(private readonly service: ComponentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(ComponentSchema)) dto: ComponentDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ComponentSchema.partial())) dto: Partial<ComponentDto>,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Get(':id/unir')
  vistaDeUnion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('destinoId') destinoId: string) {
    return this.service.vistaDeUnion(user.organizationId, id, destinoId ?? '');
  }

  /** Unir este insumo dentro de otro. PATCH: es una acción sobre fichas existentes, no un alta. */
  @Patch(':id/unir')
  unir(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UnirFichaSchema)) dto: UnirFichaDto,
  ) {
    return this.service.unir(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [ComponentsController],
  providers: [ComponentsService],
})
export class ComponentsModule {}
