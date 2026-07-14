/*
  Warnings:

  - You are about to drop the column `zone` on the `Client` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Client" DROP COLUMN "zone",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "municipality" TEXT;
