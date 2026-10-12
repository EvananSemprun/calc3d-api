import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  businessCash,
  reconcile,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
} from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';
import { destinoDe, dia, n } from './helpers-de-caja';
import { cargarDatosDeCaja, obligacionesDe } from './datos-de-caja';
import { aUsd, repartoDeFaltante } from './conciliacion';

/**
 * ESCRIBIR UNA CONCILIACIÓN: guardarla, confirmarla y anularla.
 *
 * ⚠️ **Ninguna devuelve el resumen, y eso es lo que las dejó salir del
 * servicio** (2026-10-11). Las tres terminaban en `return this.summary(...)`,
 * y por eso la primera pasada del refactor las dejó donde estaban: moverlas
 * parecía exigir pasarse el servicio entero como parámetro, o sea una
 * dependencia circular disfrazada. La salida era más simple de lo que
 * parecía: **escribir y devolver el resumen son dos cosas distintas**. Acá se
 * escribe; el servicio compone, llama a `summary()` y responde. Cada endpoint
 * sigue devolviendo exactamente lo mismo que antes.
 *
 * ⚠️ Lo que DECIDE (a quién se le atribuye un faltante, cómo se reparte) vive
 * en `conciliacion.ts`. Acá solo se escribe lo ya decidido, en transacción.
 */

export async function guardarConciliacion(
prisma: PrismaService,
organizationId: string,
dto: CashReconciliationUpsertDto,
) {
  const cuenta = await prisma.cashAccount.findFirst({
    where: { id: dto.accountId, organizationId },
  });
  if (!cuenta) throw new NotFoundException('No existe esa cuenta');

  const date = new Date(`${dto.date}T00:00:00.000Z`);
  const viva = await prisma.cashReconciliation.findFirst({
    where: { organizationId, accountId: dto.accountId, date, status: { not: 'VOID' } },
  });
  if (viva?.status === 'CONFIRMED') {
    throw new ConflictException('Esa conciliación ya está confirmada. Anulala y hacé una nueva.');
  }

  const datos = {
    totalAmount: dto.totalAmount,
    personalAmount: dto.personalAmount,
    currency: dto.currency,
    rate: dto.currency === 'USD' ? null : dto.rate,
    note: dto.note ?? null,
  };

  if (viva) {
    await prisma.cashReconciliation.update({ where: { id: viva.id }, data: datos });
  } else {
    await prisma.cashReconciliation.create({
      data: { organizationId, accountId: dto.accountId, date, status: 'DRAFT', ...datos },
    });
  }
}

/**
 * CONFIRMAR: congela los importes, calcula la diferencia y —si la cuenta lo
 * tiene activado y el dueño no pidió otra cosa— registra el faltante como
 * salida hacia la contraparte, aplicándolo FIFO a sus deudas.
 *
 * ⚠️ Idempotente: solo corre sobre un DRAFT. Re-confirmar da 409, y además
 * `OwnerMovement.cashReconciliationId` es único en la base, así que ni
 * forzándolo se crearía un segundo ajuste.
 *
 * ⚠️ Una diferencia A FAVOR no genera NADA: no se convierte en venta, ni en
 * ganancia, ni en aporte. Su origen no se conoce.
 *
 * ⚠️ El ajuste va fechado el día de la conciliación, no hoy: así baja el
 * saldo esperado A ESA FECHA y la conciliación queda cuadrada.
 */
export async function confirmarConciliacion(
prisma: PrismaService,
organizationId: string,
id: string,
dto: CashReconciliationConfirmDto,
userId: string,
) {
  const c = await prisma.cashReconciliation.findFirst({
    where: { id, organizationId },
    include: { account: true },
  });
  if (!c) throw new NotFoundException('No existe esa conciliación');
  if (c.status !== 'DRAFT') {
    throw new ConflictException('Esa conciliación ya se confirmó o se anuló');
  }

  const d = await cargarDatosDeCaja(prisma, organizationId);
  const fecha = dia(c.date);
  const expectedUsd = businessCash(d.ledger, fecha).balance;
  const totalUsd = aUsd(n(c.totalAmount), c.rate);
  const personalUsd = aUsd(n(c.personalAmount), c.rate);
  const r = reconcile({ expectedUsd, totalUsd, personalUsd });

  const atribuir =
    r.kind === 'SHORT' &&
    c.account.shared &&
    c.account.autoAttributeShortfall &&
    dto.attributeShortfall &&
    c.account.sharedWithId != null;

  const destino = destinoDe(dto);
  // ⚠️ Una deuda destino que no se va a usar NO se ignora en silencio. El
  // dueño pidió que el faltante fuera contra ESA deuda; confirmar sin
  // hacerlo y sin decir nada es la misma mentira que el endpoint de
  // previsualización existe para evitar.
  if (destino && !atribuir) {
    throw new BadRequestException(
      'Esta conciliación no va a atribuir ningún faltante, así que no hay deuda destino que elegir',
    );
  }

  /**
   * El reparto se calcula ANTES de abrir la transacción: si la deuda destino
   * no es una de las elegibles, el 400 sale sin haber escrito nada.
   */
  const contraparte = atribuir ? c.account.sharedWithId! : null;
  const monto = Math.abs(r.differenceUsd);
  const plan = contraparte
    ? repartoDeFaltante(obligacionesDe(d, contraparte, fecha), monto, d.order, destino)
    : null;

  await prisma.$transaction(async (tx) => {
    if (contraparte && plan) {
      const ajuste = await tx.ownerMovement.create({
        data: {
          organizationId,
          date: c.date,
          kind: 'WITHDRAWAL',
          amount: monto,
          concept: `Faltante de la conciliación del ${fecha}`,
          counterpartyId: contraparte,
          refundable: true,
          source: 'RECONCILIATION',
          cashReconciliationId: c.id,
        },
      });

      if (plan.applications.length) {
        await tx.debtApplication.createMany({
          data: plan.applications.map((a) => ({
            organizationId,
            paymentId: ajuste.id,
            amount: a.amount,
            expenseId: a.source === 'EXPENSE' ? a.sourceId : null,
            loanPaymentId: a.source === 'LOAN_PAYMENT' ? a.sourceId : null,
            obligationMovementId: a.source === 'MOVEMENT' ? a.sourceId : null,
          })),
        });
      }
    }

    await tx.cashReconciliation.update({
      where: { id: c.id },
      data: {
        status: 'CONFIRMED',
        expectedUsd,
        totalUsd,
        personalUsd,
        differenceUsd: r.differenceUsd,
        explanation: dto.explanation ?? null,
        confirmedAt: new Date(),
        confirmedByUserId: userId,
      },
    });
  });

}

/**
 * ANULAR: revierte el ajuste y sus aplicaciones (caen en cascada con el
 * movimiento) y deja la fila en el historial. Corregir = anular + nueva.
 */
export async function anularConciliacion(
prisma: PrismaService,
organizationId: string,
id: string,
) {
  const c = await prisma.cashReconciliation.findFirst({
    where: { id, organizationId },
    include: { adjustment: { select: { id: true } } },
  });
  if (!c) throw new NotFoundException('No existe esa conciliación');
  if (c.status === 'VOID') throw new ConflictException('Esa conciliación ya está anulada');

  await prisma.$transaction(async (tx) => {
    if (c.adjustment) {
      await tx.ownerMovement.deleteMany({ where: { id: c.adjustment.id, organizationId } });
    }
    await tx.cashReconciliation.update({
      where: { id: c.id },
      data: { status: 'VOID', voidedAt: new Date() },
    });
  });

}
