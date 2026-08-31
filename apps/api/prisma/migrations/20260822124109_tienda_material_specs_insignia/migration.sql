-- Datos de vitrina que pedía el diseño y no existían: material, insignia,
-- personalizable y una ficha técnica libre (JSON de pares label/valor, para
-- no migrar cada vez que aparece una especificación nueva).


-- AlterTable
ALTER TABLE "StoreProduct" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "custom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "specs" JSONB NOT NULL DEFAULT '[]';

