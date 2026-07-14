-- Publicidad como gasto con período: categoría nueva + fin de período.
ALTER TYPE "ExpenseCategory" ADD VALUE 'ADVERTISING';

ALTER TABLE "Expense" ADD COLUMN "endDate" TIMESTAMP(3);
