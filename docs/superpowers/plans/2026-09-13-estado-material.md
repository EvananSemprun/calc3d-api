# Activo / Descontinuado en las fichas de material — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño pueda descontinuar y reactivar una ficha de material desde el panel, que las descontinuadas no se ofrezcan al cotizar y que comprar rollos las reactive.

**Architecture:** La columna `Material.status` ya existe. Se agrega un contrato (`MaterialStatusUpdateSchema`, shared 0.14.0) y una ruta aparte `PATCH /materials/:id/status`, de modo que el formulario de edición nunca cambia el estado. La reactivación vive en `ExpensesService`, en el mismo paso que fija `rollPrice`. En el panel, `Catalog.tsx` gana filtro, insignia y botón por fila (habilitados por config), la calculadora filtra y Gastos marca.

**Tech Stack:** NestJS + Prisma + Zod (API), jest/ts-jest; React + Vite + TanStack Query v5 (panel). Spec: `docs/superpowers/specs/2026-09-13-estado-material-design.md`.

**Reglas para quien ejecute:**
- Repos hermanos en `C:\Users\evanan-it\Desktop\Todo\mio\calculadora 3d\`: `calc3d-api` y `calc3d-web`. Rutas con espacios: citarlas.
- **Sin commits** (el dueño no lo pidió). Sin `--no-verify`. No tocar `.env*`.
- Nunca `pnpm -r build`. Shared: `pnpm --filter @calc3d/shared build`.
- Nunca editar `calc3d-web/packages/shared` a mano: solo `pnpm sync:shared`.
- Hay trabajo sin commitear de otras features (cierre mensual del stock, mes en hora de Venezuela): no revertir nada ajeno.

---

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `calc3d-api/packages/shared/src/schemas/stock.ts` | + `MaterialStatusUpdateSchema` / `MaterialStatusUpdateDto` |
| `calc3d-api/packages/shared/src/schemas/stock.spec.ts` | + tests del schema |
| `calc3d-api/packages/shared/src/version.ts`, `package.json` | 0.13.0 → 0.14.0 |
| `calc3d-api/apps/api/src/materials/materials.service.ts` | + `setStatus`; mensaje del 409 |
| `calc3d-api/apps/api/src/materials/materials.service.spec.ts` | + tests de `setStatus` (IDOR); 409 |
| `calc3d-api/apps/api/src/materials/materials.controller.ts` | + `PATCH :id/status` |
| `calc3d-api/apps/api/src/materials/materials.controller.spec.ts` | nuevo: guard, ruta, pipe, mass-assignment |
| `calc3d-api/apps/api/src/expenses/expenses.service.ts` | reactivar al comprar; `updateMany` con organización |
| `calc3d-api/apps/api/src/expenses/expenses.service.spec.ts` | tests ajustados y nuevos |
| `calc3d-web/packages/shared/**` | vía `pnpm sync:shared` |
| `calc3d-web/apps/web/src/features/calculator/useCatalogData.ts` | `MaterialItem.status` |
| `calc3d-web/apps/web/src/features/calculator/sections.tsx` | filtrar descontinuadas |
| `calc3d-web/apps/web/src/pages/Expenses.tsx` | sufijo "(descontinuado)" + aviso |
| `calc3d-web/apps/web/src/features/catalogs/config.ts` | `statusToggle`, filtro `status` |
| `calc3d-web/apps/web/src/pages/Catalog.tsx` | filtro Estado, insignia, botón por fila |
| `calc3d-api/CLAUDE.md`, `calc3d-web/CLAUDE.md`, spec del cierre mensual | docs |

---

### Task 1: Shared — contrato del cambio de estado (0.14.0)

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/stock.ts:9-10`
- Test: `calc3d-api/packages/shared/src/schemas/stock.spec.ts`
- Modify: `calc3d-api/packages/shared/src/version.ts`, `calc3d-api/packages/shared/package.json`

- [ ] **Step 1: Escribir el test que falla**

En `stock.spec.ts`, reemplazar la primera línea:

```ts
import { StockMonthCloseSchema, StockMonthReopenSchema } from './stock';
```

por:

```ts
import { MaterialStatusUpdateSchema, StockMonthCloseSchema, StockMonthReopenSchema } from './stock';
```

Y agregar al final del archivo:

```ts
describe('MaterialStatusUpdateSchema', () => {
  it('acepta descontinuar y reactivar', () => {
    expect(MaterialStatusUpdateSchema.parse({ status: 'DISCONTINUED' })).toEqual({ status: 'DISCONTINUED' });
    expect(MaterialStatusUpdateSchema.parse({ status: 'ACTIVE' })).toEqual({ status: 'ACTIVE' });
  });

  it('rechaza un estado que no existe o que falta', () => {
    expect(MaterialStatusUpdateSchema.safeParse({ status: 'BORRADO' }).success).toBe(false);
    expect(MaterialStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('descarta cualquier otro campo', () => {
    expect(MaterialStatusUpdateSchema.parse({ status: 'ACTIVE', rollPrice: 0 })).toEqual({ status: 'ACTIVE' });
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run (desde `calc3d-api/packages/shared`): `pnpm exec jest src/schemas/stock.spec.ts`
Expected: FAIL (`TS2305: Module './stock' has no exported member 'MaterialStatusUpdateSchema'`).

- [ ] **Step 3: Implementar**

En `stock.ts`, justo después de:

```ts
export type MaterialStatus = z.infer<typeof MaterialStatusSchema>;
```

agregar:

```ts

/**
 * Descontinuar o reactivar una ficha (`PATCH /materials/:id/status`). Va aparte
 * del formulario de la ficha a propósito: guardar un precio nunca cambia el estado.
 */
export const MaterialStatusUpdateSchema = z.object({ status: MaterialStatusSchema });
export type MaterialStatusUpdateDto = z.infer<typeof MaterialStatusUpdateSchema>;
```

- [ ] **Step 4: Subir la versión**

En `src/version.ts`: `SHARED_VERSION = '0.13.0'` → `SHARED_VERSION = '0.14.0'`.
En `package.json`: `"version": "0.13.0"` → `"version": "0.14.0"`.

- [ ] **Step 5: Compilar y verificar**

Run (desde `calc3d-api`):

```
pnpm --filter @calc3d/shared build
pnpm test:shared
```

Expected: build sin errores; todas las suites en verde (236 tests: 233 + 3).

---

### Task 2: API — `MaterialsService.setStatus` y el mensaje del 409

**Files:**
- Modify: `calc3d-api/apps/api/src/materials/materials.service.ts`
- Test: `calc3d-api/apps/api/src/materials/materials.service.spec.ts`

Depende de la Task 1 (tipo `MaterialStatusUpdateDto` compilado).

- [ ] **Step 1: Escribir los tests que fallan**

En `materials.service.spec.ts`, dentro de `makePrisma`, reemplazar:

```ts
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG } as { id: string } | null),
      delete: jest.fn().mockResolvedValue({}),
    },
```

por:

```ts
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG } as { id: string } | null),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
```

En el test `'una ficha con conteos en un mes cerrado no se borra'`, reemplazar:

```ts
    await expect(intento).rejects.toThrow('No se puede borrar');
```

por:

```ts
    // Desde que el panel deja descontinuar, el mensaje sugiere esa salida.
    await expect(intento).rejects.toThrow('Descontinuala en vez de borrarla');
```

Y agregar al final del archivo:

```ts
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
    // Simula la base: 'm1' existe solo en org-A.
    prisma.material.findFirst.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === 'm1' && where.organizationId === ORG ? { id: 'm1', organizationId: ORG } : null),
    );

    await expect(service(prisma).setStatus('org-B', 'm1', { status: 'DISCONTINUED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.material.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/materials/materials.service.spec.ts`
Expected: FAIL — `TS2339: Property 'setStatus' does not exist on type 'MaterialsService'` (y el 409 con el texto viejo).

- [ ] **Step 3: Implementar**

En `materials.service.ts`, reemplazar:

```ts
import type { MaterialDto } from '@calc3d/shared';
```

por:

```ts
import type { MaterialDto, MaterialStatusUpdateDto } from '@calc3d/shared';
```

Después del método `update`, agregar:

```ts

  /**
   * Descontinuar o reactivar. Una ficha descontinuada no se ofrece al cotizar ni
   * entra en la reposición, pero conserva sus compras y conteos: es la salida para
   * una ficha que no se puede borrar porque tiene conteos en meses cerrados.
   */
  async setStatus(organizationId: string, id: string, dto: MaterialStatusUpdateDto) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.material.update({ where: { id }, data: { status: dto.status } });
  }
```

Y reemplazar:

```ts
          `Esta ficha tiene conteos en meses cerrados (${mes}). No se puede borrar: se perderían esos conteos.`,
```

por:

```ts
          `Esta ficha tiene conteos en meses cerrados (${mes}). Descontinuala en vez de borrarla.`,
```

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `pnpm exec jest src/materials/materials.service.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Verificar el RED del IDOR**

Temporalmente, en `setStatus`, comentar `await this.ensureOwned(organizationId, id);`. Correr el test: `'una ficha de otra organización es 404 y no se escribe'` debe FALLAR. Restaurar la línea y volver a correr: PASS.

---

### Task 3: API — ruta `PATCH /materials/:id/status`

**Files:**
- Modify: `calc3d-api/apps/api/src/materials/materials.controller.ts`
- Create: `calc3d-api/apps/api/src/materials/materials.controller.spec.ts`

Depende de las Tasks 1 y 2.

- [ ] **Step 1: Escribir el test que falla**

Crear `materials.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MaterialSchema, MaterialStatusUpdateSchema } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MaterialsController } from './materials.controller';

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
    const pipe = new ZodValidationPipe(MaterialStatusUpdateSchema);

    expect(() => pipe.transform({ status: 'BORRADO' })).toThrow(BadRequestException);
    expect(pipe.transform({ status: 'DISCONTINUED' })).toEqual({ status: 'DISCONTINUED' });
  });

  it('crear o editar la ficha no puede cambiar el estado', () => {
    const alta = new ZodValidationPipe(MaterialSchema).transform({
      name: 'PLA Negro',
      rollPrice: 20,
      rollGrams: 1000,
      status: 'DISCONTINUED',
    }) as Record<string, unknown>;
    const edicion = new ZodValidationPipe(MaterialSchema.partial()).transform({
      rollPrice: 20,
      status: 'DISCONTINUED',
    }) as Record<string, unknown>;

    expect(alta).not.toHaveProperty('status');
    expect(edicion).toEqual({ rollPrice: 20 });
  });
});
```

Si `ZodValidationPipe.transform` tuviera otra firma, leer `apps/api/src/common/zod-validation.pipe.ts` y adaptar las llamadas (hoy recibe un solo argumento).

- [ ] **Step 2: Correrlo y verlo fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/materials/materials.controller.spec.ts`
Expected: FAIL — `TS2339: Property 'setStatus' does not exist on type 'MaterialsController'`.

- [ ] **Step 3: Implementar**

En `materials.controller.ts`, reemplazar:

```ts
import { MaterialSchema, type MaterialDto } from '@calc3d/shared';
```

por:

```ts
import {
  MaterialSchema,
  MaterialStatusUpdateSchema,
  type MaterialDto,
  type MaterialStatusUpdateDto,
} from '@calc3d/shared';
```

Y después del método `update`, agregar:

```ts

  /** Descontinuar o reactivar. Aparte del PATCH de la ficha: guardar el formulario no cambia el estado. */
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MaterialStatusUpdateSchema)) dto: MaterialStatusUpdateDto,
  ) {
    return this.service.setStatus(user.organizationId, id, dto);
  }
```

- [ ] **Step 4: Correr y verificar**

Run (desde `calc3d-api/apps/api`):

```
pnpm exec jest src/materials
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/materials
```

Expected: 2 suites en verde (12 tests); `tsc` y `eslint` sin errores.

---

### Task 4: API — comprar rollos reactiva la ficha (y solo la propia)

**Files:**
- Modify: `calc3d-api/apps/api/src/expenses/expenses.service.ts:78`, `:82-99`, `:127-134`
- Test: `calc3d-api/apps/api/src/expenses/expenses.service.spec.ts`

- [ ] **Step 1: Ajustar y escribir los tests que fallan**

En `expenses.service.spec.ts`, en `makePrisma`, reemplazar:

```ts
    material: { update: jest.fn() },
```

por:

```ts
    material: { update: jest.fn(), updateMany: jest.fn() },
```

Reemplazar el test entero `'una compra de filamento actualiza el precio del material'` por:

```ts
    it('una compra de filamento fija el precio del rollo y reactiva la ficha', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e1' });

      await service.create(ORG, {
        date: '2026-09-07',
        category: 'CONSUMABLE',
        description: 'Compra PLA',
        amount: 40,
        isInvestment: false,
        quantity: 2,
        materialId: 'm1',
      } as any);

      // Regresión de IDOR: la escritura sobre la ficha filtra por la organización
      // del token; con un materialId ajeno, updateMany no encuentra nada.
      expect(prisma.material.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', organizationId: ORG },
        data: { rollPrice: 20, status: 'ACTIVE' }, // 40 ÷ 2 rollos; comprarla la vuelve a activa
      });
      expect(prisma.material.update).not.toHaveBeenCalled();
    });
```

En los tests `'sin cantidad no se puede saber el precio por rollo: no lo toca'` y `'un gasto que no es de filamento no toca ningún catálogo'`, después de su `expect(prisma.material.update).not.toHaveBeenCalled();` agregar:

```ts
      expect(prisma.material.updateMany).not.toHaveBeenCalled();
```

Y dentro de `describe('ExpensesService.createWithDefinition', …)`, antes de su `});` final, agregar:

```ts
  it("modo 'existing' kind material con rollos: fija el precio y la reactiva", async () => {
    tx.material.findFirst.mockResolvedValue({ id: 'mat-9', organizationId: ORG });
    tx.expense.create.mockResolvedValue({ id: 'e-mat' });

    await service.createWithDefinition(ORG, {
      expense: {
        date: '2026-09-13',
        amount: 50,
        category: 'CONSUMABLE',
        description: 'Recompra PLA',
        isInvestment: false,
        quantity: 2,
      },
      link: { kind: 'material', mode: 'existing', id: 'mat-9' },
    } as any);

    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: 'mat-9' },
      data: { rollPrice: 25, status: 'ACTIVE' },
    });
  });
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/expenses/expenses.service.spec.ts`
Expected: FAIL en `'una compra de filamento fija el precio del rollo y reactiva la ficha'` (updateMany no llamado) y en `"modo 'existing' kind material con rollos…"` (`data` sin `status`).

- [ ] **Step 3: Implementar**

En `expenses.service.ts`, en `create`, reemplazar:

```ts
    await this.refreshRollPrice(dto.materialId, dto.quantity, dto.amount);
```

por:

```ts
    await this.refreshRollPrice(organizationId, dto.materialId, dto.quantity, dto.amount);
```

Reemplazar el método entero `refreshRollPrice` (desde su comentario `/**` hasta su `}`) por:

```ts
  /**
   * "La última compra manda": el precio del rollo con el que se cotiza es lo que
   * costó reponerlo la última vez. Lo fija el SERVIDOR y no una casilla del
   * formulario — si dependiera de que alguien la marque, el día que se olvide se
   * seguiría cotizando con un precio viejo, que es como se pierde margen sin
   * darse cuenta. Sin cantidad no hay precio por rollo que calcular.
   *
   * Comprar rollos de una ficha descontinuada la vuelve a ACTIVA: si se volvió a
   * comprar, se sigue manejando. `updateMany` con la organización: con el id de
   * una ficha ajena no escribe nada.
   */
  private async refreshRollPrice(
    organizationId: string,
    materialId: string | null | undefined,
    quantity: number | null | undefined,
    amount: number,
  ) {
    if (!materialId || !quantity || quantity <= 0) return;
    await this.prisma.material.updateMany({
      where: { id: materialId, organizationId },
      data: { rollPrice: purchaseCostPerRoll(amount, quantity), status: 'ACTIVE' },
    });
  }
```

En `createWithDefinition`, reemplazar:

```ts
      // Una compra de filamento fija el precio del rollo, sin depender de la
      // casilla de "usar como referencia" que manda el cliente.
      if (link.kind === 'material' && linkId && expense.quantity && expense.quantity > 0) {
        await model.update({
          where: { id: linkId },
          data: { rollPrice: purchaseCostPerRoll(expense.amount, expense.quantity) },
        });
      }
```

por:

```ts
      // Una compra de filamento fija el precio del rollo, sin depender de la
      // casilla de "usar como referencia" que manda el cliente, y reactiva la
      // ficha si estaba descontinuada. La ficha ya se validó como propia arriba.
      if (link.kind === 'material' && linkId && expense.quantity && expense.quantity > 0) {
        await model.update({
          where: { id: linkId },
          data: { rollPrice: purchaseCostPerRoll(expense.amount, expense.quantity), status: 'ACTIVE' },
        });
      }
```

- [ ] **Step 4: Correr y verificar**

Run (desde `calc3d-api/apps/api`):

```
pnpm exec jest src/expenses
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/expenses
```

Expected: PASS; `tsc` y `eslint` sin errores nuevos (el archivo spec ya usaba `as any`: si eslint marca warnings de `any` preexistentes, no cuentan).

- [ ] **Step 5: Verificar el RED del IDOR**

Temporalmente, en `refreshRollPrice`, quitar `organizationId` del `where`. Correr `pnpm exec jest src/expenses/expenses.service.spec.ts`: el test de la compra debe FALLAR. Restaurar y volver a correr: PASS.

---

### Task 5: Panel — sincronizar shared, calculadora y Gastos

**Files:**
- Modify (vía script): `calc3d-web/packages/shared/**`
- Modify: `calc3d-web/apps/web/src/features/calculator/useCatalogData.ts`
- Modify: `calc3d-web/apps/web/src/features/calculator/sections.tsx:122-124`
- Modify: `calc3d-web/apps/web/src/pages/Expenses.tsx:308-312`, `:495-506`

Depende de la Task 1.

- [ ] **Step 1: Sincronizar shared**

Run (desde `calc3d-web`):

```
pnpm sync:shared
pnpm --filter @calc3d/shared build
pnpm test:shared
```

Expected: `version: 0.13.0 → 0.14.0`; build limpio; mismo total de tests que en la API (236).

- [ ] **Step 2: El tipo de la ficha trae el estado**

En `useCatalogData.ts`, reemplazar:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface MaterialItem {
  id: string;
  name: string;
  rollPrice: string;
  rollGrams: number;
}
```

por:

```ts
import { useQuery } from '@tanstack/react-query';
import type { MaterialStatus } from '@calc3d/shared';
import { api } from '@/lib/api';

export interface MaterialItem {
  id: string;
  name: string;
  rollPrice: string;
  rollGrams: number;
  status: MaterialStatus;
}
```

- [ ] **Step 3: La calculadora no ofrece descontinuadas**

En `sections.tsx`, reemplazar:

```tsx
          <CatalogSelect
            items={c.catalogs.materials.data}
```

por:

```tsx
          <CatalogSelect
            // Una ficha descontinuada no se ofrece al cotizar. Lo ya cotizado no
            // cambia: elegir una ficha COPIA precio y gramos al trabajo.
            items={c.catalogs.materials.data?.filter((m) => m.status !== 'DISCONTINUED')}
```

- [ ] **Step 4: Gastos marca las descontinuadas y avisa que se reactivan**

En `Expenses.tsx`, reemplazar:

```tsx
  const { data: items = [] } = useQuery({
    queryKey: [listEndpoint],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>(`/${listEndpoint}`)).data,
    enabled: !!listEndpoint,
  });
```

por:

```tsx
  const { data: items = [] } = useQuery({
    queryKey: [listEndpoint],
    queryFn: async () =>
      (await api.get<{ id: string; name: string; status?: string }[]>(`/${listEndpoint}`)).data,
    enabled: !!listEndpoint,
  });
  const elegidaDescontinuada = items.find((i) => i.id === selectedId)?.status === 'DISCONTINUED';
```

Y reemplazar:

```tsx
          <Field label={`Elegir ${cfg?.singular ?? 'item'}`}>
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Elegir…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
```

por:

```tsx
          <Field label={`Elegir ${cfg?.singular ?? 'item'}`}>
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">Elegir…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.status === 'DISCONTINUED' ? ' (descontinuado)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {elegidaDescontinuada && type.perUnit && (
            <p className="text-xs text-muted-foreground">
              Esta ficha está descontinuada: al registrar la compra vuelve a estar activa.
            </p>
          )}
```

- [ ] **Step 5: Verificar**

Run (desde `calc3d-web/apps/web`):

```
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/features/calculator src/pages/Expenses.tsx
```

Expected: sin errores. Si `tsc` marca otro uso de `MaterialItem` sin `status` (p. ej. un objeto armado a mano), leer ese archivo y agregar `status: 'ACTIVE'` solo si es un objeto construido localmente; reportarlo.

---

### Task 6: Panel — Materiales con filtro, insignia y botón

**Files:**
- Modify: `calc3d-web/apps/web/src/features/catalogs/config.ts:43-45`, `:48-72`
- Modify: `calc3d-web/apps/web/src/pages/Catalog.tsx`

Depende de la Task 5 (shared sincronizado).

- [ ] **Step 1: Config**

En `config.ts`, reemplazar:

```ts
  /** Filtros a mostrar en la página (solo materiales por ahora). */
  filters?: Array<'brand' | 'type' | 'color' | 'date'>;
}
```

por:

```ts
  /** Filtros a mostrar en la página (solo materiales por ahora). */
  filters?: Array<'status' | 'brand' | 'type' | 'color' | 'date'>;
  /** true = botón Descontinuar / Reactivar por fila (`PATCH /:endpoint/:id/status`). */
  statusToggle?: boolean;
}
```

Y en `materials`, reemplazar:

```ts
    costDefinition: true,
    filters: ['brand', 'type', 'color', 'date'],
  },
```

por:

```ts
    costDefinition: true,
    filters: ['status', 'brand', 'type', 'color', 'date'],
    statusToggle: true,
  },
```

- [ ] **Step 2: Imports y estado en `Catalog.tsx`**

Reemplazar:

```tsx
import { Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
```

por:

```tsx
import { Archive, ArchiveRestore, Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MaterialStatus } from '@calc3d/shared';
```

Después del `const remove = useMutation({ … });` (termina en `onError: (error) => notify.error(apiErrorMessage(error)),\n  });`), agregar:

```tsx

  // Descontinuar / reactivar (solo catálogos con `statusToggle`). La reposición
  // del stock depende del estado, por eso se refrescan también esas consultas.
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MaterialStatus }) =>
      api.patch(`/${config.endpoint}/${id}/status`, { status }),
    onSuccess: (_data, { status }) => {
      for (const key of [config.endpoint, 'filament-stock', 'filament-summary']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      notify.success(status === 'DISCONTINUED' ? 'Ficha descontinuada' : 'Ficha reactivada');
    },
    onError: (error) => notify.error(apiErrorMessage(error)),
  });

  const toggleStatus = async (row: Row) => {
    const nombre = String(row.name ?? '');
    const descontinuar = row.status !== 'DISCONTINUED';
    const ok = await confirm(
      descontinuar
        ? {
            title: `¿Descontinuar «${nombre}»?`,
            description:
              'Deja de aparecer al cotizar y en la reposición. Sus compras y conteos no se tocan. Se reactiva sola al registrar una compra con rollos, o con «Reactivar».',
            confirmLabel: 'Descontinuar',
          }
        : {
            title: `¿Reactivar «${nombre}»?`,
            description: 'Vuelve a aparecer al cotizar y en la reposición.',
            confirmLabel: 'Reactivar',
          },
    );
    if (ok) setStatus.mutate({ id: row.id, status: descontinuar ? 'DISCONTINUED' : 'ACTIVE' });
  };
```

- [ ] **Step 3: Filtro Estado**

Reemplazar:

```tsx
  const [brandF, setBrandF] = usePersistentState(`catalog:${config.route}:brand`, '');
```

por:

```tsx
  // Arranca en Activas: una ficha descontinuada no se maneja día a día.
  const [statusF, setStatusF] = usePersistentState(`catalog:${config.route}:status`, 'ACTIVE');
  const [brandF, setBrandF] = usePersistentState(`catalog:${config.route}:brand`, '');
```

Reemplazar:

```tsx
  const visible = items.filter(
    (r) =>
      (!brandF || String(r.brand ?? '') === brandF) &&
```

por:

```tsx
  const visible = items.filter(
    (r) =>
      (!filters.includes('status') || !statusF || String(r.status ?? 'ACTIVE') === statusF) &&
      (!brandF || String(r.brand ?? '') === brandF) &&
```

Reemplazar:

```tsx
          {filters.includes('brand') && (
```

por:

```tsx
          {filters.includes('status') && (
            <Select className="w-40" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              <option value="ACTIVE">Activas</option>
              <option value="DISCONTINUED">Descontinuadas</option>
              <option value="">Todas</option>
            </Select>
          )}
          {filters.includes('brand') && (
```

- [ ] **Step 4: Insignia y botón en la fila**

Reemplazar:

```tsx
                      {config.columns.map((col) => (
                        <td key={col.key} className="px-4 py-3">
                          {col.computed === 'rolls' ? rollsOf(row) : fmt(row[col.key], col.kind)}
                        </td>
                      ))}
```

por:

```tsx
                      {config.columns.map((col, i) => (
                        <td key={col.key} className="px-4 py-3">
                          {col.computed === 'rolls' ? rollsOf(row) : fmt(row[col.key], col.kind)}
                          {i === 0 && row.status === 'DISCONTINUED' && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              descontinuado
                            </Badge>
                          )}
                        </td>
                      ))}
```

Y reemplazar:

```tsx
                          <Tooltip label="Eliminar">
```

por:

```tsx
                          {config.statusToggle && (
                            <Tooltip label={row.status === 'DISCONTINUED' ? 'Reactivar' : 'Descontinuar'}>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={setStatus.isPending}
                                onClick={() => toggleStatus(row)}
                                aria-label={`${row.status === 'DISCONTINUED' ? 'Reactivar' : 'Descontinuar'} ${String(row.name ?? '')}`}
                              >
                                {row.status === 'DISCONTINUED' ? (
                                  <ArchiveRestore className="h-4 w-4" />
                                ) : (
                                  <Archive className="h-4 w-4" />
                                )}
                              </Button>
                            </Tooltip>
                          )}
                          <Tooltip label="Eliminar">
```

- [ ] **Step 5: Verificar**

Run (desde `calc3d-web/apps/web`):

```
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/pages/Catalog.tsx src/features/catalogs
```

Expected: sin errores. Si `confirm(...)` no acepta la unión de objetos, tiparla: `const opciones: Parameters<typeof confirm>[0] = descontinuar ? {…} : {…};`.

---

### Task 7: Documentación

**Files:**
- Modify: `calc3d-api/CLAUDE.md`
- Modify: `calc3d-web/CLAUDE.md`
- Modify: `calc3d-api/docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`

- [ ] **Step 1: Ubicar los textos del mensaje viejo**

Run (desde la carpeta contenedora):

```
grep -n "No se puede borrar\|no tiene forma de descontinuar\|NO tiene forma de descontinuar\|no sugiere descontinuar" calc3d-api/CLAUDE.md calc3d-api/docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md calc3d-web/CLAUDE.md
```

- [ ] **Step 2: `calc3d-api/CLAUDE.md`**

En cada línea que devolvió el grep en este archivo:
- El texto del 409 pasa a: `Esta ficha tiene conteos en meses cerrados (agosto de 2026). Descontinuala en vez de borrarla.`
- Borrar la frase que dice que el panel no puede descontinuar una ficha (y su "por eso el mensaje no sugiere descontinuar").

Y justo después del bullet **"Cierre mensual del stock"** (termina con la línea del Spec `docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`), agregar:

```
  - **Activo / Descontinuado** (2026-09-13, shared 0.14.0) —
    `PATCH /materials/:id/status` con `MaterialStatusUpdateSchema`. Va APARTE del
    `PATCH /materials/:id`: `MaterialSchema` no tiene `status`, así que guardar el
    formulario nunca cambia el estado (fijado en `materials.controller.spec.ts`).
    Una ficha descontinuada no se ofrece al cotizar ni entra en la reposición, y
    conserva compras y conteos: es la salida para una ficha con conteos en meses
    cerrados que no se puede borrar. **Comprar rollos la reactiva**: en
    `ExpensesService` (`refreshRollPrice` y `createWithDefinition`) el mismo paso
    que fija `rollPrice` escribe `status: 'ACTIVE'`. ⚠️ `refreshRollPrice` usa
    `updateMany` con `organizationId`: antes hacía `update` por id y un gasto con
    el `materialId` de otra organización le cambiaba el precio a esa ficha.
    Spec: `docs/superpowers/specs/2026-09-13-estado-material-design.md`.
```

- [ ] **Step 3: Spec del cierre mensual**

En `2026-09-13-cierre-mensual-stock-design.md`, en las líneas del grep: el texto del 409 pasa a `…Descontinuala en vez de borrarla.` y agregar al lado, entre paréntesis, `(desde 2026-09-13 el panel deja descontinuar: ver 2026-09-13-estado-material-design.md)`.

- [ ] **Step 4: `calc3d-web/CLAUDE.md`**

En la sección `### Catálogos + registro de gastos (front)`, agregar al final de su lista:

```
- **Activo / Descontinuado** (2026-09-13, shared 0.14.0): en Materiales, filtro
  **Estado** que arranca en Activas (`catalog:materials:status`), insignia
  "descontinuado" y botón **Descontinuar / Reactivar** por fila con confirmación
  (`statusToggle` en `config.ts`, `PATCH /materials/:id/status`). El formulario
  de la ficha NO tiene estado. La **calculadora no ofrece** fichas descontinuadas
  (lo ya cotizado no cambia: se copian precio y gramos). En **Gastos** siguen
  visibles con "(descontinuado)" y **registrar una compra con rollos la
  reactiva** (lo hace el servidor). Cambiar el estado refresca también el stock
  y el resumen de filamento, porque la reposición depende de él.
```

Y en `### Control de filamento`, en el bullet de la **lista de reposición**, después de `Los descontinuados nunca entran.` agregar: ` Se descontinúan desde Materiales.`

- [ ] **Step 5: Checkpoint**

Run (desde la carpeta contenedora):

```
grep -n "No se puede borrar: se perderían" calc3d-api/CLAUDE.md calc3d-api/docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md
grep -n "Activo / Descontinuado" calc3d-api/CLAUDE.md calc3d-web/CLAUDE.md
```

Expected: el primero sin resultados; el segundo, una línea en cada archivo.

---

### Task 8: Verificación final

- [ ] **Step 1: Suites**

Run:

```
cd "C:/Users/evanan-it/Desktop/Todo/mio/calculadora 3d/calc3d-api" && pnpm test:shared
cd apps/api && pnpm exec jest src/materials src/expenses src/filament && pnpm exec tsc --noEmit -p tsconfig.json
cd "C:/Users/evanan-it/Desktop/Todo/mio/calculadora 3d/calc3d-web" && pnpm test:shared
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint src
```

Expected: todo en verde; mismo total de `test:shared` en los dos repos (236). `pnpm lint` de la API tiene 3 errores preexistentes en `sales`/`export` que no son de esta feature.

- [ ] **Step 2: Shared idéntico**

Run (desde la carpeta contenedora): `git diff --no-index calc3d-api/packages/shared/src calc3d-web/packages/shared/src`
Expected: sin diferencias de contenido (solo avisos de CRLF).

- [ ] **Step 3: Prueba en pantalla** (API en 3001 y panel en 5180; recargar la página tras reiniciar la API)

1. Materiales: arranca en **Activas**. Descontinuar una ficha → confirmación → desaparece de la lista; en **Descontinuadas** aparece con la insignia.
2. Calculadora → Filamento → "Elegir del catálogo…": la ficha no está.
3. Stock del mes: la ficha se ve con su insignia "descontinuado" y no aparece en la lista de reposición.
4. Gastos → Registrar gasto → Filamento → Del catálogo: la ficha aparece con "(descontinuado)" y, al elegirla, el aviso de que se reactiva. **No registrar la compra con datos reales** salvo que el dueño lo quiera; en su lugar, volver a Materiales → Descontinuadas → **Reactivar** → vuelve a Activas.
5. Borrar una ficha con conteos en agosto (cerrado) → toast con "Descontinuala en vez de borrarla". (Cancelar si la confirmación de borrado aparece antes: el 409 llega recién al confirmar; si se confirma, no se borra nada.)
6. Consola del navegador sin errores.

- [ ] **Step 4: Despliegue (solo con OK del dueño)**

API primero, panel después. Sin migración ni backup extra (no cambia el esquema). Si se invierte el orden, el botón de la fila da 404 con un toast; nada más se rompe.
