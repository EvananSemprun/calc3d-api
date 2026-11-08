-- AlterTable
ALTER TABLE "StoreProduct" ADD COLUMN     "publishedAt" TIMESTAMP(3);


-- Relleno: las fichas que YA estaban publicadas se dan por publicadas el dia que se
-- crearon. Es lo unico que se puede afirmar con los datos que hay.
--
-- Medido en produccion al escribir esto: el llavero de la Copa lleva 78 dias, asi que
-- NO se vuelve «Nuevo»; el arbol de Navidad se creo hoy y SI va a mostrarse como nuevo,
-- que es lo correcto. O sea que la migracion no inventa novedad en nada viejo.
--
-- Las ocultas quedan en NULL: publicarlas por primera vez pondra la fecha de ese dia.
UPDATE "StoreProduct" SET "publishedAt" = "createdAt" WHERE visible = true AND "publishedAt" IS NULL;
