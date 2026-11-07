-- Una categoría de la tienda puede colgar de una madre (subcategorías).
-- Nullable y sin DEFAULT a propósito: las categorías que ya existen son raíces,
-- y NULL es exactamente eso. Un DEFAULT les pondría una madre que nadie eligió.
-- ON DELETE RESTRICT: borrar una madre con hijas falla en vez de borrarlas en
-- silencio (CASCADE) o subirlas a la raíz sin avisar (SET NULL). El servicio
-- da el mensaje; la base es la última línea de defensa.
ALTER TABLE "StoreCategory" ADD COLUMN "parentId" TEXT;
CREATE INDEX "StoreCategory_parentId_idx" ON "StoreCategory"("parentId");
ALTER TABLE "StoreCategory" ADD CONSTRAINT "StoreCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "StoreCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
