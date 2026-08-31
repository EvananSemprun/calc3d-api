import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrderLine } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessDoc, type ItemsColumn } from './business-doc';
import { BusinessIdentityService } from './business-identity.service';
import { documentNumber, formatDate } from './document-format';

/**
 * Nota de entrega en PDF, calcada de la plantilla real del negocio: logo,
 * cabecera con N.º de nota (el correlativo del pedido), fecha, emisor y
 * receptor; texto de constancia; tabla Ítem/Descripción/Cantidad/Unidad/
 * Observaciones (SIN precios: es constancia de entrega, no factura); caja de
 * total entregado, renglones para anotar a mano y doble firma.
 *
 * Todo sale de la base: el documento no lleva ningún dato escrito a mano.
 */
@Injectable()
export class DeliveryNoteService {
  /** Columnas en puntos; suman el ancho útil de la página (511,2 pt). */
  private static readonly COLUMNS: ItemsColumn[] = [
    { label: 'Ítem', width: 32.5, align: 'center' },
    { label: 'Descripción', width: 215 },
    { label: 'Cantidad', width: 52.5, align: 'center' },
    { label: 'Unidad', width: 45, align: 'center' },
    { label: 'Observaciones', width: 166.2 },
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
    const lines = (order.lines as unknown as OrderLine[]) ?? [];
    const totalUnidades = lines.reduce((sum, l) => sum + Number(l.quantity), 0);
    const fecha = order.deliveryDate ?? order.createdAt;

    const doc = new BusinessDoc({
      emisor: me.emisor,
      logo: me.logo,
      footerNote: 'Documento de control de entrega',
    });

    doc.header();

    const cabecera: Array<[string, string, string, string]> = [
      ['N.º de nota:', documentNumber(order.code, order.createdAt), 'Fecha:', formatDate(fecha)],
      ['Empresa emisora:', me.emisor, 'Entregado a:', order.client.name],
      ['C.I. / RIF:', me.rif || '—', 'Teléfono:', me.phone || '—'],
    ];
    if (order.client.rif || order.client.phone) {
      cabecera.push([
        'C.I. / RIF del cliente:',
        order.client.rif || '—',
        'Teléfono del cliente:',
        order.client.phone || '—',
      ]);
    }
    doc.keyValueTable(cabecera);

    doc.title('NOTA DE ENTREGA');
    doc.sectionTitle('DETALLE DE ENTREGA:');
    doc.paragraph(
      `Por medio de la presente, ${me.emisor} deja constancia de la entrega de los ` +
        'artículos descritos a continuación, en buen estado y conforme a la cantidad indicada.',
    );
    doc.gap(8);

    doc.itemsTable(
      DeliveryNoteService.COLUMNS,
      lines.map((l, i) => [
        String(i + 1),
        l.description,
        String(l.quantity),
        l.unit ?? 'Unidad',
        'Entrega completa',
      ]),
      `Total entregado: ${totalUnidades} unidades`,
    );

    if (order.notes) {
      doc.gap(10);
      doc.note(`Notas del pedido: ${order.notes}`);
    }

    doc.ruledLines('Observaciones:');
    doc.signatures({
      heading: 'Firmas de conformidad',
      leftTitle: `Entrega por ${me.emisor}`,
      rightTitle: 'Recibe conforme',
      leftName: me.signer,
      leftRif: me.rif,
    });

    return doc.finish();
  }
}
