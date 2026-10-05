-- De dónde salió cada venta y cada abono: la insignia "Importado" del
-- desplegable de la Caja.
--
-- `Expense`, `LoanPayment` y `OwnerMovement` ya tenían `source` desde la fase
-- 1. Sin esta columna, el detalle de "Ventas cobradas" mostraría las 112
-- ventas que vinieron del Excel SIN la insignia mientras el de "Gastos
-- generales" las muestra con ella: el dueño concluiría que esas ventas las
-- cargó él a mano.
--
-- Puramente ADITIVA: dos ADD COLUMN con DEFAULT. No hay backfill acá — marcar
-- lo importado es trabajo del script `prisma/backfill-importado.mjs`, que corre
-- aparte, en seco por defecto y con reversa. Una migración que escribiera datos
-- se aplicaría sola al arrancar el contenedor en Render, sin que nadie mire.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'MANUAL';
