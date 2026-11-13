import { BadRequestException } from '@nestjs/common';
import {
  conciliacionesQueSeInvalidan,
  mensajeDeConciliacionAfectada,
  type ConciliacionParaAviso,
} from '@calc3d/shared';

/**
 * EL AVISO DE CONCILIACIÓN, en el servicio (2026-11-12, fase B tarea 8).
 *
 * Cargar un movimiento con fecha igual o anterior a una conciliación la deja
 * mintiendo, y nadie lo notaba: una CONFIRMADA solo muestra `stale` al expandir
 * la fila, y una DRAFT cambia su esperado en silencio.
 *
 * Es el mismo candado BLANDO que `confirmoFueraDePlazo` de Compras: el servidor
 * corta con 400 y un mensaje que dice qué pasó y cómo seguir; el cliente
 * reintenta con `confirmoConciliacion: true`. No impide nada.
 *
 * ⚠️ Va en el SERVIDOR y no solo en el formulario: un aviso dibujado solo en
 * una pantalla no avisa a la otra puerta (un import, un script, otra pantalla).
 * Y la REGLA (qué fechas invalidan qué) vive en `shared`, no acá, para que el
 * panel pueda mostrarla sin adivinarla y las dos definiciones no se separen.
 *
 * ⚠️ **No filtra por cuenta, a propósito.** El esperado es GLOBAL: con ~100
 * pagos históricos sin cuenta, mirar solo la cuenta de la conciliación dejaría
 * pasar justo esos movimientos (y, aguas abajo, filtrar el ESPERADO por cuenta
 * inventaría un faltante que con `autoAttributeShortfall` se vuelve deuda
 * saldada). Se pregunta por TODA conciliación vigente de la organización.
 *
 * ⚠️ La consulta va SIEMPRE por `organizationId`: una conciliación ajena no
 * puede frenar ni ensuciar el mensaje de otro negocio.
 */

/** Lo único que la guarda necesita de Prisma: así los specs no armen una base entera. */
export interface PrismaConConciliaciones {
  cashReconciliation: {
    findMany(args: {
      where: { organizationId: string; status: { not: 'VOID' } };
      select: { id: true; date: true; status: true };
    }): Promise<ConciliacionParaAviso[]>;
  };
}

/**
 * Corta con 400 si alguna de las `fechas` cae dentro de una conciliación y el
 * cliente no confirmó.
 *
 * `fechas` es una LISTA porque editar mueve un movimiento: la fecha vieja y la
 * nueva cambian el esperado de las conciliaciones que las cubren. Vacía = nada
 * que mover, no se consulta.
 */
export async function exigirConfirmacionDeConciliacion(
  prisma: PrismaConConciliaciones,
  organizationId: string,
  fechas: ReadonlyArray<Date | string>,
  confirmo?: boolean,
): Promise<void> {
  // Confirmó: ya sabe lo que hace. Sin fechas: no hay nada que invalidar.
  if (confirmo || fechas.length === 0) return;

  const conciliaciones = await prisma.cashReconciliation.findMany({
    where: { organizationId, status: { not: 'VOID' } },
    select: { id: true, date: true, status: true },
  });
  // El filtro de verdad es el de `shared` (el único que sabe qué cuenta como
  // "dentro"), no el `where`: así no hay dos definiciones de "afectada".
  const afectadas = conciliacionesQueSeInvalidan(fechas, conciliaciones);
  if (afectadas.length === 0) return;

  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: mensajeDeConciliacionAfectada(afectadas),
    // Para que el panel ofrezca "anular esta conciliación" sin adivinar cuál.
    conciliacionesAfectadas: afectadas.map((c) => ({
      id: c.id,
      date: c.date instanceof Date ? c.date.toISOString().slice(0, 10) : c.date.slice(0, 10),
      status: c.status,
    })),
  });
}
