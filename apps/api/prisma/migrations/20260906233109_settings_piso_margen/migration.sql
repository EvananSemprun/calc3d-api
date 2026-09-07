-- Piso de margen real configurable (60 % por defecto, el de la hoja).
-- Bajo ese margen la calculadora avisa en rojo: no bloquea la venta, pero no
-- deja bajar el precio en silencio.
ALTER TABLE "Settings" ADD COLUMN     "minMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0.6;
