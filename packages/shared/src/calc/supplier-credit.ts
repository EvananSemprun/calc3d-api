/**
 * SALDO A FAVOR CON EL PROVEEDOR: la plata que le pagaste de más y todavía no
 * usaste.
 *
 * Pagaste $100 de una factura de $85. Esos $15 **no son un costo de esa
 * compra**: son plata tuya que el proveedor te debe, y la forma natural de
 * cobrarla es descontarla del próximo pedido.
 *
 * ⚠️ **EL SALDO SE DERIVA: Σ pagado de más − Σ aplicado.** Nada guardado que
 * pueda contradecir a sus partes — la regla central de este proyecto, la misma
 * del saldo de un préstamo, del saldo de un pedido y de la deuda con una
 * contraparte. Lo único que se persiste es **de qué factura sale** cada abono
 * tomado del saldo (`tomadoDeFacturaId`): un hecho, no un total.
 *
 * ⚠️ Y cada mitad se deriva en UN solo lugar: **"aplicado" acá**
 * (`creditoTomadoPorFactura`) y **"disponible" en `invoiceTotals`**
 * (`aFavorDisponible`), que ya era la única definición de "pagado de más". Este
 * módulo SUMA lo que esa función devolvió; no lo vuelve a calcular. Con dos
 * cuentas para el mismo número, el día que una cambie la pantalla del proveedor
 * y la de la factura dirían cosas distintas de la misma plata.
 */
import { D, toCents } from './money';

/** Un abono, visto solo por la pregunta de acá: "¿de qué saldo salió?". */
export interface AbonoDeSaldo {
  amount: number;
  /** La factura cuyo sobrepago lo financia. `null` = plata de verdad. */
  tomadoDeFacturaId?: string | null;
  /** Un abono anulado **devuelve** el saldo: no cuenta. */
  voided?: boolean;
}

/**
 * CUÁNTO SE TOMÓ DE CADA FACTURA, por id de factura de origen.
 *
 * Es la mitad "aplicado" de la derivación, y la única: `invoiceTotals` recibe
 * este número y resta. Una factura sin abonos tomados de ella **no aparece** en
 * el resultado, en vez de aparecer en 0: un 0 inventado se lee igual que un
 * dato, y acá no hay dato que dar.
 */
export function creditoTomadoPorFactura(abonos: AbonoDeSaldo[]): Record<string, number> {
  const tomado: Record<string, number> = {};
  for (const a of abonos) {
    if (a.voided) continue;
    const origen = a.tomadoDeFacturaId;
    if (!origen) continue;
    tomado[origen] = toCents(D(tomado[origen] ?? 0).plus(Math.max(a.amount, 0)));
  }
  return tomado;
}

/** Una factura con sus cuentas ya hechas por `invoiceTotals`. */
export interface FacturaConSaldoAFavor {
  id: string;
  /** `null` = sin proveedor anotado. Ver abajo: no es un proveedor. */
  supplierId: string | null;
  supplierName: string | null;
  voidedAt: string | Date | null;
  /** Lo pagado DE MÁS. Es un hecho y no se mueve nunca. */
  aFavor: number;
  /** Lo que todavía se puede usar: `aFavor − tomado`, nunca negativo. */
  aFavorDisponible: number;
}

export interface SaldoAFavorDeProveedor {
  supplierId: string;
  supplierName: string;
  /** Σ disponible de sus facturas vigentes. */
  disponible: number;
  /** De qué facturas sale, de la que más tiene a la que menos. */
  facturas: { id: string; disponible: number }[];
}

/** Sin nombre anotado, el proveedor igual existe: tiene id. */
const SIN_NOMBRE = 'Proveedor sin nombre';

/**
 * CUÁNTO TIENE A FAVOR CADA PROVEEDOR, y de qué facturas sale.
 *
 * ⚠️ **Una factura ANULADA no deja saldo a favor**: ya no existe como
 * compromiso, ni a favor ni en contra. Es la misma guarda que en
 * `deudaPorProveedor`, por el otro lado de la cuenta.
 *
 * ⚠️ **"Sin proveedor anotado" NO es un proveedor.** En la pantalla Deuda es un
 * grupo legítimo —la plata se debe igual, con nombre o sin él—, pero acá sería
 * peor que no mostrarlo: juntaría el sobrepago de dos facturas que pueden ser
 * de dos personas distintas y dejaría pagarle a una con lo que te debe la otra.
 * Para usar ese saldo hay que anotar primero de quién es.
 */
export function saldoAFavorPorProveedor(
  facturas: FacturaConSaldoAFavor[],
): SaldoAFavorDeProveedor[] {
  const porProveedor = new Map<string, SaldoAFavorDeProveedor>();

  for (const f of facturas) {
    if (f.voidedAt != null) continue;
    if (!f.supplierId) continue;
    const disponible = Math.max(f.aFavorDisponible, 0);
    if (disponible <= 0) continue;

    const grupo =
      porProveedor.get(f.supplierId) ??
      {
        supplierId: f.supplierId,
        supplierName: f.supplierName ?? SIN_NOMBRE,
        disponible: 0,
        facturas: [],
      };
    grupo.disponible = toCents(D(grupo.disponible).plus(disponible));
    grupo.facturas.push({ id: f.id, disponible });
    porProveedor.set(f.supplierId, grupo);
  }

  const groups = [...porProveedor.values()];
  for (const g of groups) {
    // A igualdad, por id: así el orden es reproducible y la lista no baila
    // entre dos cargas.
    g.facturas.sort((a, b) => b.disponible - a.disponible || a.id.localeCompare(b.id));
  }
  return groups.sort(
    (a, b) => b.disponible - a.disponible || a.supplierName.localeCompare(b.supplierName, 'es'),
  );
}

/** Por qué no se puede tomar ese saldo. */
export type MotivoDeRechazo =
  | 'MISMA_FACTURA'
  | 'ORIGEN_DESCONOCIDO'
  | 'ORIGEN_ANULADO'
  | 'SIN_PROVEEDOR'
  | 'OTRO_PROVEEDOR'
  | 'SIN_SALDO';

export interface UsoDeSaldo {
  /** `null` = se puede. */
  rechazo: MotivoDeRechazo | null;
  /** Lo que de verdad hay en la factura de origen (0 si no se encontró). */
  disponible: number;
}

/**
 * ¿SE PUEDE TOMAR `monto` DEL SALDO A FAVOR DE `origenId` PARA ESTA FACTURA?
 *
 * ⚠️ **La pertenencia se cierra por CONSTRUCCIÓN**: el origen tiene que estar
 * en `facturas`, que es la lista de la organización. Ser miembro ES la
 * autorización, igual que la obligación destino de `applyPayment`. Buscar la
 * factura de origen por id contra la base reabriría el IDOR: ese camino no sabe
 * de qué negocio es ni de qué proveedor.
 *
 * ⚠️ Devuelve el motivo y **no lanza**: es el borde entre el motor y la UI, y el
 * mensaje de cara al dueño lo escribe quien llama (necesita el nombre del
 * proveedor y la moneda, que el motor no conoce).
 */
export function evaluarUsoDeSaldo(
  facturas: FacturaConSaldoAFavor[],
  destino: { id: string; supplierId: string | null },
  origenId: string,
  monto: number,
): UsoDeSaldo {
  const origen = facturas.find((f) => f.id === origenId);
  const disponible = origen ? Math.max(origen.aFavorDisponible, 0) : 0;

  // Primero lo del círculo: tomar saldo de la factura que se está abonando
  // subiría `pagado` sin que entrara plata, financiado por su propio sobrepago.
  if (origenId === destino.id) return { rechazo: 'MISMA_FACTURA', disponible };
  if (!origen) return { rechazo: 'ORIGEN_DESCONOCIDO', disponible };
  if (origen.voidedAt != null) return { rechazo: 'ORIGEN_ANULADO', disponible };
  if (!origen.supplierId || !destino.supplierId) return { rechazo: 'SIN_PROVEEDOR', disponible };
  if (origen.supplierId !== destino.supplierId) return { rechazo: 'OTRO_PROVEEDOR', disponible };
  // El límite es INCLUSIVO: tomarlo exacto se puede.
  if (D(monto).greaterThan(disponible)) return { rechazo: 'SIN_SALDO', disponible };

  return { rechazo: null, disponible };
}
