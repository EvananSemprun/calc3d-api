/*
  Warnings:

  - You are about to drop the `FilamentPurchase` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "FilamentPurchase" DROP CONSTRAINT "FilamentPurchase_materialId_fkey";

-- DropForeignKey
ALTER TABLE "FilamentPurchase" DROP CONSTRAINT "FilamentPurchase_organizationId_fkey";

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "componentId" TEXT,
ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "packagingId" TEXT,
ADD COLUMN     "printerId" TEXT,
ADD COLUMN     "quantity" INTEGER;

-- DropTable
DROP TABLE "FilamentPurchase";

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "Packaging"("id") ON DELETE SET NULL ON UPDATE CASCADE;
