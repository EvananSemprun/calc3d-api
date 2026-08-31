-- Logo del negocio (para el encabezado de la nota de entrega y la cotización).
-- Se guarda en la BD, no en disco: el disco de Render es efímero.
ALTER TABLE "Settings" ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logoMime" TEXT;

-- Correlativo por organización para el N.º de cotización del documento.
ALTER TABLE "Quote" ADD COLUMN     "code" INTEGER;

-- Relleno de los presupuestos ya existentes: numerados por organización en
-- orden de creación, para que el correlativo respete la historia.
WITH numerados AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS n
  FROM "Quote"
)
UPDATE "Quote" q
SET "code" = numerados.n
FROM numerados
WHERE q.id = numerados.id;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_code_key" ON "Quote"("organizationId", "code");
