import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ProductCreateSchema,
  ProductRepriceSchema,
  ProductUpdateSchema,
  calculateQuote,
  productStatus,
  type CalcInput,
  type ProductCreateDto,
  type ProductRepriceDto,
  type ProductUpdateDto,
} from '@calc3d/shared';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';

const lc = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** Catálogo vigente de la organización, indexado por nombre para el recosteo. */
interface CatalogContext {
  materials: Map<string, { rollPrice: number; rollGrams: number }>;
  printers: Map<string, { price: number; lifetimeHours: number; powerKw: number; maintPerHour: number }>;
  components: Map<string, { packagePrice: number; unitsPerPackage: number }>;
  kwhPrice: number;
  minMarginPct: number;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: ExchangeRatesService,
  ) {}

  /** Carga catálogos + settings UNA vez para recostear uno o varios productos. */
  private async loadCatalog(organizationId: string): Promise<CatalogContext> {
    const [materials, printers, components, settings] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId } }),
      this.prisma.printer.findMany({ where: { organizationId } }),
      this.prisma.component.findMany({ where: { organizationId } }),
      this.prisma.settings.findUnique({ where: { organizationId } }),
    ]);
    return {
      materials: new Map(
        materials.map((m) => [lc(m.name), { rollPrice: Number(m.rollPrice), rollGrams: m.rollGrams }]),
      ),
      printers: new Map(
        printers.map((p) => [
          lc(p.name),
          {
            price: Number(p.price),
            lifetimeHours: p.lifetimeHours,
            powerKw: Number(p.powerKw),
            maintPerHour: Number(p.maintPerHour),
          },
        ]),
      ),
      components: new Map(
        components.map((c) => [
          lc(c.name),
          { packagePrice: Number(c.packagePrice), unitsPerPackage: c.unitsPerPackage },
        ]),
      ),
      kwhPrice: settings ? Number(settings.kwhPrice) : 0,
      minMarginPct: settings ? settings.productAlertMinMarginPct : 0.15,
    };
  }

  /**
   * Reconstruye el CalcInput guardado usando los precios de HOY: re-resuelve cada
   * línea contra el catálogo por NOMBRE. Lo que no encuentra (item renombrado o
   * borrado) conserva su precio congelado y se reporta como `unmatched`.
   */
  private rebuildWithCurrentPrices(
    input: CalcInput,
    ctx: CatalogContext,
  ): { input: CalcInput; unmatched: string[] } {
    const unmatched: string[] = [];

    const materials = (input.materials ?? []).map((m) => {
      const cur = ctx.materials.get(lc(m.name));
      if (!cur) {
        if (m.name) unmatched.push(m.name);
        return m;
      }
      return { ...m, rollPrice: cur.rollPrice, rollGrams: cur.rollGrams };
    });

    let printer = input.printer;
    if (printer) {
      const cur = ctx.printers.get(lc(printer.name));
      if (cur) {
        printer = {
          ...printer,
          price: cur.price,
          lifetimeHours: cur.lifetimeHours,
          powerKw: cur.powerKw,
          maintPerHour: cur.maintPerHour,
        };
      } else if (printer.name) {
        unmatched.push(printer.name);
      }
    }

    const components = (input.components ?? []).map((c) => {
      const cur = ctx.components.get(lc(c.name));
      if (!cur) {
        if (c.name) unmatched.push(c.name);
        return c;
      }
      return { ...c, packagePrice: cur.packagePrice, unitsPerPackage: cur.unitsPerPackage };
    });

    // La electricidad no es catálogo: su precio vive en Settings; refréscalo a hoy.
    const electricity = input.electricity
      ? { ...input.electricity, kwhPrice: input.electricity.enabled ? ctx.kwhPrice : input.electricity.kwhPrice }
      : input.electricity;

    return { input: { ...input, materials, printer, components, electricity }, unmatched };
  }

  /** Costo unitario de HOY + estado de rentabilidad de un producto ya cargado. */
  private recostWith(
    product: { input: unknown; priceSet: unknown; costAtSave: unknown },
    ctx: CatalogContext,
  ) {
    const priceSet = Number(product.priceSet);
    const costAtSave = Number(product.costAtSave);
    const { input, unmatched } = this.rebuildWithCurrentPrices(product.input as CalcInput, ctx);
    const result = calculateQuote(input);
    const costNow = result.costPerUnit;
    return {
      priceSet,
      costAtSave,
      costNow,
      status: productStatus(priceSet, costAtSave, costNow, ctx.minMarginPct),
      unmatched,
      result,
    };
  }

  /** Lista de productos con su estado de rentabilidad recosteado a precios de hoy. */
  async list(organizationId: string) {
    const [products, ctx] = await Promise.all([
      this.prisma.product.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
      this.loadCatalog(organizationId),
    ]);
    return products.map((p) => {
      const { result, ...recost } = this.recostWith(p, ctx);
      void result; // la lista no necesita el CalcResult completo
      return { ...p, recost };
    });
  }

  /** Detalle de un producto con el recosteo COMPLETO (incluye CalcResult de hoy). */
  async get(organizationId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const ctx = await this.loadCatalog(organizationId);
    return { ...product, recost: this.recostWith(product, ctx) };
  }

  async create(organizationId: string, dto: ProductCreateDto) {
    // El costo se calcula en el servidor (autoridad); el precio lo decide el dueño.
    const costAtSave = calculateQuote(dto.input as CalcInput).costPerUnit;
    const exchangeRates = await this.rates.snapshotJson(organizationId, dto.currencyLabel);
    return this.prisma.product.create({
      data: {
        organizationId,
        name: dto.name,
        imageUrl: dto.imageUrl ?? null,
        notes: dto.notes ?? null,
        input: dto.input as unknown as Prisma.InputJsonValue,
        priceSet: dto.priceSet,
        costAtSave,
        currencyLabel: dto.currencyLabel ?? null,
        exchangeRates: exchangeRates ?? Prisma.JsonNull,
      },
    });
  }

  async update(organizationId: string, id: string, dto: ProductUpdateDto) {
    await this.ensureOwned(organizationId, id);
    const existing = await this.prisma.product.findFirst({ where: { id, organizationId } });
    const nextLabel = dto.currencyLabel !== undefined ? dto.currencyLabel : existing?.currencyLabel;
    // Si cambia el CalcInput, se re-ancla el costo (y la tasa) al valor de hoy.
    // También se re-congela la tasa si cambió la MONEDA elegida.
    const reSnapshot = dto.input !== undefined || dto.currencyLabel !== undefined;
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl ?? null }),
        ...(dto.notes !== undefined && { notes: dto.notes ?? null }),
        ...(dto.priceSet !== undefined && { priceSet: dto.priceSet }),
        ...(dto.currencyLabel !== undefined && { currencyLabel: dto.currencyLabel }),
        ...(dto.input !== undefined && {
          costAtSave: calculateQuote(dto.input as CalcInput).costPerUnit,
          input: dto.input as unknown as Prisma.InputJsonValue,
        }),
        ...(reSnapshot && {
          exchangeRates: (await this.rates.snapshotJson(organizationId, nextLabel)) ?? Prisma.JsonNull,
        }),
      },
    });
  }

  /**
   * Re-fija el precio de venta: el dueño acepta el costo de hoy. Re-ancla
   * `costAtSave` al costo recosteado y refresca la tasa, de modo que la alerta
   * se apaga hasta el próximo movimiento de precios.
   */
  async reprice(organizationId: string, id: string, dto: ProductRepriceDto) {
    const product = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const ctx = await this.loadCatalog(organizationId);
    const { costNow } = this.recostWith(product, ctx);
    const exchangeRates = await this.rates.snapshotJson(organizationId, product.currencyLabel);
    return this.prisma.product.update({
      where: { id },
      data: {
        priceSet: dto.priceSet,
        costAtSave: costNow,
        exchangeRates: exchangeRates ?? Prisma.JsonNull,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Producto no encontrado');
  }
}

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

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
    @Body(new ZodValidationPipe(ProductCreateSchema)) dto: ProductCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ProductUpdateSchema)) dto: ProductUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Post(':id/reprice')
  reprice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ProductRepriceSchema)) dto: ProductRepriceDto,
  ) {
    return this.service.reprice(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  imports: [ExchangeRatesModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
