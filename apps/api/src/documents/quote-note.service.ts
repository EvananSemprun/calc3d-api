import { Injectable, NotFoundException } from '@nestjs/common';
import {
  formatMoney,
  orderTotal,
  type ExchangeRateSnapshot,
  type OrderLine,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessDoc, type ItemsColumn } from './business-doc';
import { BusinessIdentityService } from './business-identity.service';
import { QUOTE_VALIDITY_DAYS, documentNumber, formatDate, validUntil } from './document-format';

/**
 * COTIZACIÓN PARA EL CLIENTE, en el mismo formato que la nota de entrega.
 *
 * Sale de un **PEDIDO** (2026-09-07): cotizar dejó de ser una entidad aparte y
 * pasó a ser el primer estado del pedido. Un pedido en `QUOTED` ya tiene
 * cliente, líneas, moneda y su documento; si el cliente acepta, ese mismo
 * registro sigue adelante en vez de copiarse a otro lado.
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

  async pdf(organizationId: string, orderId: string): Promise<Buffer> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      include: { client: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const me = await this.identity.load(organizationId);
    const lines = (order.lines ?? []) as unknown as OrderLine[];
    if (lines.length === 0) {
      throw new NotFoundException('El pedido no tiene artículos que cotizar');
    }

    const currency = 'USD';
    const money = (n: number) => formatMoney(n, currency, 'en-US');
    const total = orderTotal(lines);

    const doc = new BusinessDoc({
      emisor: me.emisor,
      logo: me.logo,
      footerNote: 'Cotización',
    });

    doc.header();

    const vence = validUntil(order.createdAt);
    const cabecera: Array<[string, string, string, string]> = [
      [
        'N.º de cotización:',
        documentNumber(order.code, order.createdAt),
        'Fecha:',
        formatDate(order.createdAt),
      ],
      ['Empresa emisora:', me.emisor, 'Cliente:', order.client?.name ?? '—'],
      ['C.I. / RIF:', me.rif || '—', 'Teléfono:', me.phone || '—'],
    ];
    if (order.client?.rif || order.client?.phone) {
      cabecera.push([
        'C.I. / RIF del cliente:',
        order.client.rif || '—',
        'Teléfono del cliente:',
        order.client.phone || '—',
      ]);
    }
    cabecera.push(['Válida hasta:', formatDate(vence), '', '']);
    doc.keyValueTable(cabecera);

    doc.title('COTIZACIÓN');
    doc.sectionTitle('DETALLE DE LA COTIZACIÓN:');
    doc.paragraph(
      `Por medio de la presente, ${me.emisor} presenta la cotización de los artículos ` +
        `descritos a continuación. Los montos están expresados en ${currency} e incluyen ` +
        `materiales, producción y acabado. Esta cotización tiene una validez de ` +
        `${QUOTE_VALIDITY_DAYS} días, hasta el ${formatDate(vence)}.`,
    );
    doc.gap(8);

    // Un renglón por línea del pedido: los precios ya son los acordados, así
    // que no hay precio de lista ni descuento que desglosar.
    const rows = lines.map((l, i) => [
      String(i + 1),
      l.description,
      `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`,
      money(l.unitPrice),
      money(l.quantity * l.unitPrice),
    ]);

    doc.itemsTable(QuoteNoteService.COLUMNS, rows, `Total: ${money(total)}`);

    // Equivalente en la moneda de presentación con la tasa CONGELADA del
    // pedido (el motor no convierte: esto es solo presentación).
    const snap = (order.exchangeRates ?? null) as ExchangeRateSnapshot | null;
    const frozen = snap ? Object.entries(snap)[0] : undefined;
    if (frozen) {
      const [code, fr] = frozen;
      doc.gap(10);
      doc.note(
        `Equivalente en ${code}: ${formatMoney(total * fr.rate, code, 'es-VE')} ` +
          `(tasa ${fr.label ?? code} de ${fr.rate.toLocaleString('es-VE')} ${code}/${currency}, ` +
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
