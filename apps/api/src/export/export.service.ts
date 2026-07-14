import { Injectable } from '@nestjs/common';
import {
  formatMoney,
  formatPercent,
  pickSuggestedPrice,
  priceFinalPerUnit,
  priceHasSurcharges,
  priceJobTotal,
  type CalcResult,
  type ExchangeRateSnapshot,
} from '@calc3d/shared';
import PDFDocument from 'pdfkit';
import { writeToString } from 'fast-csv';
import { QuotesService } from '../quotes/quotes.service';

@Injectable()
export class ExportService {
  constructor(private readonly quotes: QuotesService) {}

  private async load(organizationId: string, id: string) {
    const quote = await this.quotes.get(organizationId, id);
    const totals = quote.totals as unknown as CalcResult;
    return { quote, totals };
  }

  /** Genera el PDF de la cotización con desglose y precios. */
  async pdf(organizationId: string, id: string): Promise<Buffer> {
    const { quote, totals } = await this.load(organizationId, id);
    const c = totals.currency;
    const l = totals.locale;
    const money = (n: number) => formatMoney(n, c, l);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Encabezado
    doc.fontSize(20).text('Cotización', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#444').text(quote.name);
    doc
      .fontSize(10)
      .fillColor('#666')
      .text(`Cantidad: ${totals.quantity} piezas`)
      .text(`Versión: ${quote.version}    Estado: ${quote.status}`)
      .text(`Fecha: ${new Date(quote.createdAt).toLocaleDateString(l)}`);
    doc.moveDown();

    // Resumen
    doc.fillColor('#000').fontSize(14).text('Resumen');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Costo real (lote)', money(totals.costBatch));
    this.row(doc, 'Costo por unidad', money(totals.costPerUnit));
    for (const p of totals.prices) {
      this.row(
        doc,
        `Venta ${formatPercent(p.marginPct, l, 0)} (${p.mode === 'MARKUP' ? 'markup' : 'margen'})`,
        `${money(p.priceRounded)}  ·  ganancia ${money(p.profit)}/pieza`,
      );
    }
    // Extras de cotización (diseño/urgencia/mínimo) y tandas — opcional-seguro
    // para snapshots creados antes de la Fase 2A.
    const chosen = pickSuggestedPrice(totals.prices);
    if (chosen && priceHasSurcharges(chosen)) {
      if (chosen.designPerUnit) this.row(doc, 'Tarifa de diseño / pieza', money(chosen.designPerUnit));
      if (chosen.rushAmount) this.row(doc, 'Recargo por urgencia / pieza', money(chosen.rushAmount));
      this.row(doc, 'Precio final / pieza', money(priceFinalPerUnit(chosen)));
      this.row(
        doc,
        `Total del pedido${chosen.hitMinimum ? ' (mínimo aplicado)' : ''}`,
        money(priceJobTotal(chosen, totals.quantity)),
      );
    }
    if (totals.batches) {
      this.row(
        doc,
        'Tandas',
        `${totals.batches.count} (${totals.batches.full} llenas` +
          `${totals.batches.partialPieces > 0 ? ` + 1 de ${totals.batches.partialPieces} pzs` : ''})`,
      );
    }
    doc.moveDown();

    // Equivalente en moneda secundaria con la tasa CONGELADA en el presupuesto.
    // El snapshot trae solo la moneda secundaria de la organización.
    const snap = (quote.exchangeRates ?? null) as ExchangeRateSnapshot | null;
    const frozen = snap ? Object.entries(snap)[0] : undefined;
    if (frozen) {
      const [code, fr] = frozen;
      const alt = (n: number) => formatMoney(n * fr.rate, code, 'es-VE');
      doc
        .fontSize(14)
        .text(code === 'VES' ? 'Equivalente en bolívares' : `Equivalente en ${code}`, 50);
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .fillColor('#666')
        .text(
          `Tasa congelada: ${fr.rate.toLocaleString('es-VE')} ${code}/${c} ` +
            `(${fr.source === 'AUTO' ? 'BCV' : 'manual'}, ${new Date(fr.at).toLocaleDateString('es-VE')})`,
          50,
        );
      doc.fillColor('#000').fontSize(10);
      this.row(doc, 'Costo real (lote)', alt(totals.costBatch));
      this.row(doc, 'Costo por unidad', alt(totals.costPerUnit));
      for (const p of totals.prices) {
        this.row(doc, `Venta ${formatPercent(p.marginPct, l, 0)}`, alt(p.priceRounded));
      }
      doc.moveDown();
    }

    // Desglose
    doc.fontSize(14).text('Desglose del lote');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Material', money(totals.breakdown.material));
    this.row(doc, 'Desgaste de impresora', money(totals.breakdown.wear));
    this.row(doc, 'Electricidad', money(totals.breakdown.power));
    this.row(doc, 'Componentes', money(totals.breakdown.components));
    this.row(doc, 'Empaque', money(totals.breakdown.packaging));
    this.row(doc, 'Mano de obra', money(totals.breakdown.labor));
    if ((totals.breakdown.setup ?? 0) > 0) {
      this.row(doc, 'Arranque de tandas', money(totals.breakdown.setup));
    }
    this.row(doc, 'Merma', money(totals.breakdown.wasteAmount));
    doc.moveDown();

    // Componentes (logística de compra)
    if (totals.components.length > 0) {
      doc.fontSize(14).text('Componentes (compra por paquete)');
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const comp of totals.components) {
        this.row(
          doc,
          comp.name ?? 'Componente',
          `${comp.totalUnits} u · ${comp.packagesToBuy} paq · sobran ${comp.leftover} · ${money(comp.appliedCost)}`,
        );
      }
      doc.moveDown();
    }

    // Mayoreo
    if (totals.wholesale) {
      doc.fontSize(14).text('Mayoreo');
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const t of totals.wholesale.tiers) {
        this.row(
          doc,
          `${t.minQty}+ piezas (${formatPercent(t.marginPct, l, 0)})${t.applies ? '  ◄ aplica' : ''}`,
          `${money(t.unitPriceRounded)}/u · total ${money(t.lotTotal)}`,
        );
      }
      this.row(doc, 'Ahorro vs menudeo', money(totals.wholesale.savings));
    }

    doc.end();
    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private row(doc: PDFKit.PDFDocument, label: string, value: string) {
    const y = doc.y;
    doc.text(label, 50, y, { continued: false, width: 300 });
    doc.text(value, 350, y, { width: 200, align: 'right' });
    doc.moveDown(0.2);
  }

  /** Genera el CSV de la cotización. */
  async csv(organizationId: string, id: string): Promise<string> {
    const { totals } = await this.load(organizationId, id);
    const rows: Record<string, string | number>[] = [
      { seccion: 'resumen', concepto: 'Cantidad', valor: totals.quantity },
      { seccion: 'resumen', concepto: 'Costo real (lote)', valor: totals.costBatch },
      { seccion: 'resumen', concepto: 'Costo por unidad', valor: totals.costPerUnit },
      { seccion: 'desglose', concepto: 'Material', valor: totals.breakdown.material },
      { seccion: 'desglose', concepto: 'Desgaste', valor: totals.breakdown.wear },
      { seccion: 'desglose', concepto: 'Electricidad', valor: totals.breakdown.power },
      { seccion: 'desglose', concepto: 'Componentes', valor: totals.breakdown.components },
      { seccion: 'desglose', concepto: 'Empaque', valor: totals.breakdown.packaging },
      { seccion: 'desglose', concepto: 'Mano de obra', valor: totals.breakdown.labor },
      { seccion: 'desglose', concepto: 'Merma', valor: totals.breakdown.wasteAmount },
    ];
    if ((totals.breakdown.setup ?? 0) > 0) {
      rows.push({ seccion: 'desglose', concepto: 'Arranque de tandas', valor: totals.breakdown.setup });
    }
    if (totals.batches) {
      rows.push({ seccion: 'tandas', concepto: 'Número de tandas', valor: totals.batches.count });
      rows.push({ seccion: 'tandas', concepto: 'Tandas llenas', valor: totals.batches.full });
      rows.push({ seccion: 'tandas', concepto: 'Piezas en tanda parcial', valor: totals.batches.partialPieces });
    }
    for (const p of totals.prices) {
      rows.push({
        seccion: 'precios',
        concepto: `Venta ${(p.marginPct * 100).toFixed(0)}%`,
        valor: p.priceRounded,
      });
    }
    if (totals.wholesale) {
      for (const t of totals.wholesale.tiers) {
        rows.push({
          seccion: 'mayoreo',
          concepto: `${t.minQty}+ piezas (${(t.marginPct * 100).toFixed(0)}%)`,
          valor: t.lotTotal,
        });
      }
    }
    return writeToString(rows, { headers: true });
  }
}
