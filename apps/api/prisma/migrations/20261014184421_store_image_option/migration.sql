-- AlterTable
ALTER TABLE "StoreImage" ADD COLUMN     "optionId" TEXT;

-- CreateIndex
CREATE INDEX "StoreImage_optionId_idx" ON "StoreImage"("optionId");

-- AddForeignKey
ALTER TABLE "StoreImage" ADD CONSTRAINT "StoreImage_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "StoreOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
