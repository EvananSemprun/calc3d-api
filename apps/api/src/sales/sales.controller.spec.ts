import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SalesController } from './sales.controller';

/**
 * Lee el pipe REAL declarado en `@Body(...)` de la ruta (no uno armado en el
 * test), para que sacar el pipe de la ruta también rompa esta regresión.
 */
function pipeDe(metodo: 'create' | 'update'): ZodValidationPipe<unknown> {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, SalesController, metodo) as Record<
    string,
    { pipes?: unknown[] }
  >;
  const conPipe = Object.values(args).find((a) => (a.pipes?.length ?? 0) > 0);
  if (!conPipe?.pipes?.length) throw new Error(`No se encontró un @Body con pipe en ${metodo}`);
  return conPipe.pipes[0] as ZodValidationPipe<unknown>;
}

/**
 * Regresión de seguridad — encargo = pedido (2026-09-14). Un encargo cargado como
 * venta ENCARGO y además como pedido se cuenta dos veces en los ingresos. La
 * pantalla ya no ofrece el tipo, pero la puerta real es la API: saltarse el
 * panel y mandar `kind: 'ENCARGO'` tiene que ser 400, al crear y al editar.
 */
describe('SalesController', () => {
  it('todo el controller exige sesión', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SalesController)).toContain(JwtAuthGuard);
  });

  it('crear una venta tipo ENCARGO es 400', () => {
    expect(() =>
      pipeDe('create').transform({ date: '2026-09-14', amount: 12, kind: 'ENCARGO' }),
    ).toThrow(BadRequestException);
  });

  it('convertir una venta en ENCARGO al editarla es 400', () => {
    expect(() => pipeDe('update').transform({ kind: 'ENCARGO' })).toThrow(BadRequestException);
  });

  it('la venta de mostrador pasa', () => {
    expect(pipeDe('create').transform({ date: '2026-09-14', amount: 3 })).toMatchObject({
      kind: 'COUNTER',
    });
  });
});
