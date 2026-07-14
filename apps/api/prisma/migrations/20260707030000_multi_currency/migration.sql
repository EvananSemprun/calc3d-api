-- ExchangeRate: nombre (identidad) de la tasa. Las tasas existentes se bautizan
-- por su moneda (VES → "Bolívar (BCV)").
ALTER TABLE "ExchangeRate" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';
UPDATE "ExchangeRate" SET "label" = CASE WHEN "currencyCode" = 'VES' THEN 'Bolívar (BCV)' ELSE "currencyCode" END;

-- CreateIndex
CREATE INDEX "ExchangeRate_organizationId_label_createdAt_idx" ON "ExchangeRate"("organizationId", "label", "createdAt" DESC);

-- Settings: tasa con nombre usada por defecto en la vista ambiental (dual en vivo).
ALTER TABLE "Settings" ADD COLUMN     "defaultRateLabel" TEXT;
UPDATE "Settings" SET "defaultRateLabel" = 'Bolívar (BCV)' WHERE "secondaryCurrency" = 'VES';

-- Documentos: moneda de presentación elegida (null = solo USD).
ALTER TABLE "Quote" ADD COLUMN     "currencyLabel" TEXT;
ALTER TABLE "Order" ADD COLUMN     "currencyLabel" TEXT;
ALTER TABLE "Product" ADD COLUMN     "currencyLabel" TEXT;
