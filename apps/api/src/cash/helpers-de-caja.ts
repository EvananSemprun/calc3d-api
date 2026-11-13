import type {
  CashCategory,
  ObligationRef,
  ObligationSource,
  PayerKind,
  RepartoDeCompra,
} from '@calc3d/shared';
import type { PurchaseLineNuevoTipo, RecordSource } from '@prisma/client';

/**
 * LOS AYUDANTES DE CAJA: traducciones de la base al motor, sin estado.
 *
 * Salieron de `cash.service.ts` el 2026-10-11, cuando ese archivo pasó las 900
 * líneas (su propia nota pedía partirlo a las 480). **Ninguno toca la base ni
 * guarda nada**: convierten una fila de Prisma en algo que el motor entiende,
 * y por eso se pueden leer —y testear— sin levantar medio Nest.
 *
 * ⚠️ Lo que vive acá NO decide números de plata: eso es del motor
 * (`shared/calc/cash.ts`). Acá solo se traduce. Si alguna función de este
 * archivo empieza a sumar dinero, su lugar es shared, donde los tests la
 * agarran sin mocks.
 */

export const dia = (d: Date) => d.toISOString().slice(0, 10);
export const n = (x: unknown) => Number(x);

/**
 * De qué TIPO es quien puso la plata, para el motor. `null` = la caja.
 *
 * ⚠️ Una contraparte que no está en la lista (borrada en el mismo instante)
 * cae a `null`, o sea "lo puso la caja". Es lo correcto y no lo inventado: sin
 * contraparte NO hay a quién deberle, y suponer un tipo movería el saldo. La
 * relación es `onDelete: Restrict`, así que no debería pasar nunca.
 */
export const tipoPagador = (
  fila: { counterpartyId: string | null },
  contrapartes: { id: string; kind: string }[],
): PayerKind | null => {
  if (!fila.counterpartyId) return null;
  const kind = contrapartes.find((c) => c.id === fila.counterpartyId)?.kind;
  return kind === 'OWNER' || kind === 'PARTNER' || kind === 'EXTERNAL_LENDER' ? kind : null;
};
export const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * LAS CUOTAS VIGENTES: las que de verdad se pagaron.
 *
 * Anular una cuota NO la borra —la fila se queda en el historial con su
 * motivo— pero ese pago **no ocurrió**: el saldo del préstamo vuelve a subir,
 * la caja no pagó nada y quien la puso de su bolsillo no tiene nada que
 * cobrar. Es la regla del módulo de préstamos (`serialize()` de
 * `loans.module.ts` calcula sobre los vigentes) y Caja la ignoraba: anular
 * subía el saldo en Deuda y **no** en Caja, así que Caja **subestimaba** la
 * deuda con el prestamista. Dos definiciones del mismo número.
 *
 * ⚠️ La exclusión NO va en el `where` de Prisma, a propósito: lo anulado viaja
 * con su `voidedAt` y la decisión la toma ESTE código, que es el que los tests
 * corren. El motor (`loanBalance`, `cashEntries`) no conoce `voidedAt`, así que
 * con el filtro en SQL no quedaría ninguna guarda ejercida —la base falsa de
 * los specs no resuelve el `where` anidado de una relación— y borrarla no
 * tumbaría un solo test: peor que no tenerla, porque parece puesta.
 *
 * Regresión: `cash.service.spec.ts`, "Caja y Deuda cuentan lo mismo".
 */
export const vigentes = <T extends { voidedAt: Date | null }>(filas: T[]) =>
  filas.filter((f) => f.voidedAt == null);

/**
 * Una línea de factura, vista por lo ÚNICO que decide en qué línea del saldo
 * cae su plata.
 */
export interface LineaParaReparto {
  quantity: number;
  unitPrice: unknown;
  materialId?: string | null;
  printerId?: string | null;
  componentId?: string | null;
  /** Qué ficha NACE al recibir, cuando la línea todavía no apunta a ninguna. */
  nuevoTipo?: PurchaseLineNuevoTipo | null;
}

/**
 * EN QUÉ LÍNEA DEL SALDO CAE UNA LÍNEA DE FACTURA.
 *
 * ⚠️ **Hay que mirar las DOS formas de decir qué es.** Una línea apunta a una
 * ficha del catálogo (`materialId` / `printerId` / `componentId`) **o** pide
 * algo que todavía no existe, y entonces lo dice con `nuevoTipo` y la ficha nace
 * al recibir. Mirando solo los ids, una impresora encargada por primera vez
 * —el caso normal: una máquina nueva no está en el catálogo— caería en el
 * respaldo.
 *
 * ⚠️ **El respaldo es `filament`, y es el comportamiento de siempre**: hasta hoy
 * el reparto era `if (l.printerId == null) deFilamento += monto`, o sea que
 * todo lo que no era impresora se contaba como filamento. Mantenerlo deja una
 * factura vieja —o una línea con un dato incompleto— dando el mismo número que
 * daba ayer, en una línea con sentido en vez de en "equipos".
 *
 * ⚠️ **EL `switch` ES EXHAUSTIVO A PROPÓSITO, y eso NO es estilo.** Con un
 * respaldo que se tragara los valores nuevos de `PurchaseLineNuevoTipo`, un tipo
 * de línea agregado mañana caería **en silencio** en filamento — literalmente lo
 * que pasó cuando entró `COMPONENT` en octubre y este reparto no se enteró, o
 * sea la forma exacta del bug que esta función vino a cerrar. Un comentario que
 * avisa no es una guarda: el `const nunca: never` convierte el olvido en un
 * **error de compilación** que fuerza la decisión, igual que el
 * `Record<CashCategory, string>` de la hoja Caja del Excel.
 *
 * ⚠️ **El día que Compras gane los tipos SERVICIO y REPUESTO/MANTENIMIENTO**
 * (§5.2 del diseño de compras), van acá — con su categoría de Caja, que todavía
 * NO existe: se agrega entonces, junto con lo que la llena. Dejarlos caer en el
 * respaldo contaría un alquiler como filamento.
 */
export function categoriaDeLinea(l: LineaParaReparto): CashCategory {
  // La ficha del catálogo manda cuando está: es lo que la línea YA es.
  if (l.printerId != null) return 'equipment';
  if (l.componentId != null) return 'consumables';
  if (l.materialId != null) return 'filament';

  // Si no apunta a ninguna, lo que decide es qué ficha NACE al recibir.
  switch (l.nuevoTipo) {
    case 'PRINTER':
      return 'equipment';
    case 'COMPONENT':
      return 'consumables';
    case 'MATERIAL':
      return 'filament';
    case null:
    case undefined:
      // El respaldo histórico: hasta hoy el reparto era
      // `if (l.printerId == null) deFilamento += monto`, o sea que todo lo que
      // no era impresora se contaba como filamento. Mantenerlo deja una línea
      // con el dato incompleto en una fila con sentido en vez de en "equipos".
      return 'filament';
    default: {
      // Inalcanzable: el `never` es lo que impide que un tipo nuevo llegue acá
      // sin que alguien decida su fila. Lanza en vez de adivinar, porque
      // adivinar ES el bug (y plata mal clasificada no se ve).
      const nunca: never = l.nuevoTipo;
      throw new Error(`Falta decidir en qué línea de Caja cae el tipo de línea ${String(nunca)}`);
    }
  }
}

/**
 * CÓMO SE REPARTE UNA FACTURA entre las líneas del saldo: categoría → fracción,
 * a prorrata de lo que vale cada línea.
 *
 * ⚠️ Es una **convención de prorrateo declarada, no un descuido**: un abono no
 * "fue" a una línea concreta. Se reparte así para que "Filamento comprado" siga
 * queriendo decir todo el filamento que compraste, venga de una factura o de una
 * compra directa. Con facturas de una sola cosa —lo normal— es exacto.
 *
 * ⚠️ Lo que estaba viejo era que el reparto conociera **dos** clases (impresora
 * o filamento) cuando una línea ya podía ser un insumo desde el 2026-10-20: la
 * placa de impresión de $40 de C-0001 se contaba como filamento.
 *
 * Una factura sin líneas devuelve el mapa VACÍO: no hay mercadería que
 * repartir. ⚠️ **Eso no significa que su abono termine en filamento**: con una
 * factura sin líneas el anticipo es todo lo pagado, así que `repartoDeAbono`
 * devuelve `{ supplierAdvances: 1 }` antes de llamar a esta función.
 */
export function proporcionPorCategoria(lineas: LineaParaReparto[]): RepartoDeCompra {
  const porCategoria = new Map<CashCategory, number>();
  let total = 0;
  for (const l of lineas) {
    const monto = Math.max(l.quantity, 0) * Math.max(n(l.unitPrice), 0);
    if (monto <= 0) continue;
    const c = categoriaDeLinea(l);
    porCategoria.set(c, (porCategoria.get(c) ?? 0) + monto);
    total += monto;
  }
  if (total <= 0) return {};

  const reparto: RepartoDeCompra = {};
  for (const [c, monto] of porCategoria) reparto[c] = monto / total;
  return reparto;
}

/**
 * EL REPARTO DE UN ABONO, con los anticipos separados.
 *
 * ⚠️ **Lo pagado y todavía no recibido NO es filamento ni insumo: es plata en
 * manos del proveedor.** Va a su propia línea, «Anticipos a proveedores», y por
 * eso el problema que esta tarea vino a cerrar —que $21,54 de un insumo
 * estuvieran etiquetados «filamento»— desaparece solo en el caso de C-0001: con
 * la plata en su propia fila, ya no está etiquetada filamento. A qué apuntaba lo
 * responde el DETALLE del asiento, que dice de qué factura es.
 *
 * ⚠️ **El anticipo es de la FACTURA y se reparte entre SUS abonos**, a prorrata
 * de lo pagado: `anticipo / pagado`. Es la misma convención que el resto —un
 * abono no fue a una línea concreta, y tampoco "fue" a la parte recibida o a la
 * pendiente—. Con un solo abono por factura —lo normal— es exacto. El
 * denominador es lo pagado de la factura y no su total: lo pagado de más es
 * `aFavor` y no corresponde a esta compra.
 *
 * ⚠️ **Un borde que hoy no se puede alcanzar, anotado para que no sorprenda:**
 * si TODAS las líneas valieran 0 pero hubiera recepciones con precio informado,
 * `proporcionPorCategoria` devuelve `{}` y, con un anticipo PARCIAL, la parte de
 * mercadería se queda sin categoría y cae entera en `supplierAdvances` por la
 * normalización del motor. No vale un test —una línea pide `quantity` positiva y
 * `unitPrice ≥ 0`, así que una factura con todo en 0 y entregas cobradas no
 * existe—, pero si alguna vez aparece, el número a mirar es ese.
 */
export function repartoDeAbono(
  lineas: LineaParaReparto[],
  totales: { pagado: number; anticipo: number },
): RepartoDeCompra {
  const deAnticipo =
    totales.pagado > 0 ? Math.min(Math.max(totales.anticipo / totales.pagado, 0), 1) : 0;
  if (deAnticipo >= 1) return { supplierAdvances: 1 };

  const mercaderia = proporcionPorCategoria(lineas);
  const reparto: RepartoDeCompra = {};
  for (const [c, f] of Object.entries(mercaderia) as [CashCategory, number][]) {
    reparto[c] = f * (1 - deAnticipo);
  }
  if (deAnticipo > 0) reparto.supplierAdvances = deAnticipo;
  return reparto;
}

/** Lo que la pantalla muestra de cada asiento, además de la fecha y el monto. */
export interface EtiquetaAsiento {
  label: string;
  source: RecordSource;
}

/**
 * Cuando el asiento no trae id —o su origen no está en el mapa— la plata se
 * muestra igual, sin etiqueta. El número es lo importante: esconder la fila
 * haría que el detalle sumara menos que su propio total.
 */
export const SIN_DETALLE: EtiquetaAsiento = { label: 'Sin detalle', source: 'MANUAL' };

/** Un texto vacío o en blanco no es una etiqueta: hay que caer al respaldo. */
export const texto = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/**
 * Los dos campos sueltos del DTO, como la referencia que entiende el motor.
 *
 * El schema ya garantiza que vengan los dos o ninguno; esto solo traduce. NO
 * valida que la deuda exista: eso lo decide la lista derivada de obligaciones.
 */
export const destinoDe = (dto: {
  targetSource?: ObligationSource | null;
  targetSourceId?: string | null;
}): ObligationRef | null =>
  dto.targetSource && dto.targetSourceId
    ? { source: dto.targetSource, sourceId: dto.targetSourceId }
    : null;

/**
 * LAS CUATRO COLUMNAS DE `DebtApplication` que apuntan a una obligación: una y
 * solo una va con valor (CHECK `DebtApplication_una_obligacion`).
 */
export interface ColumnasDeObligacion {
  expenseId: string | null;
  loanPaymentId: string | null;
  obligationMovementId: string | null;
  purchasePaymentId: string | null;
}

/**
 * De qué columna cuelga cada origen de obligación.
 *
 * ⚠️ **Es un `switch` exhaustivo con `never` a propósito.** Antes eran tres
 * ternarios paralelos en `escribir-conciliacion.ts`, y el cuarto origen
 * (`PURCHASE`) se olvidó: un faltante que alcanzaba un abono escribía las tres
 * columnas en null y el CHECK lo rechazaba con un 500. Con esto, un origen
 * nuevo en `OBLIGATION_SOURCES` **no compila** hasta que alguien decide su
 * columna — el mismo cierre que `categoriaDeLinea`.
 */
export function columnasDeObligacion(
  source: ObligationSource,
  sourceId: string,
): ColumnasDeObligacion {
  const vacias: ColumnasDeObligacion = {
    expenseId: null,
    loanPaymentId: null,
    obligationMovementId: null,
    purchasePaymentId: null,
  };
  switch (source) {
    case 'EXPENSE':
      return { ...vacias, expenseId: sourceId };
    case 'LOAN_PAYMENT':
      return { ...vacias, loanPaymentId: sourceId };
    case 'MOVEMENT':
      return { ...vacias, obligationMovementId: sourceId };
    case 'PURCHASE':
      return { ...vacias, purchasePaymentId: sourceId };
    default: {
      // Lanza en vez de escribir una fila sin obligación: plata mal aplicada no se ve.
      const nunca: never = source;
      throw new Error(`Origen de obligación sin columna: ${String(nunca)}`);
    }
  }
}

/** El inverso: el id de la obligación a la que apunta una aplicación. */
export const obligacionDeAplicacion = (a: ColumnasDeObligacion): string | null =>
  a.expenseId ?? a.loanPaymentId ?? a.obligationMovementId ?? a.purchasePaymentId;
