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
  PurchaseReceiveSchema,
  PurchaseVoidSchema,
  invoiceStatus,
  invoiceTotals,
  purchaseCostPerRoll,
  type PurchaseInvoicePaymentDto,
  type PurchaseInvoiceUpsertDto,
  type PurchaseReceiveDto,
  type PurchaseVoidDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { ExpensesService } from '../expenses/expenses.service';

const n = (x: unknown) => Number(x);

/** Lo que se trae siempre: sin las líneas y los abonos no hay cuentas. */
const incluir = {
  supplier: { select: { id: true, name: true } },
  lines: {
    include: {
      material: { select: { id: true, name: true } },
      printer: { select: { id: true, name: true } },
      /**
       * LAS RECEPCIONES DE LA LÍNEA.
       *
       * ⚠️ **Una recepción no tiene tabla propia: su registro ES el gasto** que
       * nace al recibir. Ahí están su cantidad y su monto, o sea **lo que de
       * verdad te cobraron**. Guardar el precio otra vez al lado sería una
       * segunda verdad sobre la misma entrega, y el día que una de las dos
       * cambie la factura y el gasto dirían cosas distintas de la misma compra.
       * Por eso no hubo migración en la fase 2: el dato ya estaba guardado, lo
       * que faltaba era mirarlo.
       *
       * En orden ASCENDENTE: la primera entrega primero, como la leería
       * cualquiera. Deshacer, en cambio, busca la ÚLTIMA y usa su propio
       * `orderBy` descendente.
       */
      expenses: {
        select: { id: true, date: true, quantity: true, amount: true },
        // El `as` no es decorativo: el `as const` de abajo volvería `readonly`
        // a este arreglo y Prisma pide uno mutable en `orderBy`.
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] as Array<
          { date: 'asc' } | { createdAt: 'asc' }
        >,
      },
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
  constructor(
    private readonly prisma: PrismaService,
    /** Para que el precio del rollo salga de la MISMA regla que una compra directa. */
    private readonly expenses: ExpensesService,
  ) {}

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
      /** Qué ficha va a nacer al recibir: la pantalla lo necesita para decirlo. */
      nuevoTipo: l.nuevoTipo,
      quantity: l.quantity,
      unitPrice: n(l.unitPrice),
      received: l.received,
      /** Lo que falta llegar de ESTA línea. */
      porRecibir: Math.max(l.quantity - l.received, 0),
      /**
       * CADA ENTREGA, CON EL PRECIO QUE TE COBRARON.
       *
       * ⚠️ El precio por unidad se deriva con **`purchaseCostPerRoll`**, la
       * misma función que fija el precio de cotización del rollo. Dividir acá a
       * mano sería una segunda cuenta para la misma pregunta ("¿a cuánto salió
       * la unidad?") y el día que una redondee distinto, la factura y la
       * calculadora no coincidirían.
       *
       * ⚠️ La pantalla necesita esto para **avisar** cuando el precio informado
       * difiere del pedido: cambia el total de la factura, y un total que se
       * mueve sin decir por qué miente de la peor manera, la que no se nota.
       */
      recepciones: l.expenses.map((e) => ({
        id: e.id,
        date: e.date.toISOString(),
        quantity: e.quantity ?? 0,
        unitPrice: purchaseCostPerRoll(n(e.amount), e.quantity ?? 0),
      })),
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

    // ⚠️ **El total ya NO es `Σ cantidad × precio pedido`.** Cada línea viaja con
    // sus recepciones, así que lo ya recibido vale lo que COSTÓ y lo que falta
    // sigue valiendo lo que PEDISTE. `received` sigue siendo la única definición
    // de cuántos llegaron: el motor recorta las recepciones contra él.
    const totals = invoiceTotals(
      lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        received: l.received,
        recepciones: l.recepciones,
      })),
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
      /** El schema ya garantiza que viene con `nombreNuevo` y solo con él. */
      nuevoTipo: l.nuevoTipo || null,
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
        `Ya recibiste ${recibidas.length} línea(s) de esta factura: corregir las líneas dejaría esas compras colgando. Deshacé esas recepciones ("Deshacer recepción", en cada línea) y después corregila.`,
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
      // ⚠️ Este mensaje mandaba a "Compras de filamento", que es una puerta
      // CERRADA: un gasto nacido de una factura no se toca desde ahí. Un
      // mensaje que manda a una puerta cerrada es peor que no tener mensaje.
      throw new BadRequestException(
        `Esta factura tiene ${recibidas.length} línea(s) con mercadería recibida. Deshacé esas recepciones ("Deshacer recepción", en cada línea) y después anulala.`,
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
      throw new BadRequestException(
        'Tiene mercadería recibida: deshacé esas recepciones ("Deshacer recepción", en cada línea) y después borrala.',
      );
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

  // ---------- recepción ----------

  /**
   * LLEGÓ LA MERCADERÍA (entera o parte).
   *
   * Crea el gasto —marcado con la línea, para que **su plata no se cuente dos
   * veces**— sube lo recibido y deja que el precio del rollo lo recalcule la
   * misma regla que usa una compra directa.
   *
   * ⚠️ El monto NO viaja en el body: sale de `cantidad × precio unitario`. Si
   * lo mandara el cliente, dos recepciones de la misma línea podrían sumar
   * algo distinto del total de la factura sin que nadie se entere.
   *
   * ⚠️ El **precio** sí viaja, y es opcional (`dto.unitPrice`): pediste 10 a $7
   * y te facturaron $7,50. La línea conserva lo PEDIDO y esta recepción guarda
   * lo que COSTÓ —en el monto de su gasto—, así que el total de la factura y el
   * precio de cotización del rollo salen del precio real sin reescribir el
   * pedido. Antes había que corregir la línea ANTES de recibir, y con algo ya
   * recibido no se podía por ninguna puerta.
   *
   * ⚠️ Todo en UNA transacción: un gasto creado sin subir `received` dejaría
   * la línea pidiendo de nuevo lo que ya llegó, y volver a recibirla cargaría
   * el filamento dos veces en el inventario.
   */
  async receive(
    organizationId: string,
    id: string,
    lineId: string,
    dto: PurchaseReceiveDto,
  ) {
    const f = await this.mia(organizationId, id);
    if (f.voidedAt) throw new BadRequestException('La factura está anulada');

    const linea = f.lines.find((l) => l.id === lineId);
    if (!linea) throw new NotFoundException('Esa línea no es de esta factura');

    const pendiente = linea.quantity - linea.received;
    if (pendiente <= 0) throw new BadRequestException('Esa línea ya llegó entera');
    if (dto.quantity > pendiente) {
      throw new BadRequestException(
        `Pediste ${linea.quantity} y ya recibiste ${linea.received}: no podés recibir ${dto.quantity} más.`,
      );
    }

    const fecha = dto.date ? new Date(dto.date) : new Date();
    /**
     * ⚠️ **EL PRECIO QUE TE COBRARON.** Sin informar nada se usa el de la
     * línea, que es el caso normal (llegó a lo pactado). `?? ` y no `||`: un
     * precio informado de **0** es un dato verdadero —un rollo regalado— y con
     * `||` se habría leído como "no informó nada" y cobrado el pedido.
     *
     * ⚠️ **La línea NO se reescribe.** Es el pedido, y lo que falta llegar se
     * sigue valuando a ese precio; pisarla dejaría la factura sin memoria de lo
     * que habías acordado.
     */
    const precio = dto.unitPrice ?? n(linea.unitPrice);
    const monto = Math.round(dto.quantity * precio * 10000) / 10000;

    // ⚠️ Una línea que pide algo nuevo y NO dice qué es no se adivina: adivinar
    // "filamento" es justo lo que dejaba un rollo llamado "Impresora A2". El
    // schema Zod ya lo frena al cargar la factura; esto cubre una fila vieja o
    // un script. Antes de la transacción: el 400 sale sin haber escrito nada.
    if (!linea.materialId && !linea.printerId && !linea.nuevoTipo) {
      throw new BadRequestException(
        'Esa línea pide algo que todavía no tenés pero no dice si es filamento o impresora. Elegilo en la factura antes de recibir.',
      );
    }

    const materialId = await this.prisma.$transaction(async (tx) => {
      // Una ficha que nace acá: lo que nunca compraste no existía hasta que
      // llegó. El resto de sus datos se corrige después desde su catálogo.
      let matId = linea.materialId;
      let impId = linea.printerId;
      if (!matId && !impId && linea.nombreNuevo) {
        if (linea.nuevoTipo === 'PRINTER') {
          // Nace con el precio de la compra; horas de vida y consumo quedan en
          // el default y se corrigen desde el catálogo de impresoras.
          // Nace con lo que COSTÓ, no con lo que pediste.
          const nueva = await tx.printer.create({
            data: { organizationId, name: linea.nombreNuevo, price: precio },
          });
          impId = nueva.id;
          // ⚠️ Repuntar la línea no es cosmético: el gasto de abajo decide
          // EQUIPMENT/CONSUMABLE e `isInvestment` por `impId`. Sin esto, una
          // impresora entraría como consumible y quedaría fuera de la
          // reposición de equipos.
          await tx.purchaseInvoiceLine.update({ where: { id: lineId }, data: { printerId: impId } });
        } else {
          const nueva = await tx.material.create({
            data: {
              organizationId,
              name: linea.nombreNuevo,
              rollPrice: precio,
              ...(dto.rollGrams ? { rollGrams: dto.rollGrams } : {}),
            },
          });
          matId = nueva.id;
          await tx.purchaseInvoiceLine.update({ where: { id: lineId }, data: { materialId: matId } });
        }
      }

      await tx.expense.create({
        data: {
          organizationId,
          date: fecha,
          category: impId ? 'EQUIPMENT' : 'CONSUMABLE',
          description: `Compra ${linea.nombreNuevo ?? linea.material?.name ?? linea.printer?.name ?? ''}`.trim(),
          amount: monto,
          quantity: dto.quantity,
          isInvestment: impId != null,
          materialId: matId,
          printerId: impId,
          providerId: f.supplierId,
          // ⚠️ Esto es lo que le dice a Caja que su plata ya se contó.
          purchaseInvoiceLineId: lineId,
        },
      });

      await tx.purchaseInvoiceLine.update({
        where: { id: lineId },
        data: { received: linea.received + dto.quantity },
      });
      return matId;
    });

    // Fuera de la transacción: lee la última compra, que recién ahora existe.
    await this.expenses.recalcularPrecioDelRollo(organizationId, materialId);
    return this.get(organizationId, id);
  }

  /**
   * DESHACER LA ÚLTIMA RECEPCIÓN de una línea: **el inverso exacto de
   * `receive()`**.
   *
   * ⚠️ Es la SALIDA del callejón. Un gasto nacido de una factura no se toca
   * desde Gastos, y una línea ya recibida no se puede corregir ni anular: sin
   * esta puerta, una recepción mal cargada quedaba congelada para siempre y los
   * cuatro mensajes de error se mandaban unos a otros en círculo.
   *
   * ⚠️ **No es un borrado libre.** Cada recepción creó UN gasto con su
   * cantidad; esto borra **ese** gasto y baja `received` en **esa misma**
   * cantidad. Si no aparece el gasto, corta: bajar `received` a ciegas dejaría
   * la línea pidiendo de nuevo mercadería que sí llegó, y volver a recibirla
   * cargaría el filamento dos veces.
   *
   * ⚠️ **No mueve la caja.** Ese gasto nunca movió plata (la plata son los
   * abonos, y el gasto nació marcado con su línea justamente para no contarla
   * dos veces): borrarlo tampoco puede moverla. Fijado con número clavado en el
   * spec.
   *
   * ⚠️ **La ficha que nació al recibir NO se borra**: puede estar ya en una
   * cotización o en un pedido. Lo que vuelve atrás es la compra. Y la línea
   * conserva su enlace a esa ficha, así que volver a recibirla la reusa en vez
   * de crear una duplicada.
   */
  async unreceive(organizationId: string, id: string, lineId: string) {
    const f = await this.mia(organizationId, id);
    if (f.voidedAt) {
      throw new BadRequestException('La factura está anulada: no hay recepciones que deshacer.');
    }

    const linea = f.lines.find((l) => l.id === lineId);
    if (!linea) throw new NotFoundException('Esa línea no es de esta factura');
    if (linea.received <= 0) {
      throw new BadRequestException('De esa línea no llegó nada todavía: no hay nada que deshacer.');
    }

    // La ÚLTIMA recepción: la más nueva por fecha y, a igualdad, por
    // `createdAt`. Mismo criterio que el precio del rollo, que también sigue a
    // la última compra.
    const gasto = await this.prisma.expense.findFirst({
      where: { organizationId, purchaseInvoiceLineId: lineId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    if (!gasto) {
      throw new BadRequestException(
        'Esta línea figura recibida pero no tiene ninguna compra asociada, así que no se sabe cuánto bajar. Hay que revisarla a mano.',
      );
    }

    const cantidad = gasto.quantity ?? 0;
    if (cantidad <= 0 || cantidad > linea.received) {
      throw new BadRequestException(
        `La última compra de esta línea dice ${cantidad} y la línea tiene ${linea.received} recibido(s): las cuentas no cierran y deshacer la dejaría peor. Hay que revisarla a mano.`,
      );
    }

    // ⚠️ Todo en UNA transacción, igual que al recibir: borrar el gasto sin
    // bajar `received` deja la línea mintiendo, y bajar `received` sin borrar
    // el gasto deja la compra duplicada al volver a recibir.
    await this.prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: gasto.id } });
      await tx.purchaseInvoiceLine.update({
        where: { id: lineId },
        data: { received: linea.received - cantidad },
      });
    });

    // Fuera de la transacción: el precio del rollo tiene que volver al de la
    // compra ANTERIOR, y para eso la que se borró ya no puede existir.
    await this.expenses.recalcularPrecioDelRollo(organizationId, gasto.materialId);
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

  @Post(':id/lines/:lineId/receive')
  receive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(PurchaseReceiveSchema)) dto: PurchaseReceiveDto,
  ) {
    return this.service.receive(user.organizationId, id, lineId, dto);
  }

  /**
   * Deshacer la última recepción. **Sin cuerpo a propósito**: no hay nada que
   * elegir, se revierte exactamente la recepción que se hizo (su gasto y su
   * cantidad). Un `quantity` del cliente podría no coincidir con ninguna
   * recepción real y dejaría `received` contando algo que nunca pasó.
   */
  @Post(':id/lines/:lineId/unreceive')
  unreceive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.service.unreceive(user.organizationId, id, lineId);
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
  imports: [ExpensesModule],
  controllers: [PurchaseInvoicesController],
  providers: [PurchaseInvoicesService],
  exports: [PurchaseInvoicesService],
})
export class PurchaseInvoicesModule {}
