-- SALDO A FAVOR CON EL PROVEEDOR (fase 3). Migración ADITIVA.
--
-- Pagaste $100 de una factura de $85: esos $15 son plata tuya que el proveedor
-- te debe. Lo único que se guarda es DE QUÉ FACTURA sale cada abono que los usa
-- —un hecho—; el saldo disponible se DERIVA (Σ pagado de más − Σ aplicado),
-- como el saldo de un préstamo o la deuda con una contraparte.
--
-- ⚠️ `ON DELETE RESTRICT`: borrar la factura que financió un abono dejaría ese
-- abono sin respaldo y el saldo a favor saldría de la nada.

-- AlterTable
ALTER TABLE "PurchaseInvoicePayment" ADD COLUMN     "tomadoDeFacturaId" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseInvoicePayment_tomadoDeFacturaId_idx" ON "PurchaseInvoicePayment"("tomadoDeFacturaId");

-- AddForeignKey
ALTER TABLE "PurchaseInvoicePayment" ADD CONSTRAINT "PurchaseInvoicePayment_tomadoDeFacturaId_fkey" FOREIGN KEY ("tomadoDeFacturaId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
