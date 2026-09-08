-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "StoreProduct" DROP CONSTRAINT "StoreProduct_productId_fkey";

-- AlterTable
ALTER TABLE "StoreProduct" DROP COLUMN "productId";

-- DropTable
DROP TABLE "Product";

