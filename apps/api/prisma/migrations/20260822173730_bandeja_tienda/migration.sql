-- CreateEnum
CREATE TYPE "StoreRequestKind" AS ENUM ('ORDER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StoreRequestStatus" AS ENUM ('NEW', 'CONFIRMED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "AttributionChannel" ADD VALUE 'STORE';

-- CreateTable
CREATE TABLE "StoreRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "StoreRequestKind" NOT NULL,
    "status" "StoreRequestStatus" NOT NULL DEFAULT 'NEW',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerPhoneKey" TEXT NOT NULL,
    "customerNote" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "totalUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "clientId" TEXT,
    "orderId" TEXT,

    CONSTRAINT "StoreRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreRequest_orderId_key" ON "StoreRequest"("orderId");

-- CreateIndex
CREATE INDEX "StoreRequest_organizationId_status_idx" ON "StoreRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StoreRequest_organizationId_createdAt_idx" ON "StoreRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreRequest_clientId_idx" ON "StoreRequest"("clientId");

-- AddForeignKey
ALTER TABLE "StoreRequest" ADD CONSTRAINT "StoreRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreRequest" ADD CONSTRAINT "StoreRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreRequest" ADD CONSTRAINT "StoreRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
