-- Lo que pagó el cliente EN SU MONEDA, tal cual se escribió.
-- Aditiva y NULLABLE a propósito: los abonos que ya existen se cobraron en USD
-- o con la tasa congelada del pedido, y ninguno tiene este dato. Un DEFAULT
-- los haría afirmar un monto que nadie registró (la lección de `paidBy`).
ALTER TABLE "Payment" ADD COLUMN "amountForeign" DECIMAL(14,4);
