-- Link público de solo lectura: token no adivinable por pedido.
ALTER TABLE "Order" ADD COLUMN "publicToken" TEXT;
CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");
