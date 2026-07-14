-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyLabel" TEXT,
ADD COLUMN     "rate" DECIMAL(18,6);
