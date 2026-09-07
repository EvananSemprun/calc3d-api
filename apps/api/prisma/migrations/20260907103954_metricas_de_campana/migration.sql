-- Lo que reporta la plataforma de anuncios. Es la unica medida de una campana
-- que todavia no genero venta atribuida.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "conversations" INTEGER,
ADD COLUMN     "profileVisits" INTEGER,
ADD COLUMN     "reach" INTEGER;
