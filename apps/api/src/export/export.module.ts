import { Controller, Get, Module, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { DocumentsModule } from '../documents/documents.module';
import { QuoteNoteService } from '../documents/quote-note.service';
import { ExportService } from './export.service';

/**
 * COTIZACIÓN PARA EL CLIENTE — cuelga del PEDIDO desde 2026-09-07.
 *
 * Cotizar dejó de ser una entidad aparte: un pedido en estado "Cotizado" ES la
 * cotización, y si el cliente acepta, ese mismo registro sigue adelante.
 */
@Controller('orders/:id')
@UseGuards(JwtAuthGuard)
export class OrderQuoteController {
  constructor(private readonly quoteNote: QuoteNoteService) {}

  /** Lo que se le manda al cliente: sin costos ni márgenes. */
  @Get('cotizacion.pdf')
  async clientQuotePdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.quoteNote.pdf(user.organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cotizacion-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}

/**
 * DESGLOSE INTERNO de una ficha del catálogo. ⚠️ NO se le manda al cliente:
 * lleva costos, márgenes y mayoreo.
 */
@Controller('store/products/:id')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Get('desglose.pdf')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.pdf(user.organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="desglose-interno-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Get('desglose.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const csv = await this.service.csv(user.organizationId, id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="desglose-interno-${id}.csv"`,
    });
    res.end(csv);
  }
}

@Module({
  imports: [DocumentsModule],
  controllers: [OrderQuoteController, ExportController],
  providers: [ExportService],
})
export class ExportModule {}
