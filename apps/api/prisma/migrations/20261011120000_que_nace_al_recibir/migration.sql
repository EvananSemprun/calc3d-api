-- QUÉ NACE AL RECIBIR una línea que pide algo que todavía no está en el catálogo.
--
-- Puramente ADITIVA: un enum nuevo y una columna NULABLE. Ninguna columna
-- existente se toca y ninguna fila cambia de valor, así que no puede mover una
-- cifra. En producción hay 0 líneas con `nombreNuevo` (verificado el
-- 2026-10-09), así que nada queda con el tipo en null por arrastre.
--
-- ⚠️ Sin esta columna la recepción creaba SIEMPRE una ficha de filamento:
-- encargar una impresora nueva —el caso normal, porque una máquina nueva no
-- está en el catálogo— dejaba un rollo llamado "Impresora A2".

-- CreateEnum
CREATE TYPE "PurchaseLineNuevoTipo" AS ENUM ('MATERIAL', 'PRINTER');

-- AlterTable
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN     "nuevoTipo" "PurchaseLineNuevoTipo";
