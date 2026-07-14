import { orderTotal, orderPaid, orderBalance, orderIsPaid } from './order';

const lines = [
  { description: 'Llavero', quantity: 200, unit: 'u', unitPrice: 1.5 }, // 300
  { description: 'Empaque', quantity: 1, unit: 'servicio', unitPrice: 25 }, // 25
];

describe('cálculo de pedido', () => {
  it('orderTotal suma cantidad × precio de cada línea', () => {
    expect(orderTotal(lines)).toBe(325); // 200*1.5 + 25
  });

  it('orderTotal de lista vacía es 0', () => {
    expect(orderTotal([])).toBe(0);
  });

  it('orderPaid suma los abonos', () => {
    expect(orderPaid([100, 50.5])).toBe(150.5);
  });

  it('orderBalance = total − abonado', () => {
    expect(orderBalance(lines, [100, 50])).toBe(175); // 325 - 150
  });

  it('orderBalance no se ensucia con decimales (325 − 108.33×3)', () => {
    expect(orderBalance([{ description: 'x', quantity: 1, unitPrice: 325 }], [108.33, 108.33, 108.34])).toBe(0);
  });

  it('orderIsPaid true cuando el saldo llega a 0 o menos', () => {
    expect(orderIsPaid(lines, [325])).toBe(true);
    expect(orderIsPaid(lines, [400])).toBe(true); // sobrepago
    expect(orderIsPaid(lines, [300])).toBe(false);
  });
});
