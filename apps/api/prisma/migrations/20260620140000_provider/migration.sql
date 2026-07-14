-- Entidad Proveedor + enlace opcional desde Expense.
CREATE TABLE "Provider" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contact" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Provider_organizationId_idx" ON "Provider"("organizationId");
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD COLUMN "providerId" TEXT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
