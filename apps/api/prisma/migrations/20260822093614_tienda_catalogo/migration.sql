-- Catálogo de tienda: ficha pública (StoreProduct) separada del Product interno,
-- con sus fotos en almacenamiento externo, sus grupos de opciones y categorías.
-- No hay stock: la producción es bajo pedido (leadTimeDays ocupa ese lugar).


-- CreateEnum
CREATE TYPE "StoreProductKind" AS ENUM ('PHYSICAL', 'SERVICE');

-- CreateTable
CREATE TABLE "StoreCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StoreProductKind" NOT NULL DEFAULT 'PHYSICAL',
    "summary" TEXT,
    "description" TEXT,
    "priceUsd" DECIMAL(12,4) NOT NULL,
    "compareAtUsd" DECIMAL(12,4),
    "leadTimeDays" INTEGER,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "productId" TEXT,
    "quoteId" TEXT,
    "costAtPublish" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreImage" (
    "id" TEXT NOT NULL,
    "storeProductId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOptionGroup" (
    "id" TEXT NOT NULL,
    "storeProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreOptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priceDeltaUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "swatchHex" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreCategory_organizationId_idx" ON "StoreCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCategory_organizationId_slug_key" ON "StoreCategory"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "StoreProduct_organizationId_idx" ON "StoreProduct"("organizationId");

-- CreateIndex
CREATE INDEX "StoreProduct_organizationId_visible_idx" ON "StoreProduct"("organizationId", "visible");

-- CreateIndex
CREATE INDEX "StoreProduct_categoryId_idx" ON "StoreProduct"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_organizationId_slug_key" ON "StoreProduct"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "StoreImage_storeProductId_idx" ON "StoreImage"("storeProductId");

-- CreateIndex
CREATE INDEX "StoreOptionGroup_storeProductId_idx" ON "StoreOptionGroup"("storeProductId");

-- CreateIndex
CREATE INDEX "StoreOption_groupId_idx" ON "StoreOption"("groupId");

-- AddForeignKey
ALTER TABLE "StoreCategory" ADD CONSTRAINT "StoreCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StoreCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreImage" ADD CONSTRAINT "StoreImage_storeProductId_fkey" FOREIGN KEY ("storeProductId") REFERENCES "StoreProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOptionGroup" ADD CONSTRAINT "StoreOptionGroup_storeProductId_fkey" FOREIGN KEY ("storeProductId") REFERENCES "StoreProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOption" ADD CONSTRAINT "StoreOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StoreOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

