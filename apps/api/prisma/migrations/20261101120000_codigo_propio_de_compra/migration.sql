-- CÓDIGO PROPIO DE CADA COMPRA (2026-11-01).
--
-- Hasta acá la única identidad de una compra era `reference`, que es el número
-- que le pone EL PROVEEDOR. Eso dejaba compras sin nombre ("(sin número)") y
-- permitía que dos proveedores usaran el mismo "0003" sin que la app los
-- distinguiera. Ahora la compra tiene código propio y `reference` queda como
-- lo que siempre fue: el número del proveedor.
--
-- Los tres pasos van en el MISMO archivo a propósito: la columna no puede
-- quedar NOT NULL antes de rellenarla, y dejar el despliegue a mitad de camino
-- (columna nullable sin índice) sería peor que no migrar.

-- 1) La columna, nullable por ahora.
ALTER TABLE "PurchaseInvoice" ADD COLUMN "code" INTEGER;

-- 2) El correlativo, por organización y en el orden en que se compró. El
--    desempate por `createdAt` y después por `id` hace que el resultado sea
--    el MISMO si esto se corriera de nuevo: sin un orden total, dos facturas
--    del mismo día podrían intercambiarse los códigos entre base y base.
WITH numeradas AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "organizationId"
           ORDER BY "date", "createdAt", "id"
         ) AS n
    FROM "PurchaseInvoice"
)
UPDATE "PurchaseInvoice" AS p
   SET "code" = numeradas.n
  FROM numeradas
 WHERE p."id" = numeradas."id";

-- 3) Obligatoria y única. Si algún día quedara una fila sin código, es mejor
--    que el despliegue falle acá y no que la compra salga sin identidad.
ALTER TABLE "PurchaseInvoice" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "PurchaseInvoice_organizationId_code_key"
    ON "PurchaseInvoice"("organizationId", "code");

-- La misma factura del mismo proveedor no se carga dos veces. Postgres trata
-- los NULL como distintos, así que varias compras SIN número del proveedor
-- conviven sin chocar, que es justo lo que se quiere.
CREATE UNIQUE INDEX "PurchaseInvoice_organizationId_supplierId_reference_key"
    ON "PurchaseInvoice"("organizationId", "supplierId", "reference");
