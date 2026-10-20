-- La ficha de filamento que nace al recibir, con su marca, tipo y color.
--
-- Sin esto nacía MUDA (solo nombre y precio) y quedaba FUERA del precio de
-- cotización: `preciosPorTipo` saltea toda ficha sin tipo (`if (!type)
-- continue`). Los tres son nullable: una línea del catálogo no los usa, y
-- `null` sigue significando "no se dijo".
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "nuevaMarca" TEXT;
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "nuevoTipoFilamento" TEXT;
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "nuevoColor" TEXT;
