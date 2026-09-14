import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { MaterialStatusUpdateDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MaterialsController } from './materials.controller';

/**
 * Lee el pipe REAL declarado en `@Body(...)` de una ruta del controller (en vez
 * de instanciar uno propio en el test), para que quitar el pipe de la ruta
 * también rompa este test.
 */
function pipeDe(metodo: 'setStatus' | 'update'): ZodValidationPipe<unknown> {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, MaterialsController, metodo) as Record<
    string,
    { pipes?: unknown[] }
  >;
  const conPipe = Object.values(args).find((a) => (a.pipes?.length ?? 0) > 0);
  if (!conPipe?.pipes?.length) throw new Error(`No se encontró un @Body con pipe en ${metodo}`);
  return conPipe.pipes[0] as ZodValidationPipe<unknown>;
}

/**
 * Regresión de seguridad de las fichas de material: la ruta exige sesión, usa la
 * organización del token, valida el estado, y corregir la ficha no puede colar
 * precio, estado ni ningún otro campo (mass-assignment). Desde 2026-09-14 no hay
 * alta suelta: las fichas nacen de una compra en Gastos.
 */
describe('MaterialsController', () => {
  it('todo el controller exige sesión', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MaterialsController)).toContain(JwtAuthGuard);
  });

  it('PATCH :id/status llega a setStatus con la organización del token', async () => {
    const service = { setStatus: jest.fn().mockResolvedValue({ id: 'm1' }) };
    const controller = new MaterialsController(service as never);

    await controller.setStatus({ organizationId: 'org-A' } as never, 'm1', { status: 'DISCONTINUED' });

    expect(service.setStatus).toHaveBeenCalledWith('org-A', 'm1', { status: 'DISCONTINUED' });
    const handler = MaterialsController.prototype.setStatus;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/status');
  });

  it('un estado inválido es 400', () => {
    const pipe = pipeDe('setStatus');

    expect(() => pipe.transform({ status: 'BORRADO' })).toThrow(BadRequestException);
    expect(pipe.transform({ status: 'DISCONTINUED' } as unknown)).toEqual({
      status: 'DISCONTINUED',
    } satisfies MaterialStatusUpdateDto);
  });

  it('PATCH :id llega a update con la organización del token', async () => {
    const service = { update: jest.fn().mockResolvedValue({ id: 'm1' }) };
    const controller = new MaterialsController(service as never);

    await controller.update({ organizationId: 'org-A' } as never, 'm1', { name: 'PLA Negro' });

    expect(service.update).toHaveBeenCalledWith('org-A', 'm1', { name: 'PLA Negro' });
    const handler = MaterialsController.prototype.update;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id');
  });

  it('corregir la ficha solo acepta nombre y color: el precio sale de la compra', () => {
    const dto = pipeDe('update').transform({
      name: ' PLA Negro ',
      color: 'Negro',
      rollPrice: 1,
      rollGrams: 250,
      brand: 'Otra',
      type: 'PETG',
      status: 'DISCONTINUED',
      organizationId: 'org-B',
    });

    expect(dto).toEqual({ name: 'PLA Negro', color: 'Negro' });
  });

  it('corregir con el nombre en blanco es 400', () => {
    expect(() => pipeDe('update').transform({ name: '   ' })).toThrow(BadRequestException);
  });

  it('no hay alta suelta de fichas: ninguna ruta POST', () => {
    const proto = MaterialsController.prototype as unknown as Record<string, unknown>;
    const posts = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor')
      .filter((n) => Reflect.getMetadata(METHOD_METADATA, proto[n] as object) === RequestMethod.POST);

    expect(posts).toEqual([]);
  });
});
