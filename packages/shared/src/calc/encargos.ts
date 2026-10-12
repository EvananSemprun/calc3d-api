/**
 * AVISOS DE ENCARGOS (2026-10-12).
 *
 * Cuatro cosas que la app ya sabe y que hoy no te dice a tiempo: una entrega
 * que se pasó, un encargo entregado que quedó sin cobrar, los que se entregan
 * en los próximos días y una cotización que se enfrió.
 *
 * ⚠️ **"Hoy" ENTRA COMO PARÁMETRO**, nunca se lee del reloj acá dentro. Es la
 * convención del proyecto (`cashChainCuts`, `facturasAtrasadas`,
 * `lecturaDeHorasPendiente`): un test que dependa de la fecha de la máquina
 * pasa hoy y falla solo algún día, en una corrida que nadie va a estar
 * mirando.
 *
 * ⚠️ **El saldo NO se calcula acá: llega calculado.** Es `orderBalance` (total
 * de líneas − abonos), la única definición de lo que falta cobrar de un
 * encargo. Derivarlo otra vez en este archivo sería la segunda, y el día que
 * una cambie la pantalla se contradiría sola.
 *
 * ⚠️ **El silencio es el caso normal.** Medido en producción el día que se
 * escribió esto: 24 encargos, 23 entregados y uno en producción con fecha
 * futura — o sea **cero** en las cuatro categorías. Eso no es un defecto del
 * aviso: un aviso de "se te pasó una entrega" existe para el día que se te
 * pase, y el resto del tiempo tiene que callarse.
 */
import { daysBetween, isCalendarDay } from './stock';

/** Los estados por los que pasa un encargo. Espejo de `OrderStatus` en Prisma. */
export type EstadoDeEncargo =
  | 'QUOTED'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

/** Lo único que hace falta saber de un encargo para decidir si avisa. */
export interface EncargoParaAviso {
  id: string;
  /** El correlativo que el dueño ve y dice en voz alta ("el 25"). */
  code: number;
  status: EstadoDeEncargo;
  /** `AAAA-MM-DD`, o `null` si nunca se le puso fecha. */
  deliveryDate: string | null;
  /** Lo que falta cobrar. Viene de `orderBalance`; acá NO se recalcula. */
  balance: number;
  /** `AAAA-MM-DD` en que se cargó. Es lo que mide si una cotización se enfrió. */
  createdAt: string;
}

/**
 * CUÁNTOS DÍAS ANTES AVISAR DE UNA ENTREGA.
 *
 * ⚠️ **El número sale de los datos, no del gusto de nadie.** Medido en
 * producción sobre los 24 encargos con fecha: el plazo entre cargarlos y
 * entregarlos es de **4 a 5 días** en los únicos tres que se cargaron al
 * tomarlos (el resto da negativo porque son la migración del Excel, cargados
 * DESPUÉS de entregar — por eso la mediana no sirve acá).
 *
 * Con un trabajo que dura 4-5 días, avisar a **3** cae en la segunda mitad,
 * cuando todavía hay margen para apurarlo y ya no es obvio. Avisar a 7 sería
 * avisar el día que se toma el encargo: un aviso que aparece siempre deja de
 * verse, y arrastra a los que sí importaban.
 */
export const DIAS_ENTREGA_PROXIMA = 3;

/**
 * CUÁNDO UNA COTIZACIÓN ESTÁ FRÍA.
 *
 * ⚠️ **Este número NO tiene datos detrás y conviene saberlo**: en producción
 * nunca hubo un encargo en `QUOTED` —se cargan ya confirmados—, así que no hay
 * historia de cuánto tarda un cliente en responder. Está anclado a lo único
 * medido: si el trabajo entero toma 4-5 días, un presupuesto sin respuesta
 * después de **14** (unas tres veces eso) ya no está "en curso".
 *
 * Si algún día hay cotizaciones de verdad, este número se revisa con ellas.
 */
export const DIAS_COTIZACION_FRIA = 14;

export interface AvisosDeEncargos {
  /** La fecha de entrega pasó y el encargo sigue abierto. */
  vencidos: EncargoParaAviso[];
  /** Entregado, pero quedó plata por cobrar. */
  sinCobrar: EncargoParaAviso[];
  /** Se entregan dentro de los próximos `DIAS_ENTREGA_PROXIMA` días. */
  proximos: EncargoParaAviso[];
  /** Cotizados hace más de `DIAS_COTIZACION_FRIA` días y sin novedad. */
  cotizacionesFrias: EncargoParaAviso[];
}

/** Ni entregado ni cancelado: todavía hay algo que hacer con él. */
const abierto = (e: EncargoParaAviso) => e.status !== 'DELIVERED' && e.status !== 'CANCELLED';

/**
 * Un saldo por debajo del centavo no es un saldo: es el resto de una división.
 * Sin esto, un encargo cobrado entero podría avisar por $0.000001.
 */
const QUEDA_PLATA = 0.005;

export function avisosDeEncargos(
  encargos: EncargoParaAviso[],
  hoy: string,
): AvisosDeEncargos {
  // Un "hoy" inventado haría cuentas que parecen buenas. Mejor no avisar nada
  // que avisar con una fecha que no existe.
  if (!isCalendarDay(hoy)) {
    return { vencidos: [], sinCobrar: [], proximos: [], cotizacionesFrias: [] };
  }

  const vencidos: EncargoParaAviso[] = [];
  const sinCobrar: EncargoParaAviso[] = [];
  const proximos: EncargoParaAviso[] = [];
  const cotizacionesFrias: EncargoParaAviso[] = [];

  for (const e of encargos) {
    if (e.status === 'DELIVERED') {
      if (e.balance > QUEDA_PLATA) sinCobrar.push(e);
      continue;
    }
    if (!abierto(e)) continue; // cancelado: no hay nada que hacer

    // ⚠️ Una fecha que no existe (`2026-02-30`) NO se usa para decidir: se
    // ignora. `daysBetween` lanzaría, y un aviso no puede tumbar el Dashboard.
    const conFecha = e.deliveryDate != null && isCalendarDay(e.deliveryDate);
    const dias = conFecha ? daysBetween(hoy, e.deliveryDate as string) : null;

    if (dias != null && dias < 0) {
      vencidos.push(e);
      // ⚠️ **Un encargo avisa UNA sola vez.** Una cotización vieja que además
      // se pasó de fecha es las dos cosas, pero contarla dos veces infla el
      // renglón y manda al dueño a la misma fila por dos caminos. Gana lo más
      // urgente, que es que la fecha ya pasó.
      continue;
    }
    if (dias != null && dias <= DIAS_ENTREGA_PROXIMA) {
      proximos.push(e);
      continue;
    }
    if (e.status === 'QUOTED' && isCalendarDay(e.createdAt)) {
      if (daysBetween(e.createdAt, hoy) >= DIAS_COTIZACION_FRIA) cotizacionesFrias.push(e);
    }
  }

  return { vencidos, sinCobrar, proximos, cotizacionesFrias };
}

/** Cuántos encargos pide mirar el conjunto. Cero = no hay nada que decir. */
export function totalDeAvisos(a: AvisosDeEncargos): number {
  return a.vencidos.length + a.sinCobrar.length + a.proximos.length + a.cotizacionesFrias.length;
}
