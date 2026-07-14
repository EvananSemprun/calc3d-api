-- A lo sumo uno de los enlaces polimórficos del gasto puede ser no-nulo.
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_single_link"
  CHECK (num_nonnulls("materialId", "printerId", "componentId", "packagingId") <= 1);
