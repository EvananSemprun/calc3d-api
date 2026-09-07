import { Injectable, NotFoundException } from '@nestjs/common';
import {
  formatMoney,
  formatPercent,
  type CalcResult,
  type ExchangeRateSnapshot,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessDoc, type ItemsColumn } from './business-doc';
import { BusinessIdentityService } from './business-identity.service';
import { QUOTE_VALIDITY_DAYS, documentNumber, formatDate, validUntil } from './document-format';

/**
 * COTIZACIÓN PARA EL CLIENTE, en el mismo formato que la nota de entrega.
 *
 * ⚠️ Este documento sale del negocio: muestra SOLO lo que el cliente compra
 * (descripción, cantidad, precio unitario y total). NO lleva costos, desglose
 * ni márgenes — para eso está el PDF interno de `ExportService`, que es de uso
 * propio y nunca se le manda a un cliente. Si alguien agrega acá una línea de
 * costo o de margen, está publicando la ganancia del negocio.
 */
@Injectable()
export class QuoteNoteService {
  /** Columnas en puntos; suman el ancho útil de la página (511,2 pt). */
  private static readonly COLUMNS: ItemsColumn[] = [
    { label: 'Ítem', width: 32.5, align: 'center' },
    { label: 'Descripción', width: 215 },
    { label: 'Cantidad', width: 52.5, align: 'center' },
    { label: 'P. unitario', width: 105.6, align: 'right' },
    { label: 'Total', width: 105.6, align: 'right' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: BusinessIdentityService,
  ) {}

  async pdf(organizationId: string, quoteId: string): Promise<Buffer> {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, organizationId },
      include: { client: true },
    });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');

    const me = await this.identity.load(organizationId);
    const totals = quote.totals as unknown as CalcResult;
    const money = (n: number) => formatMoney(n, totals.currency, totals.locale);
    const qty = totals.quantity;
    const precio = totals.price?.final;

    if (!precio) {
      throw new NotFoundException('El presupuesto no tiene un precio calculado');
    }

    // Lo que se COBRA sale de `order`: si el pedido alcanzó un tramo de mayoreo,
    // el cliente paga ese precio. El panel y este documento leen el mismo campo
    // justamente para no poder decir cifras distintas.
    const listaUnit = totals.order?.listUnitPrice ?? precio;
    const total = totals.order?.total ?? precio * qty;
    const descuento = totals.order?.discountPct ?? 0;

    const doc = new BusinessDoc({
      emisor: me.emisor,
      logo: me.logo,
      footerNote: 'Cotización',
    });

    doc.header();

    const vence = validUntil(quote.createdAt);
    const cabecera: Array<[string, string, string, string]> = [
      [
        'N.º de cotización:',
        documentNumber(quote.code, quote.createdAt),
        'Fecha:',
        formatDate(quote.createdAt),
      ],
      ['Empresa emisora:', me.emisor, 'Cliente:', quote.client?.name ?? '—'],
      ['C.I. / RIF:', me.rif || '—', 'Teléfono:', me.phone || '—'],
    ];
    if (quote.client?.rif || quote.client?.phone) {
      cabecera.push([
        'C.I. / RIF del cliente:',
        quote.client.rif || '—',
        'Teléfono del cliente:',
        quote.client.phone || '—',
      ]);
    }
    cabecera.push(['Válida hasta:', formatDate(vence), 'Versión:', String(quote.version)]);
    doc.keyValueTable(cabecera);

    doc.title('COTIZACIÓN');
    doc.sectionTitle('DETALLE DE LA COTIZACIÓN:');
    doc.paragraph(
      `Por medio de la presente, ${me.emisor} presenta la cotización de los artículos ` +
        `descritos a continuación. Los montos están expresados en ${totals.currency} e incluyen ` +
        `materiales, producción y acabado. Esta cotización tiene una validez de ` +
        `${QUOTE_VALIDITY_DAYS} días, hasta el ${formatDate(vence)}.`,
    );
    doc.gap(8);

    // Renglón del producto a precio de LISTA y, si lo hubo, el descuento por
    // cantidad como concepto propio: el cliente tiene que VER lo que ganó por
    // comprar más. Mandarle el precio rebajado pelado pierde ese argumento.
    const rows: string[][] = [
      ['1', quote.name, String(qty), money(listaUnit), money(listaUnit * qty)],
    ];
    if (descuento > 0) {
      const ahorroUnit = listaUnit - (totals.order?.unitPrice ?? listaUnit);
      rows.push([
        '2',
        `Descuento por cantidad (${formatPercent(descuento, totals.locale, 0)})`,
        String(qty),
        `-${money(ahorroUnit)}`,
        `-${money(ahorroUnit * qty)}`,
      ]);
    }

    doc.itemsTable(QuoteNoteService.COLUMNS, rows, `Total: ${money(total)}`);

    if (descuento > 0) {
      doc.gap(6);
      doc.note(
        `Precio por unidad con el descuento aplicado: ${money(totals.order?.unitPrice ?? precio)}.`,
      );
    }

    // Equivalente en la moneda de presentación con la tasa CONGELADA al crear
    // el presupuesto (el motor no convierte: esto es solo presentación).
    const snap = (quote.exchangeRates ?? null) as ExchangeRateSnapshot | null;
    const frozen = snap ? Object.entries(snap)[0] : undefined;
    if (frozen) {
      const [code, fr] = frozen;
      doc.gap(10);
      doc.note(
        `Equivalente en ${code}: ${formatMoney(total * fr.rate, code, 'es-VE')} ` +
          `(tasa ${fr.label ?? code} de ${fr.rate.toLocaleString('es-VE')} ${code}/${totals.currency}, ` +
          `${formatDate(fr.at)}). Sujeto a la tasa del día de pago.`,
      );
    }

    doc.ruledLines('Observaciones:');
    doc.signatures({
      heading: 'Firmas de conformidad',
      leftTitle: `Emite ${me.emisor}`,
      rightTitle: 'Acepta el cliente',
      leftName: me.signer,
      leftRif: me.rif,
    });

    return doc.finish();
  }
}
