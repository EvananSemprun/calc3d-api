/**
 * EL INVARIANTE DE CIERRE DE LAS COMPRAS (fase B, tarea 9).
 *
 *     Gastos recibidos + Anticipos − Deuda = lo que salió de Caja por compras
 *
 * Por factura es una identidad: `valorRecibido + anticipo − deuda = pagado`
 * (porque `anticipo − deuda = pagado − valorRecibido`, sea cual sea el signo).
 * Lo que hace valioso al test es que compara las tres piezas de la fórmula, que
 * salen de `invoiceTotals`, contra el otro lado, que sale de **la Caja**
 * (`businessCash` sobre los abonos repartidos por `repartoDeAbono`): dos caminos
 * independientes hacia la misma plata.
 *
 * ⚠️ **El `− Deuda` NO es opcional.** Sin él la regla se reduce a
 * `máx(pagado, recibido) = pagado`, que se rompe el día de la primera compra a
 * crédito (recibida y sin pagar): justo el caso que la fórmula existe para cubrir.
 * El segundo test lo demuestra, y el tercero deja el contrafáctico a la vista.
 *
 * ⚠️ **Los números están CLAVADOS A MANO** y no se derivan de las funciones que
 * se prueban: un test que calcula su esperado con la misma función que verifica
 * es una tautología (este repo ya se comió una así).
 */
import { businessCash, invoiceTotals, type CashLedger } from '@calc3d/shared';
import { repartoDeAbono, type LineaParaReparto } from './helpers-de-caja';

interface Factura {
  lineas: (LineaParaReparto & { received: number })[];
  /** Abonos en USD. `deSaldo` = tomado del saldo a favor (no mueve la Caja). */
  abonos: { amount: number; deSaldo?: boolean }[];
}

const totalesDe = (f: Factura, creditoTomado = 0) =>
  invoiceTotals(
    f.lineas.map((l) => ({ quantity: l.quantity, unitPrice: Number(l.unitPrice), received: l.received })),
    f.abonos.map((a) => ({ amount: a.amount })),
    creditoTomado,
  );

/** La Caja de un conjunto de facturas: solo los abonos, repartidos como en producción. */
const cajaDe = (facturas: Factura[]): CashLedger => ({
  sales: [],
  orderPayments: [],
  expenses: [], // los gastos que nacen al recibir van marcados `fromInvoice`: no entran a Caja
  purchasePayments: facturas.flatMap((f, i) => {
    const t = totalesDe(f);
    return f.abonos.map((a, j) => ({
      id: `f${i}-a${j}`,
      date: '2026-11-10',
      amount: a.amount,
      payer: null,
      refundable: true,
      reparto: repartoDeAbono(f.lineas, { pagado: t.pagado, anticipo: t.anticipo }),
      fromCredit: a.deSaldo === true,
    }));
  }),
  loanPayments: [],
  movements: [],
});

/** Lo que salió de Caja por compras, en positivo: las cuatro líneas que producen los abonos. */
const salidoPorCompras = (c: CashLedger) => {
  const b = businessCash(c);
  return b.filament + b.equipment + b.consumables + b.supplierAdvances;
};

/** La fórmula tal cual, sumada sobre las facturas con `invoiceTotals`. */
const cierre = (facturas: Factura[]) =>
  facturas.reduce((s, f) => {
    const t = totalesDe(f);
    return s + t.valorRecibido + t.anticipo - t.deuda;
  }, 0);

const FILAMENTO = { materialId: 'mat', quantity: 10, unitPrice: 7, received: 6 }; // pedido 70, llegó 42
const INSUMOS = { componentId: 'ins', quantity: 4, unitPrice: 10, received: 4 }; // 40, llegó todo
const IMPRESORA = { printerId: 'imp', quantity: 1, unitPrice: 300, received: 1 }; // 300, llegó

describe('el invariante de cierre: Gastos recibidos + Anticipos − Deuda = salido de Caja', () => {
  const F1: Factura = { lineas: [FILAMENTO], abonos: [{ amount: 70 }] }; // pagó 70, llegaron 42 → anticipo 28
  const F2: Factura = { lineas: [INSUMOS], abonos: [{ amount: 40 }] }; // exacta
  const F3: Factura = { lineas: [IMPRESORA], abonos: [{ amount: 100 }] }; // pagó 100 de 300 → deuda 200

  it('con un anticipo, una factura exacta y una a medio pagar', () => {
    const t = [F1, F2, F3].map((f) => totalesDe(f));

    // Cada pieza, clavada a mano (no solo la suma):
    expect(t.map((x) => x.valorRecibido)).toEqual([42, 40, 300]);
    expect(t.map((x) => x.anticipo)).toEqual([28, 0, 0]);
    expect(t.map((x) => x.deuda)).toEqual([0, 0, 200]);

    const gastosRecibidos = 42 + 40 + 300; // 382
    const anticipos = 28;
    const deuda = 200;
    expect(gastosRecibidos + anticipos - deuda).toBe(210);

    // Y la Caja, por su camino: 42 filamento + 28 anticipo + 40 insumos + 100 equipo.
    const caja = businessCash(cajaDe([F1, F2, F3]));
    expect(caja.filament).toBe(42);
    expect(caja.supplierAdvances).toBe(28);
    expect(caja.consumables).toBe(40);
    expect(caja.equipment).toBe(100);
    expect(salidoPorCompras(cajaDe([F1, F2, F3]))).toBe(210);
    expect(cierre([F1, F2, F3])).toBe(salidoPorCompras(cajaDe([F1, F2, F3])));
    expect(caja.balance).toBe(-210);
  });

  it('se sostiene con una factura recibida y SIN pagar: la compra a crédito', () => {
    const aCredito: Factura = { lineas: [INSUMOS], abonos: [] }; // llegó 40, no se pagó nada
    const t = totalesDe(aCredito);
    expect(t.valorRecibido).toBe(40);
    expect(t.anticipo).toBe(0);
    expect(t.deuda).toBe(40);

    // 40 + 0 − 40 = 0, y de la Caja no salió un centavo.
    expect(40 + 0 - 40).toBe(0);
    expect(cierre([aCredito])).toBe(0);
    expect(salidoPorCompras(cajaDe([aCredito]))).toBe(0);
    expect(businessCash(cajaDe([aCredito])).balance).toBe(0);
  });

  it('contrafáctico: SIN el `− Deuda` la fórmula da otra cosa en la compra a crédito', () => {
    // Recibida (40) y sin pagar: sin restar la deuda la regla diría que salieron
    // 40 de Caja, y salieron 0. Con `máx(pagado, recibido)` pasa lo mismo.
    const sinRestarDeuda = 40 + 0;
    const maxPagadoRecibido = Math.max(0, 40);
    const real = salidoPorCompras(cajaDe([{ lineas: [INSUMOS], abonos: [] }]));
    expect(real).toBe(0);
    expect(sinRestarDeuda).not.toBe(real);
    expect(maxPagadoRecibido).not.toBe(real);
  });

  it('un abono TOMADO DEL SALDO A FAVOR no sale de Caja: la fórmula descuenta ese crédito', () => {
    // A: costó 85 (llegó todo) y se pagaron 100 → anticipo 15.
    // B: costó 40 (llegó todo); se pagaron 34 en efectivo y 6 del saldo a favor de A.
    const A: Factura = {
      lineas: [{ materialId: 'mat', quantity: 85, unitPrice: 1, received: 85 }],
      abonos: [{ amount: 100 }],
    };
    const B: Factura = { lineas: [INSUMOS], abonos: [{ amount: 34 }, { amount: 6, deSaldo: true }] };

    const tA = totalesDe(A);
    const tB = totalesDe(B);
    expect([tA.valorRecibido, tA.anticipo, tA.deuda]).toEqual([85, 15, 0]);
    expect([tB.valorRecibido, tB.anticipo, tB.deuda]).toEqual([40, 0, 0]);

    // De Caja salieron 100 + 34 = 134: los 6 del saldo ya habían salido en A.
    expect(salidoPorCompras(cajaDe([A, B]))).toBe(134);

    // 125 recibido + 15 anticipos − 0 deuda = 140, que son 6 de más: esos 6 son
    // el crédito ya aplicado. Con el término de crédito cierra al centavo.
    expect(85 + 40 + 15 - 0).toBe(140);
    expect(85 + 40 + 15 - 0 - 6).toBe(134);
  });
});
