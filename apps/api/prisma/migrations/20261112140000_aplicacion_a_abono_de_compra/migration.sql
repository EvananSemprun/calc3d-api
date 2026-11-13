-- Una aplicación de deuda ahora puede cancelar un ABONO A UNA FACTURA DE COMPRA
-- que puso la contraparte de su bolsillo (origen PURCHASE de las obligaciones).
--
-- ADITIVA: una columna nullable y un índice. El CHECK se ENSANCHA a cuatro
-- orígenes con el MISMO nombre, así que ninguna fila existente lo viola (todas
-- suman 1 con las tres columnas de antes) y no quedan dos nombres distintos
-- entre bases.
ALTER TABLE "DebtApplication" ADD COLUMN "purchasePaymentId" TEXT;

CREATE INDEX "DebtApplication_purchasePaymentId_idx" ON "DebtApplication"("purchasePaymentId");

ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_purchasePaymentId_fkey"
  FOREIGN KEY ("purchasePaymentId") REFERENCES "PurchaseInvoicePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DebtApplication" DROP CONSTRAINT "DebtApplication_una_obligacion";
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_una_obligacion"
  CHECK (
    (("expenseId" IS NOT NULL)::int
     + ("loanPaymentId" IS NOT NULL)::int
     + ("obligationMovementId" IS NOT NULL)::int
     + ("purchasePaymentId" IS NOT NULL)::int) = 1
  );
