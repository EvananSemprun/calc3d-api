-- Una sola cuenta PRINCIPAL por organización, igual que `Counterparty`.
--
-- `Counterparty` ya tenía su índice parcial desde la fase 1
-- (`Counterparty_org_default_key`); `CashAccount` quedó sin el equivalente, así
-- que "solo puede haber una principal" lo sostenía únicamente el código. Si
-- algún día otro camino escribe `isDefault` —la multicuenta real, un script—
-- no habría red. Prisma no declara índices parciales: va a mano.
--
-- Por si alguna organización ya tuviera dos, se deja la más antigua.
UPDATE "CashAccount" a
SET "isDefault" = false
WHERE a."isDefault"
  AND a."id" <> (
    SELECT b."id" FROM "CashAccount" b
    WHERE b."organizationId" = a."organizationId" AND b."isDefault"
    ORDER BY b."createdAt" ASC, b."id" ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX "CashAccount_org_default_key"
  ON "CashAccount" ("organizationId")
  WHERE "isDefault";
