import 'reflect-metadata';
import { BadRequestException, GoneException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { MonthSchema } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FilamentController } from './filament.controller';

/**
 * El proyecto no tiene e2e: estas pruebas fijan por METADATA de Nest lo que un
 * test e2e verificaría contra HTTP real (guard aplicado, verbo y ruta de cada
 * método), sin levantar la app completa.
 */
describe('FilamentController', () => {
  /**
   * Regresión de seguridad: el guardado por casilla dejó de existir. Si alguien
   * vuelve a conectar `PUT /filament/stock` al servicio, los meses cerrados se
   * vuelven editables por la puerta de atrás.
   */
  it('PUT /filament/stock ya no guarda: responde 410 sin tocar el servicio', () => {
    const service = { closeMonth: jest.fn(), reopenMonth: jest.fn(), monthStatus: jest.fn() };
    const controller = new FilamentController(service as never);

    expect(() => controller.saveCount()).toThrow(GoneException);
    expect(service.closeMonth).not.toHaveBeenCalled();
  });

  it('todo el controller exige sesión (guard a nivel de clase)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FilamentController)).toContain(JwtAuthGuard);
  });

  /**
   * Si mañana alguien agrega una ruta de escritura nueva (un PATCH suelto, p.
   * ej.) sin pasar por `closeMonth`/`reopenMonth`, este test la detecta.
   */
  it('las únicas rutas de escritura son cerrar, reabrir y el PUT en 410', () => {
    const proto = FilamentController.prototype as unknown as Record<string, object>;
    const escrituras = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor')
      .map((k) => {
        const method = Reflect.getMetadata(METHOD_METADATA, proto[k]) as RequestMethod | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, proto[k]) as string;
        return { k, method, path };
      })
      .filter((r) => r.method !== undefined && r.method !== RequestMethod.GET)
      .map((r) => `${RequestMethod[r.method as RequestMethod]} ${r.path} -> ${r.k}`)
      .sort();

    expect(escrituras).toEqual([
      'POST stock/close -> close',
      'POST stock/reopen -> reopen',
      'PUT stock -> saveCount',
    ]);
  });

  /**
   * `monthStart` (shared) lanza un Error común ante un mes mal formado: sin
   * este pipe, `GET /filament/stock`, `/stock/status` y `/summary` devolvían
   * 500 en vez de 400. Se prueba contra el pipe REAL, no un mock.
   */
  it('un mes mal formado es 400, no 500', () => {
    const pipe = new ZodValidationPipe(MonthSchema);

    expect(() => pipe.transform('2026-13')).toThrow(BadRequestException);
    expect(pipe.transform('2026-08')).toBe('2026-08');
  });

  /**
   * El test anterior prueba el pipe SUELTO: no detecta que alguien lo saque del
   * `@Query('month', ...)` de una ruta. Este lo fija por metadata de Nest sobre
   * el controller real: `stock`, `summary` y `status` tienen que seguir validando
   * `month` con un `ZodValidationPipe`, o vuelve el 500 ante un mes mal formado.
   */
  it('stock, summary y status validan el query "month" con ZodValidationPipe', () => {
    const rutas: Array<keyof FilamentController> = ['stock', 'summary', 'status'];

    for (const ruta of rutas) {
      const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, FilamentController, ruta) as
        | Record<string, { index: number; data?: string; pipes: unknown[] }>
        | undefined;
      const monthArg = Object.values(meta ?? {}).find((arg) => arg?.data === 'month');

      if (!monthArg) throw new Error(`falta @Query('month', ...) en "${ruta}"`);
      expect(monthArg.pipes.some((p) => p instanceof ZodValidationPipe)).toBe(true);
    }
  });
  /**
   * EL ÚLTIMO MES CERRADO, para el aviso del Dashboard (2026-10-10).
   *
   * ⚠️ El Dashboard **no puede deducirlo** del estado de un mes suelto:
   * `/stock/status?month=2026-09` dice si septiembre está cerrado, pero no
   * distingue "no lo cerró" de "este negocio todavía no cerró ningún mes", que
   * es justo el caso en el que el aviso NO tiene que aparecer.
   */
  it('GET /filament/stock/last-closed es de lectura y la organización sale de la sesión', async () => {
    const proto = FilamentController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(PATH_METADATA, proto.lastClosed)).toBe('stock/last-closed');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.lastClosed)).toBe(RequestMethod.GET);

    const service = { lastClosedMonth: jest.fn().mockResolvedValue('2026-09') };
    const controller = new FilamentController(service as never);

    await expect(controller.lastClosed({ organizationId: 'org-A' } as never)).resolves.toEqual({
      month: '2026-09',
    });
    expect(service.lastClosedMonth).toHaveBeenCalledWith('org-A');
  });

  /**
   * Sin ningún mes cerrado devuelve `null`, y eso es un DATO: es lo que apaga
   * el aviso en un negocio que arranca. Un 404 obligaría al panel a tratar un
   * error como "no hay", que es cómo se termina avisando de más.
   */
  it('sin ningún mes cerrado devuelve null, no un error ni un mes inventado', async () => {
    const service = { lastClosedMonth: jest.fn().mockResolvedValue(null) };
    const controller = new FilamentController(service as never);

    await expect(controller.lastClosed({ organizationId: 'org-A' } as never)).resolves.toEqual({
      month: null,
    });
  });

  /**
   * El precio por tipo es la fuente que la calculadora usa para cotizar. La
   * organización sale de la SESIÓN: si alguna vez entrara por un parámetro,
   * cotizarías con los precios de otro negocio.
   */
  it('GET /filament/type-prices es de lectura y la organización sale de la sesión', async () => {
    const proto = FilamentController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(PATH_METADATA, proto.typePrices)).toBe('type-prices');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.typePrices)).toBe(RequestMethod.GET);

    const service = { typePrices: jest.fn().mockResolvedValue([]) };
    const controller = new FilamentController(service as never);
    await controller.typePrices({ organizationId: 'org-A' } as never);

    expect(service.typePrices).toHaveBeenCalledWith('org-A');
  });
});
