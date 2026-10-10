import { PurchaseInvoiceLineSchema, PurchaseReceiveSchema } from './api';

/**
 * ⚠️ **"Algo que todavía no tenés" tiene que decir QUÉ es.**
 *
 * Una impresora nueva es, por definición, la que no está en el catálogo: es el
 * caso normal al encargar una máquina, no el raro. Hasta shared 0.33.0 la línea
 * solo llevaba `nombreNuevo` y la recepción creaba **siempre** una ficha de
 * filamento: encargar una "Impresora A2" te dejaba un rollo con ese nombre.
 *
 * Las dos mitades del contrato son necesarias: si `nuevoTipo` fuera solo
 * opcional, la ambigüedad volvería por la misma puerta (una línea sin tipo
 * tendría que adivinarse); y si se aceptara en una línea del catálogo, diría
 * "impresora" sobre una ficha de filamento que ya existe.
 */
describe('PurchaseInvoiceLineSchema: qué nace cuando es algo nuevo', () => {
  it.each([
    ['filamento nuevo', 'MATERIAL'],
    ['impresora nueva', 'PRINTER'],
  ])('%s → se acepta', (_, nuevoTipo) => {
    expect(
      PurchaseInvoiceLineSchema.safeParse({
        nombreNuevo: 'Impresora A2',
        nuevoTipo,
        quantity: 1,
        unitPrice: 300,
      }).success,
    ).toBe(true);
  });

  it('algo nuevo SIN decir qué es → se rechaza', () => {
    const r = PurchaseInvoiceLineSchema.safeParse({
      nombreNuevo: 'Impresora A2',
      quantity: 1,
      unitPrice: 300,
    });

    expect(r.success).toBe(false);
  });

  it('el mensaje dice que hay que elegir filamento o impresora', () => {
    const r = PurchaseInvoiceLineSchema.safeParse({
      nombreNuevo: 'Impresora A2',
      quantity: 1,
      unitPrice: 300,
    });

    expect(r.success).toBe(false);
    if (r.success) return;
    const texto = r.error.issues.map((i) => i.message).join(' | ');
    expect(texto).toMatch(/filamento o .*impresora/i);
  });

  it('un tipo inventado → se rechaza', () => {
    expect(
      PurchaseInvoiceLineSchema.safeParse({
        nombreNuevo: 'Algo',
        nuevoTipo: 'COMPONENT',
        quantity: 1,
        unitPrice: 1,
      }).success,
    ).toBe(false);
  });

  /**
   * La otra mitad: sin ella, una línea del catálogo podría declarar un tipo que
   * contradice a su propia ficha y nadie lo frenaría.
   */
  it.each([
    ['un filamento del catálogo', { materialId: 'mat-1' }],
    ['una impresora del catálogo', { printerId: 'imp-1' }],
  ])('%s con nuevoTipo → se rechaza', (_, ficha) => {
    expect(
      PurchaseInvoiceLineSchema.safeParse({
        ...ficha,
        nuevoTipo: 'MATERIAL',
        quantity: 1,
        unitPrice: 10,
      }).success,
    ).toBe(false);
  });

  // Los hermanos alcanzables: sin esto, lo de arriba pasaría con un schema que
  // rechazara TODA línea del catálogo.
  it.each([
    ['un filamento del catálogo', { materialId: 'mat-1' }],
    ['una impresora del catálogo', { printerId: 'imp-1' }],
  ])('%s sin nuevoTipo → se acepta', (_, ficha) => {
    expect(
      PurchaseInvoiceLineSchema.safeParse({ ...ficha, quantity: 1, unitPrice: 10 }).success,
    ).toBe(true);
  });
});

/**
 * EL PRECIO QUE TE COBRARON, al recibir.
 *
 * ⚠️ Es **opcional** a propósito: el caso normal es que llegue a lo pactado, y
 * entonces no hay nada que informar y se usa el de la línea. Exigirlo obligaría
 * a retipear el mismo número en cada recepción, que es como se cuela un error.
 *
 * ⚠️ Y lo que NO viaja sigue siendo el **monto**: sale de cantidad × precio. Si
 * el cliente mandara el total, dos recepciones podrían sumar algo distinto de
 * la factura y nadie se enteraría.
 */
describe('PurchaseReceiveSchema: el precio real de la entrega', () => {
  it('sin precio se acepta: llegó a lo pactado', () => {
    const r = PurchaseReceiveSchema.safeParse({ quantity: 6 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.unitPrice ?? null).toBeNull();
  });

  it('con el precio que te cobraron se acepta y llega como número', () => {
    const r = PurchaseReceiveSchema.safeParse({ quantity: 6, unitPrice: 7.5 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.unitPrice).toBe(7.5);
  });

  /** Un rollo regalado es un dato verdadero: $0 entra. */
  it('un precio de 0 se acepta', () => {
    expect(PurchaseReceiveSchema.safeParse({ quantity: 1, unitPrice: 0 }).success).toBe(true);
  });

  /** Una factura no es el lugar para una devolución. */
  it('un precio negativo se rechaza', () => {
    expect(PurchaseReceiveSchema.safeParse({ quantity: 1, unitPrice: -1 }).success).toBe(false);
  });

  it('un precio que no es número se rechaza', () => {
    expect(PurchaseReceiveSchema.safeParse({ quantity: 1, unitPrice: '7.5' }).success).toBe(false);
  });

  /** ⚠️ El MONTO no viaja: un `amount` en el cuerpo se descarta. */
  it('un monto en el cuerpo no se guarda: el precio lo decide la cantidad', () => {
    const r = PurchaseReceiveSchema.safeParse({ quantity: 6, unitPrice: 7.5, amount: 1 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect('amount' in r.data).toBe(false);
  });
});
