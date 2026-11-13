/**
 * MASS-ASSIGNMENT EN LAS COMPRAS (fase B, tarea 9): el estado de pago NO sale
 * del body. Pagado, saldo, deuda, estado, recibido, anulación, código y
 * organización se DERIVAN o los fija el servidor; si el cliente los mandara,
 * podría marcar como pagada una factura sin abonos o saltarse la recepción.
 *
 * Se prueba contra el `ZodValidationPipe` REAL que cuelga de cada ruta (leído de
 * la metadata de Nest) y no contra el schema suelto: un schema cerrado con la
 * ruta sin pipe no cierra nada, y los tipos no lo avisan. Cada ataque va con su
 * HERMANO ALCANZABLE: el campo legítimo del mismo body SÍ pasa, así que un pipe
 * que descartara todo no aprobaría el test.
 *
 * El IDOR de factura y de proveedor vive en `purchase-invoices.service.spec.ts`,
 * que ya tiene el mock de Prisma que filtra por organización.
 */
import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PurchaseInvoicesController } from './purchase-invoices.module';

function pipeDe(metodo: string): ZodValidationPipe<Record<string, any>> {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, PurchaseInvoicesController, metodo) as
    | Record<string, { pipes: unknown[] }>
    | undefined;
  const body = Object.entries(meta ?? {}).find(([k]) => k.startsWith('3:'))?.[1]; // 3 = BODY
  const pipe = body?.pipes.find((p) => p instanceof ZodValidationPipe);
  if (!pipe) throw new Error(`falta @Body(new ZodValidationPipe(...)) en ${metodo}`);
  return pipe as ZodValidationPipe<Record<string, any>>;
}

/** Lo que un atacante intentaría fijar: todo lo que debe decidir el servidor. */
const ESTADO_DE_PAGO = {
  voidedAt: '2026-11-01T00:00:00.000Z',
  voidReason: 'x',
  status: 'PAGADA',
  paid: 9999,
  pagado: 9999,
  saldo: 0,
  deuda: 0,
  aFavor: 500,
  aFavorDisponible: 500,
  payments: [{ amount: 9999 }],
  code: 1,
  organizationId: 'org-ajena',
  source: 'EXCEL_IMPORT',
};

const LINEA = { materialId: 'mat-mio', quantity: 2, unitPrice: 25 };

describe('POST /purchase-invoices — el estado de pago no se acepta del body', () => {
  const alta = { date: '2026-11-12', lines: [LINEA] };

  it('el pipe real descarta pagado, saldo, estado, anulación, código y organización', () => {
    const salida = pipeDe('create').transform({ ...alta, ...ESTADO_DE_PAGO });
    for (const campo of Object.keys(ESTADO_DE_PAGO)) {
      expect(salida).not.toHaveProperty(campo);
    }
  });

  it('hermano: los campos legítimos del mismo body SÍ pasan', () => {
    const salida = pipeDe('create').transform({ ...alta, reference: 'A-001', ...ESTADO_DE_PAGO });
    expect(salida.date).toBe('2026-11-12');
    expect(salida.reference).toBe('A-001');
    expect(salida.lines).toHaveLength(1);
  });

  it('una línea no puede traer `received`: la mercadería llega por la recepción', () => {
    const salida = pipeDe('create').transform({ ...alta, lines: [{ ...LINEA, received: 2, id: 'x' }] });
    expect(salida.lines[0]).not.toHaveProperty('received');
    expect(salida.lines[0]).not.toHaveProperty('id');
    expect(salida.lines[0].quantity).toBe(2); // hermano
  });

  it('la corrección (PUT) cierra lo mismo', () => {
    const salida = pipeDe('update').transform({ ...alta, ...ESTADO_DE_PAGO, lines: [{ ...LINEA, received: 2 }] });
    for (const campo of Object.keys(ESTADO_DE_PAGO)) expect(salida).not.toHaveProperty(campo);
    expect(salida.lines[0]).not.toHaveProperty('received');
    expect(salida.lines[0].unitPrice).toBe(25);
  });

  it('el alta no declara ningún campo de estado: solo fecha y líneas', () => {
    const salida = pipeDe('create').transform({ date: '2026-11-12', lines: [LINEA] });
    expect(Object.keys(salida).sort()).toEqual(['date', 'lines']);
  });
});

describe('POST /purchase-invoices/:id/payments — el abono no trae su propia verdad', () => {
  it('descarta anulación, organización y la tasa: la tasa la resuelve el servidor', () => {
    const salida = pipeDe('addPayment').transform({
      date: '2026-11-12',
      amount: 10,
      voidedAt: '2026-11-01T00:00:00.000Z',
      voidReason: 'x',
      organizationId: 'org-ajena',
      invoiceId: 'otra-factura',
      rate: 1,
      currencyCode: 'VES',
    });
    for (const campo of ['voidedAt', 'voidReason', 'organizationId', 'invoiceId', 'rate', 'currencyCode']) {
      expect(salida).not.toHaveProperty(campo);
    }
    expect(salida.amount).toBe(10); // hermano
  });
});

describe('POST /purchase-invoices/:id/lines/:lineId/receive — lo recibido no se fija desde el body', () => {
  it('el monto del gasto y lo recibido no viajan: salen de cantidad × precio', () => {
    const salida = pipeDe('receive').transform({
      quantity: 2,
      amount: 1,
      received: 999,
      purchaseInvoiceLineId: 'otra-linea',
      organizationId: 'org-ajena',
    });
    for (const campo of ['amount', 'received', 'purchaseInvoiceLineId', 'organizationId']) {
      expect(salida).not.toHaveProperty(campo);
    }
    expect(salida.quantity).toBe(2); // hermano
  });
});
