-- CreateEnum
CREATE TYPE "PaidBy" AS ENUM ('BUSINESS', 'OWNER', 'LOAN');

-- CreateEnum
CREATE TYPE "OwnerMovementKind" AS ENUM ('CONTRIBUTION', 'WITHDRAWAL');

-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'DESIGN';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "paidBy" "PaidBy" NOT NULL DEFAULT 'BUSINESS';

-- AlterTable
ALTER TABLE "LoanPayment" ADD COLUMN     "paidBy" "PaidBy" NOT NULL DEFAULT 'BUSINESS';

-- CreateTable
CREATE TABLE "OwnerMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "OwnerMovementKind" NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "concept" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerMovement_organizationId_date_idx" ON "OwnerMovement"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CashCount_organizationId_date_key" ON "CashCount"("organizationId", "date");

-- AddForeignKey
ALTER TABLE "OwnerMovement" ADD CONSTRAINT "OwnerMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

