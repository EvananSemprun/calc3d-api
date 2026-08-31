import { Module } from '@nestjs/common';
import { BusinessIdentityService } from './business-identity.service';
import { DeliveryNoteService } from './delivery-note.service';
import { QuoteNoteService } from './quote-note.service';

/**
 * Documentos de cara al cliente (nota de entrega y cotización). Comparten el
 * mismo formato — `business-doc.ts` — y la misma ficha del negocio, para que no
 * se desincronicen. Los consumen `OrdersModule` y `ExportModule`.
 */
@Module({
  providers: [BusinessIdentityService, DeliveryNoteService, QuoteNoteService],
  exports: [BusinessIdentityService, DeliveryNoteService, QuoteNoteService],
})
export class DocumentsModule {}
