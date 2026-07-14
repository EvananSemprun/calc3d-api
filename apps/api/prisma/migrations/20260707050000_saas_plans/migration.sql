-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('TRIAL', 'TALLER', 'PRO');
CREATE TYPE "PaymentMethod" AS ENUM ('PAGO_MOVIL', 'ZELLE', 'TRANSFER', 'CASH', 'OTHER');
CREATE TYPE "PaymentReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: plan de la organización. Las orgs EXISTENTES se dan por vigentes a
-- largo plazo (no se auto-bloquean); las nuevas arrancan en TRIAL (lo fija el registro).
ALTER TABLE "Organization"
  ADD COLUMN "plan" "PlanTier" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "planExpiresAt" TIMESTAMP(3);
UPDATE "Organization" SET "plan" = 'PRO', "planExpiresAt" = '2100-01-01T00:00:00.000Z';

-- AlterTable: superadmin de plataforma.
ALTER TABLE "User" ADD COLUMN "isSuperadmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL,
    "months" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentReport_organizationId_idx" ON "PaymentReport"("organizationId");
CREATE INDEX "PaymentReport_status_idx" ON "PaymentReport"("status");

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
