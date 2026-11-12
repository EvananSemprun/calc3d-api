-- Moneda, tasa y «¿se te devuelve?» del abono de una factura de compra.
--
-- ADITIVA: todo nullable salvo `refundable`, que lleva DEFAULT true para no
-- alterar el histórico (así se comporta hoy: un abono de una contraparte se
-- devuelve). No hay backfill: un abono viejo se pagó en USD o no se sabe, y
-- inventarle una tasa sería mentir.
ALTER TABLE "PurchaseInvoicePayment"
  ADD COLUMN "rate" DECIMAL(18,6),
  ADD COLUMN "currencyCode" TEXT,
  ADD COLUMN "currencyLabel" TEXT,
  ADD COLUMN "amountForeign" DECIMAL(14,4),
  ADD COLUMN "refundable" BOOLEAN NOT NULL DEFAULT true;
