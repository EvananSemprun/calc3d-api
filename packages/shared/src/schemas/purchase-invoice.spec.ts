import { PurchaseInvoiceLineSchema } from './api';

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
