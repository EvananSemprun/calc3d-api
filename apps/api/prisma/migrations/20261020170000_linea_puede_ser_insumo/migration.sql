-- Un valor nuevo del enum, SOLO. Va en su propia migración a propósito:
-- Postgres no deja USAR un valor de enum en la misma transacción en que se
-- agrega, y Prisma envuelve cada archivo en una. `migrate deploy` aplica las
-- pendientes seguidas, así que la siguiente ya lo encuentra confirmado.
ALTER TYPE "PurchaseLineNuevoTipo" ADD VALUE 'COMPONENT';
