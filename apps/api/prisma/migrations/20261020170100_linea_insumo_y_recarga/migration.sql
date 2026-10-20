-- Una línea de factura puede apuntar a un insumo que ya existe, y puede decir
-- si lo que se pidió es una recarga o un rollo con carrete.
--
-- `isRefill` NULLABLE Y SIN DEFAULT: `null` es "no se registró", no "con
-- carrete". Misma regla que `Expense.isRefill` — un default se lee después
-- como un dato (ver `paidBy DEFAULT 'BUSINESS'`, que tiñó 71 gastos).
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "componentId" TEXT;
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "isRefill" BOOLEAN;

-- RESTRICT, como `materialId` y `printerId`: borrar un insumo que una factura
-- pidió dejaría la línea sin saber qué se compró.
ALTER TABLE "PurchaseInvoiceLine"
  ADD CONSTRAINT "PurchaseInvoiceLine_componentId_fkey"
  FOREIGN KEY ("componentId") REFERENCES "Component"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
