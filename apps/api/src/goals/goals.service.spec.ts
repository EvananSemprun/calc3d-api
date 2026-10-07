import { GoalsService } from './goals.module';

const ORG = 'org-A';
const OTRA = 'org-B';
const service = (p: unknown) => new GoalsService(p as never);

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Un mock que MODELA la base, no que devuelve lo que al test le conviene.
 *
 * ⚠️ Filtra por TODAS las claves del `where` que le llegue. Si devolviera lo
 * mismo pase lo que pase, un test de aislamiento pasaría con y sin el scope —
 * que es exactamente lo que arruinó los specs de la fase 2 de Caja. Y un
 * operador que no modela NO filtra, en vez de descartar: errar hacia devolver
 * de más nunca esconde una fila que debería haberse visto.
 */
function baseFalsa({
  ventas = [] as { organizationId: string; date: Date; amount: number }[],
  pedidos = [] as { organizationId: string; deliveryDate: Date | null; lines: unknown }[],
  clientes = [] as { organizationId: string; orders: { deliveryDate: Date | null }[]; sales: { date: Date }[] }[],
  metas = [] as { id: string; organizationId: string; month: Date; salesTarget: number; ordersTarget: number; newClientsTarget: number; notes: string | null }[],
} = {}) {
  const enRango = (valor: Date | null, cond: { gte?: Date; lt?: Date; not?: null } | undefined) => {
    if (!cond) return true;
    if (cond.not === null && valor == null) return false;
    if (valor == null) return cond.gte == null && cond.lt == null;
    if (cond.gte && valor < cond.gte) return false;
    if (cond.lt && valor >= cond.lt) return false;
    return true;
  };
  const filtrar = <T extends Record<string, unknown>>(filas: T[], where: Record<string, unknown> = {}, campoFecha?: string) =>
    filas.filter((f) => {
      for (const [k, v] of Object.entries(where)) {
        if (k === campoFecha) {
          if (!enRango(f[k] as Date | null, v as never)) return false;
        } else if (f[k] !== v) return false;
      }
      return true;
    });

  return {
    sale: {
      findMany: jest.fn(({ where }: never) => Promise.resolve(filtrar(ventas, where, 'date'))),
      findFirst: jest.fn(({ where }: never) =>
        Promise.resolve([...filtrar(ventas, where, 'date')].sort((a, b) => +a.date - +b.date)[0] ?? null),
      ),
    },
    order: {
      findMany: jest.fn(({ where }: never) => Promise.resolve(filtrar(pedidos, where, 'deliveryDate'))),
      findFirst: jest.fn(({ where }: never) =>
        Promise.resolve(
          [...filtrar(pedidos, where, 'deliveryDate')]
            .filter((p) => p.deliveryDate)
            .sort((a, b) => +a.deliveryDate! - +b.deliveryDate!)[0] ?? null,
        ),
      ),
    },
    client: { findMany: jest.fn(({ where }: never) => Promise.resolve(filtrar(clientes, where))) },
    goal: {
      findMany: jest.fn(({ where }: never) =>
        Promise.resolve([...filtrar(metas, where)].sort((a, b) => +a.month - +b.month)),
      ),
    },
  };
}

const venta = (org: string, iso: string, amount: number) => ({ organizationId: org, date: d(iso), amount });
const pedido = (org: string, iso: string, monto: number) => ({
  organizationId: org,
  deliveryDate: d(iso),
  lines: [{ quantity: 1, unitPrice: monto }],
});

describe('GoalsService.realesPorMes', () => {
  it('devuelve lo real de un mes aunque NO tenga meta cargada', async () => {
    const p = baseFalsa({ ventas: [venta(ORG, '2026-03-10', 40), venta(ORG, '2026-03-20', 60)] });

    const r = await service(p).realesPorMes(ORG, d('2026-03-01'), d('2026-04-01'));

    // Sin una sola meta en la base: antes esto devolvía vacío.
    expect(r.get('2026-03')?.sales).toBe(100);
    expect(p.goal.findMany).not.toHaveBeenCalled();
  });

  it('un mes SIN ACTIVIDAD posterior al primer dato vale 0, y cuenta', async () => {
    const p = baseFalsa({ ventas: [venta(ORG, '2026-02-02', 50), venta(ORG, '2026-04-05', 70)] });

    const r = await service(p).realesPorMes(ORG, d('2026-02-01'), d('2026-05-01'));

    // Marzo existe, no vendió nada, y entra como 0: es un mes malo de verdad.
    expect(r.get('2026-03')).toMatchObject({ sales: 0, hayDatos: expect.objectContaining({ sales: true }) });
  });

  it('un mes ANTERIOR al primer dato queda marcado SIN datos', async () => {
    const p = baseFalsa({ ventas: [venta(ORG, '2026-02-02', 50)] });

    const r = await service(p).realesPorMes(ORG, d('2026-01-01'), d('2026-03-01'));

    // Enero no vendió 0: enero no existía. Promediarlo como 0 inventaría un mes
    // malo que nunca ocurrió.
    expect(r.get('2026-01')?.hayDatos.sales).toBe(false);
    expect(r.get('2026-02')?.hayDatos.sales).toBe(true);
  });

  it('la frontera es POR MÉTRICA: hay ventas desde febrero y encargos desde septiembre', async () => {
    const p = baseFalsa({
      ventas: [venta(ORG, '2026-02-02', 50)],
      pedidos: [pedido(ORG, '2026-09-10', 30)],
    });

    const r = await service(p).realesPorMes(ORG, d('2026-02-01'), d('2026-10-01'));

    // Es el caso real: los pedidos arrancan mucho después que las ventas.
    expect(r.get('2026-03')).toMatchObject({
      hayDatos: { sales: true, orders: false, newClients: true },
    });
    expect(r.get('2026-09')?.hayDatos.orders).toBe(true);
  });

  it('las ventas incluyen los pedidos entregados, con la definición de siempre', async () => {
    const p = baseFalsa({
      ventas: [venta(ORG, '2026-05-03', 20)],
      pedidos: [pedido(ORG, '2026-05-15', 80)],
    });

    const r = await service(p).realesPorMes(ORG, d('2026-05-01'), d('2026-06-01'));

    expect(r.get('2026-05')).toMatchObject({ sales: 100, orders: 1 });
  });

  it('un cliente que ya había comprado antes no vuelve a ser nuevo', async () => {
    const p = baseFalsa({
      clientes: [
        { organizationId: ORG, orders: [], sales: [{ date: d('2026-02-10') }, { date: d('2026-05-10') }] },
        { organizationId: ORG, orders: [], sales: [{ date: d('2026-05-20') }] },
      ],
    });

    const r = await service(p).realesPorMes(ORG, d('2026-05-01'), d('2026-06-01'));

    // El de febrero compra otra vez en mayo y NO cuenta; el estreno sí.
    expect(r.get('2026-05')?.newClients).toBe(1);
  });

  it('no mira los datos de otra organización', async () => {
    const p = baseFalsa({
      ventas: [venta(ORG, '2026-03-10', 40), venta(OTRA, '2026-03-11', 999)],
      clientes: [{ organizationId: OTRA, orders: [], sales: [{ date: d('2026-03-11') }] }],
    });

    const r = await service(p).realesPorMes(ORG, d('2026-03-01'), d('2026-04-01'));

    expect(r.get('2026-03')).toMatchObject({ sales: 40, newClients: 0 });
  });

  it('el mock modela la base: esa misma venta SÍ aparece para su propio negocio', async () => {
    // Sin este hermano, el test de arriba pasaría aunque el mock devolviera
    // vacío siempre — o sea, con y sin el scope.
    const p = baseFalsa({ ventas: [venta(ORG, '2026-03-10', 40), venta(OTRA, '2026-03-11', 999)] });

    const r = await service(p).realesPorMes(OTRA, d('2026-03-01'), d('2026-04-01'));

    expect(r.get('2026-03')?.sales).toBe(999);
  });
});

describe('GoalsService.suggestion', () => {
  // Parado en octubre 2026: los 3 ultimos completos son jul, ago y sep.
  const HOY = new Date('2026-10-07T12:00:00.000Z');

  const conVentas = (org = ORG) =>
    baseFalsa({
      ventas: [
        venta(org, '2026-07-10', 100),
        venta(org, '2026-08-10', 200),
        venta(org, '2026-09-10', 300),
      ],
    });

  it('NO escribe nada: es de solo lectura', async () => {
    const p = conVentas() as Record<string, Record<string, unknown>>;
    await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    // Si algun dia aparece una escritura en este camino, el mock no la tiene y
    // el test se cae: es la guarda, no un adorno.
    for (const tabla of Object.values(p)) {
      for (const metodo of ['create', 'update', 'upsert', 'delete', 'updateMany', 'createMany']) {
        expect(tabla[metodo]).toBeUndefined();
      }
    }
  });

  it('usa los 3 ultimos meses COMPLETOS: el mes en curso no entra', async () => {
    const p = baseFalsa({
      ventas: [
        venta(ORG, '2026-07-10', 100),
        venta(ORG, '2026-08-10', 200),
        venta(ORG, '2026-09-10', 300),
        venta(ORG, '2026-10-05', 9999), // en curso: no puede contaminar
      ],
    });

    const s = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    expect(s.sales.monthsUsed).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(s.sales.value).toBe(233);
  });

  it('un mes FUTURO usa los mismos 3 completos de hoy, y dice cuales', async () => {
    const p = conVentas();

    // Enero 2027 estando en octubre 2026: sus 3 meses previos (oct, nov, dic)
    // no terminaron. Sin esta regla la sugerencia quedaria vacia.
    const enero = await service(p).suggestion(ORG, { month: '2027-01' }, HOY);
    const noviembre = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    expect(enero.sales.monthsUsed).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(enero.sales.value).toBe(noviembre.sales.value);
  });

  it('el borde de fin de mes se decide en hora de Venezuela', async () => {
    const p = conVentas();
    // 2026-10-01T02:00Z son todavia las 22:00 del 30/09 en Caracas: el mes en
    // curso sigue siendo SEPTIEMBRE y el ultimo completo, agosto.
    const s = await service(p).suggestion(ORG, { month: '2026-12' }, new Date('2026-10-01T02:00:00.000Z'));

    expect(s.sales.monthsUsed).toEqual(['2026-08', '2026-07']);
  });

  it('informa cuantos meses pudo usar cuando hay menos de 3', async () => {
    const p = baseFalsa({ ventas: [venta(ORG, '2026-09-10', 300)] });

    const s = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    expect(s.sales.monthsUsed).toEqual(['2026-09']);
    expect(s.sales.value).toBe(300);
  });

  it('una metrica sin datos viene null CON motivo, no en cero', async () => {
    const p = conVentas();

    const s = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    // No hay un solo pedido entregado: encargos no se sugiere.
    expect(s.orders).toMatchObject({ value: null, reason: 'SIN_DATOS' });
    expect(s.sales.value).toBe(233);
  });

  it('sin el mismo mes del ano anterior, el aviso de temporada es SIN_HISTORIA', async () => {
    const p = conVentas();

    const s = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    // Enero 2026 no existe en estos datos: no se pudo medir. Que el silencio
    // no se lea como aprobacion es justo el punto.
    expect(s.seasonal.status).toBe('SIN_HISTORIA');
  });

  it('el crecimiento se aplica y se informa', async () => {
    const p = conVentas();

    const s = await service(p).suggestion(ORG, { month: '2026-11', growth: 'AMBICIOSO' }, HOY);

    expect(s.growth).toBe('AMBICIOSO');
    expect(s.growthPct).toBe(0.25);
    expect(s.sales.value).toBe(Math.round(s.sales.base! * 1.25));
  });

  it('no mira los meses de otra organizacion', async () => {
    const p = baseFalsa({
      ventas: [
        venta(ORG, '2026-09-10', 100),
        venta(OTRA, '2026-09-11', 9999),
      ],
    });

    const s = await service(p).suggestion(ORG, { month: '2026-11' }, HOY);

    expect(s.sales.value).toBe(100);
  });

  it('el mock modela la base: esas ventas SI sugieren para su propio negocio', async () => {
    const p = baseFalsa({
      ventas: [
        venta(ORG, '2026-09-10', 100),
        venta(OTRA, '2026-09-11', 9999),
      ],
    });

    const s = await service(p).suggestion(OTRA, { month: '2026-11' }, HOY);

    expect(s.sales.value).toBe(9999);
  });
});
