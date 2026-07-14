import { SHARED_VERSION } from './version';
import pkg from '../package.json';

describe('SHARED_VERSION', () => {
  it('coincide con la versión del package.json (fuente de verdad del motor)', () => {
    expect(SHARED_VERSION).toBe(pkg.version);
  });
});
