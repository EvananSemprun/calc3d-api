# Quitar la página Materiales — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar la página Materiales, mover la ficha (corregir nombre/color, descontinuar, borrar sin historial) a Stock del mes, hacer que el precio del filamento salga solo de la compra y avisar al cotizar los filamentos que cerraron el último mes en 0.

**Architecture:** La API (NestJS + Prisma) cierra los caminos que escriben `rollPrice` a mano, endurece el borrado y agrega dos datos derivados (`outAtLastClose` en `GET /materials`, `canDelete` en `GET /filament/stock`). El contrato vive en `packages/shared` (canónico en `calc3d-api`, copiado a `calc3d-web` con `pnpm sync:shared`). El panel (React + TanStack Query) quita la página y suma un diálogo de ficha en `StockTab`.

**Tech Stack:** NestJS 10, Prisma, Zod 3.24, Jest + ts-jest, React 18, Vite, TanStack Query v5, Radix Dialog.

**Spec:** `calc3d-api/docs/superpowers/specs/2026-09-14-quitar-pagina-materiales-design.md`

---

## Reglas para quien implemente

- **NO hacer commit ni push** (regla del dueño). Donde un plan normal diría "commit", acá hay un **checkpoint**: correr lo indicado y reportar.
- No tocar `.env`. No usar `--no-verify`. Nunca `pnpm -r build`.
- `packages/shared` se edita **solo en `calc3d-api`**. En `calc3d-web` se trae con `pnpm sync:shared`.
- `calc3d-web` ya tiene cambios sin commitear de otro trabajo (`AppLayout.tsx`, `ui.tsx`, `Catalog.tsx`, `Expenses.tsx`, etc.). **No revertirlos**: editá encima.
- TDD de seguridad: los tests marcados 🔒 se escriben primero y **se ven fallar** antes del fix.
- Rutas de este plan relativas a la carpeta `calculadora 3d/`.
- Comandos en Bash (Git Bash). Desde la raíz de cada repo.

## Mapa de archivos

**calc3d-api**
| Archivo | Cambio |
|---|---|
| `packages/shared/src/schemas/stock.ts` | + `MaterialCorrectionSchema`; `StockCountRow.canDelete` |
| `packages/shared/src/schemas/stock.spec.ts` | tests del schema |
| `packages/shared/src/version.ts`, `packages/shared/package.json` | 0.14.0 → 0.15.0 |
| `apps/api/src/materials/materials.controller.ts` | PATCH con el schema nuevo; sin POST |
| `apps/api/src/materials/materials.controller.spec.ts` | 🔒 pipe real + sin POST |
| `apps/api/src/materials/materials.service.ts` | sin `create`; `update` tipado; `remove` sin historial; `list` con `outAtLastClose` |
| `apps/api/src/materials/materials.service.spec.ts` | reescrito |
| `apps/api/src/filament/filament.service.ts` | `stock()` con `canDelete` |
| `apps/api/src/filament/filament.service.spec.ts` | fixture + test |
| `apps/api/src/expenses/expenses.service.ts` | `createWithDefinition`: precio solo de la compra |
| `apps/api/src/expenses/expenses.service.spec.ts` | 🔒 tests nuevos + `it.each` ajustado |
| `CLAUDE.md` | docs |

**calc3d-web**
| Archivo | Cambio |
|---|---|
| `packages/shared/**` | `pnpm sync:shared` |
| `apps/web/src/features/filament/api.ts` | hooks de ficha |
| `apps/web/src/features/filament/FichaDialog.tsx` | **nuevo** |
| `apps/web/src/features/filament/StockTab.tsx` | marca → botón que abre la ficha |
| `apps/web/src/features/calculator/useCatalogData.ts` | `MaterialItem.outAtLastClose` |
| `apps/web/src/features/calculator/materialOptions.ts` | **nuevo**: orden y etiqueta |
| `apps/web/src/features/calculator/parts.tsx` | `CatalogSelect` con `labelOf` |
| `apps/web/src/features/calculator/sections.tsx` | usa lo anterior |
| `apps/web/src/pages/Expenses.tsx` | filamento sin precio de referencia |
| `apps/web/src/App.tsx` | redirección |
| `apps/web/src/components/AppLayout.tsx`, `CommandPalette.tsx`, `OnboardingChecklist.tsx` | sin Materiales |
| `apps/web/src/features/catalogs/config.ts` | materiales solo para Gastos; tipo limpio |
| `apps/web/src/pages/Catalog.tsx` | sin el código exclusivo de materiales |
| `CLAUDE.md` | docs |

---

### Task 0: Foto de base para las revisiones

- [ ] **Step 1: Guardar la base de cada repo** (incluye cambios sin commitear; no toca el árbol)

```bash
cd "calc3d-api" && b=$(git stash create); [ -z "$b" ] && b=$(git rev-parse HEAD); git update-ref refs/quitar-materiales/base "$b"; git rev-parse refs/quitar-materiales/base
cd "../calc3d-web" && b=$(git stash create); [ -z "$b" ] && b=$(git rev-parse HEAD); git update-ref refs/quitar-materiales/base "$b"; git rev-parse refs/quitar-materiales/base
```

Expected: dos SHAs. Un revisor ve lo hecho con `git diff refs/quitar-materiales/base`.

---

### Task 1: Shared — `MaterialCorrectionSchema` y versión 0.15.0

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/stock.ts` (después de `MaterialStatusUpdateSchema`, ~línea 17)
- Test: `calc3d-api/packages/shared/src/schemas/stock.spec.ts`
- Modify: `calc3d-api/packages/shared/src/version.ts`, `calc3d-api/packages/shared/package.json`

- [ ] **Step 1: Test que falla**

En `stock.spec.ts`, agregar `MaterialCorrectionSchema` al import existente (línea 1):

```ts
import {
  MaterialCorrectionSchema,
  MaterialStatusUpdateSchema,
  StockMonthCloseSchema,
  StockMonthReopenSchema,
} from './stock';
```

Y al final del archivo:

```ts
/**
 * Corregir una ficha (2026-09-14): solo nombre y color, para tipeos. El precio
 * sale de la compra; marca, tipo y gramos quedan como nacieron.
 */
describe('MaterialCorrectionSchema', () => {
  it('solo deja nombre y color: el precio y el resto se descartan', () => {
    const r = MaterialCorrectionSchema.parse({
      name: ' PLA Negro ',
      color: ' Negro ',
      rollPrice: 1,
      rollGrams: 250,
      brand: 'Otra',
      type: 'PETG',
      status: 'DISCONTINUED',
      organizationId: 'org-B',
    });

    expect(r).toEqual({ name: 'PLA Negro', color: 'Negro' });
  });

  it('un nombre en blanco no vale', () => {
    expect(MaterialCorrectionSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('un color vacío queda sin color', () => {
    expect(MaterialCorrectionSchema.parse({ color: '' })).toEqual({ color: null });
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared exec jest src/schemas/stock.spec.ts`
Expected: FAIL — `MaterialCorrectionSchema` is not exported / undefined.

- [ ] **Step 3: Implementar**

En `stock.ts`, justo después de `export type MaterialStatusUpdateDto = …;`:

```ts
/**
 * Corregir una ficha (`PATCH /materials/:id`, 2026-09-14). Solo nombre y color:
 * es para arreglar tipeos. El precio del rollo sale SIEMPRE de la compra y
 * marca, tipo y gramos quedan como nacieron (decisión del dueño). Lo que no está
 * acá se descarta, como en el resto de los schemas.
 */
export const MaterialCorrectionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').optional(),
  color: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});
export type MaterialCorrectionDto = z.infer<typeof MaterialCorrectionSchema>;
```

- [ ] **Step 4: Subir la versión**

`packages/shared/src/version.ts`: `export const SHARED_VERSION = '0.15.0';`
`packages/shared/package.json`: `"version": "0.15.0",`

- [ ] **Step 5: Verlo pasar y compilar shared**

Run: `cd calc3d-api && pnpm test:shared && pnpm --filter @calc3d/shared build`
Expected: todos los tests de shared PASS (incluido `version.spec.ts`); build sin errores.

- [ ] **Step 6: Checkpoint** — sin commit. Reportar resultado.

---

### Task 2: 🔒 `MaterialsController` — PATCH solo nombre/color y sin POST

**Files:**
- Modify: `calc3d-api/apps/api/src/materials/materials.controller.ts`
- Modify: `calc3d-api/apps/api/src/materials/materials.service.ts` (solo `create` y la firma de `update`)
- Test: `calc3d-api/apps/api/src/materials/materials.controller.spec.ts`

- [ ] **Step 1: Reemplazar el spec completo por este (tests que fallan)**

```ts
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
```

- [ ] **Step 2: Verlo fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/materials/materials.controller.spec.ts`
Expected: FAIL en "corregir la ficha solo acepta nombre y color" (sale `rollPrice`, `rollGrams`, `brand`, `type` y el nombre sin recortar) y en "ninguna ruta POST" (`['create']`). Los demás PASS.

- [ ] **Step 3: Implementar el controller**

Reemplazar `materials.controller.ts` completo:

```ts
import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  MaterialCorrectionSchema,
  MaterialStatusUpdateSchema,
  type MaterialCorrectionDto,
  type MaterialStatusUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MaterialsService } from './materials.service';

/**
 * Fichas de material. Desde 2026-09-14 NO hay alta suelta (`POST`): una ficha
 * nace de una compra en Gastos (`POST /expenses/with-definition`), que es la que
 * fija el precio del rollo.
 */
@Controller('materials')
@UseGuards(JwtAuthGuard)
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  /** Corregir tipeos: solo nombre y color. El precio no se toca a mano. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MaterialCorrectionSchema)) dto: MaterialCorrectionDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  /** Descontinuar o reactivar. Aparte del PATCH de la ficha: corregirla no cambia el estado. */
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MaterialStatusUpdateSchema)) dto: MaterialStatusUpdateDto,
  ) {
    return this.service.setStatus(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}
```

- [ ] **Step 4: Ajustar el service (solo lo que el controller necesita)**

En `materials.service.ts`:
- Import: `import type { MaterialCorrectionDto, MaterialStatusUpdateDto } from '@calc3d/shared';`
- **Borrar** el método `create` entero.
- Cambiar la firma de `update`:

```ts
  async update(organizationId: string, id: string, dto: MaterialCorrectionDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: dto });
  }
```

- [ ] **Step 5: Verlo pasar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/materials`
Expected: `materials.controller.spec.ts` PASS. `materials.service.spec.ts` PASS (todavía no se tocó `remove`).

- [ ] **Step 6: Checkpoint** — sin commit.

---

### Task 3: 🔒 `MaterialsService` — borrar solo sin historial, `outAtLastClose`, IDOR en `update`

**Files:**
- Modify: `calc3d-api/apps/api/src/materials/materials.service.ts`
- Test: `calc3d-api/apps/api/src/materials/materials.service.spec.ts` (reescrito)

- [ ] **Step 1: Reemplazar el spec completo por este**

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const ORG = 'org-A';
const AGOSTO = new Date('2026-08-01T00:00:00Z');

type Ficha = { id: string; organizationId: string; status: 'ACTIVE' | 'DISCONTINUED' };

function makePrisma() {
  return {
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'ACTIVE' } as Ficha | null),
      findMany: jest.fn().mockResolvedValue([] as unknown[]),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
    expense: { count: jest.fn().mockResolvedValue(0) },
    stockMonth: { findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null) },
    stockCount: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([] as unknown[]),
    },
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new MaterialsService(prisma as never);

/**
 * Borrar una ficha: solo si no tiene historial (2026-09-14). `Expense→Material` es
 * `onDelete: SetNull` (borrarla deja compras huérfanas) y `StockCount→Material` es
 * `Cascade` (borrarla borra conteos). Con historial, se descontinúa.
 */
describe('MaterialsService.remove', () => {
  it('una ficha con una compra no se borra', async () => {
    const prisma = makePrisma();
    prisma.expense.count.mockResolvedValue(1);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(intento).rejects.toThrow('Descontinuala en vez de borrarla');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('una ficha con un conteo, aunque el mes esté abierto, no se borra', async () => {
    const prisma = makePrisma();
    prisma.stockCount.count.mockResolvedValue(1);

    await expect(service(prisma).remove(ORG, 'm1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('cuenta compras y conteos de esa ficha en la organización del token', async () => {
    const prisma = makePrisma();

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.expense.count).toHaveBeenCalledWith({ where: { materialId: 'm1', organizationId: ORG } });
    expect(prisma.stockCount.count).toHaveBeenCalledWith({ where: { materialId: 'm1', organizationId: ORG } });
  });

  it('sin compras ni conteos se borra', async () => {
    const prisma = makePrisma();

    await expect(service(prisma).remove(ORG, 'm1')).resolves.toEqual({ ok: true });
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('una ficha de otra organización es 404', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue(null);

    await expect(service(prisma).remove(ORG, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('si ya está descontinuada, el 409 no sugiere descontinuarla', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue({ id: 'm1', organizationId: ORG, status: 'DISCONTINUED' });
    prisma.expense.count.mockResolvedValue(3);

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toThrow('se conserva descontinuada');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });
});

/**
 * Al cotizar se avisa "0 al cierre de agosto" (2026-09-14): la ficha tiene fila de
 * conteo en el último mes cerrado con total 0 y no se volvió a comprar después.
 * "Tiene fila" prueba que existía al cierre (cerrar escribe TODAS las fichas); no
 * se usa `createdAt` porque las fichas se importaron después, con compras del 31/08.
 */
describe('MaterialsService.list — outAtLastClose', () => {
  const ficha = (id: string, expenses: { quantity: number | null; date: Date }[] = []) => ({ id, name: id, expenses });

  it('sin meses cerrados, ninguna avisa', async () => {
    const prisma = makePrisma();
    prisma.material.findMany.mockResolvedValue([ficha('m1')]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
    expect(prisma.stockCount.findMany).not.toHaveBeenCalled();
  });

  it('en 0 al cierre y sin compras después: avisa con el mes', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    // La compra del 31/08 es de ANTES del cierre: no cuenta como reposición.
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: 1, date: new Date('2026-08-31T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBe('2026-08');
  });

  it('con rollos al cierre no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1')]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 1 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
  });

  it('comprada después del cierre no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: 2, date: new Date('2026-09-01T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBeNull();
  });

  it('una compra posterior sin cantidad no cuenta como reposición', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('m1', [{ quantity: null, date: new Date('2026-09-05T00:00:00Z') }])]);
    prisma.stockCount.findMany.mockResolvedValue([{ materialId: 'm1', sealed: 0, inUse: 0, running: 0 }]);

    const [m1] = await service(prisma).list(ORG);

    expect(m1.outAtLastClose).toBe('2026-08');
  });

  it('sin fila en el mes cerrado (se creó después) no avisa', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });
    prisma.material.findMany.mockResolvedValue([ficha('nueva')]);

    const [nueva] = await service(prisma).list(ORG);

    expect(nueva.outAtLastClose).toBeNull();
  });

  it('lee el último mes cerrado y sus conteos, de la organización del token', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: AGOSTO });

    await service(prisma).list(ORG);

    expect(prisma.stockMonth.findFirst.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
    expect(prisma.stockCount.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, month: AGOSTO },
    });
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } });
  });
});

/**
 * Corregir una ficha. Regresión de seguridad: una ficha de otra organización no se
 * puede tocar (IDOR). Ya estaba cubierto por `ensureOwned`; este test lo fija.
 */
describe('MaterialsService.update', () => {
  it('corrige una ficha propia con lo que llegó', async () => {
    const prisma = makePrisma();

    await service(prisma).update(ORG, 'm1', { name: 'PLA Negro', color: null });

    expect(prisma.material.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { name: 'PLA Negro', color: null } });
  });

  it('una ficha de otra organización es 404 y no se escribe', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG, status: 'ACTIVE' as const } : null),
    );

    await expect(service(prisma).update('org-B', 'm1', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});

/**
 * Descontinuar o reactivar una ficha. Regresión de seguridad: una ficha de otra
 * organización no se puede tocar (IDOR).
 */
describe('MaterialsService.setStatus', () => {
  it('descontinúa una ficha propia', async () => {
    const prisma = makePrisma();

    await service(prisma).setStatus(ORG, 'm1', { status: 'DISCONTINUED' });

    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'DISCONTINUED' },
    });
  });

  it('reactiva una ficha propia', async () => {
    const prisma = makePrisma();

    await service(prisma).setStatus(ORG, 'm1', { status: 'ACTIVE' });

    expect(prisma.material.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'ACTIVE' } });
  });

  it('una ficha de otra organización es 404 y no se escribe', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG, status: 'ACTIVE' as const } : null),
    );

    await expect(service(prisma).setStatus('org-B', 'm1', { status: 'DISCONTINUED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/materials/materials.service.spec.ts`
Expected: FAIL en `remove` ("una compra", "un conteo", "cuenta compras y conteos", "se conserva descontinuada") y en todos los de `outAtLastClose` (propiedad `undefined` / `stockMonth.findMany is not a function`). `update` y `setStatus` PASS (ya estaban cubiertos por `ensureOwned`: son tests de regresión, pasar de entrada es lo esperado).

- [ ] **Step 3: Implementar**

En `materials.service.ts`:

Import de shared:

```ts
import { monthKey, stockTotal, type MaterialCorrectionDto, type MaterialStatusUpdateDto } from '@calc3d/shared';
```

Reemplazar `list`:

```ts
  /**
   * Las fichas con sus compras (para Gastos y el conteo de rollos) y
   * `outAtLastClose`: el mes (`AAAA-MM`) si la ficha cerró el último mes cerrado en
   * 0 y no se volvió a comprar después; si no, null. La calculadora lo usa para
   * avisar "0 al cierre de agosto" sin ocultarla.
   *
   * "Estaba al cierre" = tiene fila de conteo en ese mes: cerrar escribe TODAS las
   * fichas. No sirve `createdAt`: las fichas se importaron después de sus compras.
   */
  async list(organizationId: string) {
    const [materiales, ultimoCierre] = await Promise.all([
      this.prisma.material.findMany({
        where: { organizationId },
        include: { expenses: { select: { quantity: true, date: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMonth.findFirst({
        where: { organizationId, closedAt: { not: null } },
        orderBy: { month: 'desc' },
        select: { month: true },
      }),
    ]);
    if (!ultimoCierre) return materiales.map((m) => ({ ...m, outAtLastClose: null }));

    const mes = ultimoCierre.month;
    const mesSiguiente = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1));
    const conteos = await this.prisma.stockCount.findMany({
      where: { organizationId, month: mes },
      select: { materialId: true, sealed: true, inUse: true, running: true },
    });
    const totalAlCierre = new Map(conteos.map((c) => [c.materialId, stockTotal(c)]));
    const clave = monthKey(mes);

    return materiales.map((m) => {
      const enCero = totalAlCierre.get(m.id) === 0;
      const compradaDespues = m.expenses.some((e) => (e.quantity ?? 0) > 0 && e.date >= mesSiguiente);
      return { ...m, outAtLastClose: enCero && !compradaDespues ? clave : null };
    });
  }
```

Reemplazar `remove`:

```ts
  /**
   * Borrar solo una ficha SIN historial (2026-09-14). Con compras, borrarla las deja
   * huérfanas (`onDelete: SetNull`); con conteos, los borra en cascada — y un
   * conteo de un mes cerrado es un registro que el dueño dio por final. Con
   * historial, la salida es descontinuarla. Sin candado contra un cierre que se
   * cuele en el medio: carrera aceptada (app de un solo dueño).
   */
  async remove(organizationId: string, id: string) {
    const ficha = await this.ensureOwned(organizationId, id);

    const [compras, conteos] = await Promise.all([
      this.prisma.expense.count({ where: { materialId: id, organizationId } }),
      this.prisma.stockCount.count({ where: { materialId: id, organizationId } }),
    ]);
    if (compras > 0 || conteos > 0) {
      throw new ConflictException(
        ficha.status === 'DISCONTINUED'
          ? 'Tiene compras o conteos registrados: se conserva descontinuada.'
          : 'Tiene compras o conteos registrados. Descontinuala en vez de borrarla.',
      );
    }

    await this.prisma.material.delete({ where: { id } });
    return { ok: true };
  }
```

Actualizar el comentario de `setStatus` ("es la salida para una ficha que no se puede borrar porque tiene conteos en meses cerrados") → "es la salida para una ficha con compras o conteos, que no se puede borrar".

- [ ] **Step 4: Verlo pasar + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/materials && pnpm --filter @calc3d/api exec tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` sin errores.

- [ ] **Step 5: Checkpoint** — sin commit.

---

### Task 4: `GET /filament/stock` — `canDelete`

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/stock.ts` (`StockCountRow`)
- Modify: `calc3d-api/apps/api/src/filament/filament.service.ts` (`stock()`, ~línea 116)
- Test: `calc3d-api/apps/api/src/filament/filament.service.spec.ts`

- [ ] **Step 1: Test que falla**

En `filament.service.spec.ts`, al fixture `MATERIALES` agregarle a CADA una de las 3 fichas `_count: { expenses: 0, stockCounts: 0 }` (al final de cada objeto).

Dentro de `describe('Conteo de stock', …)`, agregar al final:

```ts
  it('solo se puede borrar una ficha sin compras ni conteos', async () => {
    const prisma = makePrisma();
    prisma.material.findMany.mockResolvedValue([
      { ...MATERIALES[0], _count: { expenses: 0, stockCounts: 0 } },
      { ...MATERIALES[1], _count: { expenses: 1, stockCounts: 0 } },
      { ...MATERIALES[2], _count: { expenses: 0, stockCounts: 2 } },
    ]);

    const filas = await service(prisma).stock(ORG, '2026-08');

    expect(Object.fromEntries(filas.map((f) => [f.materialId, f.canDelete]))).toEqual({
      m1: true,
      m2: false,
      m3: false,
    });
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({
      include: { _count: { select: { expenses: true, stockCounts: true } } },
    });
  });
```

- [ ] **Step 2: Verlo fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/filament/filament.service.spec.ts`
Expected: FAIL — `canDelete` undefined / `include` ausente (o error de tipos de ts-jest: `canDelete` no existe en `StockCountRow`).

- [ ] **Step 3: Implementar**

`stock.ts`, dentro de `interface StockCountRow`, después de `counted: boolean;`:

```ts
  /** La ficha no tiene compras ni conteos: es la única que se puede borrar. */
  canDelete: boolean;
```

`filament.service.ts`, en `stock()`:

```ts
      this.prisma.material.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { expenses: true, stockCounts: true } } },
      }),
```

y en el objeto que devuelve cada fila, después de `counted: cerrado,`:

```ts
        canDelete: m._count.expenses === 0 && m._count.stockCounts === 0,
```

- [ ] **Step 4: Compilar shared, verlo pasar + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm --filter @calc3d/api exec jest src/filament && pnpm --filter @calc3d/api exec tsc --noEmit -p tsconfig.json`
Expected: PASS; `tsc` sin errores.

- [ ] **Step 5: Checkpoint** — sin commit.

---

### Task 5: 🔒 Gastos — el precio del filamento sale solo de la compra

**Files:**
- Modify: `calc3d-api/apps/api/src/expenses/expenses.service.ts` (`createWithDefinition`, ~líneas 109-166)
- Test: `calc3d-api/apps/api/src/expenses/expenses.service.spec.ts`

- [ ] **Step 1: Tests que fallan**

En `describe('ExpensesService.createWithDefinition', …)`, agregar después del test "modo 'existing' kind material con rollos: fija el precio y la reactiva":

```ts
  /**
   * Regresión de seguridad (2026-09-14): el precio del rollo sale SOLO de la compra
   * (monto ÷ rollos). Ni el "precio de referencia" ni `data.rollPrice` del body lo
   * pueden fijar a mano.
   */
  it("filamento existente: el precio de referencia del body se ignora", async () => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });
    tx.expense.create.mockResolvedValue({ id: 'e-mat' });

    await service.createWithDefinition(ORG, {
      expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false, quantity: 2 },
      link: { kind: 'material', mode: 'existing', id: 'mat-9', referenceField: 'rollPrice', referenceValue: 999 },
    } as any);

    expect(tx.material.update).toHaveBeenCalledTimes(1);
    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-9' },
      data: { rollPrice: 20, status: 'ACTIVE' },
    });
  });

  it('filamento nuevo: el rollPrice del body se pisa con el de la compra', async () => {
    tx.material.create.mockResolvedValue({ id: 'mat-1' });
    tx.expense.create.mockResolvedValue({ id: 'e-new' });

    await service.createWithDefinition(ORG, {
      expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false, quantity: 2 },
      link: { kind: 'material', mode: 'new', data: { name: 'PLA Rojo', rollPrice: 999, rollGrams: 1000 } },
    } as any);

    expect(tx.material.create.mock.calls[0][0].data.rollPrice).toBe(20);
  });

  it.each(['new', 'existing'])('filamento %s sin rollos → 400 y no escribe nada', async (mode) => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });

    await expect(
      service.createWithDefinition(ORG, {
        expense: { date: '2026-09-14', amount: 40, category: 'CONSUMABLE', description: 'PLA', isInvestment: false },
        link: {
          kind: 'material',
          mode,
          id: mode === 'existing' ? 'mat-9' : null,
          data: mode === 'new' ? { name: 'PLA Rojo', rollGrams: 1000 } : null,
          referenceField: 'rollPrice',
          referenceValue: 40,
        },
      } as any),
    ).rejects.toThrow('Indicá cuántos rollos compraste');
    expect(tx.material.create).not.toHaveBeenCalled();
    expect(tx.material.update).not.toHaveBeenCalled();
    expect(tx.expense.create).not.toHaveBeenCalled();
  });
```

Y en el `it.each` de "referenceField … → 400 y no escribe nada", **sacar las filas de `material`** (en filamento el campo ahora se ignora; lo cubren los tests de arriba) y dejar:

```ts
  it.each([
    ['printer', 'lifetimeHours', 0],
    ['printer', 'organizationId', 1],
    ['component', 'unitsPerPackage', 0],
    ['component', 'status', 1],
    ['printer', 'rollPrice', 10], // el precio de OTRO tipo de ficha
  ])("modo 'existing' kind %s con referenceField '%s' → 400 y no escribe nada", async (kind, field, value) => {
```

(el cuerpo del test no cambia). En el comentario de arriba de ese `it.each`, cambiar "(gramos del rollo, vida útil, unidades por paquete)" por "(vida útil, unidades por paquete)" y agregar al final: "En filamento el precio de referencia se ignora: lo fija la compra."

- [ ] **Step 2: Verlo fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/expenses`
Expected: FAIL en "el precio de referencia del body se ignora" (update llamado 2 veces, una con 999), "el rollPrice del body se pisa" (999) y los dos "sin rollos" (no lanza). El resto PASS.

- [ ] **Step 3: Implementar**

En `createWithDefinition`, reemplazar desde `const { expense, link } = dto;` hasta el cierre del bloque `if (link.kind === 'material' && linkId …) { … }` por:

```ts
    const { expense, link } = dto;
    // Filamento: el precio del rollo sale SOLO de la compra (monto ÷ rollos). Sin
    // rollos no hay precio que calcular, y aceptarla dejaba entrar uno a mano.
    const rollos = expense.quantity ?? 0;
    if (link.kind === 'material' && rollos <= 0) {
      throw new BadRequestException('Indicá cuántos rollos compraste');
    }
    const schemas = {
      material: MaterialSchema,
      printer: PrinterSchema,
      component: ComponentSchema,
    } as const;
    const linkField = `${link.kind}Id` as 'materialId' | 'printerId' | 'componentId';

    return this.prisma.$transaction(async (tx) => {
      const model = (tx as unknown as Record<string, CatalogDelegate>)[link.kind];
      let linkId = link.id ?? undefined;

      if (link.mode === 'new') {
        // Filamento: lo que venga en `data.rollPrice` se pisa con el de la compra.
        const crudo =
          link.kind === 'material'
            ? { ...(link.data ?? {}), rollPrice: purchaseCostPerRoll(expense.amount, rollos) }
            : (link.data ?? {});
        const data = schemas[link.kind].parse(crudo);
        const created = await model.create({ data: { ...data, organizationId } });
        linkId = created.id;
      } else {
        if (!linkId) throw new BadRequestException('Falta el item del catálogo');
        const owned = await model.findFirst({ where: { id: linkId, organizationId } });
        if (!owned) throw new NotFoundException('Definición no encontrada');
        // El precio de referencia es de impresoras e insumos. En filamento se
        // ignora (sin 400: un panel viejo lo sigue mandando durante el deploy).
        if (link.kind !== 'material' && link.referenceField != null && link.referenceValue != null) {
          // `referenceField` viaja en el body: solo puede ser el precio de este tipo
          // de ficha y no negativo. Si no, escribiría cualquier campo numérico
          // (vida útil, unidades por paquete…) sin las reglas de su schema.
          if (link.referenceField !== PRICE_FIELD[link.kind] || link.referenceValue < 0) {
            throw new BadRequestException('Campo de referencia inválido');
          }
          await model.update({ where: { id: linkId }, data: { [link.referenceField]: link.referenceValue } });
        }
      }

      // Una compra de filamento fija el precio del rollo y reactiva la ficha si
      // estaba descontinuada. La ficha ya se validó como propia arriba.
      if (link.kind === 'material' && linkId) {
        await model.update({
          where: { id: linkId },
          data: { rollPrice: purchaseCostPerRoll(expense.amount, rollos), status: 'ACTIVE' },
        });
      }
```

(el `return tx.expense.create({ … })` que sigue no cambia).

- [ ] **Step 4: Verlo pasar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/expenses`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — sin commit.

---

### Task 6: API — verificación completa y docs

**Files:**
- Modify: `calc3d-api/CLAUDE.md`

- [ ] **Step 1: Suite, tipos y lint**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest && pnpm --filter @calc3d/api exec tsc --noEmit -p tsconfig.json && pnpm --filter @calc3d/api lint && pnpm test:shared`
Expected: todo PASS / sin errores. Si algún otro spec usaba `MaterialsService.create` o `POST /materials`, reportarlo (no se esperaba ninguno: `grep -rn "materials" apps/api/src --include=*.spec.ts`).

- [ ] **Step 2: Docs**

En `calc3d-api/CLAUDE.md`, en el bullet **Activo / Descontinuado** (~línea 587):
- Cambiar "es la salida para una ficha con conteos en meses cerrados que no se puede borrar" por "es la salida para una ficha con compras o conteos, que no se puede borrar".

Y agregar a continuación de ese bullet (mismo nivel de sangría):

```md
  - **Sin página Materiales** (2026-09-14, shared 0.15.0) — la ficha se maneja
    desde Stock del mes. **No hay `POST /materials`**: una ficha nace de una compra
    en Gastos. `PATCH /materials/:id` valida con `MaterialCorrectionSchema` (SOLO
    `name` y `color`, decisión del dueño; marca, tipo, gramos y precio quedan como
    nacieron). ⚠️ **El precio del filamento sale SOLO de la compra**: en
    `createWithDefinition`, `kind: 'material'` exige `quantity ≥ 1` (400 "Indicá
    cuántos rollos compraste"), ignora `referenceField` y pisa `data.rollPrice` con
    `purchaseCostPerRoll`. `DELETE /materials/:id` da 409 si la ficha tiene
    CUALQUIER compra o conteo. `GET /materials` trae `outAtLastClose` (`AAAA-MM` si
    tiene fila de conteo en 0 en el último mes cerrado y no se compró después; NO
    usa `createdAt`: las fichas se importaron después de sus compras del 31/08) y
    `GET /filament/stock` trae `canDelete`. Regresión de seguridad:
    `materials.controller.spec.ts` (pipe real del PATCH, ninguna ruta POST),
    `materials.service.spec.ts`, `expenses.service.spec.ts`. Spec:
    `docs/superpowers/specs/2026-09-14-quitar-pagina-materiales-design.md`.
```

- [ ] **Step 3: Checkpoint** — sin commit. Reportar el conteo de tests.

---

### Task 7: Panel — traer shared 0.15.0

- [ ] **Step 1: Sincronizar y compilar**

Run: `cd calc3d-web && pnpm sync:shared && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: sync copia desde `../calc3d-api/packages/shared`; build OK; tests PASS (incluye `version.spec.ts` con 0.15.0).

- [ ] **Step 2: Ver qué rompe el tipo nuevo**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit`
Expected: sin errores (`canDelete` es un campo nuevo de una respuesta, no rompe lecturas). Si hay errores, reportarlos antes de seguir.

- [ ] **Step 3: Checkpoint** — sin commit.

---

### Task 8: Panel — la ficha en Stock del mes

**Files:**
- Modify: `calc3d-web/apps/web/src/features/filament/api.ts`
- Create: `calc3d-web/apps/web/src/features/filament/FichaDialog.tsx`
- Modify: `calc3d-web/apps/web/src/features/filament/StockTab.tsx`

- [ ] **Step 1: Hooks**

En `features/filament/api.ts`, agregar `MaterialStatus` al import de tipos de `@calc3d/shared` y al final del archivo:

```ts
/**
 * Tras corregir, descontinuar o borrar una ficha cambian el catálogo (calculadora
 * y Gastos), el conteo, la reposición y los nombres en Compras.
 */
function useInvalidarFichas() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['materials', 'filament-stock', 'filament-summary', 'filament-purchases'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

/** Corregir tipeos de una ficha: solo nombre y color (el precio sale de la compra). */
export function useCorrectMaterial() {
  const invalidar = useInvalidarFichas();
  return useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name: string; color: string | null }) => {
      const { data } = await api.patch(`/materials/${id}`, { name, color });
      return data;
    },
    onSuccess: invalidar,
  });
}

export function useSetMaterialStatus() {
  const invalidar = useInvalidarFichas();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: MaterialStatus }) => {
      const { data } = await api.patch(`/materials/${id}/status`, { status });
      return data;
    },
    onSuccess: invalidar,
  });
}

/** Solo anda con una ficha sin compras ni conteos (`canDelete`); si no, la API da 409. */
export function useDeleteMaterial() {
  const invalidar = useInvalidarFichas();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/materials/${id}`);
    },
    onSuccess: invalidar,
  });
}
```

- [ ] **Step 2: Crear `FichaDialog.tsx`**

```tsx
import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import type { StockCountRow } from '@calc3d/shared';
import { Button, Field, Input } from '@/components/ui';
import { Dialog, useConfirm } from '@/components/overlays';
import { Combobox } from '@/components/Combobox';
import { notify } from '@/components/toast';
import { apiErrorMessage } from '@/lib/api';
import { useCorrectMaterial, useDeleteMaterial, useSetMaterialStatus } from '@/features/filament/api';

/**
 * LA FICHA DE UN ROLLO, desde Stock del mes. Reemplaza a la página Materiales
 * (se quitó el 2026-09-14). Solo se corrigen nombre y color — tipeos: el precio
 * sale de la compra y marca, tipo y gramos quedan como nacieron (decisión del
 * dueño). Cada acción cierra el diálogo: la fila se refresca con lo nuevo.
 */
export function FichaDialog({ fila, onClose }: { fila: StockCountRow; onClose: () => void }) {
  const [name, setName] = useState(fila.name);
  const [color, setColor] = useState(fila.color ?? '');
  const corregir = useCorrectMaterial();
  const cambiarEstado = useSetMaterialStatus();
  const borrar = useDeleteMaterial();
  const confirm = useConfirm();

  const ocupado = corregir.isPending || cambiarEstado.isPending || borrar.isPending;
  const descontinuada = fila.status === 'DISCONTINUED';
  const nombreLimpio = name.trim();
  const colorLimpio = color.trim() || null;
  const sinCambios = nombreLimpio === fila.name && colorLimpio === (fila.color ?? null);
  const titulo = [fila.type, fila.color].filter(Boolean).join(' ') || fila.name;

  const guardar = () =>
    corregir.mutate(
      { id: fila.materialId, name: nombreLimpio, color: colorLimpio },
      {
        onSuccess: () => {
          notify.success('Ficha corregida');
          onClose();
        },
        onError: (e) => notify.error('No se pudo corregir la ficha', apiErrorMessage(e)),
      },
    );

  const alternarEstado = async () => {
    const ok = await confirm(
      descontinuada
        ? {
            title: `¿Reactivar «${fila.name}»?`,
            description: 'Vuelve a aparecer al cotizar y en la reposición.',
            confirmLabel: 'Reactivar',
          }
        : {
            title: `¿Descontinuar «${fila.name}»?`,
            description:
              'Deja de aparecer al cotizar y en la reposición. Sus compras y conteos no se tocan. Se reactiva sola al registrar una compra con rollos, o con «Reactivar».',
            confirmLabel: 'Descontinuar',
          },
    );
    if (!ok) return;
    cambiarEstado.mutate(
      { id: fila.materialId, status: descontinuada ? 'ACTIVE' : 'DISCONTINUED' },
      {
        onSuccess: () => {
          notify.success(descontinuada ? 'Ficha reactivada' : 'Ficha descontinuada');
          onClose();
        },
        onError: (e) => notify.error('No se pudo cambiar el estado', apiErrorMessage(e)),
      },
    );
  };

  const borrarFicha = async () => {
    const ok = await confirm({
      title: `¿Borrar «${fila.name}»?`,
      description: 'No tiene compras ni conteos. Esta acción no se puede deshacer.',
      confirmLabel: 'Borrar',
      tone: 'destructive',
    });
    if (!ok) return;
    borrar.mutate(fila.materialId, {
      onSuccess: () => {
        notify.success('Ficha borrada');
        onClose();
      },
      onError: (e) => notify.error('No se pudo borrar la ficha', apiErrorMessage(e)),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`${titulo} · ${fila.brand ?? 'Sin marca'}`}
      description="El precio del rollo sale de la última compra."
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{fila.type ?? '—'}</dd>
          <dt className="text-muted-foreground">Marca</dt>
          <dd>{fila.brand ?? 'Sin marca'}</dd>
        </dl>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Corregir</h3>
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={ocupado} />
          </Field>
          <Field label="Color (opcional)">
            <Combobox kind="MATERIAL_COLOR" value={color} onChange={setColor} />
          </Field>
          <div className="flex justify-end">
            <Button variant="accent" onClick={guardar} disabled={ocupado || sinCambios || !nombreLimpio}>
              Guardar corrección
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t border-border/60 pt-4">
          <Button variant="outline" className="w-full" onClick={alternarEstado} disabled={ocupado}>
            {descontinuada ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {descontinuada ? 'Reactivar' : 'Descontinuar'}
          </Button>
          {fila.canDelete ? (
            <Button variant="outline" className="w-full text-destructive" onClick={borrarFicha} disabled={ocupado}>
              <Trash2 className="h-4 w-4" /> Borrar ficha
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tiene compras o conteos: no se borra, se descontinúa.
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
```

Nota: si `MATERIAL_COLOR` no fuera un `CatalogOptionKind` válido, usar el que usa hoy `features/catalogs/config.ts` para el color de materiales (es ese literal).

- [ ] **Step 3: Conectar en `StockTab.tsx`**

Import (junto a los demás de `@/features/filament`):

```ts
import { FichaDialog } from '@/features/filament/FichaDialog';
```

Estado, justo después de `const confirm = useConfirm();`:

```ts
  // La ficha abierta en el diálogo (2026-09-14: reemplaza a la página Materiales).
  const [fichaAbierta, setFichaAbierta] = useState<StockCountRow | null>(null);
```

Texto de ayuda (el `<p>` bajo el `MonthPicker`):

```tsx
          <p className="text-sm text-muted-foreground">
            El último día del mes contá los rollos, llená las casillas y cerrá el mes. Tocá una
            marca para corregir o descontinuar su ficha.
          </p>
```

Reemplazar `<span className="truncate text-sm">{f.brand ?? 'Sin marca'}</span>` por:

```tsx
                          <button
                            type="button"
                            onClick={() => setFichaAbierta(f)}
                            aria-label={`Ficha de ${ficha}`}
                            className="truncate rounded text-left text-sm underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {f.brand ?? 'Sin marca'}
                          </button>
```

Y antes del `</div>` que cierra el `return` del componente (después del bloque de la grilla):

```tsx
      {fichaAbierta && <FichaDialog fila={fichaAbierta} onClose={() => setFichaAbierta(null)} />}
```

- [ ] **Step 4: Tipos y lint**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint`
Expected: sin errores.

- [ ] **Step 5: Checkpoint** — sin commit.

---

### Task 8b: Panel — filtros en Stock del mes

Pedido del dueño (2026-09-14), con la página Materiales se van sus filtros. Decisión: **Buscar (color o marca)**, **Tipo** y **Estado** (arranca en **Todas**). ⚠️ Los filtros solo cambian lo que **se ve**: cerrar el mes sigue guardando TODAS las fichas (`filas`, no `filasVisibles`). Por eso hay aviso mientras haya fichas ocultas y la confirmación de cierre lo repite — si no, una ficha oculta con rollos se cerraría en 0 sin verla.

**Files:**
- Modify: `calc3d-web/apps/web/src/features/filament/StockTab.tsx`
- Modify: `calc3d-web/CLAUDE.md`

- [ ] **Step 1: Imports**

Agregar `FilterBar`, `SearchInput` y `Select` al import de `@/components/ui` (hoy: `Badge, Button, Card, CardContent, NumberInput, TableSkeleton`).

- [ ] **Step 2: Estado de los filtros y filas visibles**

Reemplazar la línea `const grupos = useMemo(() => agruparPorColor(filas), [filas]);` por:

```tsx
  // Filtros (2026-09-14): solo cambian lo que SE VE. Cerrar el mes guarda TODAS
  // las fichas, filtradas o no — por eso el Estado arranca en "Todas" y hay aviso.
  const [busqueda, setBusqueda] = usePersistentState('filament:stock:q', '');
  const [tipoF, setTipoF] = usePersistentState('filament:stock:type', '');
  const [estadoRaw, setEstadoF] = usePersistentState('filament:stock:status', '');
  // Un valor viejo o raro en localStorage dejaría la grilla vacía y el selector en blanco.
  const estadoF = ESTADOS.includes(estadoRaw) ? estadoRaw : '';

  const tipos = useMemo(
    () =>
      [...new Set(filas.map((f) => f.type).filter((t): t is string => !!t))].sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
    [filas],
  );
  const filasVisibles = useMemo(() => {
    const q = norm(busqueda.trim());
    return filas.filter(
      (f) =>
        (!tipoF || f.type === tipoF) &&
        (!estadoF || f.status === estadoF) &&
        (!q || norm(`${claveDeColor(f)} ${f.brand ?? ''} ${f.name}`).includes(q)),
    );
  }, [filas, busqueda, tipoF, estadoF]);
  const hayOcultas = filasVisibles.length < filas.length;
  const quitarFiltros = () => {
    setBusqueda('');
    setTipoF('');
    setEstadoF('');
  };

  const grupos = useMemo(() => agruparPorColor(filasVisibles), [filasVisibles]);
```

Y a nivel de módulo (junto a `CERO`/`partesDe`):

```tsx
/** Valores válidos del filtro de estado: '' = todas. */
const ESTADOS = ['', 'ACTIVE', 'DISCONTINUED'];

/** Minúsculas y sin acentos, para que "limon" encuentre "Limón". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
```

- [ ] **Step 3: La confirmación de cierre lo avisa**

En `cerrarMes`, antes de `const ok = await confirm(`, agregar:

```tsx
    const avisoOcultas = hayOcultas ? ' Se guardan TODAS las fichas, también las que ocultan los filtros.' : '';
```

y sumar `${avisoOcultas}` al final de las dos `description` (la de `rollos === 0` y la otra), dentro del template string.

- [ ] **Step 4: Barra de filtros y aviso**

Justo antes del bloque `{(stockFallo && !stockQuery.data) || (estadoFallo && !estado) ? (`, agregar:

```tsx
      {filas.length > 0 && (
        <div className="space-y-2">
          <FilterBar>
            <SearchInput
              value={busqueda}
              onChange={setBusqueda}
              placeholder="Buscar color o marca…"
              className="col-span-full w-full sm:w-64"
            />
            <Select className="w-full sm:w-40" value={tipoF} onChange={(e) => setTipoF(e.target.value)}>
              <option value="">Tipo: todos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select className="w-full sm:w-44" value={estadoF} onChange={(e) => setEstadoF(e.target.value)}>
              <option value="">Estado: todas</option>
              <option value="ACTIVE">Activas</option>
              <option value="DISCONTINUED">Descontinuadas</option>
            </Select>
          </FilterBar>
          {hayOcultas && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              Se ven {filasVisibles.length} de {filas.length} fichas. Al cerrar el mes se guardan todas,
              también las ocultas.
              <button
                type="button"
                onClick={quitarFiltros}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Quitar filtros
              </button>
            </p>
          )}
        </div>
      )}
```

(Si `SearchInput` o `Select` tienen otra firma, seguir la de `features/filament/PurchasesTab.tsx` y `pages/Catalog.tsx`, que ya los usan así.)

- [ ] **Step 5: Grilla vacía por filtros**

Dentro de `<CardContent className="space-y-5 pt-5">` de la grilla, antes de `{grupos.map((g) => (`, agregar:

```tsx
            {grupos.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ninguna ficha coincide con los filtros.
              </p>
            )}
```

- [ ] **Step 6: Verificar que el cierre sigue usando todas las fichas**

Run: `cd calc3d-web && grep -n "filas.map\|filas.filter\|filasVisibles" apps/web/src/features/filament/StockTab.tsx`
Expected: `cerrarMes` (`counts`, `colores`), el `useEffect` del borrador y `pendientes` siguen sobre `filas`; `filasVisibles` solo alimenta `grupos` y el aviso.

- [ ] **Step 7: Tipos y lint**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint`
Expected: sin errores.

- [ ] **Step 8: Docs**

En `calc3d-web/CLAUDE.md`, en el bullet "Barras de filtros: SIEMPRE `FilterBar`", agregar **Stock del mes** a la lista de páginas que lo usan. Y en el bullet de **Stock del mes** (`StockTab`), agregar al final:

```md
  **Filtros** (2026-09-14): Buscar (color o marca, sin acentos), Tipo y Estado
  (arranca en **Todas**; `filament:stock:q|type|status`). ⚠️ Solo cambian lo que
  SE VE: cerrar el mes guarda TODAS las fichas. Con fichas ocultas hay aviso
  ("Se ven X de Y… Quitar filtros") y la confirmación de cierre lo repite; no
  arrancar en "Activas": una descontinuada con rollos se cerraría en 0 sin verla.
```

- [ ] **Step 9: Checkpoint** — sin commit. (Se verifica en pantalla en la Task 12: filtrar por "negro", por tipo PETG y por Descontinuadas, a 375 px; ver el aviso y "Quitar filtros".)

---

### Task 9: Panel — aviso al cotizar

**Files:**
- Modify: `calc3d-web/apps/web/src/features/calculator/useCatalogData.ts`
- Create: `calc3d-web/apps/web/src/features/calculator/materialOptions.ts`
- Modify: `calc3d-web/apps/web/src/features/calculator/parts.tsx` (`CatalogSelect`, ~línea 66)
- Modify: `calc3d-web/apps/web/src/features/calculator/sections.tsx` (~líneas 122-134)

- [ ] **Step 1: Tipo**

En `MaterialItem` (`useCatalogData.ts`), después de `status: MaterialStatus;`:

```ts
  /** `AAAA-MM` si cerró ese mes (el último cerrado) en 0 y no se volvió a comprar; si no, null. */
  outAtLastClose: string | null;
```

- [ ] **Step 2: Crear `materialOptions.ts`**

```ts
import { monthStart } from '@calc3d/shared';
import type { MaterialItem } from './useCatalogData';

/**
 * Las fichas que se ofrecen al cotizar: sin las descontinuadas y con las que
 * cerraron el último mes en 0 AL FINAL (2026-09-14, decisión del dueño: se avisa,
 * no se ocultan — se puede cotizar un color que se va a reponer).
 */
export function materialesParaCotizar(items: MaterialItem[] | undefined): MaterialItem[] | undefined {
  if (!items) return undefined;
  const activas = items.filter((m) => m.status !== 'DISCONTINUED');
  return [...activas.filter((m) => !m.outAtLastClose), ...activas.filter((m) => m.outAtLastClose)];
}

/** `"PLA Amarillo — 0 al cierre de agosto"` para las que cerraron en 0; si no, el nombre. */
export function etiquetaMaterial(m: MaterialItem): string {
  if (!m.outAtLastClose) return m.name;
  const mes = monthStart(m.outAtLastClose).toLocaleDateString('es-VE', { month: 'long', timeZone: 'UTC' });
  return `${m.name} — 0 al cierre de ${mes}`;
}
```

- [ ] **Step 3: `CatalogSelect` con `labelOf`**

Reemplazar la función en `parts.tsx`:

```tsx
/** Selector "Elegir del catálogo" reutilizable. */
export function CatalogSelect<T extends { id: string; name: string }>({
  items,
  onPick,
  labelOf = (item) => item.name,
}: {
  items: T[] | undefined;
  onPick: (item: T) => void;
  /** Texto de cada opción; por defecto, el nombre. */
  labelOf?: (item: T) => string;
}) {
  return (
    <Select
      className="h-9"
      value=""
      onChange={(e) => {
        const item = items?.find((x) => x.id === e.target.value);
        if (item) onPick(item);
      }}
    >
      <option value="">Elegir del catálogo…</option>
      {items?.map((x) => (
        <option key={x.id} value={x.id}>
          {labelOf(x)}
        </option>
      ))}
    </Select>
  );
}
```

- [ ] **Step 4: Usarlo en `sections.tsx`**

Import:

```ts
import { etiquetaMaterial, materialesParaCotizar } from '@/features/calculator/materialOptions';
```

Reemplazar en `SectionFilamento`:

```tsx
            // Una ficha descontinuada no se ofrece al cotizar. Lo ya cotizado no
            // cambia: elegir una ficha COPIA precio y gramos al trabajo.
            items={c.catalogs.materials.data?.filter((m) => m.status !== 'DISCONTINUED')}
```

por:

```tsx
            // Sin descontinuadas; las que cerraron el último mes en 0 (y no se
            // volvieron a comprar) van al final, avisadas. Lo ya cotizado no
            // cambia: elegir una ficha COPIA precio y gramos al trabajo.
            items={materialesParaCotizar(c.catalogs.materials.data)}
            labelOf={etiquetaMaterial}
```

- [ ] **Step 5: Tipos y lint**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint`
Expected: sin errores.

- [ ] **Step 6: Checkpoint** — sin commit.

---

### Task 10: Panel — Gastos sin precio de referencia para filamento

**Files:**
- Modify: `calc3d-web/apps/web/src/pages/Expenses.tsx`

- [ ] **Step 1: No mandar la referencia en filamento**

En `save`, reemplazar:

```ts
          mode === 'existing' && updatePrice && type.priceField
```

por:

```ts
          // Filamento: el precio del rollo lo fija el servidor con monto ÷ rollos.
          mode === 'existing' && updatePrice && type.priceField && type.key !== 'filament'
```

- [ ] **Step 2: Ficha existente — casilla fuera, precio a la vista**

Reemplazar:

```tsx
          <Checkbox
            checked={updatePrice}
            onChange={setUpdatePrice}
            label="Usar este precio como referencia para cotizar"
          />
```

por:

```tsx
          {type.key === 'filament' ? (
            <PrecioDelRollo amount={amount} quantity={quantity} />
          ) : (
            <Checkbox
              checked={updatePrice}
              onChange={setUpdatePrice}
              label="Usar este precio como referencia para cotizar"
            />
          )}
```

- [ ] **Step 3: Ficha nueva — precio a la vista**

En el bloque `{linksCatalog && mode === 'new' && cfg && (…)}`, el último hijo es el `Field` "Cantidad comprada" dentro de `{type.perUnit && (…)}`. Justo después de ese `{type.perUnit && (…)}` y antes del `</div>` que cierra el recuadro, agregar:

```tsx
          {type.key === 'filament' && <PrecioDelRollo amount={amount} quantity={quantity} />}
```

(Ojo: el mismo `Field` "Cantidad comprada" aparece también en el bloque de ficha existente; editar el que está dentro del recuadro `rounded-xl border` de "Se creará en el catálogo de…").

- [ ] **Step 4: Componente**

Al final del archivo:

```tsx
/** Filamento: el precio del rollo para cotizar sale de la compra, no de una casilla (2026-09-14). */
function PrecioDelRollo({ amount, quantity }: { amount: number; quantity: number }) {
  const precio = quantity > 0 ? amount / quantity : 0;
  return (
    <p className="text-xs text-muted-foreground">
      El precio del rollo para cotizar queda en{' '}
      {precio.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.
    </p>
  );
}
```

- [ ] **Step 5: Tipos y lint**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint`
Expected: sin errores. (El formulario de ficha nueva deja de pedir "Precio del rollo" en la Task 11, al sacarlo de la config.)

- [ ] **Step 6: Checkpoint** — sin commit.

---

### Task 11: Panel — quitar la página

**Files:**
- Modify: `calc3d-web/apps/web/src/App.tsx`
- Modify: `calc3d-web/apps/web/src/components/AppLayout.tsx`, `CommandPalette.tsx`, `OnboardingChecklist.tsx`
- Modify: `calc3d-web/apps/web/src/features/catalogs/config.ts`
- Modify: `calc3d-web/apps/web/src/pages/Catalog.tsx`

- [ ] **Step 1: Redirección**

En `App.tsx`, justo antes de `<Route path="/catalogs/:resource" element={<CatalogPage />} />`:

```tsx
        {/* Materiales ya no tiene página (2026-09-14): la ficha vive en Stock del mes. */}
        <Route path="/catalogs/materials" element={<Navigate to="/filament/stock" replace />} />
```

- [ ] **Step 2: Menú, paleta y onboarding**

`AppLayout.tsx`: borrar `{ to: '/catalogs/materials', label: 'Materiales', icon: Box },` y cambiar el comentario del grupo a:

```ts
    // Categoría propia (2026-09-13): antes era una sola página con pestañas en
    // Definiciones. Sin "Materiales" desde 2026-09-14: la ficha vive en Stock del mes.
```

Si `Box` queda sin uso en `AppLayout.tsx`, sacarlo del import de `lucide-react`.

`CommandPalette.tsx`: borrar la línea `{ key: 'p-mat', group: 'Ir a', label: 'Materiales', to: '/catalogs/materials', icon: Box },` (`Box` sigue en uso por `p-fil-stock`).

`OnboardingChecklist.tsx`: reemplazar el paso de materiales por:

```ts
    { done: materials > 0, label: 'Registrá tu primera compra de filamento', hint: 'En Gastos, tipo Filamento: la ficha se crea con el precio de la compra.', to: '/expenses' },
```

- [ ] **Step 3: Config**

En `features/catalogs/config.ts`:
- En `CatalogColumn`, borrar `computed?: 'rolls';` y su comentario.
- En `CatalogConfig`, borrar `filters?: …` y `statusToggle?: …` con sus comentarios.
- Reemplazar la entrada `materials` por:

```ts
  // Sin página propia desde 2026-09-14 (`/catalogs/materials` redirige a Stock del
  // mes). Esta entrada solo arma el alta de ficha en Gastos → Filamento, y sin
  // "Precio del rollo": lo fija el servidor con monto ÷ rollos.
  materials: {
    route: 'materials',
    endpoint: 'materials',
    title: 'Materiales / Filamentos',
    singular: 'material',
    schema: MaterialSchema,
    fields: [
      { name: 'name', label: 'Nombre', type: 'text' },
      { name: 'brand', label: 'Marca', type: 'combobox', optionsKind: 'MATERIAL_BRAND', optional: true },
      { name: 'type', label: 'Tipo (PLA, PETG…)', type: 'combobox', optionsKind: 'MATERIAL_TYPE', optional: true },
      { name: 'rollGrams', label: 'Gramos del rollo', type: 'number', step: '1', hint: 'Ej. 1000' },
      { name: 'color', label: 'Color', type: 'combobox', optionsKind: 'MATERIAL_COLOR', optional: true },
    ],
    columns: [],
    costDefinition: true,
  },
```

- [ ] **Step 4: `Catalog.tsx` sin el código exclusivo de materiales**

Reemplazar las líneas 1-372 (imports, `numericDefaults`, `CatalogPage` y `CatalogView`) por lo siguiente. Desde `function buildDefaults` hasta el final del archivo **no cambia**.

```tsx
import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useMoney } from '@/features/settings/useSettings';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  FilterBar,
  Input,
  NumberInput,
  SearchInput,
  Select,
  TableSkeleton,
} from '@/components/ui';
import { Dialog, useConfirm, Tooltip } from '@/components/overlays';
import { Combobox } from '@/components/Combobox';
import { notify } from '@/components/toast';
import { catalogs, type CatalogConfig, type CatalogField } from '@/features/catalogs/config';

type Row = Record<string, unknown> & { id: string };

const numericDefaults: Record<string, number> = {
  rollGrams: 1000,
  lifetimeHours: 5000,
  unitsPerPackage: 100,
  powerKw: 0,
  maintPerHour: 0,
};

export function CatalogPage() {
  const { resource } = useParams<{ resource: string }>();
  const config = resource ? catalogs[resource] : undefined;
  if (!config) return <Navigate to="/" replace />;
  return <CatalogView key={config.route} config={config} />;
}

function CatalogView({ config }: { config: CatalogConfig }) {
  const qc = useQueryClient();
  const { money } = useMoney();
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();

  const { data: items = [], isLoading } = useQuery({
    queryKey: [config.endpoint],
    queryFn: async () => (await api.get<Row[]>(`/${config.endpoint}`)).data,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/${config.endpoint}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [config.endpoint] });
      notify.success('Elemento eliminado');
    },
    onError: (error) => notify.error(apiErrorMessage(error)),
  });

  const startCreate = () => {
    setEditing(null);
    setOpen(true);
  };
  const startEdit = (row: Row) => {
    setEditing(row);
    setOpen(true);
  };

  const fmt = (value: unknown, kind?: string) => {
    if (value === null || value === undefined || value === '') return '—';
    if (kind === 'money') return money(Number(value));
    if (kind === 'number') return new Intl.NumberFormat().format(Number(value));
    if (value === 'PER_PIECE') return 'Por pieza';
    if (value === 'PER_ORDER') return 'Por pedido';
    return String(value);
  };

  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const visible = items.filter(
    (r) =>
      !q ||
      String(r.name ?? '').toLowerCase().includes(q) ||
      config.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-8 w-1 rounded-full bg-brand-yellow shadow-glow-sm" />
          <div>
            <h1 className="font-display text-2xl font-bold">{config.title}</h1>
            <p className="text-sm text-muted-foreground">Catálogo reutilizable en tus presupuestos.</p>
          </div>
        </div>
        {!config.costDefinition && (
          <Button variant="accent" onClick={startCreate}>
            <Plus className="h-4 w-4" /> Agregar
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Buscar ${config.title.toLowerCase()}…`}
            className="col-span-full w-full sm:w-64"
          />
        </FilterBar>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton cols={5} />
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-blue/15 text-brand-blue-bright ring-1 ring-inset ring-brand-blue/30">
                <Inbox className="h-6 w-6" />
              </span>
              <p className="text-sm text-muted-foreground">
                {config.costDefinition
                  ? `Aún no registras ${config.title.toLowerCase()}. Se crean al registrar su compra en Gastos.`
                  : `No hay ${config.title.toLowerCase()} todavía. Agrega el primero.`}
              </p>
              {!config.costDefinition && (
                <Button variant="outline" size="sm" onClick={startCreate}>
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Ningún resultado con la búsqueda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    {config.columns.map((col) => (
                      <th key={col.key} className="px-4 py-3 font-semibold">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      {config.columns.map((col) => (
                        <td key={col.key} className="px-4 py-3">
                          {fmt(row[col.key], col.kind)}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Tooltip label="Editar">
                            <Button variant="ghost" size="icon" onClick={() => startEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                          <Tooltip label="Eliminar">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: '¿Eliminar este elemento?',
                                    description: 'Esta acción no se puede deshacer.',
                                    confirmLabel: 'Eliminar',
                                    tone: 'destructive',
                                  })
                                ) {
                                  remove.mutate(row.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <CatalogFormModal
          config={config}
          editing={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: [config.endpoint] });
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Sin restos**

Run: `cd calc3d-web && grep -rn "catalogs/materials\|statusToggle\|computed: 'rolls'\|filters:" apps/web/src`
Expected: solo la línea de la redirección en `App.tsx`.

- [ ] **Step 6: Tipos y lint**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint`
Expected: sin errores.

- [ ] **Step 7: Checkpoint** — sin commit.

---

### Task 12: Panel — verificación en pantalla y docs

**Files:**
- Modify: `calc3d-web/CLAUDE.md`

- [ ] **Step 1: Levantar** API (`calc3d-api`: `pnpm dev`, puerto 3001) y panel (`calc3d-web`: `pnpm dev`, puerto 5180) con los `launch.json`. **No ingresar contraseñas**: si pide login, el dueño se loguea.

- [ ] **Step 2: Verificar a 1280 px y a 375 px** (consola sin errores):
  1. `/catalogs/materials` redirige a `/filament/stock`; el grupo Filamento del menú tiene 3 ítems; la paleta (Ctrl+K) no ofrece "Materiales".
  2. Stock del mes: tocar una marca abre la ficha; el título es "tipo color · marca"; corregir el nombre refresca la fila; Descontinuar/Reactivar pide confirmación; "Borrar ficha" solo aparece en una ficha sin compras ni conteos (en los datos actuales normalmente ninguna: debe verse el texto "Tiene compras o conteos…").
  3. Calculadora → Filamento → "Elegir del catálogo…": las fichas que cerraron agosto en 0 (p. ej. Amarillo girasol) aparecen al final con "— 0 al cierre de agosto".
  4. Gastos → Registrar gasto → Filamento: en "Nuevo" no hay "Precio del rollo"; en "Del catálogo" no está la casilla de referencia; en ambos se ve "El precio del rollo para cotizar queda en $…". **No guardar el gasto** (sería escribir datos reales): basta con ver el formulario.

- [ ] **Step 3: Docs**

En `calc3d-web/CLAUDE.md`:

(a) En el bullet "Categoría propia del menú, 'Filamento'" reemplazar:

```md
  (`/filament/compras`) y **Análisis** (`/filament/analisis`), más **Materiales**
  (`/catalogs/materials`, el catálogo de esas fichas). Antes eran pestañas de una
```

por:

```md
  (`/filament/compras`) y **Análisis** (`/filament/analisis`). **Materiales ya no
  tiene página** (2026-09-14): `/catalogs/materials` redirige a Stock. Antes eran pestañas de una
```

(b) Reemplazar "Se descontinúan desde Materiales." por "Se descontinúan desde la ficha (tocando la marca en Stock del mes)."

(c) En el bullet de Gastos, reemplazar "Check \"usar como precio de referencia\" → `PATCH` PARCIAL al item." por "Check \"usar como precio de referencia\" → `PATCH` PARCIAL al item (**no en Filamento**: el precio del rollo sale de monto ÷ rollos, lo fija el servidor, y el formulario de ficha nueva no pide precio)."

(d) Reemplazar el bullet **Activo / Descontinuado** completo por:

```md
- **La ficha de un filamento vive en Stock del mes** (2026-09-14, shared 0.15.0;
  antes era la página Materiales, que se quitó por decisión del dueño). Tocar la
  marca de una fila abre `FichaDialog` (`features/filament/FichaDialog.tsx`):
  **corregir SOLO nombre y color** (`PATCH /materials/:id`; marca, tipo, gramos y
  precio quedan como nacieron), **Descontinuar / Reactivar** con confirmación
  (`PATCH /materials/:id/status`) y **Borrar** solo si `canDelete` (sin compras ni
  conteos; si no, la API da 409). Cada acción invalida `materials`,
  `filament-stock`, `filament-summary` y `filament-purchases`. La **calculadora no
  ofrece** descontinuadas y pone **al final** las que cerraron el último mes en 0
  sin compra posterior, con "— 0 al cierre de agosto" (`outAtLastClose`,
  `features/calculator/materialOptions.ts`). En **Gastos** las descontinuadas
  siguen visibles con "(descontinuado)" y **registrar una compra con rollos la
  reactiva** (lo hace el servidor). Spec:
  `calc3d-api/docs/superpowers/specs/2026-09-14-quitar-pagina-materiales-design.md`.
```

- [ ] **Step 4: Verificación final**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit && pnpm --filter @calc3d/web lint && pnpm test:shared`
Expected: sin errores.

- [ ] **Step 5: Checkpoint final** — sin commit. Reportar al dueño: tests de API, `tsc`/`eslint` del panel, lo verificado en pantalla, y el orden de deploy (API primero, sin migración).
