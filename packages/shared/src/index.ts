// Contratos compartidos entre front y back: schemas Zod, tipos y motor de cálculo.
export * from './schemas/calc';
export * from './schemas/api';
export * from './calc/types';
export * from './calc/calculateQuote';
export * from './calc/select';
export * from './calc/charge-equivalents';
export * from './calc/breakeven';
export * from './calc/order';
export * from './calc/product';
export * from './calc/plan';
export * from './calc/campaign';
export * from './calc/money';
export * from './calc/format';
export { SHARED_VERSION } from './version';
