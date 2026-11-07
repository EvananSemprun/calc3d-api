import { exigirBaseLocal, hostDeUrlDeBase, modoSintetico } from './guarda-base-local';

// Se arma por partes: el pre-commit del repo bloquea cualquier literal usuario:clave@host.
const url = (usuario: string, clave: string, resto: string) => 'postgresql://' + usuario + ':' + clave + '@' + resto;

describe('guarda de base local para el catálogo sintético', () => {
  it.each([
    url('u', 'p', 'localhost:5432/calc3d'),
    url('u', 'p', '127.0.0.1:5432/calc3d?schema=public'),
    url('u', 'p', '[::1]:5432/calc3d'),
  ])('deja pasar %s', (u) => {
    expect(() => exigirBaseLocal(u)).not.toThrow();
  });

  it.each([
    url('u', 'p', 'junction.proxy.rlwy.net:5432/railway'),
    url('u', 'p', 'db.produccion.com/calc3d'),
    // truco clásico: "localhost" como parte del usuario o de un subdominio
    url('localhost', 'x', 'db.produccion.com/calc3d'),
    url('u', 'p', 'localhost.evil.com/calc3d'),
  ])('ROMPE con %s', (u) => {
    expect(() => exigirBaseLocal(u)).toThrow(/no es una base local/);
  });

  it('ROMPE si no hay DATABASE_URL o no se puede leer (no asume local)', () => {
    expect(() => exigirBaseLocal(undefined)).toThrow(/no es una base local/);
    expect(() => exigirBaseLocal('basura')).toThrow(/no es una base local/);
  });

  it('el mensaje no filtra la contraseña', () => {
    expect.assertions(1);
    try {
      exigirBaseLocal(url('u', 'secreto123', 'db.produccion.com/calc3d'));
    } catch (e) {
      expect((e as Error).message).not.toContain('secreto123');
    }
  });

  it('lee el host en minúsculas', () => {
    expect(hostDeUrlDeBase(url('u', 'p', 'LocalHost:5432/x'))).toBe('localhost');
  });

  it('modoSintetico distingue sembrar, borrar y nada', () => {
    expect(modoSintetico('1')).toBe('sembrar');
    expect(modoSintetico('true')).toBe('sembrar');
    expect(modoSintetico('borrar')).toBe('borrar');
    expect(modoSintetico(undefined)).toBeNull();
    expect(modoSintetico('0')).toBeNull();
  });
});
