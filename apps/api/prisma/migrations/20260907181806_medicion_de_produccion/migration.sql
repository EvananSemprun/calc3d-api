-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "machineHours" DECIMAL(12,4),
ADD COLUMN     "printerId" TEXT,
ADD COLUMN     "reprints" INTEGER;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

