-- Quitar la capa SaaS: planes, pago manual, superadmin, verificación de email y
-- links públicos de pedidos. Conserva el resto de los datos del negocio.

-- DropForeignKey
ALTER TABLE "PaymentReport" DROP CONSTRAINT "PaymentReport_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentReport" DROP CONSTRAINT "PaymentReport_reviewedById_fkey";

-- DropIndex
DROP INDEX "Order_publicToken_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "publicToken";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "plan",
DROP COLUMN "planExpiresAt",
DROP COLUMN "trialEndsAt";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "emailVerified",
DROP COLUMN "isSuperadmin";

-- DropTable
DROP TABLE "PaymentReport";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PaymentReportStatus";

-- DropEnum
DROP TYPE "PlanTier";
