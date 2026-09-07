-- Un solo margen objetivo, no tres precios a elegir (shared 0.7.0).
--
-- Sin backfill a propósito: el default 1.0 (100 %) es el margen que usa la hoja
-- "Costeo" del Excel, que es la referencia de la calculadora nueva. Quien tenía
-- otros márgenes cargados los vuelve a fijar en Configuración.
ALTER TABLE "Settings" DROP COLUMN "componentProrationMode",
DROP COLUMN "defaultMargins",
DROP COLUMN "marginMode",
DROP COLUMN "wasteAppliesTo",
ADD COLUMN     "defaultMarkup" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
