import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseVoidSchema,
  invoiceStatus,
  invoiceTotals,
  type PurchaseInvoicePaymentDto,
  type PurchaseInvoiceUpsertDto,
  type PurchaseVoidDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const n = (x: unknown) => Number(x);

/** Lo que se trae siempre: sin las líneas y los abonos no hay cuentas. */
const incluir = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: {
      material: { select: { id: true, name: true } },
      printer: { select: { id: true, name: true } },
    },
  },
  payments: {
    orderBy: { date: 'asc' },
    include: { counterparty: { select: { id: true, name: true } } },
  },
} as const;

type FacturaCruda = Awaited<ReturnType<PurchaseInvoicesService['todas']>>[number];

/**
 * FACTURAS Y ENCARGOS DE COMPRA de filamento e impresoras.
 *
 * ⚠️ **Los abonos son la PLATA; la recepción es la MERCADERÍA.** Acá vive la
 * primera mitad: cargar lo pedido y abonarlo. Caja cuenta los abonos (ver
 * `cash.service.ts`); el gasto nace al recibir, y nace marcado para que su
 * plata no se cuente dos veces.
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  private todas(organizationId: string) {
    return this.prisma.purchaseInvoice.findMany({
      where: { organizationId },
      include: incluir,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * La factura como la ve la pantalla: con sus cuentas DERIVADAS.
   *
   * Nada de esto se guarda. Un total almacenado se desincroniza de sus partes
   * el día que alguien corrige una línea.
   */
  private serializar(f: FacturaCruda) {
    const lines = f.lines.map((l) => ({
      id: l.id,
      materialId: l.materialId,
      materialName: l.material?.name ?? null,
      printerId: l.printerId,
      printerName: l.printer?.name ?? null,
      nombreNuevo: l.nombreNuevo,
      quantity: l.quantity,
      unitPrice: n(l.unitPrice),
      received: l.received,
      /** Lo que falta llegar de ESTA línea. */
      porRecibir: Math.max(l.quantity - l.received, 0),
    }));
    const payments = f.payments.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      amount: n(p.amount),
      counterpartyId: p.counterpartyId,
      counterparty: p.counterparty,
      accountId: p.accountId,
      note: p.note,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidReason: p.voidReason,
    }));

    const totals = invoiceTotals(
      lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, received: l.received })),
      payments.map((p) => ({ amount: p.amount, voided: p.voidedAt != null })),
    );

    return {
      id: f.id,
      date: f.date.toISOString(),
      expectedAt: f.expectedAt?.toISOString() ?? null,
      reference: f.reference,
      notes: f.notes,
      supplier: f.supplier,
      voidedAt: f.voidedAt?.toISOString() ?? null,
      voidReason: f.voidReason,
      source: f.source,
      lines,
      payments,
      ...totals,
      status: invoiceStatus(totals),
    };
  }

  async list(organizationId: string) {
    return (await this.todas(organizationId)).map((f) => this.serializar(f));
  }

  async get(organizationId: string, id: string) {
    return this.serializar(await this.mia(organizationId, id));
  }

  private async mia(organizationId: string, id: string) {
    const f = await this.prisma.purchaseInvoice.findFirst({
      where: { id, organizationId },
      include: incluir,
    });
    if (!f) throw new NotFoundException('No existe esa factura');
    return f;
  }

  /**
   * Las fichas y el proveedor viajan en el body: **se validan contra la
   * organización**. Sin esto, el id de otro negocio ataría la factura a su
   * contacto o a su filamento, y el nombre ajeno saldría a la vista.
   */
  private async validarReferencias(organizationId: string, dto: PurchaseInvoiceUpsertDto) {
    if (dto.supplierId) {
      const prov = await this.prisma.client.findFirst({
        where: { id: dto.supplierId, organizationId, type: 'SUPPLIER' },
      });
      if (!prov) throw new NotFoundException('No existe ese proveedor');
    }
    for (const l of dto.lines) {
      if (l.materialId) {
        const m = await this.prisma.material.findFirst({ where: { id: l.materialId, organizationId } });
        if (!m) throw new NotFoundException('No existe ese filamento');
      }
      if (l.printerId) {
        const p = await this.prisma.printer.findFirst({ where: { id: l.printerId, organizationId } });
        if (!p) throw new NotFoundException('No existe esa impresora');
      }
    }
  }

  private datosDeLinea(dto: PurchaseInvoiceUpsertDto) {
    return dto.lines.map((l) => ({
      materialId: l.materialId || null,
      printerId: l.printerId || null,
      nombreNuevo: l.nombreNuevo || null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));
  }

  async create(organizationId: string, dto: PurchaseInvoiceUpsertDto) {
    await this.validarReferencias(organizationId, dto);
    const f = await this.prisma.purchaseInvoice.create({
      data: {
        organizationId,
        date: new Date(dto.date),
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        supplierId: dto.supplierId || null,
        reference: dto.reference || null,
        notes: dto.notes || null,
        lines: { create: this.datosDeLinea(dto) },
      },
      include: incluir,
    });
    return this.serializar(f);
  }

  /**
   * Corregir la factura. Las líneas se reemplazan enteras.
   *
   * ⚠️ **Una línea con algo recibido NO se puede borrar ni reemplazar**: su
   * recepción ya creó un gasto y movió el inventario. Rehacerla dejaría ese
   * gasto apuntando a una línea que ya no existe, y el `ON DELETE SET NULL`
   * lo volvería un gasto normal — que SÍ mueve la caja. Doble carga por la
   * puerta de atrás.
   */
  async update(organizationId: string, id: string, dto: PurchaseInvoiceUpsertDto) {
    const actual = await this.mia(organizationId, id);
    if (actual.voidedAt) throw new BadRequestException('La factura está anulada');
    const recibidas = actual.lines.filter((l) => l.received > 0);
    if (recibidas.length) {
      throw new BadRequestException(
        `Ya recibiste ${recibidas.length} línea(s) de esta factura: corregir las líneas dejaría esas compras colgando. Anulá la factura y cargala de nuevo.`,
      );
    }
    await this.validarReferencias(organizationId, dto);

    const f = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.purchaseInvoice.update({
        where: { id },
        data: {
          date: new Date(dto.date),
          expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
          supplierId: dto.supplierId || null,
          reference: dto.reference || null,
          notes: dto.notes || null,
          lines: { create: this.datosDeLinea(dto) },
        },
        include: incluir,
      });
    });
    return this.serializar(f);
  }

  /**
   * Anular, no borrar: una factura con abonos movió plata de verdad y su
   * historial tiene que seguir siendo legible. Anularla saca sus abonos de la
   * caja (ver el `where` de `cash.service.ts`).
   */
  async void(organizationId: string, id: string, dto: PurchaseVoidDto) {
    const f = await this.mia(organizationId, id);
    if (f.voidedAt) throw new BadRequestException('Esa factura ya estaba anulada');
    const recibidas = f.lines.filter((l) => l.received > 0);
    if (recibidas.length) {
      throw new BadRequestException(
        'Esta factura tiene mercadería recibida: esas compras ya están en el inventario. Corregilas desde Compras de filamento.',
      );
    }
    await this.prisma.purchaseInvoice.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: dto.reason },
    });
    return this.get(organizationId, id);
  }

  /** Borrar solo una factura SIN historial: sin abonos y sin nada recibido. */
  async remove(organizationId: string, id: string) {
    const f = await this.mia(organizationId, id);
    if (f.payments.length) {
      throw new BadRequestException('Tiene abonos: anulala en vez de borrarla.');
    }
    if (f.lines.some((l) => l.received > 0)) {
      throw new BadRequestException('Tiene mercadería recibida: no se borra.');
    }
    await this.prisma.purchaseInvoice.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- abonos ----------

  async addPayment(organizationId: string, id: string, dto: PurchaseInvoicePaymentDto) {
    const f = await this.mia(organizationId, id);
    if (f.voidedAt) throw new BadRequestException('La factura está anulada');

    if (dto.counterpartyId) {
      const cp = await this.prisma.counterparty.findFirst({
        where: { id: dto.counterpartyId, organizationId },
      });
      if (!cp) throw new NotFoundException('No existe esa contraparte');
    }
    if (dto.accountId) {
      const cuenta = await this.prisma.cashAccount.findFirst({
        where: { id: dto.accountId, organizationId },
      });
      if (!cuenta) throw new NotFoundException('No existe esa cuenta');
    }

    await this.prisma.purchaseInvoicePayment.create({
      data: {
        invoiceId: id,
        organizationId,
        date: new Date(dto.date),
        amount: dto.amount,
        counterpartyId: dto.counterpartyId || null,
        accountId: dto.accountId || null,
        note: dto.note || null,
      },
    });
    return this.get(organizationId, id);
  }

  /** Anular un abono: la plata vuelve a la caja y la fila queda en el historial. */
  async voidPayment(organizationId: string, id: string, paymentId: string, dto: PurchaseVoidDto) {
    await this.mia(organizationId, id);
    const pago = await this.prisma.purchaseInvoicePayment.findFirst({
      where: { id: paymentId, invoiceId: id, organizationId },
    });
    if (!pago) throw new NotFoundException('No existe ese abono');
    if (pago.voidedAt) throw new BadRequestException('Ese abono ya estaba anulado');

    await this.prisma.purchaseInvoicePayment.update({
      where: { id: paymentId },
      data: { voidedAt: new Date(), voidReason: dto.reason },
    });
    return this.get(organizationId, id);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('purchase-invoices')
export class PurchaseInvoicesController {
  constructor(private readonly service: PurchaseInvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PurchaseInvoiceUpsertSchema)) dto: PurchaseInvoiceUpsertDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PurchaseInvoiceUpsertSchema)) dto: PurchaseInvoiceUpsertDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  /** Anular es POST y pide motivo: no es un DELETE, la factura sigue existiendo. */
  @Post(':id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PurchaseVoidSchema)) dto: PurchaseVoidDto,
  ) {
    return this.service.void(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PurchaseInvoicePaymentSchema)) dto: PurchaseInvoicePaymentDto,
  ) {
    return this.service.addPayment(user.organizationId, id, dto);
  }

  @Post(':id/payments/:paymentId/void')
  voidPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(PurchaseVoidSchema)) dto: PurchaseVoidDto,
  ) {
    return this.service.voidPayment(user.organizationId, id, paymentId, dto);
  }
}

@Module({
  controllers: [PurchaseInvoicesController],
  providers: [PurchaseInvoicesService],
  exports: [PurchaseInvoicesService],
})
export class PurchaseInvoicesModule {}
