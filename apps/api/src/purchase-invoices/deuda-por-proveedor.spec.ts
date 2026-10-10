import { deudaPorProveedor, type FacturaParaDeuda } from './deuda-por-proveedor';

/**
 * LO QUE LE DEBÉS A CADA PROVEEDOR — números a mano.
 *
 * Todos los montos de este archivo están elegidos para que la suma se pueda
 * hacer de cabeza: si un día el agrupador pierde o duplica una factura, el
 * número cantado deja de dar y el test lo dice.
 */

const PROV_A = { id: 'prov-a', name: 'StratoFill' };
const PROV_B = { id: 'prov-b', name: 'Filamentos del Sur' };

const factura = (over: Partial<FacturaParaDeuda> = {}): FacturaParaDeuda => ({
  supplier: PROV_A,
  voidedAt: null,
  saldo: 0,
  aFavor: 0,
  ...over,
});

describe('deudaPorProveedor — agrupa y suma', () => {
  it('suma los saldos de cada proveedor y el total es la suma de los grupos', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, saldo: 30 }),
      factura({ supplier: PROV_A, saldo: 12.5 }),
      factura({ supplier: PROV_B, saldo: 100 }),
    ]);

    // 30 + 12.50 = 42.50 con A; 100 con B; 142.50 en total.
    expect(r.groups).toHaveLength(2);
    expect(r.total).toBe(142.5);
    const a = r.groups.find((g) => g.supplierId === 'prov-a');
    expect(a?.total).toBe(42.5);
    expect(a?.facturas).toBe(2);
    expect(r.groups.find((g) => g.supplierId === 'prov-b')?.total).toBe(100);
    // El total NO es otro camino: tiene que ser la suma de lo que se dibuja.
    expect(r.total).toBe(r.groups.reduce((s, g) => s + g.total, 0));
  });

  it('el grupo de más deuda va primero: es el orden en que se mira la pantalla', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, saldo: 10 }),
      factura({ supplier: PROV_B, saldo: 90 }),
    ]);

    expect(r.groups.map((g) => g.supplierId)).toEqual(['prov-b', 'prov-a']);
  });

  it('una factura SIN proveedor anotado se debe igual, en su propio grupo', () => {
    const r = deudaPorProveedor([
      factura({ supplier: null, saldo: 7 }),
      factura({ supplier: PROV_A, saldo: 3 }),
    ]);

    // No desaparece por no tener nombre: esa plata se debe.
    expect(r.total).toBe(10);
    expect(r.groups.find((g) => g.supplierId === null)?.supplierName).toBe('Sin proveedor anotado');
  });

  it('un proveedor sin nada pendiente no se dibuja', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, saldo: 0 }),
      factura({ supplier: PROV_B, saldo: 5 }),
    ]);

    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].supplierId).toBe('prov-b');
  });

  it('sin facturas, todo en cero y sin grupos', () => {
    expect(deudaPorProveedor([])).toEqual({ groups: [], total: 0, aFavor: 0 });
  });
});

describe('deudaPorProveedor — una factura ANULADA no se debe', () => {
  it('su saldo queda fuera del grupo y del total', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, saldo: 40 }),
      factura({ supplier: PROV_A, saldo: 1000, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    // Los $1000 anulados NO existen: el proveedor sigue debiendo 40.
    expect(r.total).toBe(40);
    expect(r.groups[0].total).toBe(40);
    expect(r.groups[0].facturas).toBe(1);
  });

  it('un proveedor cuya ÚNICA factura está anulada desaparece del bloque', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_B, saldo: 500, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    expect(r.groups).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('tampoco cuenta lo pagado de más de una factura anulada', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, aFavor: 80, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    expect(r.aFavor).toBe(0);
    expect(r.groups).toHaveLength(0);
  });
});

describe('deudaPorProveedor — lo pagado de más NO se compensa', () => {
  it('no resta de lo que debés en otra factura del MISMO proveedor', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, saldo: 50 }),
      factura({ supplier: PROV_A, aFavor: 20 }),
    ]);

    // ⚠️ Le debés 50, no 30. Los 20 de más son otra cuenta: restarlos
    // inventaría un pago que nunca se hizo contra esa factura.
    expect(r.groups[0].total).toBe(50);
    expect(r.groups[0].aFavor).toBe(20);
    expect(r.groups[0].facturasAFavor).toBe(1);
    expect(r.total).toBe(50);
    expect(r.aFavor).toBe(20);
  });

  it('tampoco resta de lo que debés a OTRO proveedor', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, aFavor: 1000 }),
      factura({ supplier: PROV_B, saldo: 60 }),
    ]);

    expect(r.total).toBe(60);
    expect(r.aFavor).toBe(1000);
    // Y el de más NUNCA vuelve negativo un total.
    expect(r.groups.every((g) => g.total >= 0)).toBe(true);
  });

  it('un proveedor SOLO con pagado de más se muestra, con deuda en cero', () => {
    const r = deudaPorProveedor([factura({ supplier: PROV_A, aFavor: 15 })]);

    // Hay algo que decirle, pero no es deuda: sin esto, el dato desaparece.
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].total).toBe(0);
    expect(r.groups[0].facturas).toBe(0);
    expect(r.groups[0].aFavor).toBe(15);
    expect(r.total).toBe(0);
  });
});

describe('deudaPorProveedor — centavos', () => {
  it('tres tercios de centavo no dejan un total con cola de coma flotante', () => {
    const r = deudaPorProveedor([
      factura({ saldo: 0.1 }),
      factura({ saldo: 0.2 }),
      factura({ saldo: 0.3 }),
    ]);

    expect(r.total).toBe(0.6);
    expect(r.groups[0].total).toBe(0.6);
  });
});
