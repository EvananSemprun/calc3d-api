-- El FONDO del hero: la imagen grande detrás del texto, a todo el ancho.
--
-- ADITIVA y nullable: todo banner que ya existe queda sin fondo, que es exactamente
-- como se venía viendo. No hay backfill que hacer ni dato que traducir.
ALTER TABLE "StoreBanner" ADD COLUMN "backgroundKey" TEXT;
