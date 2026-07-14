-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('CLIENT', 'SUPPLIER', 'ALLY', 'COMPETITOR');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "type" "ContactType" NOT NULL DEFAULT 'CLIENT',
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Client_organizationId_type_idx" ON "Client"("organizationId", "type");
