import { groupPurchases } from '@calc3d/shared';
import { baseFalsa, type BaseFalsa } from '../common/unir-fichas.fake';
import { MaterialsService } from '../materials/materials.service';
import { FilamentService } from './filament.service';

/**
 * EL HISTÓRICO NO SE REESCRIBE (cierre de la fase (h), 13/11).
 *
 * Un cierre mensual es un DOCUMENTO: el dueño lo dio por final. Descontinuar una
 * ficha o unirla con su duplicada son operaciones de limpieza del catálogo, y
 * ninguna puede cambiar lo que ya se contó ni lo que ya se pagó.
 *
 * ⚠️ **Los números están CLAVADOS a mano**, calculados en papel desde el
 * escenario de abajo. Medir «antes» y «después» con la misma función y comparar
 * entre sí no probaría nada: si la función se rompiera igual en los dos lados,
 * el test pasaría. Acá cada medición se compara contra una constante literal,
 * tanto ANTES como DESPUÉS de la operación.
 *
 * ⚠️ Los servicios son los reales (`MaterialsService`, `FilamentService`) y la
 * base es `baseFalsa`: claves foráneas, única de conteos y rollback incluidos.
 *
 * El escenario (4 fichas de la misma organización, rollos de 1000 g):
 *   m1 «PLA Negro»    Sunlu  PLA   Negro   — duplicada de m2
 *   m2 «PLA Negro 2»  Sunlu  PLA   Negro   — la que sobrevive al unir
 *   m3 «PETG Rojo»    Esun   PETG  Rojo
 *   m4 «PLA Blanco»   Sunlu  PLA   Blanco
 *
 * Compras (rollos, USD):          Conteo (sellados, en uso, por acabarse):
 *   e1 m1  2  $40  (10/07)          julio   m1 1,0,0  m2 2,0,0  m4 3,0,0           → 6
 *   e2 m1  1  $22  (05/08)          agosto  m1 2,1,0  m2 1,0,1  m3 1,0,0  m4 0,1,1 → 8
 *   e3 m2  3  $75  (20/07)
 *   e4 m3  2  $36  (12/08)          Total comprado: 12 rollos, $261
 *   e5 m4  4  $88  (15/06)
 */
const ORG = 'org-A';
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);

const ficha = (id: string, name: string, type: string, brand: string, color: string, rollPrice: number) => ({
  id, organizationId: ORG, name, type, brand, color, rollPrice, rollGrams: 1000, status: 'ACTIVE',
});
const compra = (id: string, materialId: string, quantity: number, amount: number, fecha: string) => ({
  id, organizationId: ORG, materialId, quantity, amount, date: D(fecha), createdAt: D(fecha), description: null,
});
const conteo = (id: string, materialId: string, month: string, sealed: number, inUse: number, running: number) => ({
  id, organizationId: ORG, materialId, month: D(month), sealed, inUse, running, needsBrandCheck: false,
});

function escenario(): BaseFalsa {
  return baseFalsa({
    material: [
      ficha('m1', 'PLA Negro', 'PLA', 'Sunlu', 'Negro', 20),
      ficha('m2', 'PLA Negro 2', 'PLA', 'Sunlu', 'Negro', 25),
      ficha('m3', 'PETG Rojo', 'PETG', 'Esun', 'Rojo', 18),
      ficha('m4', 'PLA Blanco', 'PLA', 'Sunlu', 'Blanco', 22),
    ],
    expense: [
      compra('e1', 'm1', 2, 40, '2026-07-10'),
      compra('e2', 'm1', 1, 22, '2026-08-05'),
      compra('e3', 'm2', 3, 75, '2026-07-20'),
      compra('e4', 'm3', 2, 36, '2026-08-12'),
      compra('e5', 'm4', 4, 88, '2026-06-15'),
    ],
    stockMonth: [
      { id: 'sm7', organizationId: ORG, month: D('2026-07-01'), closedAt: D('2026-08-01') },
      { id: 'sm8', organizationId: ORG, month: D('2026-08-01'), closedAt: D('2026-09-01') },
    ],
    stockCount: [
      conteo('c71', 'm1', '2026-07-01', 1, 0, 0),
      conteo('c72', 'm2', '2026-07-01', 2, 0, 0),
      conteo('c74', 'm4', '2026-07-01', 3, 0, 0),
      conteo('c81', 'm1', '2026-08-01', 2, 1, 0),
      conteo('c82', 'm2', '2026-08-01', 1, 0, 1),
      conteo('c83', 'm3', '2026-08-01', 1, 0, 0),
      conteo('c84', 'm4', '2026-08-01', 0, 1, 1),
    ],
  });
}

const materiales = (b: BaseFalsa) => new MaterialsService(b.prisma as never);
const filamento = (b: BaseFalsa) => new FilamentService(b.prisma as never);

/** El resumen del mes cerrado, sin lo que depende del estado de cada ficha (la reposición). */
async function resumenDeAgosto(b: BaseFalsa) {
  const r = await filamento(b).summary(ORG, '2026-08');
  return { totalRolls: r.totalRolls, running: r.running, consumption: r.consumption, purchased: r.purchased, complete: r.complete };
}
/** Las casillas del conteo de cada ficha, que es lo que el dueño dio por final. */
async function conteoDelMes(b: BaseFalsa, mes: string) {
  const filas = await filamento(b).stock(ORG, mes);
  return Object.fromEntries(filas.map((f) => [f.materialId, [f.sealed, f.inUse, f.running, f.total, f.counted]]));
}
/** Lo que cada compra pasada costó: monto, rollos y costo por rollo y por gramo. */
async function costoDeCadaCompra(b: BaseFalsa) {
  const compras = await filamento(b).purchases(ORG);
  return Object.fromEntries(
    compras.map((c) => [
      c.id,
      { quantity: c.quantity, amount: c.amount, costPerRoll: c.costPerRoll, costPerGram: c.costPerGram, date: c.date.slice(0, 10) },
    ]),
  );
}
/** El análisis de compras por marca, tipo y color: sin `share` (se deriva de lo mismo). */
async function analisis(b: BaseFalsa) {
  const compras = await filamento(b).purchases(ORG);
  const sin = (por: 'brand' | 'type' | 'color') =>
    groupPurchases(compras, por).map(({ key, rolls, invested, purchases }) => ({ key, rolls, invested, purchases }));
  return { marca: sin('brand'), tipo: sin('type'), color: sin('color') };
}

// ── Lo que el escenario vale, calculado en papel ───────────────────────────────
// consumo = 6 (julio) + 3 (comprados en agosto) − 8 (agosto) = 1
const RESUMEN_AGOSTO = { totalRolls: 8, running: 2, consumption: 1, purchased: 3, complete: true };

const CONTEO_AGOSTO = { m1: [2, 1, 0, 3, true], m2: [1, 0, 1, 2, true], m3: [1, 0, 0, 1, true], m4: [0, 1, 1, 2, true] };
const CONTEO_JULIO = { m1: [1, 0, 0, 1, true], m2: [2, 0, 0, 2, true], m3: [0, 0, 0, 0, true], m4: [3, 0, 0, 3, true] };

const COSTO_POR_COMPRA = {
  e1: { quantity: 2, amount: 40, costPerRoll: 20, costPerGram: 0.02, date: '2026-07-10' },
  e2: { quantity: 1, amount: 22, costPerRoll: 22, costPerGram: 0.022, date: '2026-08-05' },
  e3: { quantity: 3, amount: 75, costPerRoll: 25, costPerGram: 0.025, date: '2026-07-20' },
  e4: { quantity: 2, amount: 36, costPerRoll: 18, costPerGram: 0.018, date: '2026-08-12' },
  e5: { quantity: 4, amount: 88, costPerRoll: 22, costPerGram: 0.022, date: '2026-06-15' },
};

const ANALISIS = {
  marca: [
    { key: 'Sunlu', rolls: 10, invested: 225, purchases: 4 },
    { key: 'Esun', rolls: 2, invested: 36, purchases: 1 },
  ],
  tipo: [
    { key: 'PLA', rolls: 10, invested: 225, purchases: 4 },
    { key: 'PETG', rolls: 2, invested: 36, purchases: 1 },
  ],
  color: [
    { key: 'Negro', rolls: 6, invested: 137, purchases: 3 },
    { key: 'Blanco', rolls: 4, invested: 88, purchases: 1 },
    { key: 'Rojo', rolls: 2, invested: 36, purchases: 1 },
  ],
};

describe('el escenario vale lo que dice el papel (sin esto, los demás tests no prueban nada)', () => {
  it('arranca con los números clavados', async () => {
    const b = escenario();
    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
    expect(await conteoDelMes(b, '2026-08')).toEqual(CONTEO_AGOSTO);
    expect(await conteoDelMes(b, '2026-07')).toEqual(CONTEO_JULIO);
    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
    expect(await analisis(b)).toEqual(ANALISIS);
  });
});

describe('descontinuar NO reescribe el histórico', () => {
  /** Los dos estados que sacan una ficha de circulación, por las dos puertas (una ficha y un lote). */
  async function descontinuar(b: BaseFalsa) {
    await materiales(b).setStatus(ORG, 'm3', { status: 'DISCONTINUED' });
    await materiales(b).setStatusBatch(ORG, { ids: ['m1', 'm4'], status: 'DISCONTINUED' });
    await materiales(b).setStatus(ORG, 'm2', { status: 'SOLO_PEDIDO_ESPECIAL' });
  }

  it('las fichas de verdad cambiaron de estado (si no, nada de lo que sigue mide algo)', async () => {
    const b = escenario();
    await descontinuar(b);
    expect(b.estado().material.map((m) => [m.id, m.status])).toEqual([
      ['m1', 'DISCONTINUED'],
      ['m2', 'SOLO_PEDIDO_ESPECIAL'],
      ['m3', 'DISCONTINUED'],
      ['m4', 'DISCONTINUED'],
    ]);
  });

  it('el conteo de un mes ya CERRADO queda igual, casilla por casilla', async () => {
    const b = escenario();
    await descontinuar(b);

    expect(await conteoDelMes(b, '2026-08')).toEqual(CONTEO_AGOSTO);
    expect(await conteoDelMes(b, '2026-07')).toEqual(CONTEO_JULIO);
    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
  });

  it('el costo de ninguna compra pasada cambia', async () => {
    const b = escenario();
    await descontinuar(b);
    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
  });

  it('el análisis de compras por marca, tipo y color queda igual', async () => {
    const b = escenario();
    await descontinuar(b);
    expect(await analisis(b)).toEqual(ANALISIS);
  });

  it('reactivar tampoco toca nada del histórico (ida y vuelta)', async () => {
    const b = escenario();
    await descontinuar(b);
    await materiales(b).setStatusBatch(ORG, { ids: ['m1', 'm2', 'm3', 'm4'], status: 'ACTIVE' });

    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
    expect(await conteoDelMes(b, '2026-08')).toEqual(CONTEO_AGOSTO);
    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
    expect(await analisis(b)).toEqual(ANALISIS);
  });
});

describe('unir dos fichas NO cambia el total del histórico', () => {
  const unirM1EnM2 = (b: BaseFalsa) => materiales(b).unir(ORG, 'm1', { destinoId: 'm2' });

  it('rollos comprados y dinero invertido: 12 rollos y $261 antes, 12 y $261 después', async () => {
    const b = escenario();
    const total = async () => {
      const compras = await filamento(b).purchases(ORG);
      return {
        rollos: compras.reduce((s, c) => s + c.quantity, 0),
        dinero: compras.reduce((s, c) => s + c.amount, 0),
        compras: compras.length,
      };
    };
    expect(await total()).toEqual({ rollos: 12, dinero: 261, compras: 5 });

    await unirM1EnM2(b);

    expect(await total()).toEqual({ rollos: 12, dinero: 261, compras: 5 });
  });

  it('el costo de cada compra pasada queda igual, y las dos del origen ahora son de la ficha que sobrevive', async () => {
    const b = escenario();
    await unirM1EnM2(b);

    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
    const delDestino = (await filamento(b).purchases(ORG)).filter((c) => c.materialId === 'm2');
    expect(delDestino.map((c) => c.id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(delDestino.reduce((s, c) => s + c.quantity, 0)).toBe(6);
    expect(delDestino.reduce((s, c) => s + c.amount, 0)).toBe(137);
  });

  it('el análisis por marca, tipo y color queda igual cuando las dos fichas son del mismo color y marca', async () => {
    const b = escenario();
    await unirM1EnM2(b);
    expect(await analisis(b)).toEqual(ANALISIS);
  });

  it('el TOTAL de rollos contados de un mes cerrado queda en 8 (agosto) y en 6 (julio)', async () => {
    const b = escenario();
    const totalDelMes = async (mes: string) =>
      Object.values(await conteoDelMes(b, mes)).reduce((s, f) => s + (f[3] as number), 0);
    expect(await totalDelMes('2026-08')).toBe(8);
    expect(await totalDelMes('2026-07')).toBe(6);

    await unirM1EnM2(b);

    expect(await totalDelMes('2026-08')).toBe(8);
    expect(await totalDelMes('2026-07')).toBe(6);
    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
  });

  it('lo que sí cambia es el DESGLOSE por ficha, y los conteos del mismo mes se suman', async () => {
    const b = escenario();
    await unirM1EnM2(b);

    // agosto: m1 [2,1,0] + m2 [1,0,1] = [3,1,1]; julio: m1 [1,0,0] + m2 [2,0,0] = [3,0,0]
    expect(await conteoDelMes(b, '2026-08')).toEqual({ m2: [3, 1, 1, 5, true], m3: [1, 0, 0, 1, true], m4: [0, 1, 1, 2, true] });
    expect(await conteoDelMes(b, '2026-07')).toEqual({ m2: [3, 0, 0, 3, true], m3: [0, 0, 0, 0, true], m4: [3, 0, 0, 3, true] });
  });

  it('unir una ficha ya descontinuada tampoco cambia el total', async () => {
    const b = escenario();
    await materiales(b).setStatus(ORG, 'm1', { status: 'DISCONTINUED' });
    await unirM1EnM2(b);

    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
  });

  it('si la unión falla a mitad de camino, el histórico queda EXACTAMENTE como estaba', async () => {
    const b = escenario();
    b.fallarEn('stockCount.updateMany');

    await expect(unirM1EnM2(b)).rejects.toThrow('Falla inyectada');

    expect(await resumenDeAgosto(b)).toEqual(RESUMEN_AGOSTO);
    expect(await conteoDelMes(b, '2026-08')).toEqual(CONTEO_AGOSTO);
    expect(await costoDeCadaCompra(b)).toEqual(COSTO_POR_COMPRA);
    expect(await analisis(b)).toEqual(ANALISIS);
  });
});
