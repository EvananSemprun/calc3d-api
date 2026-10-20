-- Recarga (sin carrete) o rollo con carrete, por COMPRA.
--
-- Aditiva y NULLABLE SIN DEFAULT a propósito: `null` significa "no se
-- registró", no "con carrete". Poner un default teñiría las 95 compras
-- históricas con una afirmación que nadie hizo — exactamente lo que pasó con
-- `paidBy DEFAULT 'BUSINESS'`, que dejó 71 gastos diciendo que los pagó el
-- negocio sin que nadie lo decidiera.
ALTER TABLE "Expense" ADD COLUMN "isRefill" BOOLEAN;
