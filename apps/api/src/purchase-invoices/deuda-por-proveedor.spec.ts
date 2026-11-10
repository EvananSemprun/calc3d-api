import { deudaPorProveedor, type FacturaParaDeuda } from './deuda-por-proveedor';

/**
 * LO QUE LE DEBES A CADA PROVEEDOR — números a mano.
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
  deuda: 0,
  comprometido: 0,
  aFavorDisponible: 0,
  ...over,
});

describe('deudaPorProveedor — agrupa y suma', () => {
  it('suma las deudas de cada proveedor y el total es la suma de los grupos', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 30 }),
      factura({ supplier: PROV_A, deuda: 12.5 }),
      factura({ supplier: PROV_B, deuda: 100 }),
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
      factura({ supplier: PROV_A, deuda: 10 }),
      factura({ supplier: PROV_B, deuda: 90 }),
    ]);

    expect(r.groups.map((g) => g.supplierId)).toEqual(['prov-b', 'prov-a']);
  });

  it('una factura SIN proveedor anotado se debe igual, en su propio grupo', () => {
    const r = deudaPorProveedor([
      factura({ supplier: null, deuda: 7 }),
      factura({ supplier: PROV_A, deuda: 3 }),
    ]);

    // No desaparece por no tener nombre: esa plata se debe.
    expect(r.total).toBe(10);
    expect(r.groups.find((g) => g.supplierId === null)?.supplierName).toBe('Sin proveedor anotado');
  });

  it('un proveedor sin nada pendiente no se dibuja', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 0 }),
      factura({ supplier: PROV_B, deuda: 5 }),
    ]);

    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].supplierId).toBe('prov-b');
  });

  it('sin facturas, todo en cero y sin grupos', () => {
    expect(deudaPorProveedor([])).toEqual({
      groups: [],
      total: 0,
      aFavor: 0,
      comprometido: 0,
      facturasComprometidas: 0,
    });
  });
});

describe('deudaPorProveedor — una factura ANULADA no se debe', () => {
  it('su deuda queda fuera del grupo y del total', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 40 }),
      factura({ supplier: PROV_A, deuda: 1000, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    // Los $1000 anulados NO existen: el proveedor sigue debiendo 40.
    expect(r.total).toBe(40);
    expect(r.groups[0].total).toBe(40);
    expect(r.groups[0].facturas).toBe(1);
  });

  it('un proveedor cuya ÚNICA factura está anulada desaparece del bloque', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_B, deuda: 500, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    expect(r.groups).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('tampoco cuenta lo pagado de más de una factura anulada', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, aFavorDisponible: 80, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    expect(r.aFavor).toBe(0);
    expect(r.groups).toHaveLength(0);
  });
});

describe('deudaPorProveedor — lo pagado de más NO se compensa', () => {
  it('no resta de lo que debes en otra factura del MISMO proveedor', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 50 }),
      factura({ supplier: PROV_A, aFavorDisponible: 20 }),
    ]);

    // ⚠️ Le debes 50, no 30. Los 20 de más son otra cuenta: restarlos
    // inventaría un pago que nunca se hizo contra esa factura.
    expect(r.groups[0].total).toBe(50);
    expect(r.groups[0].aFavor).toBe(20);
    expect(r.groups[0].facturasAFavor).toBe(1);
    expect(r.total).toBe(50);
    expect(r.aFavor).toBe(20);
  });

  it('tampoco resta de lo que debes a OTRO proveedor', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, aFavorDisponible: 1000 }),
      factura({ supplier: PROV_B, deuda: 60 }),
    ]);

    expect(r.total).toBe(60);
    expect(r.aFavor).toBe(1000);
    // Y el de más NUNCA vuelve negativo un total.
    expect(r.groups.every((g) => g.total >= 0)).toBe(true);
  });

  it('un proveedor SOLO con pagado de más se muestra, con deuda en cero', () => {
    const r = deudaPorProveedor([factura({ supplier: PROV_A, aFavorDisponible: 15 })]);

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
      factura({ deuda: 0.1 }),
      factura({ deuda: 0.2 }),
      factura({ deuda: 0.3 }),
    ]);

    expect(r.total).toBe(0.6);
    expect(r.groups[0].total).toBe(0.6);
  });
});

/**
 * ⚠️ **LO QUE DEUDA MUESTRA A FAVOR ES LO QUE TODAVÍA SE PUEDE USAR**, no lo que
 * se pagó de más alguna vez.
 *
 * Desde la fase 3 el saldo a favor **se usa**: un abono de otra factura del
 * mismo proveedor puede estar financiado con él. `aFavor` sigue siendo el HECHO
 * (pagaste $15 de más y eso no se borra) y `aFavorDisponible` lo que queda. Si
 * esta pantalla sumara el hecho, diría que el proveedor te debe plata que ya te
 * devolvió en mercadería — y es el número que el dueño usa para decidir si
 * reclamar.
 */
describe('deudaPorProveedor — a favor es lo DISPONIBLE, no lo pagado de más', () => {
  it('usar el saldo lo baja en la pantalla: pagó 15 de más, usó 6, quedan 9', () => {
    const r = deudaPorProveedor([factura({ supplier: PROV_A, aFavorDisponible: 9 })]);

    expect(r.aFavor).toBe(9);
    expect(r.groups[0].aFavor).toBe(9);
    expect(r.groups[0].facturasAFavor).toBe(1);
  });

  it('el saldo gastado entero desaparece del bloque, aunque el sobrepago siga ahí', () => {
    // La factura sigue diciendo que pagaste 15 de más; disponible ya es 0.
    const r = deudaPorProveedor([factura({ supplier: PROV_A, aFavorDisponible: 0 })]);

    // No hay nada que decirle al proveedor: ni le debes ni te debe.
    expect(r.aFavor).toBe(0);
    expect(r.groups).toHaveLength(0);
  });

  /**
   * Y el total de la pantalla sigue siendo la suma de sus partes: usar saldo
   * baja el saldo de la factura de destino (lo hace `invoiceTotals`, no esto),
   * así que los dos números se mueven juntos y ninguno se inventa.
   */
  it('deuda y saldo a favor siguen siendo DOS cuentas: ni se compensan ni se pierden', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 34 }),
      factura({ supplier: PROV_A, aFavorDisponible: 9 }),
    ]);

    expect(r.groups[0].total).toBe(34);
    expect(r.groups[0].aFavor).toBe(9);
    expect(r.total).toBe(34);
    expect(r.total).toBe(r.groups.reduce((s, g) => s + g.total, 0));
  });
});

/**
 * ⚠️ **DEUDA Y COMPROMETIDO SON DOS CUENTAS** (fase B, tarea 2).
 *
 * «A proveedores» es solo lo que ya te llegó y no pagaste (`deuda`). Lo que
 * pediste y todavía no llegó vive aparte, como `comprometido`. Las tres
 * facturas abiertas de producción son el caso de aceptación: antes el bloque
 * decía $334 y ahora tiene que decir $0, con $334 comprometidos.
 */
describe('deudaPorProveedor — deuda real y comprometido', () => {
  // C-0001: total 260, pagado 140, recibido 0 → comprometido 120.
  // C-0004: total 134, nada pagado ni recibido → comprometido 134.
  // C-0006: total 80, nada pagado ni recibido → comprometido 80.
  const ABIERTAS = [
    factura({ supplier: PROV_A, comprometido: 120 }),
    factura({ supplier: PROV_A, comprometido: 134 }),
    factura({ supplier: PROV_B, comprometido: 80 }),
  ];

  it('con las tres facturas abiertas de producción, «A proveedores» da 0', () => {
    const r = deudaPorProveedor(ABIERTAS);

    expect(r.total).toBe(0);
    // ⚠️ Sin esto el test pasaba con `groups` vacío: `every` sobre [] es true, y
    // «las tres con deuda 0» no se distinguía de «las tres se descartaron».
    expect(r.groups).toHaveLength(2);
    expect(r.groups.every((g) => g.total === 0)).toBe(true);
  });

  it('«Comprometido» da 334, repartido 120 + 134 + 80', () => {
    const r = deudaPorProveedor(ABIERTAS);

    expect(r.comprometido).toBe(334);
    expect(r.facturasComprometidas).toBe(3);
    expect(r.groups.find((g) => g.supplierId === 'prov-a')?.comprometido).toBe(254); // 120 + 134
    expect(r.groups.find((g) => g.supplierId === 'prov-b')?.comprometido).toBe(80);
  });

  /**
   * ⚠️ EL TEST MÁS IMPORTANTE DE LA TAREA. Hoy el guard descarta una factura sin
   * deuda ni a favor: con `deuda` en lugar de `saldo`, las tres valen 0 y se
   * descartarían ANTES de que nadie sume el compromiso.
   */
  it('una factura con SOLO compromiso no se descarta', () => {
    const r = deudaPorProveedor([factura({ supplier: PROV_A, comprometido: 80 })]);

    expect(r.groups).toHaveLength(1);
    expect(r.comprometido).toBe(80);
    expect(r.facturasComprometidas).toBe(1);
  });

  /**
   * ⚠️ El Dashboard dice «$X comprometido en N facturas»: N no puede salir de
   * `facturas`, que cuenta solo las que tienen deuda y daría 0 contra $334.
   */
  it('cuenta las facturas comprometidas aparte de las que tienen deuda', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 30 }),
      factura({ supplier: PROV_A, comprometido: 50 }),
      factura({ supplier: PROV_A, deuda: 10, comprometido: 20 }),
    ]);

    const a = r.groups[0];
    expect(a.facturas).toBe(2); // las de deuda
    expect(a.facturasComprometidas).toBe(2); // las de compromiso: la 2.ª y la 3.ª
    expect(a.total).toBe(40);
    expect(a.comprometido).toBe(70);
    expect(r.facturasComprometidas).toBe(2);
  });

  it('una factura ANULADA no compromete nada', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, comprometido: 500, voidedAt: '2026-10-09T00:00:00.000Z' }),
    ]);

    expect(r.groups).toHaveLength(0);
    expect(r.comprometido).toBe(0);
    expect(r.facturasComprometidas).toBe(0);
  });

  it('el comprometido NO suma al total de deuda ni lo compensa el a favor', () => {
    const r = deudaPorProveedor([
      factura({ supplier: PROV_A, deuda: 25, comprometido: 100 }),
      factura({ supplier: PROV_A, aFavorDisponible: 10 }),
    ]);

    expect(r.total).toBe(25);
    expect(r.comprometido).toBe(100);
    expect(r.aFavor).toBe(10);
  });

  /**
   * Presentación: el que tiene deuda real va primero; a igualdad de deuda, el
   * de más compromiso. Un proveedor solo con compromiso no queda mezclado al
   * azar con los de total 0.
   */
  it('ordena por deuda, luego por comprometido, luego por nombre', () => {
    const r = deudaPorProveedor([
      factura({ supplier: { id: 'z', name: 'Zeta' }, comprometido: 10 }),
      factura({ supplier: { id: 'm', name: 'Medio' }, comprometido: 90 }),
      factura({ supplier: { id: 'd', name: 'Debe' }, deuda: 5 }),
    ]);

    expect(r.groups.map((g) => g.supplierId)).toEqual(['d', 'm', 'z']);
  });

  it('a igualdad de deuda y de comprometido, desempata por nombre', () => {
    const r = deudaPorProveedor([
      factura({ supplier: { id: 'z', name: 'Zeta' }, deuda: 5, comprometido: 20 }),
      factura({ supplier: { id: 'a', name: 'Alfa' }, deuda: 5, comprometido: 20 }),
    ]);

    expect(r.groups.map((g) => g.supplierId)).toEqual(['a', 'z']);
  });
});
