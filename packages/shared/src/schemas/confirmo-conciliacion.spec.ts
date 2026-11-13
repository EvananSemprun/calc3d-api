import {
  CashReconciliationUpsertSchema,
  ConfirmoConciliacionQuerySchema,
  ExpenseCreateSchema,
  ExpenseWithDefinitionSchema,
  LoanPaymentCreateSchema,
  LoanPaymentVoidSchema,
  OwnerMovementCreateSchema,
  PaymentCreateSchema,
  PurchaseInvoicePaymentSchema,
  PurchaseInvoiceUpsertSchema,
  PurchaseVoidSchema,
  SaleCreateSchema,
} from './api';

/**
 * Qué DTOs llevan el flag `confirmoConciliacion`. La frontera es "mueve el saldo
 * de caja": los que producen asientos en `cashEntries`. Una factura NO (la caja
 * la mueven sus abonos) y la conciliación tampoco (es la conciliación misma).
 */
const D = '2026-11-01';
const cuerpos = {
  venta: [SaleCreateSchema, { date: D, amount: 1 }],
  gasto: [ExpenseCreateSchema, { date: D, amount: 1, description: 'x' }],
  abonoDePedido: [PaymentCreateSchema, { date: D, amount: 1 }],
  cuotaDePrestamo: [LoanPaymentCreateSchema, { date: D, amount: 1 }],
  movimientoDeCaja: [
    OwnerMovementCreateSchema,
    { date: D, kind: 'CONTRIBUTION', amount: 1, concept: 'x' },
  ],
  abonoDeCompra: [PurchaseInvoicePaymentSchema, { date: D, amount: 1 }],
} as const;

describe('confirmoConciliacion: los DTOs que mueven la caja lo llevan', () => {
  for (const [nombre, [schema, cuerpo]] of Object.entries(cuerpos)) {
    it(`${nombre}: viaja y llega al servicio`, () => {
      const r = (schema as typeof SaleCreateSchema).safeParse({ ...cuerpo, confirmoConciliacion: true });
      expect(r.success).toBe(true);
      expect((r as { data: Record<string, unknown> }).data.confirmoConciliacion).toBe(true);
    });
    it(`${nombre}: es opcional`, () => {
      expect((schema as typeof SaleCreateSchema).safeParse(cuerpo).success).toBe(true);
    });
    it(`${nombre}: tiene que ser booleano, no el texto "true"`, () => {
      expect(
        (schema as typeof SaleCreateSchema).safeParse({ ...cuerpo, confirmoConciliacion: 'true' }).success,
      ).toBe(false);
    });
  }

  it('gasto con definición: lo lleva en la raíz', () => {
    expect(ExpenseWithDefinitionSchema.shape.confirmoConciliacion).toBeDefined();
  });

  it('anular una cuota o un abono de compra también lo lleva', () => {
    expect(LoanPaymentVoidSchema.safeParse({ reason: 'x', confirmoConciliacion: true }).success).toBe(true);
    const r = PurchaseVoidSchema.safeParse({ reason: 'x', confirmoConciliacion: true });
    expect(r.success && r.data.confirmoConciliacion).toBe(true);
  });
});

describe('confirmoConciliacion: los que NO mueven la caja no lo llevan', () => {
  it('la factura de compra no lo conserva', () => {
    expect(PurchaseInvoiceUpsertSchema.shape).not.toHaveProperty('confirmoConciliacion');
  });
  it('la conciliación misma no lo conserva', () => {
    const r = CashReconciliationUpsertSchema.safeParse({
      accountId: 'a',
      date: D,
      totalAmount: 1,
      confirmoConciliacion: true,
    });
    expect(r.success).toBe(true);
    expect((r as { data: Record<string, unknown> }).data).not.toHaveProperty('confirmoConciliacion');
  });
});

describe('ConfirmoConciliacionQuerySchema (los DELETE)', () => {
  it('"true" es true', () => {
    expect(ConfirmoConciliacionQuerySchema.parse({ confirmoConciliacion: 'true' })).toEqual({
      confirmoConciliacion: true,
    });
  });
  it('ausente o "false" es false', () => {
    expect(ConfirmoConciliacionQuerySchema.parse({}).confirmoConciliacion).toBe(false);
    expect(ConfirmoConciliacionQuerySchema.parse({ confirmoConciliacion: 'false' }).confirmoConciliacion).toBe(false);
  });
  it('cualquier otro texto se rechaza en vez de leerse como "no"', () => {
    expect(ConfirmoConciliacionQuerySchema.safeParse({ confirmoConciliacion: 'si' }).success).toBe(false);
  });
});
