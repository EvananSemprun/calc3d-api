// Contratos compartidos entre front y back: schemas Zod, tipos y motor de cálculo.
export * from './schemas/calc';
export * from './schemas/api';
export * from './schemas/store';
export * from './schemas/store-request';
export * from './calc/types';
export * from './calc/calculateQuote';
export * from './calc/charge-equivalents';
export * from './calc/breakeven';
export * from './calc/order';
export * from './calc/product';
export * from './calc/campaign';
export * from './calc/money';
export * from './calc/format';
export { SHARED_VERSION } from './version';
