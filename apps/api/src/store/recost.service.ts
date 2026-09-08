import { Injectable } from '@nestjs/common';
import { calculateQuote, productStatus, type CalcInput } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RECOSTEO — recalcular una ficha con los precios de HOY.
 *
 * Estaba dentro de `products/`, que se elimina: el costeo pasó a vivir en la
 * ficha de tienda (spec `2026-09-07-catalogo-unico-design.md`). La lógica es la
 * misma y se movió tal cual, porque es la parte delicada: re-resuelve cada
 * línea del `CalcInput` guardado contra el catálogo **por nombre**, ya que el
 * snapshot embebe precios y no ids.
 */
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
export class RecostService {
  constructor(private readonly prisma: PrismaService) {}

  /** Carga catálogos + settings UNA vez para recostear uno o varios productos. */
  async loadCatalog(organizationId: string): Promise<CatalogContext> {
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
  rebuildWithCurrentPrices(
    input: CalcInput,
    ctx: CatalogContext,
  ): { input: CalcInput; unmatched: string[] } {
    const unmatched: string[] = [];

    const filament = (() => {
      const f = input.filament;
      const cur = ctx.materials.get(lc(f.name));
      if (!cur) {
        if (f.name) unmatched.push(f.name);
        return f;
      }
      return { ...f, rollPrice: cur.rollPrice, rollGrams: cur.rollGrams };
    })();

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

    // El catálogo guarda el PAQUETE (100 argollas a $50) y el motor trabaja con
    // el costo por unidad: hay que dividir, no copiar el precio del paquete.
    const supplies = (input.supplies ?? []).map((s) => {
      const cur = ctx.components.get(lc(s.name));
      if (!cur) {
        if (s.name) unmatched.push(s.name);
        return s;
      }
      return { ...s, unitCost: cur.packagePrice / cur.unitsPerPackage };
    });

    // La electricidad no es catálogo: su precio vive en Settings; refréscalo a hoy.
    const electricity = input.electricity
      ? { ...input.electricity, kwhPrice: input.electricity.enabled ? ctx.kwhPrice : input.electricity.kwhPrice }
      : input.electricity;

    return { input: { ...input, filament, printer, supplies, electricity }, unmatched };
  }


  /**
   * Costo de hoy y estado de rentabilidad de una ficha costeada.
   *
   * Devuelve `null` si la ficha no tiene costeo (`input` en null): un servicio o
   * algo cargado a mano no se recostea, y eso no es un error — es la mitad del
   * catálogo.
   */
  async recost(
    organizationId: string,
    ficha: { input: unknown; priceUsd: unknown; costAtPublish: unknown },
    ctx?: CatalogContext,
  ) {
    if (!ficha.input) return null;
    const contexto = ctx ?? (await this.loadCatalog(organizationId));
    const price = Number(ficha.priceUsd);
    const costAtPublish = Number(ficha.costAtPublish ?? 0);
    const { input, unmatched } = this.rebuildWithCurrentPrices(ficha.input as CalcInput, contexto);
    const result = calculateQuote(input);
    const costNow = result.costPerUnit;

    return {
      price,
      costAtPublish,
      costNow,
      status: productStatus(price, costAtPublish, costNow, contexto.minMarginPct),
      /** Items del costeo que ya no existen en el catálogo: conservan su precio viejo. */
      unmatched,
    };
  }
}
