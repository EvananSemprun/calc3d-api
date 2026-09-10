-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "StoreProduct" DROP CONSTRAINT "StoreProduct_quoteId_fkey";

-- AlterTable
ALTER TABLE "Sale" DROP COLUMN "quoteId";

-- AlterTable
ALTER TABLE "StoreProduct" DROP COLUMN "quoteId";

-- DropTable
DROP TABLE "Quote";

-- DropEnum
DROP TYPE "QuoteStatus";

