-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "saleStartsAt" TIMESTAMP(3),
ADD COLUMN     "saleTitle" TEXT;
