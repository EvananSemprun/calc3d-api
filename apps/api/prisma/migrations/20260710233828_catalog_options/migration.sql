-- CreateTable
CREATE TABLE "CatalogOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogOption_organizationId_kind_idx" ON "CatalogOption"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOption_organizationId_kind_value_key" ON "CatalogOption"("organizationId", "kind", "value");

-- AddForeignKey
ALTER TABLE "CatalogOption" ADD CONSTRAINT "CatalogOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
