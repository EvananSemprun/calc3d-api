import { Controller, Get, Injectable, Module, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { writeToString } from 'fast-csv';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/** Entidades tabulares que se pueden bajar como CSV. */
const CSV_ENTITIES = ['clients', 'sales', 'expenses', 'products', 'orders'] as const;
type CsvEntity = (typeof CSV_ENTITIES)[number];

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  /** Respaldo COMPLETO de la organización en un solo JSON ("mis datos son míos"). */
  async fullBackup(organizationId: string) {
    const [
      settings,
      materials,
      printers,
      components,
      clients,
      providers,
      sales,
      expenses,
      orders,
      exchangeRates,
      storeProducts,
    ] = await Promise.all([
      this.prisma.settings.findUnique({ where: { organizationId } }),
      this.prisma.material.findMany({ where: { organizationId } }),
      this.prisma.printer.findMany({ where: { organizationId } }),
      this.prisma.component.findMany({ where: { organizationId } }),
      this.prisma.client.findMany({ where: { organizationId } }),
      this.prisma.provider.findMany({ where: { organizationId } }),
      this.prisma.sale.findMany({ where: { organizationId } }),
      this.prisma.expense.findMany({ where: { organizationId } }),
      this.prisma.order.findMany({ where: { organizationId }, include: { payments: true } }),
      this.prisma.exchangeRate.findMany({ where: { organizationId } }),
      this.prisma.storeProduct.findMany({ where: { organizationId } }),
    ]);
    return {
      // La fecha la estampa el servidor; el motor no depende de esto.
      exportedAt: new Date().toISOString(),
      organizationId,
      version: 1,
      data: {
        settings,
        materials,
        printers,
        components,
        clients,
        providers,
        sales,
        expenses,
        orders,
        exchangeRates,
        storeProducts,
      },
    };
  }

  /** CSV plano de una entidad tabular. */
  async csv(organizationId: string, entity: CsvEntity): Promise<string> {
    let rows: Record<string, unknown>[] = [];
    switch (entity) {
      case 'clients': {
        const items = await this.prisma.client.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
        rows = items.map((c) => ({
          nombre: c.name,
          tipo: c.type,
          telefono: c.phone ?? '',
          rif: c.rif ?? '',
          municipio: c.municipality ?? '',
          ciudad: c.city ?? '',
          direccion: c.address ?? '',
          lat: c.lat ?? '',
          lng: c.lng ?? '',
          notas: c.notes ?? '',
        }));
        break;
      }
      case 'sales': {
        const items = await this.prisma.sale.findMany({ where: { organizationId }, orderBy: { date: 'desc' } });
        rows = items.map((s) => ({
          fecha: s.date.toISOString().slice(0, 10),
          monto: Number(s.amount),
          tipo: s.kind,
          nota: s.note ?? '',
        }));
        break;
      }
      case 'expenses': {
        const items = await this.prisma.expense.findMany({ where: { organizationId }, orderBy: { date: 'desc' } });
        rows = items.map((e) => ({
          fecha: e.date.toISOString().slice(0, 10),
          categoria: e.category,
          descripcion: e.description,
          monto: Number(e.amount),
          inversion: e.isInvestment ? 'sí' : 'no',
          cantidad: e.quantity ?? '',
        }));
        break;
      }
      case 'products': {
        // El catálogo es la ficha de tienda desde 2026-09-07: el producto
        // interno dejó de existir.
        const items = await this.prisma.storeProduct.findMany({
          where: { organizationId },
          orderBy: { name: 'asc' },
        });
        rows = items.map((p) => ({
          nombre: p.name,
          tipo: p.kind,
          precio_venta: Number(p.priceUsd),
          costo_al_publicar: p.costAtPublish == null ? '' : Number(p.costAtPublish),
          visible: p.visible ? 'sí' : 'no',
          creado: p.createdAt.toISOString().slice(0, 10),
        }));
        break;
      }
      case 'orders': {
        const items = await this.prisma.order.findMany({
          where: { organizationId },
          include: { client: { select: { name: true } } },
          orderBy: { code: 'asc' },
        });
        rows = items.map((o) => ({
          codigo: o.code,
          cliente: o.client?.name ?? '',
          estado: o.status,
          entrega: o.deliveryDate ? o.deliveryDate.toISOString().slice(0, 10) : '',
          creado: o.createdAt.toISOString().slice(0, 10),
        }));
        break;
      }
    }
    if (rows.length === 0) return '';
    return writeToString(rows, { headers: true });
  }
}

@Controller('backup')
@UseGuards(JwtAuthGuard)
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get('all.json')
  async all(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const backup = await this.service.fullBackup(user.organizationId);
    const json = JSON.stringify(backup, null, 2);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="calc3d-respaldo.json"',
    });
    res.end(json);
  }

  @Get('csv/:entity')
  async csv(@CurrentUser() user: AuthUser, @Param('entity') entity: string, @Res() res: Response) {
    if (!CSV_ENTITIES.includes(entity as CsvEntity)) {
      res.status(404).json({ message: 'Entidad no exportable' });
      return;
    }
    const csv = await this.service.csv(user.organizationId, entity as CsvEntity);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="calc3d-${entity}.csv"`,
    });
    res.end(csv);
  }
}

@Module({
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
