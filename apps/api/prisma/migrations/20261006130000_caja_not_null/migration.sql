-- Después del backfill, los tres campos ya tienen valor en todas las filas.
ALTER TABLE "CashReconciliation" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "CashReconciliation" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "OwnerMovement" ALTER COLUMN "counterpartyId" SET NOT NULL;
