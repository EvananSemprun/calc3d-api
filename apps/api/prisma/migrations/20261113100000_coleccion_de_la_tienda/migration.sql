-- Coleccion principal de la tienda: la coleccion, sus items (categorias o productos
-- sueltos) y sus exclusiones.
--
-- ADITIVA: tres tablas nuevas, ninguna columna ni dato existente se toca.

CREATE TYPE "StoreCollectionVerTodo" AS ENUM ('CATEGORIA', 'COLECCION', 'NONE');

CREATE TABLE "StoreCollection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "subtitulo" TEXT,
    "verTodoTipo" "StoreCollectionVerTodo" NOT NULL DEFAULT 'NONE',
    "verTodoValor" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreCollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "categoryId" TEXT,
    "productId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StoreCollectionItem_pkey" PRIMARY KEY ("id"),
    -- Exactamente UNO de los dos: una fila con los dos (o con ninguno) no significa nada,
    -- y es la tabla la que lo impide, no solo el servicio.
    CONSTRAINT "StoreCollectionItem_uno_solo_chk"
      CHECK (("categoryId" IS NOT NULL) <> ("productId" IS NOT NULL))
);

CREATE TABLE "StoreCollectionExclusion" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "StoreCollectionExclusion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreCollection_organizationId_slug_key" ON "StoreCollection"("organizationId", "slug");
CREATE INDEX "StoreCollection_organizationId_idx" ON "StoreCollection"("organizationId");

CREATE UNIQUE INDEX "StoreCollectionItem_collectionId_categoryId_key" ON "StoreCollectionItem"("collectionId", "categoryId");
CREATE UNIQUE INDEX "StoreCollectionItem_collectionId_productId_key" ON "StoreCollectionItem"("collectionId", "productId");
CREATE INDEX "StoreCollectionItem_collectionId_idx" ON "StoreCollectionItem"("collectionId");
CREATE INDEX "StoreCollectionItem_categoryId_idx" ON "StoreCollectionItem"("categoryId");
CREATE INDEX "StoreCollectionItem_productId_idx" ON "StoreCollectionItem"("productId");

CREATE UNIQUE INDEX "StoreCollectionExclusion_collectionId_productId_key" ON "StoreCollectionExclusion"("collectionId", "productId");
CREATE INDEX "StoreCollectionExclusion_productId_idx" ON "StoreCollectionExclusion"("productId");

ALTER TABLE "StoreCollection" ADD CONSTRAINT "StoreCollection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCollectionItem" ADD CONSTRAINT "StoreCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "StoreCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCollectionItem" ADD CONSTRAINT "StoreCollectionItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StoreCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCollectionItem" ADD CONSTRAINT "StoreCollectionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StoreProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCollectionExclusion" ADD CONSTRAINT "StoreCollectionExclusion_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "StoreCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCollectionExclusion" ADD CONSTRAINT "StoreCollectionExclusion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "StoreProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
