import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  // Lo usa `PurchaseInvoicesService` al recibir una compra: el precio del rollo
  // tiene que salir de la MISMA regla. Recalcularlo aparte daría dos verdades
  // el día que la regla cambie.
  exports: [ExpensesService],
})
export class ExpensesModule {}
