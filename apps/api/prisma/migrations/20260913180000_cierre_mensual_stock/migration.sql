-- CreateTable
CREATE TABLE "StockMonth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "StockMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockMonth_organizationId_month_key" ON "StockMonth"("organizationId", "month");

-- AddForeignKey
ALTER TABLE "StockMonth" ADD CONSTRAINT "StockMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: todo mes YA TERMINADO que tiene conteos se da por CERRADO (decisión
-- del dueño, 2026-09-13). En la base local es agosto 2026, que vino del Excel.
-- - Solo meses terminados (en hora de Venezuela): el mes en curso no se puede
--   cerrar antes de su último día, y sus conteos se reescriben al cerrarlo.
-- - `now() AT TIME ZONE 'UTC'`: la columna no guarda zona y Prisma la lee como
--   UTC; con `now()` a secas, un servidor en otra zona guardaría la hora corrida.
-- - El id no tiene default en la base (cuid lo genera Prisma): se deriva del mes.
INSERT INTO "StockMonth" ("id", "organizationId", "month", "closedAt")
SELECT DISTINCT ON ("organizationId", "month")
  'sm_' || md5("organizationId" || "month"::text),
  "organizationId",
  "month",
  now() AT TIME ZONE 'UTC'
FROM "StockCount"
WHERE "month" < date_trunc('month', now() AT TIME ZONE 'America/Caracas')
ON CONFLICT ("organizationId", "month") DO NOTHING;
