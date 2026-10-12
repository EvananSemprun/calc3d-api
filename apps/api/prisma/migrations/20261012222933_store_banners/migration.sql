-- CreateEnum
CREATE TYPE "StoreBannerLinkType" AS ENUM ('NONE', 'CATEGORY', 'PRODUCT', 'URL');

-- CreateTable
CREATE TABLE "StoreBanner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageKey" TEXT NOT NULL,
    "linkType" "StoreBannerLinkType" NOT NULL DEFAULT 'NONE',
    "linkValue" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreBanner_organizationId_idx" ON "StoreBanner"("organizationId");

-- CreateIndex
CREATE INDEX "StoreBanner_organizationId_visible_idx" ON "StoreBanner"("organizationId", "visible");

-- AddForeignKey
ALTER TABLE "StoreBanner" ADD CONSTRAINT "StoreBanner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
