-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "exchangeRates" JSONB;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "exchangeRates" JSONB;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "secondaryCurrency" TEXT DEFAULT 'VES';

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_organizationId_currencyCode_createdAt_idx" ON "ExchangeRate"("organizationId", "currencyCode", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
