-- BACKFILL MÍNIMO + NOT NULL, en SQL puro y en una sola migración.
--
-- ⚠️ Por qué esto NO puede ser "primero la migración, después el script":
-- el Dockerfile corre `prisma migrate deploy` al arrancar el contenedor, y eso
-- aplica TODAS las migraciones pendientes seguidas. Con el `SET NOT NULL` en
-- una migración aparte, se aplicaría inmediatamente después de la anterior —
-- antes de que nadie pueda correr `backfill-caja.mjs`— y fallaría con
-- "la columna contiene valores null". El contenedor no arrancaría y la API
-- quedaría caída. Verificado contra un clon de la base el 2026-10-05.
--
-- Entonces: acá va SOLO lo que se puede resolver en SQL y hace falta para que
-- el NOT NULL sea válido (crear la contraparte y la cuenta, y apuntar las FKs).
-- Lo que necesita el motor de cálculo —congelar las conciliaciones heredadas y
-- el reparto FIFO de los retiros— queda en `prisma/backfill-caja.mjs`, que
-- escribe columnas que siguen siendo nullable y por eso puede correr después,
-- cuando el dueño quiera.

-- 1. Una contraparte OWNER por organizacion.
--    ⚠️ El nombre es un PROVISIONAL: no hay en los datos ninguna fuente
--    confiable del nombre real de la persona (el de la organizacion es el del
--    negocio, y el del usuario suele ser un alias). Lo renombra el dueno.
INSERT INTO "Counterparty" ("id", "organizationId", "name", "kind", "isDefault", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Propietario', 'OWNER', true, true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "Counterparty" c WHERE c."organizationId" = o."id" AND c."kind" = 'OWNER'
);

-- 2. Una cuenta compartida por organización, apuntando a esa contraparte.
--    `autoAttributeShortfall` arranca APAGADA a propósito: atribuir un faltante
--    convierte un desconocido en una deuda saldada, y eso lo decide el dueño.
INSERT INTO "CashAccount" ("id", "organizationId", "name", "kind", "currency", "shared", "sharedWithId", "autoAttributeShortfall", "active", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'Binance', 'EXCHANGE', 'USD', true,
       (SELECT c."id" FROM "Counterparty" c WHERE c."organizationId" = o."id" AND c."kind" = 'OWNER' LIMIT 1),
       false, true, true, now(), now()
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "CashAccount" a WHERE a."organizationId" = o."id" AND a."isDefault"
);

-- 3. Apuntar las FKs de lo que ya existía.
UPDATE "OwnerMovement" m
SET "counterpartyId" = (
  SELECT c."id" FROM "Counterparty" c
  WHERE c."organizationId" = m."organizationId" AND c."kind" = 'OWNER' LIMIT 1
)
WHERE m."counterpartyId" IS NULL;

UPDATE "CashReconciliation" r
SET "accountId" = (
      SELECT a."id" FROM "CashAccount" a
      WHERE a."organizationId" = r."organizationId" AND a."isDefault" LIMIT 1
    ),
    "currency" = COALESCE(r."currency", 'USD')
WHERE r."accountId" IS NULL OR r."currency" IS NULL;

-- 4. Recién ahora el NOT NULL es válido.
ALTER TABLE "CashReconciliation" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "CashReconciliation" ALTER COLUMN "currency" SET NOT NULL;
ALTER TABLE "OwnerMovement" ALTER COLUMN "counterpartyId" SET NOT NULL;
