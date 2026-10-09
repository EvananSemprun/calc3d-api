-- QUIÉN PUSO LA PLATA: un solo campo, la contraparte.
--
-- Esta es la SEGUNDA de las dos migraciones de Préstamos. La primera
-- (`20261009120000_prestamos_contraparte`) agregó `counterpartyId` sin tocar
-- nada, y `backfill-pagadores.mjs` tradujo el enum a contrapartes. Esta borra
-- el enum, que desde entonces era información duplicada que había que
-- mantener sincronizada a mano en cuatro lugares.
--
-- ⚠️ **Esto NO se puede deshacer.** El enum es el único registro de quién
-- pagó para una fila sin contraparte. Antes de aplicarla se verificó contra
-- producción que no hay ninguna:
--
--     GASTOS  BUSINESS  sin contraparte   72
--     GASTOS  OWNER     con contraparte   14
--     GASTOS  LOAN      con contraparte    1
--     CUOTAS  OWNER     con contraparte    5
--     incoherentes (paidBy <> BUSINESS y sin contraparte): 0
--
-- Si alguna vez hay que aplicarla sobre otra base, correr ANTES el backfill y
-- repetir esa cuenta: con una sola fila incoherente, el dato se pierde.
--
-- ⚠️ El enum no distinguía socios: OWNER era "alguna persona". Con dos
-- personas poniendo plata, los gastos de ambas se mezclaban y cada una veía
-- como propia la deuda de la otra. Por eso el reemplazo no es cosmético.

ALTER TABLE "Expense" DROP COLUMN "paidBy";
ALTER TABLE "LoanPayment" DROP COLUMN "paidBy";

DROP TYPE "PaidBy";
