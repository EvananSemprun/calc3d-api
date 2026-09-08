-- AlterTable
ALTER TABLE "Order" DROP COLUMN "machineHours";

-- CreateTable
CREATE TABLE "PrinterReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrinterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrinterReading_organizationId_idx" ON "PrinterReading"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrinterReading_printerId_month_key" ON "PrinterReading"("printerId", "month");

-- AddForeignKey
ALTER TABLE "PrinterReading" ADD CONSTRAINT "PrinterReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterReading" ADD CONSTRAINT "PrinterReading_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

