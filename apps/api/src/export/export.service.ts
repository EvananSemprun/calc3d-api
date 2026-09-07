import { Injectable } from '@nestjs/common';
import {
  formatMoney,
  formatPercent,
  PRICE_STATUS_LABEL,
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
    this.row(
      doc,
      `Precio sugerido (margen ${formatPercent(totals.price.markup, l, 0)})`,
      money(totals.price.suggested),
    );
    this.row(
      doc,
      'Precio final / pieza',
      `${money(totals.price.final)}${totals.price.isManual ? '  (escrito a mano)' : ''}`,
    );
    this.row(
      doc,
      'Margen real',
      `${formatPercent(totals.price.marginReal, l, 0)}  ·  ${PRICE_STATUS_LABEL[totals.price.status]}`,
    );
    this.row(doc, 'Ganancia / pieza', money(totals.price.profitPerUnit));
    if (totals.order.fromTier) {
      this.row(
        doc,
        `Descuento por cantidad (${formatPercent(totals.order.discountPct, l, 0)})`,
        `${money(totals.order.listUnitPrice)} → ${money(totals.order.unitPrice)} / pieza`,
      );
    }
    this.row(
      doc,
      'Total del pedido',
      `${money(totals.order.total)}  ·  ${PRICE_STATUS_LABEL[totals.order.status]}`,
    );
    this.row(doc, 'Ganancia del pedido', money(totals.order.profit));
    this.row(
      doc,
      'Producción',
      `${totals.production.batches} tanda(s) de ${totals.production.piecesPerBatch} pzs · ` +
        `${totals.production.machineHours} h de máquina · entrega ~${totals.production.deliveryHours} h`,
    );
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
      this.row(doc, 'Precio final / pieza', alt(totals.price.final));
      this.row(doc, 'Total del pedido', alt(totals.order.total));
      doc.moveDown();
    }

    // Desglose
    doc.fontSize(14).text('Desglose del lote');
    doc.moveDown(0.3);
    doc.fontSize(10);
    this.row(doc, 'Material', money(totals.breakdown.material));
    this.row(doc, 'Desgaste de impresora', money(totals.breakdown.wear));
    this.row(doc, 'Electricidad', money(totals.breakdown.power));
    this.row(doc, 'Insumos', money(totals.breakdown.supplies));
    this.row(doc, 'Tu tiempo', money(totals.breakdown.labor));
    this.row(doc, 'Empaque y otros', money(totals.breakdown.extras));
    this.row(doc, 'Merma', money(totals.breakdown.wasteAmount));
    doc.moveDown();

    // Insumos, línea por línea
    if (totals.supplies.length > 0) {
      doc.fontSize(14).text('Insumos');
      doc.moveDown(0.3);
      doc.fontSize(10);
      for (const item of totals.supplies) {
        this.row(
          doc,
          item.name ?? 'Insumo',
          `${money(item.perPieceCost)}/pieza · ${money(item.batchCost)} en el pedido`,
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
          `${t.minQty}+ piezas (−${formatPercent(t.discountPct, l, 0)})${t.applies ? '  ◄ aplica' : ''}`,
          `${money(t.unitPrice)}/u · margen ${formatPercent(t.marginReal, l, 0)} · ` +
            PRICE_STATUS_LABEL[t.status],
        );
      }
      this.row(doc, 'Total del pedido con el tramo aplicado', money(totals.wholesale.orderTotal));
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
      { seccion: 'desglose', concepto: 'Insumos', valor: totals.breakdown.supplies },
      { seccion: 'desglose', concepto: 'Tu tiempo', valor: totals.breakdown.labor },
      { seccion: 'desglose', concepto: 'Empaque y otros', valor: totals.breakdown.extras },
      { seccion: 'desglose', concepto: 'Merma', valor: totals.breakdown.wasteAmount },
      { seccion: 'produccion', concepto: 'Tandas', valor: totals.production.batches },
      { seccion: 'produccion', concepto: 'Piezas por tanda', valor: totals.production.piecesPerBatch },
      { seccion: 'produccion', concepto: 'Horas de máquina', valor: totals.production.machineHours },
      { seccion: 'produccion', concepto: 'Entrega estimada (h)', valor: totals.production.deliveryHours },
      { seccion: 'precio', concepto: 'Precio sugerido', valor: totals.price.suggested },
      { seccion: 'precio', concepto: 'Precio final', valor: totals.price.final },
      { seccion: 'precio', concepto: 'Margen real', valor: totals.price.marginReal },
      { seccion: 'precio', concepto: 'Estado', valor: PRICE_STATUS_LABEL[totals.price.status] },
      { seccion: 'precio', concepto: 'Precio unitario cobrado', valor: totals.order.unitPrice },
      { seccion: 'precio', concepto: 'Descuento por cantidad', valor: totals.order.discountPct },
      { seccion: 'precio', concepto: 'Total del pedido', valor: totals.order.total },
      { seccion: 'precio', concepto: 'Ganancia del pedido', valor: totals.order.profit },
      { seccion: 'precio', concepto: 'Estado del pedido', valor: PRICE_STATUS_LABEL[totals.order.status] },
    ];
    for (const item of totals.supplies) {
      rows.push({
        seccion: 'insumos',
        concepto: item.name ?? 'Insumo',
        valor: item.batchCost,
      });
    }
    if (totals.wholesale) {
      for (const t of totals.wholesale.tiers) {
        rows.push({
          seccion: 'mayoreo',
          concepto: `${t.minQty}+ piezas (−${(t.discountPct * 100).toFixed(0)}%)`,
          valor: t.unitPrice,
        });
      }
      rows.push({
        seccion: 'mayoreo',
        concepto: 'Total del pedido con el tramo aplicado',
        valor: totals.wholesale.orderTotal,
      });
    }
    return writeToString(rows, { headers: true });
  }
}
