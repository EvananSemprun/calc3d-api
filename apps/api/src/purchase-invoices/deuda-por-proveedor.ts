import { D, toCents } from '@calc3d/shared';

/**
 * LO QUE LE DEBES A CADA PROVEEDOR, derivado de sus facturas.
 *
 * ⚠️ **No se persiste nada.** Igual que el saldo de un préstamo o la deuda con
 * una contraparte, esto se DERIVA de las facturas cada vez que se pregunta. Un
 * total guardado se desincroniza de sus partes el día que alguien abona, anula
 * o corrige una línea.
 *
 * ⚠️ **Las cuentas de cada factura ya vienen hechas** (`invoiceTotals`, en
 * `shared`): acá solo se agrupa y se suma. Recalcular el saldo de una factura
 * acá sería una SEGUNDA definición, y el día que una de las dos cambie la
 * pantalla Deuda y la pantalla Compras dirían cosas distintas sobre la misma
 * factura.
 */

/** Una factura como la deja `PurchaseInvoicesService`: con sus cuentas derivadas. */
export interface FacturaParaDeuda {
  supplier: { id: string; name: string } | null;
  /** Fecha de anulación. Una factura anulada **no se debe**. */
  voidedAt: string | null;
  /**
   * Lo que **ya te llegó** y todavía no pagaste. Nunca negativo (`invoiceTotals`
   * lo recorta en 0).
   *
   * ⚠️ **No es `saldo`.** `saldo` incluye la mercadería que todavía no llegó, y
   * eso no se debe: se pidió. Mezclar las dos cosas era decir «debes $334» de
   * tres facturas sin una sola caja recibida.
   */
  deuda: number;
  /**
   * Lo pedido, no recibido y no pagado todavía. **No es deuda**: es plata
   * comprometida a futuro. Nunca negativo.
   */
  comprometido: number;
  /**
   * Lo pagado de más que **todavía se puede usar**. **No es deuda negativa**:
   * ver abajo.
   *
   * ⚠️ **Es el DISPONIBLE y no `aFavor` a propósito.** Desde el saldo a favor
   * (fase 3) los dos son números distintos: `aFavor` es el hecho (pagaste $15 de
   * más, y eso no se borra nunca) y esto es lo que queda sin usar. Esta pantalla
   * responde "¿cuánto te debe el proveedor?", que es con lo que el dueño decide
   * si reclamar: sumar el hecho diría que te debe plata que ya te devolvió en
   * mercadería.
   */
  aFavorDisponible: number;
}

export interface DeudaConProveedor {
  /** `null` = facturas sin proveedor anotado. Se deben igual. */
  supplierId: string | null;
  supplierName: string;
  /** Σ deuda (mercadería recibida sin pagar) de sus facturas vigentes. */
  total: number;
  /** Cuántas de sus facturas tienen deuda. */
  facturas: number;
  /**
   * Σ comprometido de sus facturas vigentes: lo pedido que todavía no llegó.
   * ⚠️ **NO suma a `total`**: no se debe todavía.
   */
  comprometido: number;
  /** Cuántas de sus facturas tienen algo comprometido. Es **su propio conteo**. */
  facturasComprometidas: number;
  /**
   * Lo pagado de más, SUMADO APARTE.
   *
   * ⚠️ **No resta de `total`.** Pagar $10 de más en una factura no cancela $10
   * de otra por sí solo: son dos cuentas con el proveedor y compensarlas
   * inventaría un pago que nunca se hizo. Para usarlo hay que **abonarlo**
   * tomándolo del saldo (fase 3), y entonces los dos números se mueven juntos:
   * baja lo que tiene a favor y baja la deuda de la factura que se abonó.
   */
  aFavor: number;
  facturasAFavor: number;
}

export interface DeudaProveedores {
  /**
   * Un grupo por proveedor con algo pendiente (deuda, compromiso o a favor), de
   * mayor deuda a menor; a igualdad, de mayor compromiso.
   */
  groups: DeudaConProveedor[];
  /** Σ de los `total` de los grupos. Es lo que el bloque muestra arriba. */
  total: number;
  aFavor: number;
  /** Σ de los `comprometido` de los grupos. Va aparte: no es deuda. */
  comprometido: number;
  /** Σ de las facturas comprometidas. La cuenta que acompaña a `comprometido`. */
  facturasComprometidas: number;
}

/**
 * Una factura sin proveedor anotado se debe igual. Esconderla por no tener
 * nombre sería perder plata que sí se debe — el bloque quedaría diciendo menos
 * de lo que el negocio debe, que es justo la mentira que esto viene a cerrar.
 */
const SIN_PROVEEDOR = 'Sin proveedor anotado';

export function deudaPorProveedor(facturas: FacturaParaDeuda[]): DeudaProveedores {
  const porProveedor = new Map<string | null, DeudaConProveedor>();

  for (const f of facturas) {
    // ⚠️ Una factura ANULADA no se debe: no entra ni con su deuda, ni con su
    // compromiso, ni con su pagado de más. Es el primer modo de que el número
    // mienta.
    if (f.voidedAt != null) continue;

    const deuda = Math.max(f.deuda, 0);
    const comprometido = Math.max(f.comprometido, 0);
    const aFavor = Math.max(f.aFavorDisponible, 0);
    // ⚠️ El guard tiene que admitir el compromiso: una factura recién pedida
    // vale 0 de deuda y 0 a favor, y sin esta condición se descartaría ANTES de
    // que nadie la sume como comprometida.
    if (deuda <= 0 && comprometido <= 0 && aFavor <= 0) continue;

    const id = f.supplier?.id ?? null;
    const grupo =
      porProveedor.get(id) ??
      {
        supplierId: id,
        supplierName: f.supplier?.name ?? SIN_PROVEEDOR,
        total: 0,
        facturas: 0,
        comprometido: 0,
        facturasComprometidas: 0,
        aFavor: 0,
        facturasAFavor: 0,
      };

    // Las cuentas se suman POR SEPARADO: ver `aFavor` arriba. Cada una lleva su
    // propio conteo: la cantidad de facturas con deuda NO es la de las
    // comprometidas, y el Dashboard dice «$X comprometidos en N facturas».
    if (deuda > 0) {
      grupo.total = toCents(D(grupo.total).plus(deuda));
      grupo.facturas += 1;
    }
    if (comprometido > 0) {
      grupo.comprometido = toCents(D(grupo.comprometido).plus(comprometido));
      grupo.facturasComprometidas += 1;
    }
    if (aFavor > 0) {
      grupo.aFavor = toCents(D(grupo.aFavor).plus(aFavor));
      grupo.facturasAFavor += 1;
    }

    porProveedor.set(id, grupo);
  }

  const groups = [...porProveedor.values()].sort(
    // De mayor deuda a menor; a igualdad, el de más compromiso (un proveedor solo
    // con compromiso no queda mezclado al azar con los de total 0) y después por
    // nombre, para que el orden sea reproducible y la lista no baile entre cargas.
    (a, b) =>
      b.total - a.total ||
      b.comprometido - a.comprometido ||
      a.supplierName.localeCompare(b.supplierName, 'es'),
  );

  return {
    groups,
    total: toCents(groups.reduce((s, g) => s.plus(g.total), D(0))),
    aFavor: toCents(groups.reduce((s, g) => s.plus(g.aFavor), D(0))),
    comprometido: toCents(groups.reduce((s, g) => s.plus(g.comprometido), D(0))),
    facturasComprometidas: groups.reduce((n, g) => n + g.facturasComprometidas, 0),
  };
}
