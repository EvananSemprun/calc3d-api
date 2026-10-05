-- CONSERVAR LAS FILAS: la tabla se renombra, no se recrea. `CashCount` tiene
-- los conteos de caja reales del dueño; un DROP + CREATE los borraría.
ALTER TABLE "CashCount" RENAME TO "CashReconciliation";
ALTER TABLE "CashReconciliation" RENAME CONSTRAINT "CashCount_pkey" TO "CashReconciliation_pkey";
ALTER TABLE "CashReconciliation" RENAME CONSTRAINT "CashCount_organizationId_fkey" TO "CashReconciliation_organizationId_fkey";
DROP INDEX IF EXISTS "CashCount_organizationId_date_key";
ALTER TABLE "CashReconciliation" RENAME COLUMN "total" TO "totalAmount";

-- CreateEnum
CREATE TYPE "CounterpartyKind" AS ENUM ('OWNER', 'PARTNER', 'EXTERNAL_LENDER');

-- CreateEnum
CREATE TYPE "CashAccountKind" AS ENUM ('EXCHANGE', 'BANK', 'CASH', 'WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('MANUAL', 'EXCEL_IMPORT', 'RECONCILIATION', 'MIGRATION');

-- CreateEnum
CREATE TYPE "DebtApplicationOrder" AS ENUM ('OLDEST_FIRST', 'NEWEST_FIRST');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "refundable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "refundable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
-- `counterpartyId` entra NULLABLE a propósito: lo completa el backfill de la
-- tarea 10 y una migración posterior lo endurece.
ALTER TABLE "OwnerMovement" ADD COLUMN     "cashReconciliationId" TEXT,
ADD COLUMN     "counterpartyId" TEXT,
ADD COLUMN     "refundable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "debtApplicationOrder" "DebtApplicationOrder" NOT NULL DEFAULT 'OLDEST_FIRST',
ADD COLUMN     "reconciliationFrequency" TEXT NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "reconciliationWeekday" INTEGER DEFAULT 1;

-- AlterTable
-- Columnas nuevas de la conciliación, en lugar del CREATE TABLE que Prisma
-- había generado. `accountId` y `currency` entran NULLABLE: los completa el
-- backfill. Las que ya existían (`id`, `organizationId`, `date`, `note`,
-- `createdAt`) no se tocan, y `total` ya se renombró a `totalAmount` arriba.
ALTER TABLE "CashReconciliation" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "personalAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "rate" DECIMAL(18,8),
ADD COLUMN     "totalUsd" DECIMAL(12,4),
ADD COLUMN     "personalUsd" DECIMAL(12,4),
ADD COLUMN     "expectedUsd" DECIMAL(12,4),
ADD COLUMN     "differenceUsd" DECIMAL(12,4),
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedByUserId" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `updatedAt` es `@updatedAt`: NOT NULL y SIN default en el schema. El default
-- de arriba existe solo para rellenar las filas que ya estaban; se quita acá
-- mismo para que la tabla quede igual a lo que Prisma espera (si no, la
-- próxima `migrate diff` reporta drift).
ALTER TABLE "CashReconciliation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CounterpartyKind" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CashAccountKind" NOT NULL DEFAULT 'EXCHANGE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sharedWithId" TEXT,
    "autoAttributeShortfall" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "expenseId" TEXT,
    "loanPaymentId" TEXT,
    "obligationMovementId" TEXT,
    "amount" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Counterparty_organizationId_idx" ON "Counterparty"("organizationId");

-- CreateIndex
CREATE INDEX "CashAccount_organizationId_idx" ON "CashAccount"("organizationId");

-- CreateIndex
CREATE INDEX "CashReconciliation_organizationId_date_idx" ON "CashReconciliation"("organizationId", "date");

-- CreateIndex
CREATE INDEX "CashReconciliation_accountId_idx" ON "CashReconciliation"("accountId");

-- CreateIndex
CREATE INDEX "DebtApplication_organizationId_idx" ON "DebtApplication"("organizationId");

-- CreateIndex
CREATE INDEX "DebtApplication_paymentId_idx" ON "DebtApplication"("paymentId");

-- CreateIndex
CREATE INDEX "DebtApplication_expenseId_idx" ON "DebtApplication"("expenseId");

-- CreateIndex
CREATE INDEX "DebtApplication_loanPaymentId_idx" ON "DebtApplication"("loanPaymentId");

-- CreateIndex
CREATE INDEX "DebtApplication_obligationMovementId_idx" ON "DebtApplication"("obligationMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerMovement_cashReconciliationId_key" ON "OwnerMovement"("cashReconciliationId");

-- AddForeignKey
ALTER TABLE "OwnerMovement" ADD CONSTRAINT "OwnerMovement_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerMovement" ADD CONSTRAINT "OwnerMovement_cashReconciliationId_fkey" FOREIGN KEY ("cashReconciliationId") REFERENCES "CashReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAccount" ADD CONSTRAINT "CashAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAccount" ADD CONSTRAINT "CashAccount_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- `CashReconciliation_organizationId_fkey` NO se crea acá: ya existe, se
-- renombró arriba junto con la tabla.
ALTER TABLE "CashReconciliation" ADD CONSTRAINT "CashReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashReconciliation" ADD CONSTRAINT "CashReconciliation_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OwnerMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_loanPaymentId_fkey" FOREIGN KEY ("loanPaymentId") REFERENCES "LoanPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_obligationMovementId_fkey" FOREIGN KEY ("obligationMovementId") REFERENCES "OwnerMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índices parciales y CHECK que Prisma no sabe declarar en el schema.

-- Una conciliación viva por cuenta y día. Una ANULADA no bloquea rehacerla.
CREATE UNIQUE INDEX "CashReconciliation_org_account_date_live_key"
  ON "CashReconciliation" ("organizationId", "accountId", "date")
  WHERE "status" <> 'VOID';

-- Una contraparte por defecto por organización.
CREATE UNIQUE INDEX "Counterparty_org_default_key"
  ON "Counterparty" ("organizationId")
  WHERE "isDefault";

-- Una aplicación cancela EXACTAMENTE UNA obligación.
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_una_obligacion"
  CHECK (
    (("expenseId" IS NOT NULL)::int
     + ("loanPaymentId" IS NOT NULL)::int
     + ("obligationMovementId" IS NOT NULL)::int) = 1
  );

-- Un importe aplicado siempre es positivo.
ALTER TABLE "DebtApplication" ADD CONSTRAINT "DebtApplication_monto_positivo"
  CHECK ("amount" > 0);
