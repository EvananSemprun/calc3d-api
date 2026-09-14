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
function pipeDe(metodo: 'setStatus' | 'update' | 'create'): ZodValidationPipe<unknown> {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, MaterialsController, metodo) as Record<
    string,
    { pipes?: unknown[] }
  >;
  const conPipe = Object.values(args).find((a) => (a.pipes?.length ?? 0) > 0);
  if (!conPipe?.pipes?.length) throw new Error(`No se encontró un @Body con pipe en ${metodo}`);
  return conPipe.pipes[0] as ZodValidationPipe<unknown>;
}

/**
 * Regresión de seguridad del estado de las fichas: la ruta exige sesión, usa la
 * organización del token, valida el estado y el formulario de la ficha no puede
 * colar un `status` (mass-assignment).
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

  it('crear o editar la ficha no puede cambiar el estado', () => {
    const alta = pipeDe('create').transform({
      name: 'PLA Negro',
      rollPrice: 20,
      rollGrams: 1000,
      status: 'DISCONTINUED',
    }) as Record<string, unknown>;
    const edicion = pipeDe('update').transform({
      rollPrice: 20,
      status: 'DISCONTINUED',
    }) as Record<string, unknown>;

    expect(alta).not.toHaveProperty('status');
    expect(edicion).toEqual({ rollPrice: 20 });
  });
});
