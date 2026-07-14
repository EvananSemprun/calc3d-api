-- CreateEnum
CREATE TYPE "CampaignPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'GOOGLE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('SALES', 'MESSAGES', 'VISITS', 'FOLLOWERS', 'AWARENESS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'FINISHED');

-- CreateEnum
CREATE TYPE "AttributionChannel" AS ENUM ('ORGANIC', 'INSTAGRAM_ADS', 'FACEBOOK_ADS', 'TIKTOK_ADS', 'GOOGLE_ADS', 'WHATSAPP', 'REFERRAL', 'OTHER');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "rate" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "originChannel" "AttributionChannel";

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "originChannel" "AttributionChannel";

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "originChannel" "AttributionChannel";

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "CampaignPlatform" NOT NULL DEFAULT 'OTHER',
    "objective" "CampaignObjective",
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "budget" DECIMAL(12,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_campaignId_idx" ON "Expense"("campaignId");

-- CreateIndex
CREATE INDEX "Order_campaignId_idx" ON "Order"("campaignId");

-- CreateIndex
CREATE INDEX "Quote_campaignId_idx" ON "Quote"("campaignId");

-- CreateIndex
CREATE INDEX "Sale_campaignId_idx" ON "Sale"("campaignId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
