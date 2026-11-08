-- CreateEnum
CREATE TYPE "StoreBannerKind" AS ENUM ('HERO', 'TEXTO', 'CATEGORIA');

-- AlterTable
ALTER TABLE "StoreBanner" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "kind" "StoreBannerKind" NOT NULL DEFAULT 'HERO',
ALTER COLUMN "imageKey" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "StoreBanner_organizationId_kind_visible_idx" ON "StoreBanner"("organizationId", "kind", "visible");

-- AddForeignKey
ALTER TABLE "StoreBanner" ADD CONSTRAINT "StoreBanner_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StoreCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

