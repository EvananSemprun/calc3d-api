import Decimal from 'decimal.js';
import {
  CalcInputSchema,
  type PriceStatus,
  type Rounding,
  type RoundingMode,
} from '../schemas/calc';
import { D, sum, toMoney, roundToIncrement } from './money';
import type {
  CalcResult,
  CostBreakdown,
  OrderTotals,
  PriceResult,
  ProductionSummary,
  RoundingOption,
  SupplyResult,
  WholesaleResult,
  WholesaleTierResult,
} from './types';

/**
 * MOTOR DE CÁLCULO puro (sin Nest ni DB). Toda la aritmética usa decimal.js.
 * Sigue la hoja "Costeo" del Excel de Banano Lab.
 *
 * Distingue costos "por tanda" (filamento, desgaste, luz: dependen de los
 * gramos y horas que reporta el laminador para UNA impresión) de costos "por
 * pieza" (insumos, postprocesado, empaque). NO divide ciegamente todo entre la
 * cantidad. Los redondeos solo ocurren en la presentación del precio; los
 * cálculos intermedios van a precisión completa.
 */

/** Las 5 reglas que ofrece el comparador. `DOWN` queda fuera: regala margen. */
const ROUNDING_CHOICES: { mode: RoundingMode; increment: number }[] = [
  { mode: 'NEAREST', increment: 1 },
  { mode: 'NEAREST', increment: 0.5 },
  { mode: 'UP', increment: 1 },
  { mode: 'UP', increment: 0.5 },
  { mode: 'NONE', increment: 1 },
];

/** Margen real sobre el costo. Sin costo no hay margen que calcular. */
function marginOver(price: Decimal, cost: Decimal): number {
  if (cost.lte(0)) return 0;
  return price.div(cost).minus(1).toDecimalPlaces(6).toNumber();
}

/**
 * Semáforo comercial de un precio (fórmula B58 de la hoja). El piso (`minMargin`)
 * lo fija el negocio: bajo ese margen el trabajo no vale la pena, y bajarlo en
 * silencio es el error que más caro sale.
 */
function statusFor(
  price: Decimal,
  cost: Decimal,
  marginReal: number,
  markup: number,
  minMargin: number,
): PriceStatus {
  if (price.lt(cost)) return 'LOSS';
  if (marginReal < minMargin) return 'LOW';
  if (marginReal < markup * 0.9) return 'BELOW_TARGET';
  return 'OK';
}

export function calculateQuote(raw: unknown): CalcResult {
  // parse aplica defaults y valida divisores 0 (cantidad, gramos de rollo, vida
  // útil, piezas por tanda, impresoras en paralelo): lanza ZodError si algo falla.
  const input = CalcInputSchema.parse(raw);
  const qty = D(input.quantity);

  // --- Tandas. Los gramos y horas ingresados son los de UNA tanda; se escalan
  //     al pedido completo con cantidad/piezasPorTanda. ---
  const batchSize = input.piecesPerBatch;
  const batchMultiplier = qty.div(batchSize);
  const batchCount = Math.ceil(input.quantity / batchSize);

  // --- Filamento (por tanda) ---
  const materialBatch = D(input.filament.rollPrice)
    .div(input.filament.rollGrams)
    .times(input.filament.grams)
    .times(batchMultiplier);

  // --- Desgaste y luz (por tanda: dependen de las horas de la impresión) ---
  let wearBatch = new Decimal(0);
  let powerBatch = new Decimal(0);
  const printer = input.printer;
  if (printer) {
    const hours = D(printer.hours);
    wearBatch = D(printer.price)
      .div(printer.lifetimeHours)
      .times(hours)
      .plus(D(printer.maintPerHour).times(hours))
      .times(batchMultiplier);
    if (input.electricity.enabled) {
      powerBatch = D(printer.powerKw)
        .times(input.electricity.kwhPrice)
        .times(hours)
        .times(batchMultiplier);
    }
  }

  // --- Insumos (la cantidad es por PIEZA) ---
  const supplies: SupplyResult[] = input.supplies.map((s) => {
    const perPiece = D(s.qty).times(s.unitCost);
    return {
      name: s.name,
      perPieceCost: toMoney(perPiece),
      batchCost: toMoney(perPiece.times(qty)),
    };
  });
  const suppliesBatch = sum(input.supplies.map((s) => D(s.qty).times(s.unitCost))).times(qty);

  // --- Postprocesado (minutos por PIEZA) ---
  const laborBatch = D(input.labor.minutes).div(60).times(input.labor.hourlyRate).times(qty);

  // --- Empaque (por pieza) y otros (una sola vez en el pedido) ---
  const extrasBatch = D(input.extras.packagingPerPiece)
    .times(qty)
    .plus(input.extras.otherPerOrder);

  // --- Merma: siempre sobre filamento, desgaste y luz. Una impresión fallida
  //     gasta material, horas de máquina y electricidad; no gasta el empaque
  //     ni tu tiempo de postprocesado, que todavía no invertiste. ---
  const wasteAmount = materialBatch.plus(wearBatch).plus(powerBatch).times(input.waste.pct);

  const breakdown: CostBreakdown = {
    material: toMoney(materialBatch),
    wear: toMoney(wearBatch),
    power: toMoney(powerBatch),
    supplies: toMoney(suppliesBatch),
    labor: toMoney(laborBatch),
    extras: toMoney(extrasBatch),
    wasteAmount: toMoney(wasteAmount),
  };

  const subtotalBeforeWaste = materialBatch
    .plus(wearBatch)
    .plus(powerBatch)
    .plus(suppliesBatch)
    .plus(laborBatch)
    .plus(extrasBatch);
  const costBatchD = subtotalBeforeWaste.plus(wasteAmount);
  const costPerUnitD = costBatchD.div(qty);

  // --- Precio (secciones 7 y 8 de la hoja) ---
  const { markup, minMarginPct, rounding } = input.margins;
  const price = buildPrice(costPerUnitD, markup, minMarginPct, rounding, input.manualPrice);
  const finalD = D(price.final);

  const roundingOptions: RoundingOption[] = ROUNDING_CHOICES.map(({ mode, increment }) => {
    const p = roundToIncrement(D(price.suggested), mode, increment);
    return { mode, increment, price: toMoney(p), marginReal: marginOver(p, costPerUnitD) };
  });

  // --- Mayoreo (sección 11) ---
  const wholesale = buildWholesale(
    finalD,
    costPerUnitD,
    input.quantity,
    markup,
    minMarginPct,
    input.wholesale.tiers,
    rounding,
  );

  // --- Producción (secciones 10 y el bloque de entrega) ---
  const machineHours = printer
    ? D(printer.hours).times(batchMultiplier)
    : new Decimal(0);
  const production: ProductionSummary = {
    piecesPerBatch: batchSize,
    batches: batchCount,
    totalGrams: D(input.filament.grams).times(batchMultiplier).toDecimalPlaces(2).toNumber(),
    machineHours: machineHours.toDecimalPlaces(4).toNumber(),
    deliveryHours: machineHours.div(input.parallelPrinters).toDecimalPlaces(4).toNumber(),
    costPerBatch: toMoney(costPerUnitD.times(batchSize)),
    costPerUnit: toMoney(costPerUnitD),
    costTotal: toMoney(costBatchD),
  };

  return {
    quantity: input.quantity,
    currency: input.currency,
    locale: input.locale,
    supplies,
    breakdown,
    subtotalBeforeWaste: toMoney(subtotalBeforeWaste),
    costBatch: toMoney(costBatchD),
    costPerUnit: toMoney(costPerUnitD),
    price,
    roundingOptions,
    wholesale,
    production,
    order: buildOrder(price, wholesale, costPerUnitD, qty, markup, minMarginPct),
  };
}

/**
 * Lo que se cobra: el precio del tramo de mayoreo si el pedido lo alcanza, y si
 * no el de lista. Se resuelve UNA vez acá para que el panel, la cotización del
 * cliente y la venta registrada no puedan decir cifras distintas.
 */
function buildOrder(
  price: PriceResult,
  wholesale: WholesaleResult | null,
  cost: Decimal,
  qty: Decimal,
  markup: number,
  minMargin: number,
): OrderTotals {
  const tier = wholesale?.appliedTier ?? null;
  // Un tramo con 0 % de descuento es el precio de lista: no es "mayoreo".
  const fromTier = !!tier && tier.discountPct > 0;
  const unit = fromTier ? D(tier.unitPrice) : D(price.final);
  const marginReal = marginOver(unit, cost);

  return {
    units: qty.toNumber(),
    listUnitPrice: price.final,
    discountPct: fromTier ? tier.discountPct : 0,
    unitPrice: toMoney(unit),
    fromTier,
    total: toMoney(unit.times(qty)),
    profit: toMoney(unit.minus(cost).times(qty)),
    marginReal,
    status: statusFor(unit, cost, marginReal, markup, minMargin),
  };
}

function buildPrice(
  cost: Decimal,
  markup: number,
  minMargin: number,
  rounding: Rounding,
  manualPrice: number | null,
): PriceResult {
  const suggested = cost.times(D(1).plus(markup));
  const rounded = roundToIncrement(suggested, rounding.mode, rounding.increment);
  const isManual = manualPrice != null;
  const final = isManual ? D(manualPrice) : rounded;
  const marginReal = marginOver(final, cost);

  return {
    markup,
    suggested: toMoney(suggested),
    rounded: toMoney(rounded),
    final: toMoney(final),
    isManual,
    marginReal,
    profitPerUnit: toMoney(final.minus(cost)),
    diffVsSuggested: toMoney(final.minus(suggested)),
    status: statusFor(final, cost, marginReal, markup, minMargin),
  };
}

/**
 * Mayoreo por DESCUENTO sobre el precio final, como la hoja: el descuento se
 * aplica al precio y DESPUÉS se redondea (C82:C86). No se redondea el descuento.
 */
function buildWholesale(
  finalPrice: Decimal,
  cost: Decimal,
  quantity: number,
  markup: number,
  minMargin: number,
  tiers: { minQty: number; discountPct: number }[],
  rounding: Rounding,
): WholesaleResult | null {
  if (tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  // tramo aplicable: el de mayor minQty que no supere la cantidad del pedido
  const appliedSource = [...sorted].reverse().find((t) => quantity >= t.minQty) ?? sorted[0];

  const tierResults: WholesaleTierResult[] = sorted.map((t) => {
    const raw = finalPrice.times(D(1).minus(t.discountPct));
    const unitPrice = roundToIncrement(raw, rounding.mode, rounding.increment);
    const marginReal = marginOver(unitPrice, cost);
    return {
      minQty: t.minQty,
      discountPct: t.discountPct,
      unitPrice: toMoney(unitPrice),
      marginReal,
      profitPerUnit: toMoney(unitPrice.minus(cost)),
      applies: t.minQty === appliedSource.minQty,
      status: statusFor(unitPrice, cost, marginReal, markup, minMargin),
    };
  });

  const appliedTier = tierResults.find((t) => t.applies) ?? null;
  const unit = appliedTier ? D(appliedTier.unitPrice) : finalPrice;
  const profit = appliedTier ? D(appliedTier.profitPerUnit) : finalPrice.minus(cost);

  return {
    tiers: tierResults,
    appliedTier,
    orderTotal: toMoney(unit.times(quantity)),
    orderProfit: toMoney(profit.times(quantity)),
  };
}
