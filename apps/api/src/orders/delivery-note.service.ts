import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { OrderLine } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Nota de entrega en PDF, calcada del formato real del negocio: cabecera con
 * N° de nota (el correlativo del pedido) y fecha, bloque emisor/receptor, texto
 * de constancia, tabla Ítem/Descripción/Cantidad/Unidad/Observaciones (SIN
 * precios: es constancia de entrega, no factura) y doble firma de conformidad.
 */
@Injectable()
export class DeliveryNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async pdf(organizationId: string, orderId: string): Promise<Buffer> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      include: { client: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    const [org, settings] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      this.prisma.settings.findUnique({ where: { organizationId } }),
    ]);

    const lines = (order.lines as unknown as OrderLine[]) ?? [];
    const year = new Date(order.createdAt).getFullYear();
    const notaNo = `${String(order.code).padStart(3, '0')}-${year}`;
    const totalUnidades = lines.reduce((s, l) => s + Number(l.quantity), 0);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    // Cabecera
    doc.fontSize(18).fillColor('#000').text('NOTA DE ENTREGA', { align: 'center' });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor('#444')
      .text(`N.° de nota: ${notaNo}`, { align: 'center' })
      .text(`Fecha: ${new Date(order.createdAt).toLocaleDateString('es-VE')}`, { align: 'center' });
    doc.moveDown();

    // Emisor / receptor
    const emisor = org?.name ?? 'Mi negocio';
    doc.fillColor('#000').fontSize(11).text('Empresa emisora:', { continued: true }).fillColor('#333').text(`  ${emisor}`);
    if (settings?.businessRif) doc.fillColor('#000').text('C.I. / RIF:', { continued: true }).fillColor('#333').text(`  ${settings.businessRif}`);
    if (settings?.businessPhone) doc.fillColor('#000').text('Teléfono:', { continued: true }).fillColor('#333').text(`  ${settings.businessPhone}`);
    doc.moveDown(0.4);
    doc.fillColor('#000').text('Entregado a:', { continued: true }).fillColor('#333').text(`  ${order.client.name}`);
    if (order.client.rif) doc.fillColor('#000').text('C.I. / RIF:', { continued: true }).fillColor('#333').text(`  ${order.client.rif}`);
    if (order.client.phone) doc.fillColor('#000').text('Teléfono:', { continued: true }).fillColor('#333').text(`  ${order.client.phone}`);
    doc.moveDown();

    // Constancia
    doc
      .fillColor('#333')
      .fontSize(10)
      .text(
        `Por medio de la presente, ${emisor} deja constancia de la entrega de los artículos ` +
          'descritos a continuación, en buen estado y conforme a la cantidad indicada.',
        { align: 'justify' },
      );
    doc.moveDown();

    // Tabla
    const cols = [50, 90, 330, 400, 470]; // Ítem, Descripción, Cantidad, Unidad, Observaciones
    const header = (y: number) => {
      doc.fontSize(9).fillColor('#000');
      doc.text('Ítem', cols[0], y);
      doc.text('Descripción', cols[1], y);
      doc.text('Cant.', cols[2], y);
      doc.text('Unidad', cols[3], y);
      doc.text('Observaciones', cols[4], y);
      doc.moveTo(50, y + 13).lineTo(545, y + 13).strokeColor('#ccc').stroke();
    };
    let y = doc.y;
    header(y);
    y += 18;
    doc.fillColor('#333');
    lines.forEach((l, i) => {
      doc.text(String(i + 1), cols[0], y);
      doc.text(l.description, cols[1], y, { width: cols[2] - cols[1] - 6 });
      doc.text(String(l.quantity), cols[2], y);
      doc.text(l.unit ?? 'u', cols[3], y);
      doc.text('Entrega completa', cols[4], y, { width: 80 });
      y = doc.y + 6;
    });
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#ccc').stroke();
    doc.fontSize(10).fillColor('#000').text(`Total entregado: ${totalUnidades} unidades`, 50, y + 6, { align: 'right', width: 495 });
    doc.moveDown(2);

    // Observaciones
    doc.fontSize(10).fillColor('#000').text('Observaciones:');
    doc.moveDown(0.3);
    doc.strokeColor('#ccc');
    for (let i = 0; i < 2; i++) {
      const ly = doc.y + 6;
      doc.moveTo(50, ly).lineTo(545, ly).stroke();
      doc.moveDown(1.2);
    }
    doc.moveDown(2);

    // Firmas
    const signer = settings?.businessSigner ?? '';
    const fy = doc.y;
    doc.fontSize(10).fillColor('#000');
    doc.text('Entrega por ' + emisor, 50, fy);
    doc.text('Recibe conforme', 320, fy);
    doc.moveDown(2);
    const sy = doc.y;
    doc.moveTo(50, sy).lineTo(260, sy).strokeColor('#000').stroke();
    doc.moveTo(320, sy).lineTo(530, sy).stroke();
    doc.fontSize(9).fillColor('#333');
    doc.text(signer || 'Nombre y firma', 50, sy + 4);
    doc.text('Nombre y firma', 320, sy + 4);

    doc.end();
    return new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  }
}
