// Backfill Camino B: registra la compra (inversión) de la impresora 'a1' con
// fecha 2026-01-02 y borra el material 'PLA' (definición huérfana).
// Idempotente: no duplica el gasto de la a1.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const printer = await prisma.printer.findFirst({ where: { name: 'a1' } });
  if (printer) {
    // Limpia gastos "Compra inicial a1" sueltos (sin enlazar) del mismo org.
    await prisma.expense.deleteMany({
      where: { organizationId: printer.organizationId, description: 'Compra inicial a1', printerId: null },
    });
    const existing = await prisma.expense.findFirst({ where: { printerId: printer.id } });
    if (!existing) {
      await prisma.expense.create({
        data: {
          organizationId: printer.organizationId,
          printerId: printer.id,
          date: new Date('2026-01-02'),
          category: 'EQUIPMENT',
          description: 'Compra inicial a1',
          amount: printer.price,
          isInvestment: true,
        },
      });
      console.log('Gasto de inversión (enlazado a la a1) creado.');
    } else {
      console.log('La a1 ya tiene gasto enlazado; no se duplica.');
    }
  } else {
    console.log('No se encontró la impresora a1; nada que registrar.');
  }

  const pla = await prisma.material.findFirst({ where: { name: 'PLA' } });
  if (pla) {
    await prisma.material.delete({ where: { id: pla.id } });
    console.log('Material PLA borrado (huérfano).');
  } else {
    console.log('No se encontró el material PLA; nada que borrar.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
