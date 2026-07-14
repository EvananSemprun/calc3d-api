-- 1) Componente gana 'scope' (los existentes = por pieza).
ALTER TABLE "Component" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'PER_PIECE';

-- 2) Migrar cada Empaque a Componente (conservando id, para no romper enlaces).
INSERT INTO "Component" ("id", "organizationId", "name", "packagePrice", "unitsPerPackage", "scope", "createdAt")
SELECT "id", "organizationId", "name", "packagePrice", "unitsPerPackage", "scope", "createdAt"
FROM "Packaging";

-- 3) Reapuntar los gastos enlazados a empaque hacia componente (eran excluyentes).
UPDATE "Expense" SET "componentId" = "packagingId" WHERE "packagingId" IS NOT NULL;

-- 4) Rehacer el CHECK de enlace único sin packagingId, y soltar la columna+FK.
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_single_link";
ALTER TABLE "Expense" DROP COLUMN "packagingId";
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_single_link"
  CHECK (num_nonnulls("materialId", "printerId", "componentId") <= 1);

-- 5) Eliminar la tabla Packaging.
DROP TABLE "Packaging";
