-- PROVEEDORES: una sola puerta, la del directorio.
--
-- Había DOS formas de registrar un proveedor que no se hablaban entre sí: la
-- tabla `Provider` (nombre y teléfono, nada más), que es a la que apuntaba el
-- campo "Proveedor" de un gasto, y el directorio de Contactos con su tipo
-- SUPPLIER, que además guarda RIF, dirección, ciudad y punto en el mapa. Se
-- queda el directorio.
--
-- ⚠️ La copia CONSERVA EL id. Es lo que hace que esto sea seguro: un
-- `Expense.providerId` que apuntaba a la tabla vieja sigue siendo válido
-- apuntando al contacto. Si se generaran ids nuevos, cada gasto con proveedor
-- quedaría colgando y el `ON DELETE SET NULL` los pondría en null en silencio.
--
-- ⚠️ El `INSERT` y el `DROP` van en la MISMA migración a propósito: separarlos
-- deja una ventana en la que el dueño puede perder la fila si lo segundo se
-- aplica y lo primero no.
--
-- `contact` de Provider era un teléfono, así que entra como `phone`. El
-- directorio muestra esa columna; `contact` es el campo libre heredado.

-- 1. Los proveedores pasan a ser contactos, con su mismo id.
INSERT INTO "Client" ("id", "organizationId", "name", "type", "phone", "createdAt")
SELECT "id", "organizationId", "name", 'SUPPLIER'::"ContactType", "contact", "createdAt"
FROM "Provider"
ON CONFLICT ("id") DO NOTHING;

-- 2. El gasto deja de apuntar a la tabla vieja y apunta al contacto.
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_providerId_fkey";
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Recién ahora, con todo apuntando al directorio, se va la tabla.
DROP TABLE "Provider";
