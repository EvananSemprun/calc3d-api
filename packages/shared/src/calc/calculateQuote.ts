import Decimal from 'decimal.js';
import {
  CalcInputSchema,
  type MarginMode,
  type ProrationMode,
  type Rounding,
  type WasteCategory,
} from '../schemas/calc';
import { D, sum, toMoney, roundToIncrement } from './money';
import type {
  CalcResult,
  ComponentResult,
  CostBreakdown,
  LaborResult,
  MaterialResult,
  PackagingResult,
  PriceResult,
  ProductionSummary,
  WholesaleResult,
  WholesaleTierResult,
} from './types';

/**
 * MOTOR DE CÁLCULO puro (sin Nest ni DB). Toda la aritmética usa decimal.js.
 * Distingue costos "por lote" (material, desgaste, luz) de costos "por pieza"
 * (componentes, empaque, mano de obra) para repartir bien: NO divide
 * ciegamente todo entre la cantidad. Los redondeos solo ocurren en la
 * presentación (campos *Rounded); los cálculos intermedios van a full precisión.
 */

/** Lógica común de compra por paquete (componentes y empaque). */
interface PackageCalc {
  unitCost: Decimal;
  totalUnits: number;
  packagesToBuy: number;
  leftover: number;
  usedCost: Decimal;
  fullPackageCost: Decimal;
  appliedCost: Decimal;
}

function computePackage(
  packagePrice: Decimal.Value,
  unitsPerPackage: Decimal.Value,
  totalUnitsNeeded: Decimal,
  prorationMode: ProrationMode,
): PackageCalc {
  const perPkg = D(unitsPerPackage);
  const unitCost = D(packagePrice).div(perPkg);
  const packagesToBuy = totalUnitsNeeded.div(perPkg).ceil();
  const leftover = packagesToBuy.times(perPkg).minus(totalUnitsNeeded);
  const usedCost = unitCost.times(totalUnitsNeeded);
  const fullPackageCost = packagesToBuy.times(packagePrice);
  const appliedCost = prorationMode === 'USED' ? usedCost : fullPackageCost;
  return {
    unitCost,
    totalUnits: totalUnitsNeeded.toNumber(),
    packagesToBuy: packagesToBuy.toNumber(),
    leftover: leftover.toNumber(),
    usedCost,
    fullPackageCost,
    appliedCost,
  };
}

/** Aplica un margen a un costo según el modo (markup sobre costo / margin sobre venta). */
function applyMargin(cost: Decimal, marginPct: number, mode: MarginMode): Decimal {
  if (mode === 'MARGIN') {
    const denom = D(1).minus(marginPct);
    if (denom.lte(0)) {
      throw new Error(
        `Margen sobre venta inválido: ${marginPct}. En modo "margin" el margen debe ser menor a 1 (100 %).`,
      );
    }
    return cost.div(denom);
  }
  return cost.times(D(1).plus(marginPct));
}

export function calculateQuote(raw: unknown): CalcResult {
  // parse aplica defaults y valida divisores 0 (cantidad, gramos de rollo,
  // vida útil, unidades por paquete): lanza ZodError si algo es inválido.
  const input = CalcInputSchema.parse(raw);
  const qty = D(input.quantity);

  // --- Tandas (lotes por cama). Los gramos/horas ingresados son los de UNA
  //     tanda llena; los costos "por lote" escalan lineal por cantidad/tanda.
  //     Sin piecesPerBatch, batchSize = cantidad y el multiplicador es 1 (clásico). ---
  const batchSize = input.batch.piecesPerBatch ?? input.quantity;
  const batchMultiplier = qty.div(batchSize);
  const batchCount = Math.ceil(input.quantity / batchSize);
  const fullBatches = Math.floor(input.quantity / batchSize);
  const partialPieces = input.quantity % batchSize;

  // --- Material (nivel LOTE: los gramos son los de UNA tanda; se escalan al
  //     total del trabajo con el multiplicador de tandas) ---
  const materials: MaterialResult[] = input.materials.map((m) => {
    const perBatch = D(m.rollPrice).div(m.rollGrams).times(m.grams);
    const batch = perBatch.times(batchMultiplier);
    return { name: m.name, perPieceCost: toMoney(batch.div(qty)), batchCost: toMoney(batch) };
  });
  const materialBatch = sum(
    input.materials.map((m) => D(m.rollPrice).div(m.rollGrams).times(m.grams)),
  ).times(batchMultiplier);

  // --- Desgaste y luz (nivel LOTE: dependen de las horas de la tanda; escalan igual) ---
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

  // --- Componentes (por pieza, comprados por paquete) ---
  const components: ComponentResult[] = input.components.map((c) => {
    const totalUnits = D(c.unitsPerPiece).times(qty);
    const pkg = computePackage(c.packagePrice, c.unitsPerPackage, totalUnits, c.prorationMode);
    return {
      name: c.name,
      unitCost: toMoney(pkg.unitCost),
      totalUnits: pkg.totalUnits,
      packagesToBuy: pkg.packagesToBuy,
      leftover: pkg.leftover,
      usedCost: toMoney(pkg.usedCost),
      fullPackageCost: toMoney(pkg.fullPackageCost),
      appliedCost: toMoney(pkg.appliedCost),
      perPieceCost: toMoney(pkg.appliedCost.div(qty)),
      prorationMode: c.prorationMode,
    };
  });
  const componentsBatch = sum(
    input.components.map((c) =>
      computePackage(c.packagePrice, c.unitsPerPackage, D(c.unitsPerPiece).times(qty), c.prorationMode).appliedCost,
    ),
  );

  // --- Empaque (por pieza o por pedido, comprado por paquete) ---
  const packaging: PackagingResult[] = input.packaging.map((p) => {
    const totalUnits = p.scope === 'PER_ORDER' ? D(p.unitsPerPiece) : D(p.unitsPerPiece).times(qty);
    const pkg = computePackage(p.packagePrice, p.unitsPerPackage, totalUnits, p.prorationMode);
    return {
      name: p.name,
      unitCost: toMoney(pkg.unitCost),
      totalUnits: pkg.totalUnits,
      packagesToBuy: pkg.packagesToBuy,
      leftover: pkg.leftover,
      usedCost: toMoney(pkg.usedCost),
      fullPackageCost: toMoney(pkg.fullPackageCost),
      appliedCost: toMoney(pkg.appliedCost),
      perPieceCost: toMoney(pkg.appliedCost.div(qty)),
      prorationMode: p.prorationMode,
      scope: p.scope,
    };
  });
  const packagingBatch = sum(
    input.packaging.map((p) => {
      const totalUnits = p.scope === 'PER_ORDER' ? D(p.unitsPerPiece) : D(p.unitsPerPiece).times(qty);
      return computePackage(p.packagePrice, p.unitsPerPackage, totalUnits, p.prorationMode).appliedCost;
    }),
  );

  // --- Mano de obra (por pieza o por pedido) ---
  const labor: LaborResult[] = input.labor.map((l) => {
    const base = D(l.hourlyRate).times(l.hours);
    const batch = l.scope === 'PER_PIECE' ? base.times(qty) : base;
    return {
      name: l.name,
      scope: l.scope,
      batchCost: toMoney(batch),
      perPieceCost: toMoney(batch.div(qty)),
    };
  });
  const laborBatch = sum(
    input.labor.map((l) => {
      const base = D(l.hourlyRate).times(l.hours);
      return l.scope === 'PER_PIECE' ? base.times(qty) : base;
    }),
  );

  // --- Merma: aplica solo a las categorías configuradas ---
  const categoryTotals: Record<WasteCategory, Decimal> = {
    MATERIAL: materialBatch,
    WEAR: wearBatch,
    POWER: powerBatch,
    COMPONENTS: componentsBatch,
    PACKAGING: packagingBatch,
    LABOR: laborBatch,
  };
  const wastePct = D(input.waste.pct);
  const wasteBase = sum(input.waste.appliesTo.map((cat) => categoryTotals[cat]));
  const wasteAmount = wasteBase.times(wastePct);

  // --- Arranque por tanda (fuera de merma, como la mano de obra) ---
  const setupTotal = D(input.batch.setupCost).times(batchCount);

  // El desglose muestra cada categoría EN CRUDO (sin merma) y la merma como su
  // propia línea, de modo que las líneas sumen exactamente el total del lote.
  const breakdown: CostBreakdown = {
    material: toMoney(materialBatch),
    wear: toMoney(wearBatch),
    power: toMoney(powerBatch),
    components: toMoney(componentsBatch),
    packaging: toMoney(packagingBatch),
    labor: toMoney(laborBatch),
    setup: toMoney(setupTotal),
    wasteAmount: toMoney(wasteAmount),
  };

  const subtotalBeforeWaste = sum(Object.values(categoryTotals));
  const costBatchD = subtotalBeforeWaste.plus(wasteAmount).plus(setupTotal);
  const costPerUnitD = costBatchD.div(qty);

  // --- Producción por tandas: lo que muestra el slicer para UNA tanda, llevado
  //     al pedido completo. Los gramos/horas de arriba son de una tanda; el
  //     multiplicador (cantidad/piezasPorTanda) los escala al total real. ---
  const gramsPerBatch = sum(input.materials.map((m) => D(m.grams)));
  const hoursPerBatch = printer ? D(printer.hours) : new Decimal(0);
  const production: ProductionSummary = {
    piecesPerBatch: batchSize,
    batches: batchCount,
    totalGrams: gramsPerBatch.times(batchMultiplier).toDecimalPlaces(2).toNumber(),
    totalHours: hoursPerBatch.times(batchMultiplier).toDecimalPlaces(4).toNumber(),
    costPerBatch: toMoney(costPerUnitD.times(batchSize)),
    costPerUnit: toMoney(costPerUnitD),
    costTotal: toMoney(costBatchD),
  };

  // --- Precios de venta por margen (sobre el costo unitario) ---
  const prices: PriceResult[] = input.margins.markups.map((m) =>
    buildPrice(costPerUnitD, input.quantity, m, input.margins.mode, input.margins.rounding, input.surcharges),
  );

  // --- Mayoreo (los tramos se interpretan como markup sobre costo; un "100 %"
  //     de mayoreo no tiene sentido como margen sobre venta) ---
  const wholesale = buildWholesale(
    costPerUnitD,
    input.quantity,
    input.wholesale.tiers,
    input.margins.rounding,
  );

  return {
    quantity: input.quantity,
    currency: input.currency,
    locale: input.locale,
    materials,
    components,
    packaging,
    labor,
    breakdown,
    subtotalBeforeWaste: toMoney(subtotalBeforeWaste),
    costBatch: toMoney(costBatchD),
    costPerUnit: toMoney(costPerUnitD),
    prices,
    wholesale,
    production,
    batches:
      input.batch.piecesPerBatch == null
        ? null
        : {
            size: batchSize,
            count: batchCount,
            full: fullBatches,
            partialPieces,
            setupCostPerBatch: toMoney(D(input.batch.setupCost)),
            setupCostTotal: toMoney(setupTotal),
          },
  };
}

function buildPrice(
  cost: Decimal,
  quantity: number,
  marginPct: number,
  mode: MarginMode,
  rounding: Rounding,
  surcharges: { designFee: number; rushPct: number; minOrderPrice: number },
): PriceResult {
  const price = applyMargin(cost, marginPct, mode);
  const priceRounded = roundToIncrement(price, rounding.mode, rounding.increment);
  const profit = priceRounded.minus(cost);
  const realMarginOnPrice = priceRounded.gt(0) ? profit.div(priceRounded).toNumber() : 0;
  const markupOnCost = cost.gt(0) ? profit.div(cost).toNumber() : 0;

  // Ajustes al precio: diseño amortizado, luego urgencia, luego piso al total.
  const designPerUnit = D(surcharges.designFee).div(quantity);
  const withDesign = priceRounded.plus(designPerUnit);
  const rushAmount = withDesign.times(surcharges.rushPct);
  const finalPerUnit = withDesign.plus(rushAmount);
  const jobTotalRaw = finalPerUnit.times(quantity);
  const min = D(surcharges.minOrderPrice);
  const hitMinimum = jobTotalRaw.lt(min);
  const jobTotal = hitMinimum ? min : jobTotalRaw;

  return {
    marginPct,
    mode,
    price: toMoney(price),
    priceRounded: toMoney(priceRounded),
    profit: toMoney(profit),
    realMarginOnPrice,
    markupOnCost,
    designPerUnit: toMoney(designPerUnit),
    rushAmount: toMoney(rushAmount),
    finalPerUnit: toMoney(finalPerUnit),
    jobTotal: toMoney(jobTotal),
    hitMinimum,
  };
}

function buildWholesale(
  cost: Decimal,
  quantity: number,
  tiers: { minQty: number; marginPct: number }[],
  rounding: Rounding,
): WholesaleResult | null {
  if (tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  // tramo aplicable: el de mayor minQty que no supere la cantidad del pedido
  const appliedSource =
    [...sorted].reverse().find((t) => quantity >= t.minQty) ?? sorted[0];

  const tierResults: WholesaleTierResult[] = sorted.map((t) => {
    const unitPrice = applyMargin(cost, t.marginPct, 'MARKUP');
    const unitPriceRounded = roundToIncrement(unitPrice, rounding.mode, rounding.increment);
    const lotTotal = unitPriceRounded.times(quantity);
    return {
      minQty: t.minQty,
      marginPct: t.marginPct,
      unitPrice: toMoney(unitPrice),
      unitPriceRounded: toMoney(unitPriceRounded),
      lotTotal: toMoney(lotTotal),
      applies: t.minQty === appliedSource.minQty,
    };
  });

  const appliedTier = tierResults.find((t) => t.applies) ?? null;
  const retailTotal = tierResults[0].lotTotal; // tramo de menor cantidad = menudeo
  const wholesaleTotal = appliedTier ? appliedTier.lotTotal : retailTotal;

  return {
    tiers: tierResults,
    appliedTier,
    retailTotal,
    wholesaleTotal,
    savings: toMoney(D(retailTotal).minus(wholesaleTotal)),
  };
}
