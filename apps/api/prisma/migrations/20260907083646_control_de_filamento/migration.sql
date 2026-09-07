-- Control de filamento: estado del color (activo/descontinuado) y conteo
-- FÍSICO de rollos al cierre de mes. El total no se guarda: se deriva.

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');
-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "status" "MaterialStatus" NOT NULL DEFAULT 'ACTIVE';
-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "sealed" INTEGER NOT NULL DEFAULT 0,
    "inUse" INTEGER NOT NULL DEFAULT 0,
    "running" INTEGER NOT NULL DEFAULT 0,
    "needsBrandCheck" BOOLEAN NOT NULL DEFAULT false,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "StockCount_organizationId_month_idx" ON "StockCount"("organizationId", "month");
-- CreateIndex
CREATE UNIQUE INDEX "StockCount_materialId_month_key" ON "StockCount"("materialId", "month");
-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
