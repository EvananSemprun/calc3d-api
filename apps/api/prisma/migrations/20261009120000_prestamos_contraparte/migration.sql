-- PRESTAMOS: acreedor, quien aporta cada pago, anulacion y moneda.
--
-- ⚠️ MIGRACION 1 DE 2, Y LAS DOS NO PUEDEN IR EN EL MISMO DESPLIEGUE.
-- Esta es PURAMENTE ADITIVA: agrega columnas nulables (o con default) junto a
-- `paidBy`, que sigue vivo. Entre esta y la siguiente tiene que correr
-- `prisma/backfill-pagadores.mjs`, que traduce el enum a contrapartes.
--
-- `migrate deploy` aplica TODAS las pendientes seguidas al arrancar el
-- contenedor: si la migracion 2 (que borra `paidBy`) se commitea junto con
-- esta, borra el enum antes de que nadie lo haya traducido y el motor queda
-- leyendo contrapartes que no existen. Es el mismo error que en la fase 1 de
-- Caja dejo DebtApplication en cero y la deuda inflada en $475,14.

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "counterpartyId" TEXT;

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "concept" TEXT,
ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "nextDueDate" TIMESTAMP(3),
ADD COLUMN     "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "interestAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "rate" DECIMAL(18,6),
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CashAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

