import { invoiceTotals } from './purchase-invoice';
import {
  creditoTomadoPorFactura,
  evaluarUsoDeSaldo,
  saldoAFavorPorProveedor,
  type FacturaConSaldoAFavor,
} from './supplier-credit';

/**
 * Los números van **puestos a mano**. Derivarlos del mismo motor haría pasar el
 * test con y sin la regla que se está fijando.
 */

describe('creditoTomadoPorFactura: Σ aplicado, por factura de origen', () => {
  it('suma los abonos tomados de cada factura', () => {
    const tomado = creditoTomadoPorFactura([
      { amount: 5, tomadoDeFacturaId: 'f-a' },
      { amount: 4, tomadoDeFacturaId: 'f-a' },
      { amount: 7, tomadoDeFacturaId: 'f-b' },
    ]);

    expect(tomado['f-a']).toBe(9);
    expect(tomado['f-b']).toBe(7);
  });

  it('un abono normal (plata de verdad) NO toma saldo de nadie', () => {
    const tomado = creditoTomadoPorFactura([
      { amount: 100 },
      { amount: 50, tomadoDeFacturaId: null },
      { amount: 6, tomadoDeFacturaId: 'f-a' },
    ]);

    expect(tomado).toEqual({ 'f-a': 6 });
  });

  /**
   * ⚠️ Anular el abono **devuelve** el saldo: la factura de destino vuelve a
   * deberse y el saldo a favor vuelve a estar disponible. Contarlo igual
   * dejaría plata del dueño atrapada para siempre en un abono que ya no existe.
   */
  it('un abono ANULADO no toma nada', () => {
    const tomado = creditoTomadoPorFactura([
      { amount: 9, tomadoDeFacturaId: 'f-a', voided: true },
      { amount: 1, tomadoDeFacturaId: 'f-a' },
    ]);

    expect(tomado['f-a']).toBe(1);
  });

  it('sin abonos de saldo devuelve nada, no ceros inventados', () => {
    expect(creditoTomadoPorFactura([])).toEqual({});
  });
});

describe('invoiceTotals: el saldo a favor DISPONIBLE', () => {
  /** Factura de $85 pagada con $100: $15 de más. */
  const lineas = [{ quantity: 1, unitPrice: 85 }];
  const abonos = [{ amount: 100 }];

  it('sin nada aplicado, lo disponible es todo lo pagado de más', () => {
    const t = invoiceTotals(lineas, abonos);

    expect(t.total).toBe(85);
    expect(t.aFavor).toBe(15);
    expect(t.aFavorDisponible).toBe(15);
  });

  it('usando $6, quedan $9 disponibles y el pagado de más sigue siendo $15', () => {
    const t = invoiceTotals(lineas, abonos, 6);

    // ⚠️ `aFavor` es un HECHO (pagaste $15 de más) y no se mueve nunca;
    // `aFavorDisponible` es lo que todavía podés usar. Confundirlos borraría
    // del historial que ese sobrepago existió.
    expect(t.aFavor).toBe(15);
    expect(t.aFavorDisponible).toBe(9);
  });

  it('usándolo entero queda en 0', () => {
    expect(invoiceTotals(lineas, abonos, 15).aFavorDisponible).toBe(0);
  });

  /**
   * ⚠️ Nunca negativo. Se puede llegar acá sin hacer nada raro: corregir las
   * líneas de la factura de origen sube su total y baja su sobrepago, con el
   * saldo ya aplicado en otra parte. Un disponible negativo se sumaría al
   * bloque del proveedor RESTANDO, y la pantalla diría que el proveedor te debe
   * menos de lo que te debe.
   */
  it('aplicado de más no da disponible negativo', () => {
    expect(invoiceTotals(lineas, abonos, 40).aFavorDisponible).toBe(0);
  });

  it('una factura sin sobrepago no tiene nada disponible', () => {
    const t = invoiceTotals(lineas, [{ amount: 85 }]);

    expect(t.aFavor).toBe(0);
    expect(t.aFavorDisponible).toBe(0);
  });
});

const factura = (f: Partial<FacturaConSaldoAFavor>): FacturaConSaldoAFavor => ({
  id: 'f-1',
  supplierId: 'prov-1',
  supplierName: 'StratoFill',
  voidedAt: null,
  aFavor: 0,
  aFavorDisponible: 0,
  ...f,
});

describe('saldoAFavorPorProveedor: cuánto tiene a favor cada uno', () => {
  it('suma lo disponible de sus facturas', () => {
    const r = saldoAFavorPorProveedor([
      factura({ id: 'f-1', aFavor: 15, aFavorDisponible: 9 }),
      factura({ id: 'f-2', aFavor: 20, aFavorDisponible: 20 }),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].supplierId).toBe('prov-1');
    expect(r[0].disponible).toBe(29);
    expect(r[0].facturas.map((f) => f.id)).toEqual(['f-2', 'f-1']); // de mayor a menor
  });

  it('separa por proveedor: el saldo de uno NO sirve con el otro', () => {
    const r = saldoAFavorPorProveedor([
      factura({ id: 'f-1', aFavorDisponible: 9 }),
      factura({ id: 'f-2', supplierId: 'prov-2', supplierName: 'Filaven', aFavorDisponible: 30 }),
    ]);

    expect(r.map((g) => [g.supplierId, g.disponible])).toEqual([
      ['prov-2', 30],
      ['prov-1', 9],
    ]);
  });

  it('una factura ANULADA no deja saldo a favor', () => {
    const r = saldoAFavorPorProveedor([
      factura({ id: 'f-1', aFavor: 15, aFavorDisponible: 15, voidedAt: '2026-10-09' }),
    ]);

    expect(r).toEqual([]);
  });

  it('una factura con el saldo ya gastado no aparece', () => {
    expect(saldoAFavorPorProveedor([factura({ aFavor: 15, aFavorDisponible: 0 })])).toEqual([]);
  });

  /**
   * ⚠️ **"Sin proveedor anotado" NO es un proveedor.** Dos facturas sin
   * proveedor pueden ser de dos personas distintas: juntar sus saldos dejaría
   * usar la plata que te debe uno para pagarle al otro.
   */
  it('una factura sin proveedor anotado no genera saldo usable', () => {
    const r = saldoAFavorPorProveedor([
      factura({ supplierId: null, supplierName: null, aFavor: 15, aFavorDisponible: 15 }),
    ]);

    expect(r).toEqual([]);
  });
});

describe('evaluarUsoDeSaldo: las dos cosas que no se pueden hacer', () => {
  const destino = { id: 'f-nueva', supplierId: 'prov-1' };
  const conSaldo = [
    factura({ id: 'f-vieja', aFavor: 15, aFavorDisponible: 15 }),
    factura({ id: 'f-nueva', aFavor: 0, aFavorDisponible: 0 }),
  ];

  it('tomar menos de lo que hay se puede', () => {
    expect(evaluarUsoDeSaldo(conSaldo, destino, 'f-vieja', 10)).toEqual({
      rechazo: null,
      disponible: 15,
    });
  });

  it('tomarlo EXACTO se puede: el límite es inclusivo', () => {
    expect(evaluarUsoDeSaldo(conSaldo, destino, 'f-vieja', 15).rechazo).toBeNull();
  });

  /** ⚠️ Primera regla del spec: no se puede aplicar más saldo del que hay. */
  it('NO se puede tomar más de lo que hay', () => {
    expect(evaluarUsoDeSaldo(conSaldo, destino, 'f-vieja', 15.01)).toEqual({
      rechazo: 'SIN_SALDO',
      disponible: 15,
    });
  });

  it('un centavo de más tampoco: el saldo ya gastado no se puede reusar', () => {
    const facturas = [
      factura({ id: 'f-vieja', aFavor: 15, aFavorDisponible: 9 }),
      factura({ id: 'f-nueva' }),
    ];

    expect(evaluarUsoDeSaldo(facturas, destino, 'f-vieja', 9.01).rechazo).toBe('SIN_SALDO');
    expect(evaluarUsoDeSaldo(facturas, destino, 'f-vieja', 9).rechazo).toBeNull();
  });

  /** ⚠️ Segunda regla del spec: el saldo es DE ESE proveedor. */
  it('NO se puede usar el saldo de OTRO proveedor', () => {
    const facturas = [
      factura({ id: 'f-otro', supplierId: 'prov-2', supplierName: 'Filaven', aFavorDisponible: 50 }),
      factura({ id: 'f-nueva' }),
    ];

    expect(evaluarUsoDeSaldo(facturas, destino, 'f-otro', 10)).toEqual({
      rechazo: 'OTRO_PROVEEDOR',
      disponible: 50,
    });
  });

  it('una factura SIN proveedor no puede dar ni recibir saldo', () => {
    const facturas = [
      factura({ id: 'f-anonima', supplierId: null, supplierName: null, aFavorDisponible: 50 }),
      factura({ id: 'f-nueva' }),
    ];

    expect(evaluarUsoDeSaldo(facturas, destino, 'f-anonima', 10).rechazo).toBe('SIN_PROVEEDOR');
    expect(
      evaluarUsoDeSaldo(conSaldo, { id: 'f-nueva', supplierId: null }, 'f-vieja', 10).rechazo,
    ).toBe('SIN_PROVEEDOR');
  });

  /**
   * ⚠️ El origen sale de la LISTA que recibe esta función, que es la de la
   * organización: ser miembro ES la autorización. Una factura de otro negocio
   * no está en la lista, así que cae acá — el mismo cierre por construcción
   * que `applyPayment` con su obligación destino.
   */
  it('una factura que no está en la lista no existe para esto', () => {
    expect(evaluarUsoDeSaldo(conSaldo, destino, 'f-de-otro-negocio', 1)).toEqual({
      rechazo: 'ORIGEN_DESCONOCIDO',
      disponible: 0,
    });
  });

  it('una factura ANULADA no presta su saldo', () => {
    const facturas = [
      factura({ id: 'f-vieja', aFavorDisponible: 15, voidedAt: '2026-10-01' }),
      factura({ id: 'f-nueva' }),
    ];

    expect(evaluarUsoDeSaldo(facturas, destino, 'f-vieja', 1).rechazo).toBe('ORIGEN_ANULADO');
  });

  /**
   * Tomar saldo de la factura que se está abonando no cancela nada: subiría
   * `pagado` sin que entrara plata, y el sobrepago que lo financia es de ella
   * misma. Es un círculo que inventa un pago.
   */
  it('una factura no se paga con su propio saldo a favor', () => {
    const facturas = [factura({ id: 'f-nueva', aFavor: 15, aFavorDisponible: 15 })];

    expect(evaluarUsoDeSaldo(facturas, destino, 'f-nueva', 5).rechazo).toBe('MISMA_FACTURA');
  });
});
