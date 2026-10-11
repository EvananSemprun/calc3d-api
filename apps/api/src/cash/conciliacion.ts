import {
  applyPayment,
  businessCash,
  reconcile,
  UnknownObligationError,
  type CashShortfallPlanQueryDto,
  type ApplicationOrder,
  type Obligation,
  type ObligationRef,
} from '@calc3d/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { destinoDe, dia, n } from './helpers-de-caja';
import { cargarDatosDeCaja, obligacionesDe, type DatosDeCaja } from './datos-de-caja';

/**
 * LA CONCILIACIÓN: a quién se le atribuye un faltante y cómo se reparte.
 *
 * Salió de `cash.service.ts` el 2026-10-11, cuando ese archivo pasó las 900
 * líneas; su propia nota pedía partirlo a las 480 y nadie lo había hecho.
 *
 * ⚠️ **Acá está solo la parte que DECIDE, no la que escribe.** `confirm()`,
 * `saveReconciliation()` y `voidReconciliation()` se quedaron en el servicio
 * porque los tres terminan devolviendo `summary()`: moverlos obligaría a
 * pasarse el servicio como parámetro, que es la dependencia circular
 * disfrazada de refactor. Lo que sí vino es lo que se puede responder con los
 * datos en la mano, que además es lo único que la previsualización necesita.
 *
 * ⚠️ **`atribucionDe` es la MISMA condición que evalúa `confirm()`.** Existe
 * aparte justamente para que la previsualización y el resumen no la vuelvan a
 * escribir cada uno: dos copias de "a quién se le atribuye el faltante"
 * terminan discrepando el día que cambie una.
 */

export function aUsd(monto: number, rate: unknown) {
  const tasa = rate == null ? 1 : n(rate);
  return tasa > 0 ? Math.round((monto / tasa) * 100) / 100 : monto;
}

/**
 * A quién y hasta cuándo se le atribuiría el faltante de esta conciliación,
 * o `null` si no se atribuiría nada.
 *
 * Es la MISMA condición que evalúa `confirm()`. Existe aparte para que la
 * previsualización y el resumen no la vuelvan a escribir cada uno.
 */
export function atribucionDe(
d: DatosDeCaja,
  c: { accountId: string; date: Date; status: string },
  r: { kind: string },
) {
  if (c.status !== 'DRAFT' || r.kind !== 'SHORT') return null;
  const cuenta = d.cuentas.find((a) => a.id === c.accountId);
  if (!cuenta?.shared || !cuenta.autoAttributeShortfall || !cuenta.sharedWithId) return null;
  return { counterpartyId: cuenta.sharedWithId, fecha: dia(c.date) };
}

/**
 * El reparto, con la traducción del único error que puede devolver el motor.
 *
 * ⚠️ `deudas` es la ÚNICA puerta: son las obligaciones que el servidor ya
 * derivó para ESTA organización, la contraparte de la CUENTA y hasta la
 * fecha del conteo. La deuda destino se acepta por ser MIEMBRO de esa lista,
 * no por pasar una lista de chequeos. Buscarla por id contra la base sería
 * un camino paralelo —y uno que no sabe de la contraparte ni de la fecha—:
 * ahí vuelve el IDOR.
 */
export function repartoDeFaltante(
  deudas: Obligation[],
  monto: number,
  order: ApplicationOrder,
  destino: ObligationRef | null,
) {
  try {
    return applyPayment(deudas, monto, order, destino);
  } catch (e) {
    if (e instanceof UnknownObligationError) {
      throw new BadRequestException(
        'Esa deuda no se puede saldar con esta conciliación: tiene que ser una deuda ' +
          'reembolsable de la contraparte de la cuenta, con fecha anterior al conteo.',
      );
    }
    throw e;
  }
}

/**
 * Qué va a pasar si se confirma este borrador: contra qué deudas se aplica
 * el faltante y cuánto queda como retiro.
 *
 * Tiene que usar EXACTAMENTE las mismas entradas que `confirm()` —la
 * contraparte de la CUENTA y las obligaciones filtradas HASTA la fecha de la
 * conciliación—, o la pantalla prometería un reparto distinto del que
 * ocurre. Devuelve `null` cuando no habría ajuste.
 *
 * Con `destino`, esa deuda cobra primero. ⚠️ Si no habría ajuste, una deuda
 * destino se RECHAZA en vez de ignorarse: aceptarla y no usarla es
 * exactamente la clase de mentira que esta pantalla existe para evitar.
 */
export function planDe(
  d: DatosDeCaja,
  c: { accountId: string; date: Date; status: string },
  r: { kind: string; differenceUsd: number },
  destino: ObligationRef | null = null,
) {
  const atribucion = atribucionDe(d, c, r);
  if (!atribucion) {
    if (destino) {
      throw new BadRequestException(
        'Esta conciliación no va a atribuir ningún faltante, así que no hay deuda destino que elegir',
      );
    }
    return null;
  }

  const { counterpartyId, fecha } = atribucion;
  const deudas = obligacionesDe(d, counterpartyId, fecha);
  const plan = repartoDeFaltante(deudas, Math.abs(r.differenceUsd), d.order, destino);
  const porId = new Map(deudas.map((o) => [o.sourceId, o]));

  return {
    applications: plan.applications.map((a) => ({
      sourceId: a.sourceId,
      source: a.source,
      amount: a.amount,
      date: porId.get(a.sourceId)?.date ?? fecha,
      category: porId.get(a.sourceId)?.category ?? null,
    })),
    /** Lo que sobra después de cancelar todo: se registra como retiro. */
    leftover: plan.leftover,
    order: d.order,
  };
}

/**
 * PREVISUALIZAR el reparto de un faltante contra una deuda elegida, SIN
 * escribir nada.
 *
 * ⚠️ Existe porque el reparto lo calcula el SERVIDOR, siempre. En la fase 1
 * el front lo deducía de `obligations` —una lista sin filtro de fecha y con
 * la contraparte por defecto de la organización— mientras el servidor
 * filtraba hasta la fecha del conteo y usaba la contraparte de la CUENTA.
 * Conciliando con retraso, el dueño aprobaba un reparto que no era el que
 * ocurría. Por eso acá también viajan las obligaciones ELEGIBLES: la lista
 * que la pantalla ofrece para elegir tiene que ser la misma que el servidor
 * va a aceptar.
 */
export async function planDeFaltante(
  prisma: PrismaService,
  organizationId: string,
  id: string,
  query: CashShortfallPlanQueryDto,
) {
  const c = await prisma.cashReconciliation.findFirst({ where: { id, organizationId } });
  if (!c) throw new NotFoundException('No existe esa conciliación');

  const d = await cargarDatosDeCaja(prisma, organizationId);
  const fecha = dia(c.date);
  // Una confirmada muestra lo CONGELADO, igual que en el resumen: es un
  // documento, no una vista que se recalcula sola.
  const congelado = c.status === 'CONFIRMED' && c.expectedUsd != null;
  const expectedUsd = congelado ? n(c.expectedUsd) : businessCash(d.ledger, fecha).balance;
  const totalUsd = congelado ? n(c.totalUsd) : aUsd(n(c.totalAmount), c.rate);
  const personalUsd = congelado ? n(c.personalUsd) : aUsd(n(c.personalAmount), c.rate);
  const r = reconcile({ expectedUsd, totalUsd, personalUsd });

  const destino = destinoDe(query);
  const atribucion = atribucionDe(d, c, r);

  return {
    reconciliationId: c.id,
    accountId: c.accountId,
    date: fecha,
    status: c.status,
    expectedUsd,
    totalUsd,
    personalUsd,
    ...r,
    applicationOrder: d.order,
    /** Si confirmar hoy registraría el ajuste. Con `false`, `plan` es null. */
    willAttribute: atribucion != null,
    counterpartyId: atribucion?.counterpartyId ?? null,
    target: destino,
    /** Las deudas que se pueden elegir. Vacía si no habría atribución. */
    obligations: atribucion ? obligacionesDe(d, atribucion.counterpartyId, fecha) : [],
    plan: planDe(d, c, r, destino),
  };
}
