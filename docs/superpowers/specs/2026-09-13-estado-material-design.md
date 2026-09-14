# Activo / Descontinuado en las fichas de material — diseño

Fecha: 2026-09-13 · Repos: `calc3d-api` (API + shared canónico) y `calc3d-web` (panel).
Estado: aprobado por el dueño (visibilidad, acción y lista, ver §2).

## 1. Problema

La base ya tiene `Material.status` (`ACTIVE` | `DISCONTINUED`, default `ACTIVE`) y
la reposición ignora las descontinuadas, pero **nada en la app deja cambiarlo**:

- `MaterialSchema` (shared) no tiene `status`: `POST`/`PATCH /materials` lo descartan.
- Solo `import-filamento.mjs` pone `DISCONTINUED`.
- Desde el cierre mensual del stock, borrar una ficha con conteos en un mes
  cerrado da **409** (`materials.service.ts`). Sin forma de descontinuarla, una
  ficha vieja queda para siempre en Materiales, en la calculadora y en Gastos.

## 2. Decisiones del dueño (2026-09-13)

| Pregunta | Decisión |
|---|---|
| ¿Dónde aparecen las descontinuadas? | **Ocultas al cotizar** (calculadora). En Gastos siguen visibles, marcadas, y **registrar una compra con rollos la reactiva**. |
| ¿Cómo se cambia el estado? | **Botón en la fila** de Materiales ("Descontinuar" / "Reactivar"), con confirmación. No es un campo del formulario de edición. |
| ¿Qué muestra Materiales por defecto? | **Solo activas**: filtro "Estado" que arranca en Activas y se recuerda. |

## 3. Comportamiento

### 3.1 Materiales (`/catalogs/materials`)
- Filtro **Estado**: `Activas` (default) / `Descontinuadas` / `Todas`, persistido en
  localStorage (`catalog:materials:status`), junto a marca / tipo / color / fecha.
- En la fila, una insignia `descontinuado` (Badge outline, sin colores fuera de la
  paleta) cuando corresponde.
- Acción por fila, entre Editar y Eliminar:
  - Ficha activa → **Descontinuar** (ícono `Archive`). Confirmación: *"¿Descontinuar
    «nombre»? Deja de aparecer al cotizar y en la reposición. Sus compras y conteos
    no se tocan. Se reactiva sola al registrar una compra, o con «Reactivar»."*
  - Ficha descontinuada → **Reactivar** (ícono `ArchiveRestore`), confirmación simple.
  - Tras el cambio: toast de éxito e invalidación de `['materials']`,
    `['filament-stock']` y `['filament-summary']` (la reposición depende del estado).
- La acción se habilita por config (`statusToggle: true` en `features/catalogs/config.ts`,
  solo en `materials`); los otros catálogos no cambian.

### 3.2 Calculadora
- El selector de filamento (`SectionFilamento` → `CatalogSelect`) **no lista**
  fichas `DISCONTINUED`.
- No rompe nada guardado: elegir una ficha **copia** nombre, precio y gramos al
  `CalcInput`; productos y pedidos no referencian la ficha.

### 3.3 Gastos → tipo Filamento
- El selector de ficha existente (`Expenses.tsx`, modo "Del catálogo") sigue
  listando todas; las descontinuadas con el sufijo **" (descontinuado)"**, y al
  elegir una se avisa que registrar la compra la reactiva. (El otro selector de
  ese modal es el de impresoras del mantenimiento: no cambia.)
- **Registrar un gasto que enlace la ficha con `quantity > 0` (en la práctica,
  uno de filamento) la deja `ACTIVE`**, en el mismo paso donde hoy se fija
  `rollPrice` ("la última compra manda"). Un gasto sin cantidad (ajuste) no
  cambia el estado.
- Cubre los dos caminos de alta: `ExpensesService.create` (`refreshRollPrice`) y
  `createWithDefinition` (ficha existente o nueva; la nueva ya nace `ACTIVE`).
- Editar un gasto existente **no** reactiva (hoy tampoco actualiza `rollPrice`).

### 3.4 Borrar una ficha con conteos en meses cerrados
El 409 vuelve a sugerir la salida, ahora posible:
`Esta ficha tiene conteos en meses cerrados (agosto de 2026). Descontinuala en vez de borrarla.`

### 3.5 Lo que NO cambia
- Stock del mes: las descontinuadas se siguen mostrando (con su insignia) y se
  cuentan al cerrar; la reposición ya las excluye (`restockByColor`).
- El formulario de edición de la ficha no tiene campo de estado.
- Sin migración: la columna existe.

## 4. API

### 4.1 Contrato (shared → 0.14.0)
En `packages/shared/src/schemas/stock.ts`, junto a `MaterialStatusSchema`:

```ts
/** Cambiar el estado de una ficha de material (`PATCH /materials/:id/status`). */
export const MaterialStatusUpdateSchema = z.object({ status: MaterialStatusSchema });
export type MaterialStatusUpdateDto = z.infer<typeof MaterialStatusUpdateSchema>;
```

`MaterialSchema` **no** gana `status`: guardar el formulario nunca cambia el estado.
Sube `SHARED_VERSION` y el `version` de `packages/shared/package.json` a 0.14.0;
el panel sincroniza con `pnpm sync:shared`.

### 4.2 `PATCH /materials/:id/status`
- Body `MaterialStatusUpdateSchema` vía `ZodValidationPipe` → estado inválido = **400**.
- `MaterialsService.setStatus(organizationId, id, dto)`: `ensureOwned` (ficha ajena o
  inexistente = **404**, igual que `update`/`remove`) y `material.update({ status })`.
  Devuelve la ficha actualizada.
- Mismo `@UseGuards(JwtAuthGuard)` de clase del controller.
- Va junto a `update` en el controller. El orden no importa: `:id/status` tiene
  un segmento más que `:id`, así que Nest no las confunde.

### 4.3 Reactivación al comprar
- `createWithDefinition`: el `model.update` que fija `rollPrice` pasa a
  `data: { rollPrice, status: 'ACTIVE' }` (ya corre dentro de la transacción y la
  ficha ya se validó como propia).
- `refreshRollPrice` (camino `create`): hoy hace
  `material.update({ where: { id: materialId } })` **sin filtrar por organización**,
  así que un gasto con el `materialId` de otra organización le cambiaría el precio
  (y con este cambio, el estado). Pasa a
  `material.updateMany({ where: { id: materialId, organizationId }, data: { rollPrice, status: 'ACTIVE' } })`
  — con un id ajeno no escribe nada. (La creación del gasto con un `materialId`
  ajeno es un tema aparte del módulo de gastos; acá solo se cierra la escritura
  sobre la ficha.)

### 4.4 Mensaje del 409
`materials.service.ts`: `…(${mes}). Descontinuala en vez de borrarla.` y el test
`materials.service.spec.ts` busca `'Descontinuala'` en vez de `'No se puede borrar'`.

## 5. Panel

- `features/catalogs/config.ts`: `statusToggle?: boolean` en `CatalogConfig`
  (`materials: statusToggle: true`) y `'status'` en `filters`.
- `pages/Catalog.tsx`: filtro Estado (§3.1), insignia en la fila, botón con
  `useConfirm`, mutación `api.patch(`/${endpoint}/${id}/status`, { status })`,
  `notify.success/error(apiErrorMessage)`. Botón con `aria-label` y `Tooltip`.
  Deshabilitado mientras la mutación está pendiente.
- `features/calculator/useCatalogData.ts`: `MaterialItem.status?: MaterialStatus`;
  `sections.tsx` filtra `status !== 'DISCONTINUED'` antes de pasar a `CatalogSelect`.
- `pages/Expenses.tsx`: sufijo " (descontinuado)" en las dos listas de fichas.
- Tipos desde shared (`MaterialStatus`, `MaterialStatusUpdateDto`).

## 6. Pruebas

API (jest, TDD):
- `materials.controller.spec.ts` / `materials.service.spec.ts`:
  - `setStatus` descontinúa y reactiva la ficha propia.
  - **IDOR**: `setStatus` sobre una ficha de otra organización → `NotFoundException` y
    `material.update` no se llama (el mock de `findFirst` filtra por `organizationId`).
  - Pipe real: `{ status: 'BORRADO' }` → `BadRequestException`; `{ status: 'DISCONTINUED' }` pasa.
  - **Mass-assignment**: `ZodValidationPipe(MaterialSchema)` sobre `{ ...ficha, status: 'DISCONTINUED' }`
    devuelve un objeto **sin** `status` (el formulario no puede cambiarlo).
  - 409 con el texto nuevo.
- `expenses.service.spec.ts`:
  - `create` con `materialId` y `quantity > 0` → `updateMany` con `{ id, organizationId }`
    y `data` con `rollPrice` y `status: 'ACTIVE'`.
  - `create` sin cantidad → no toca la ficha (test existente, ajustado a `updateMany`).
  - `createWithDefinition` existente con cantidad → `update` con `status: 'ACTIVE'`.
- `pnpm test:shared` en verde en los dos repos (mismo total).

Panel: `tsc --noEmit` y `eslint` limpios; prueba en pantalla: descontinuar una ficha
→ desaparece de Materiales (Activas) y de la calculadora, aparece en Descontinuadas y
en Gastos con el sufijo; registrar una compra con rollos → vuelve a Activas.

## 7. Despliegue

1. API primero (ruta nueva + reactivación). Un panel viejo sigue funcionando igual.
2. Panel después. Si se invierte, el botón da 404 con un toast de error; nada más se rompe.
3. Sin migración ni backup extra (no cambia el esquema). El orden de siempre:
   `pnpm sync:shared` en web antes de desplegar el panel.

## 8. Fuera de alcance

- Crear un gasto con un `materialId`/`printerId`/`componentId` de otra organización
  (validación de pertenencia en `ExpensesService.create`): se anota como tarea aparte.
- Estado para impresoras o insumos.
- Ocultar descontinuadas en Compras / Análisis de filamento (son historia).
