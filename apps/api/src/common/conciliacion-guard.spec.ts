import { BadRequestException } from '@nestjs/common';
import { exigirConfirmacionDeConciliacion } from './conciliacion-guard';

const ORG = 'org1';
const OTRA = 'org2';

type Fila = { id: string; organizationId: string; date: Date; status: 'DRAFT' | 'CONFIRMED' | 'VOID' };

/** Base falsa que SÍ respeta el `where.organizationId`, como Postgres. */
function base(filas: Fila[]) {
  return {
    cashReconciliation: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
        filas.filter((f) => f.organizationId === where.organizationId),
      ),
    },
  };
}
const conc = (id: string, dia: string, status: Fila['status'], org = ORG): Fila => ({
  id,
  organizationId: org,
  date: new Date(`${dia}T00:00:00.000Z`),
  status,
});

async function mensajeDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as {
      message: string;
      conciliacionesAfectadas: Array<{ id: string; date: string; status: string }>;
    };
  }
  return null;
}

describe('exigirConfirmacionDeConciliacion', () => {
  it('guardar con fecha ≤ a una conciliación CONFIRMADA exige confirmación', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    const r = await mensajeDe(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01']));
    expect(r).not.toBeNull();
    expect(r!.message).toContain('confirmada');
    expect(r!.message).toContain('confirmando');
  });

  it('con el flag de confirmación, guarda (no corta)', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    await expect(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01'], true)).resolves.toBeUndefined();
  });

  it('el 400 ofrece anular la conciliación: trae sus ids para que el panel arme el botón', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    const r = await mensajeDe(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01']));
    expect(r!.conciliacionesAfectadas).toEqual([{ id: 'c1', date: '2026-11-05', status: 'CONFIRMED' }]);
    expect(r!.message).toContain('anula');
  });

  it('una conciliación en DRAFT también avisa', async () => {
    const p = base([conc('c1', '2026-11-05', 'DRAFT')]);
    const r = await mensajeDe(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01']));
    expect(r).not.toBeNull();
    expect(r!.message).toContain('borrador');
  });

  it('una fecha posterior no pide nada', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED'), conc('c2', '2026-11-05', 'DRAFT')]);
    await expect(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-06'])).resolves.toBeUndefined();
  });

  it('el MISMO día que la conciliación sí pide confirmación', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    expect(await mensajeDe(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-05']))).not.toBeNull();
  });

  it('una conciliación ANULADA no avisa', async () => {
    const p = base([conc('c1', '2026-11-05', 'VOID')]);
    await expect(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01'])).resolves.toBeUndefined();
  });

  it('la conciliación de OTRA organización no avisa (y la propia, su hermano, sí)', async () => {
    const ajena = base([conc('x', '2026-11-05', 'CONFIRMED', OTRA)]);
    await expect(exigirConfirmacionDeConciliacion(ajena, ORG, ['2026-11-01'])).resolves.toBeUndefined();
    const propia = base([conc('x', '2026-11-05', 'CONFIRMED', ORG)]);
    expect(await mensajeDe(exigirConfirmacionDeConciliacion(propia, ORG, ['2026-11-01']))).not.toBeNull();
  });

  it('sin fechas (nada que mover) no consulta ni pide nada', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    await expect(exigirConfirmacionDeConciliacion(p, ORG, [])).resolves.toBeUndefined();
    expect(p.cashReconciliation.findMany).not.toHaveBeenCalled();
  });

  it('con el flag no hace ni la consulta', async () => {
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    await exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01'], true);
    expect(p.cashReconciliation.findMany).not.toHaveBeenCalled();
  });

  it('con movimientos SIN cuenta, la conciliación no se filtra por cuenta: el aviso salta igual', async () => {
    // El esperado es GLOBAL. La guarda no recibe cuenta ni la pregunta: un
    // movimiento histórico sin cuenta cae en TODA conciliación posterior.
    const p = base([conc('c1', '2026-11-05', 'CONFIRMED')]);
    expect(await mensajeDe(exigirConfirmacionDeConciliacion(p, ORG, ['2026-11-01']))).not.toBeNull();
    const args = p.cashReconciliation.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty('accountId');
  });
});
