import { businessCash, type CashLedger } from '@calc3d/shared';
import { categoriaDeLinea, proporcionPorCategoria, repartoDeAbono } from './helpers-de-caja';

/**
 * EL PRORRATEO DE UNA FACTURA, LÍNEA POR LÍNEA.
 *
 * ⚠️ El reparto es una **CONVENCIÓN declarada, no un descuido**: un abono de $20
 * contra una factura de dos filamentos y una placa no "fue" a una línea
 * concreta. Se reparte a prorrata para que «Filamento comprado» siga queriendo
 * decir *todo el filamento que compraste*, venga de una factura o de una compra
 * directa. Con facturas de una sola cosa —lo normal— es exacto.
 *
 * Lo que estaba viejo era que el reparto conociera **dos** clases cuando una
 * línea ya podía ser un insumo desde el 2026-10-20: `if (l.printerId == null)
 * deFilamento += monto`. La placa de $40 de C-0001 se contaba como filamento.
 */
describe('categoriaDeLinea — en qué línea del saldo cae cada tipo de línea', () => {
  const linea = (over: Record<string, unknown> = {}) => ({
    quantity: 1,
    unitPrice: 10,
    materialId: null,
    printerId: null,
    componentId: null,
    nuevoTipo: null,
    ...over,
  });

  it('lee las DOS formas de decir qué es: la ficha del catálogo y la que nace', () => {
    expect(categoriaDeLinea(linea({ materialId: 'mat-1' }))).toBe('filament');
    expect(categoriaDeLinea(linea({ printerId: 'imp-1' }))).toBe('equipment');
    expect(categoriaDeLinea(linea({ componentId: 'ins-1' }))).toBe('consumables');
    // Una impresora encargada por primera vez no está en el catálogo: su ficha
    // nace al recibir, y mirando solo los ids caía en el respaldo.
    expect(categoriaDeLinea(linea({ nuevoTipo: 'MATERIAL' }))).toBe('filament');
    expect(categoriaDeLinea(linea({ nuevoTipo: 'PRINTER' }))).toBe('equipment');
    expect(categoriaDeLinea(linea({ nuevoTipo: 'COMPONENT' }))).toBe('consumables');
  });

  /**
   * El respaldo es `filament` y no es un descuido: es el comportamiento de
   * siempre (todo lo que no era impresora se contaba como filamento), así que
   * una línea con un dato incompleto sigue dando el número que daba ayer.
   */
  it('una línea que no dice qué es cae en filamento, como siempre', () => {
    expect(categoriaDeLinea(linea())).toBe('filament');
  });
});

describe('proporcionPorCategoria — el reparto de una factura', () => {
  /** Las dos líneas de C-0001: $220 de filamento y una placa de $40. */
  const C0001 = [
    { quantity: 1, unitPrice: 220, materialId: 'mat-1' },
    { quantity: 1, unitPrice: 40, componentId: 'ins-1' },
  ];

  it('la placa de C-0001 ($40 de $260) NO cuenta como filamento', () => {
    expect(proporcionPorCategoria(C0001)).toEqual({
      filament: 220 / 260,
      consumables: 40 / 260,
    });
  });

  it('una factura con filamento e insumo se reparte entre las DOS', () => {
    const r = proporcionPorCategoria(C0001);

    expect(Object.keys(r).sort()).toEqual(['consumables', 'filament']);
    // Las fracciones suman 1: el abono se reparte entero, no se pierde ni se
    // duplica una parte.
    expect(Object.values(r).reduce((s, f) => s + (f ?? 0), 0)).toBeCloseTo(1, 10);
  });

  /**
   * ⚠️ **Sin líneas no se inventa una categoría: el mapa va vacío.**
   *
   * Y OJO con lo que esto NO dice. Una factura sin líneas **con un abono** no
   * termina en filamento: tiene `anticipo = pagado`, así que `repartoDeAbono`
   * devuelve `{ supplierAdvances: 1 }` y la plata va a «Anticipos a
   * proveedores» — que es lo correcto, pagaste y no llegó nada. Lo fija el test
   * de punta a punta de `cash.service.spec.ts`. Acá se mide solo el prorrateo
   * de la MERCADERÍA, que sin líneas no tiene nada que repartir, y el respaldo
   * del motor para un mapa vacío de cualquier llamador.
   */
  it('sin líneas el reparto va vacío, y el motor lo respalda en filamento', () => {
    expect(proporcionPorCategoria([])).toEqual({});

    const l: CashLedger = {
      sales: [],
      orderPayments: [],
      expenses: [],
      loanPayments: [],
      movements: [],
      purchasePayments: [
        {
          date: '2026-10-05',
          amount: 140,
          payer: null,
          refundable: true,
          reparto: proporcionPorCategoria([]),
        },
      ],
    };

    expect(businessCash(l).filament).toBe(140);
  });

  it('una línea en cero no inventa una categoría ni divide por cero', () => {
    expect(proporcionPorCategoria([{ quantity: 0, unitPrice: 40, componentId: 'ins-1' }])).toEqual({});
    // Cantidad o precio negativo valen 0: una factura no es el lugar para una
    // devolución, y dejarla pasar restaría del total sin que nadie lo vea.
    expect(proporcionPorCategoria([{ quantity: -3, unitPrice: 40, printerId: 'imp-1' }])).toEqual({});
  });

  it('los montos se agrupan por categoría, no una entrada por línea', () => {
    const r = proporcionPorCategoria([
      { quantity: 1, unitPrice: 50, materialId: 'mat-1' },
      { quantity: 1, unitPrice: 50, materialId: 'mat-2' },
    ]);

    expect(r).toEqual({ filament: 1 });
  });
});

/**
 * «ANTICIPOS A PROVEEDORES»: lo pagado y todavía NO recibido.
 *
 * ⚠️ **Es UNA fila, no un reparto por categoría.** Lo que no llegó no es
 * filamento ni insumo: es plata en manos del proveedor. Con el dinero en su
 * propia fila, el problema que esto vino a cerrar —que $21,54 de un insumo
 * estuvieran etiquetados «filamento»— desaparece solo en C-0001: ya no está
 * etiquetado filamento. A qué apuntaba lo responde el DETALLE del asiento.
 */
describe('repartoDeAbono — el anticipo sale de las líneas de mercadería', () => {
  const C0001 = [
    { quantity: 1, unitPrice: 220, materialId: 'mat-1' },
    { quantity: 1, unitPrice: 40, componentId: 'ins-1' },
  ];

  it('C-0001 tal como está hoy (pagado 140, recibido 0) es todo anticipo', () => {
    expect(repartoDeAbono(C0001, { pagado: 140, anticipo: 140 })).toEqual({
      supplierAdvances: 1,
    });
  });

  it('sin anticipo, el reparto es el de la mercadería y nada más', () => {
    expect(repartoDeAbono(C0001, { pagado: 140, anticipo: 0 })).toEqual({
      filament: 220 / 260,
      consumables: 40 / 260,
    });
  });

  it('con media factura recibida, el anticipo convive con la mercadería', () => {
    const r = repartoDeAbono([{ quantity: 2, unitPrice: 50, materialId: 'mat-1' }], {
      pagado: 100,
      anticipo: 50,
    });

    expect(r).toEqual({ filament: 0.5, supplierAdvances: 0.5 });
  });

  /**
   * Sin abonos no hay nada que repartir como anticipo: dividir por lo pagado
   * sería dividir por cero. El reparto queda en la mercadería.
   */
  it('una factura sin abonos no produce un anticipo de NaN', () => {
    expect(repartoDeAbono(C0001, { pagado: 0, anticipo: 0 })).toEqual({
      filament: 220 / 260,
      consumables: 40 / 260,
    });
  });

  it('las fracciones siempre suman 1: el abono se reparte entero', () => {
    for (const totales of [
      { pagado: 140, anticipo: 0 },
      { pagado: 140, anticipo: 35 },
      { pagado: 140, anticipo: 140 },
      { pagado: 0, anticipo: 0 },
    ]) {
      const suma = Object.values(repartoDeAbono(C0001, totales)).reduce(
        (s, f) => s + (f ?? 0),
        0,
      );
      expect({ totales, suma: Math.round(suma * 1e10) / 1e10 }).toEqual({ totales, suma: 1 });
    }
  });
});
