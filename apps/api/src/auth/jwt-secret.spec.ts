import { DEV_JWT_SECRET, resolveJwtSecret } from './jwt-secret';

/**
 * Regresión de la puerta trasera más peligrosa que tuvo el proyecto: el secreto
 * de firma caía a un valor por defecto ESCRITO EN EL CÓDIGO. Con él, cualquiera
 * que conociera un par usuario/organización podía firmar un token válido y
 * entrar como el dueño.
 *
 * En producción no puede haber fallback. Si alguien lo reintroduce "para que no
 * falle el arranque", esto se cae.
 */

function config(vars: Record<string, string | undefined>) {
  return { get: (k: string) => vars[k] } as never;
}

describe('Secreto de firma de los JWT', () => {
  describe('en producción', () => {
    const prod = (secret?: string) =>
      resolveJwtSecret(config({ NODE_ENV: 'production', JWT_SECRET: secret }));

    it('no arranca sin JWT_SECRET', () => {
      expect(() => prod(undefined)).toThrow(/JWT_SECRET/);
    });

    it('no arranca con el secreto de desarrollo', () => {
      // Está en el código fuente: es público por definición.
      expect(() => prod(DEV_JWT_SECRET)).toThrow(/desarrollo/);
    });

    it('no arranca con un secreto corto y adivinable', () => {
      expect(() => prod('calc3d')).toThrow(/corto/);
    });

    it('acepta un secreto aleatorio de largo suficiente', () => {
      const bueno = 'a3f1'.repeat(16); // 64 caracteres
      expect(prod(bueno)).toBe(bueno);
    });
  });

  describe('fuera de producción', () => {
    it('usa el valor de desarrollo si no hay ninguno, para no estorbar', () => {
      expect(resolveJwtSecret(config({ NODE_ENV: 'development' }))).toBe(DEV_JWT_SECRET);
    });

    it('respeta el secreto configurado si lo hay', () => {
      expect(resolveJwtSecret(config({ NODE_ENV: 'test', JWT_SECRET: 'local' }))).toBe('local');
    });
  });

  it('firma y verificación resuelven el MISMO secreto', () => {
    // El riesgo de tener dos lecturas separadas era que divergieran; ahora ambas
    // pasan por esta función. Este test ancla que siga siendo determinista.
    const vars = { NODE_ENV: 'production', JWT_SECRET: 'b7c2'.repeat(16) };
    expect(resolveJwtSecret(config(vars))).toBe(resolveJwtSecret(config(vars)));
  });
});
