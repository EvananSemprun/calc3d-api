# Quitar la página Materiales — diseño

Fecha: 2026-09-14 · Repos: `calc3d-api` (API + shared canónico) y `calc3d-web` (panel).
Estado: aprobado por el dueño (ver §2).

## 1. Problema

La página **Filamento → Materiales** (`/catalogs/materials`) duplica lo que ya
muestran Compras y Stock del mes, y deja hacer cosas que no deberían poder hacerse:

- **Editar el precio del rollo a mano.** El precio sale de la compra ("la última
  compra manda"); una compra no cambia. Hoy hay tres caminos para pisarlo a mano:
  1. `PATCH /materials/:id` (el formulario de la página) acepta `rollPrice`.
  2. `POST /materials` crea una ficha con el precio que venga en el body.
  3. En Gastos, `POST /expenses/with-definition`:
     - con ficha existente, el "precio de referencia" (`referenceField`/`referenceValue`)
       escribe `rollPrice` si la compra no trae cantidad;
     - con ficha nueva, `link.data.rollPrice` es lo que escribió el usuario, y solo se
       corrige si la compra trae cantidad.
- **Borrar una ficha con compras.** `DELETE` solo mira conteos de meses cerrados;
  `Expense→Material` es `onDelete: SetNull`, así que borrarla deja compras huérfanas.
- **Al cotizar**, un filamento que cerró el último mes en 0 rollos (y no se volvió a
  comprar) aparece igual que uno con stock, sin ninguna señal.

## 2. Decisiones del dueño (2026-09-14)

| Pregunta | Decisión |
|---|---|
| ¿Qué pasa con la página? | **Se quita.** Descontinuar/Reactivar y la corrección de datos pasan a **Stock del mes**. |
| ¿Qué se puede editar? | **Solo nombre y color** (corregir tipeos). Marca, tipo, gramos y precio quedan fijos. Se le advirtió que un error en marca/tipo/gramos no tendrá arreglo desde la app; eligió igual. |
| ¿Cuándo se puede borrar? | **Solo sin historial**: sin ninguna compra ni ningún conteo. Con historial, se descontinúa. |
| Al cotizar, ¿filamento con 0 al último cierre? | **Aviso, sin ocultar**: sigue en la lista, al final, con "— 0 al cierre de agosto". |

Contexto aclarado: las compras con fecha 31/08/2026 son la carga inicial; un cierre de
agosto en 0 con compra ese día es correcto (p. ej. Amarillo girasol).

## 3. API (`calc3d-api`)

### 3.1 Shared (0.14.0 → 0.15.0)
- `schemas/stock.ts`: `MaterialCorrectionSchema = z.object({ name: z.string().trim().min(1, 'El nombre es obligatorio').optional(), color: z.string().trim().nullable().optional() })`
  y su tipo `MaterialCorrectionDto`. Sin `.strict()`: como el resto del proyecto, lo
  que no está en el schema se **descarta**.
- `StockCountRow` suma `canDelete: boolean` (la ficha no tiene compras ni conteos).
- `MaterialSchema` no cambia (lo siguen usando el onboarding y el alta desde Gastos).

### 3.2 `materials`
- `PATCH /materials/:id` valida con `MaterialCorrectionSchema` (antes
  `MaterialSchema.partial()`). Sigue con `ensureOwned` (404 si es ajena).
- **Se elimina `POST /materials`** (`create` del controller y del service). Las fichas
  nacen solo desde una compra en Gastos; `onboarding.module.ts` usa Prisma directo y
  no se toca.
- `DELETE /materials/:id`: si la ficha tiene **alguna** compra (`expense.count`) o
  **algún** conteo (`stockCount.count`, de cualquier mes), 409 y no se borra:
  - activa: `"Tiene compras o conteos registrados. Descontinuala en vez de borrarla."`
  - descontinuada: `"Tiene compras o conteos registrados: se conserva descontinuada."`
  Reemplaza el chequeo actual por meses cerrados (que queda cubierto: un conteo de un
  mes cerrado es "algún conteo").
- `GET /materials` suma por ficha `outAtLastClose: string | null` (`'AAAA-MM'`):
  - el mes = el último mes cerrado (`FilamentService.lastClosedMonth`, o la misma consulta);
  - es ese mes si la ficha **tiene fila de conteo** en ese mes con total 0 **y** no
    tiene compras con cantidad > 0 con fecha desde el primer día del mes siguiente;
  - en cualquier otro caso (sin meses cerrados, conteo > 0, compra posterior, o
    ficha sin fila en ese mes porque se creó después del cierre), `null`.
  - ⚠️ No se usa `createdAt`: las fichas se importaron en septiembre con compras
    fechadas el 31/08. Cerrar un mes escribe una fila por CADA ficha existente, así
    que "tiene fila" es la prueba de que existía al cierre.
  Las compras ya vienen en el `include` actual; se agrega la consulta de conteos del mes.

### 3.3 `filament`
- `stock()` calcula `canDelete` con `_count: { select: { expenses: true, stockCounts: true } }`
  en el `findMany` de materiales.

### 3.4 `expenses` — el precio del filamento sale solo de la compra
En `createWithDefinition`, cuando `link.kind === 'material'`:
- La compra **exige cantidad ≥ 1**: si no, `400 "Indicá cuántos rollos compraste"` y
  no se escribe nada.
- Modo existente: `referenceField`/`referenceValue` se **ignoran** (no 400: un panel
  viejo lo sigue mandando durante el deploy). El precio lo fija el bloque que ya existe
  (`purchaseCostPerRoll(amount, quantity)`).
- Modo nuevo: `rollPrice` se fija a `purchaseCostPerRoll(amount, quantity)` **antes**
  de validar `link.data` con `MaterialSchema`; lo que venga en `data.rollPrice` se pisa.
Impresoras e insumos no cambian.

`POST /expenses` (sin definición) ya calcula el precio con `refreshRollPrice` y sin
cantidad no lo toca: no cambia.

## 4. Panel (`calc3d-web`)

### 4.1 Quitar la página
- `AppLayout.tsx`: se quita el ítem "Materiales" del grupo Filamento.
- `CommandPalette.tsx`: se quita `p-mat`.
- `App.tsx`: `/catalogs/materials` → `<Navigate to="/filament/stock" replace />`
  (ruta explícita antes de `/catalogs/:resource`).
- `OnboardingChecklist.tsx`: el paso pasa a "Registrá tu primera compra de filamento",
  hint "En Gastos, tipo Filamento: la ficha se crea con el precio de la compra.", `to: '/expenses'`.
- `features/catalogs/config.ts`: la entrada `materials` se **conserva** (Gastos arma
  el alta de ficha con sus `fields`), pero sin el campo `rollPrice` en `fields` y sin
  `filters` ni `statusToggle`. Las propiedades de `CatalogConfig` que queden sin uso
  en ningún catálogo (`statusToggle`, `filters`, `computed: 'rolls'`) se borran del tipo.
- `pages/Catalog.tsx`: se borra el código que solo servía a materiales (filtro de
  estado, insignia, botón Descontinuar/Reactivar, aviso "Ver N descontinuadas",
  filtros de marca/tipo/color/fecha, columna de rollos) si ningún otro catálogo lo usa.

### 4.2 Gastos (`pages/Expenses.tsx`)
- Filamento, ficha existente: se oculta la casilla "Usar este precio como referencia
  para cotizar" y no se manda `referenceField`. En su lugar, texto: "El precio del
  rollo para cotizar queda en {monto ÷ cantidad}."
- Filamento, ficha nueva: el formulario ya no muestra "Precio del rollo" (sale de la
  config); mismo texto con el precio calculado.
- Impresoras e insumos siguen igual.

### 4.3 Stock del mes — la ficha
- En cada fila, la marca pasa a ser un botón (`aria-label="Ficha de {tipo color} {marca}"`)
  que abre **`FichaDialog`** (archivo nuevo `features/filament/FichaDialog.tsx`, con el
  `Dialog` de `components/overlays.tsx`). Funciona con el mes abierto o cerrado: cambia
  la ficha, no el conteo.
- Contenido:
  - Datos de solo lectura: tipo y marca (la fila del conteo no trae los gramos).
  - **Corregir**: Nombre (`Input`) y Color (`Combobox` `MATERIAL_COLOR`), botón
    "Guardar corrección" → `PATCH /materials/:id` con `{ name, color }`.
  - **Descontinuar / Reactivar** con la confirmación y los textos que hoy tiene
    Materiales → `PATCH /materials/:id/status`.
  - **Borrar ficha** solo si `row.canDelete`, con confirmación destructiva →
    `DELETE /materials/:id`. Si no se puede, texto: "Tiene compras o conteos: no se
    borra, se descontinúa."
  - Errores de la API con `notify.error(..., apiErrorMessage(e))`.
- Hooks nuevos en `features/filament/api.ts`: `useCorrectMaterial`,
  `useSetMaterialStatus`, `useDeleteMaterial`. Al terminar invalidan `['materials']`,
  `['filament-stock']`, `['filament-summary']` y `['filament-purchases']`.

### 4.3b Stock del mes — filtros (pedido del dueño, 2026-09-14)
- `FilterBar` con selects de **Color** (acotado al Tipo elegido), **Marca**, **Tipo**
  (los que hay en el conteo) y **Estado** (Todas / Activas / Descontinuadas,
  **arranca en Todas**), recordados en `filament:stock:color|brand|type|status`.
  (Al principio Color y Marca eran un buscador de texto; el dueño pidió selects.)
- ⚠️ Solo cambian lo que **se ve**. Cerrar el mes sigue mandando TODAS las fichas.
  Con fichas ocultas: aviso "Se ven X de Y fichas. Al cerrar el mes se guardan
  todas, también las ocultas." + "Quitar filtros", y la confirmación de cierre lo
  repite. Motivo de arrancar en Todas: una descontinuada con rollos oculta se
  cerraría en 0 sin verla.
- Grilla vacía por filtros: "Ninguna ficha coincide con los filtros."

### 4.4 Al cotizar (`features/calculator/sections.tsx` + `parts.tsx`)
- `MaterialItem` suma `outAtLastClose: string | null`.
- `CatalogSelect` acepta `labelOf?: (item: T) => string` (por defecto `item.name`).
- En Filamento: descontinuadas fuera (como hoy); las que tienen `outAtLastClose` van
  **al final**, con la etiqueta `"{nombre} — 0 al cierre de {mes}"` (mes en minúscula,
  sin año: "agosto").

## 5. Tests

**Seguridad (Nivel 1, TDD: se ven fallar antes del fix)** — `calc3d-api`:
1. `PATCH /materials/:id`: el pipe **real** de la ruta descarta `rollPrice`, `status`,
   `brand`, `type`, `rollGrams` y deja solo `name`/`color`.
2. `MaterialsController` no tiene ningún handler `POST` (metadata de Nest).
3. `createWithDefinition`, material existente con `referenceField: 'rollPrice'`,
   `referenceValue: 999`, `amount: 40`, `quantity: 2` → el precio queda en 20.
4. Material nuevo con `data.rollPrice: 999`, `amount: 40`, `quantity: 2` → se crea con 20.
5. Material (nuevo o existente) sin cantidad → 400 y ni ficha ni gasto escritos.
6. `DELETE` con una compra → 409 sin borrar; con un conteo de un mes **abierto** → 409.
7. `PATCH /materials/:id` sobre una ficha ajena → 404 sin escribir.

**Comportamiento**:
- `GET /materials` → `outAtLastClose`: 0 al cierre y sin compras después → mes;
  compra posterior → null; conteo > 0 → null; sin meses cerrados → null; ficha sin
  fila de conteo en el mes cerrado → null.
- `stock()` → `canDelete` true solo sin compras ni conteos.

**Panel**: `tsc` y `eslint` limpios; verificación en pantalla (escritorio y 375 px)
de Stock del mes con el diálogo, Gastos → Filamento y el selector de la calculadora.
`/catalogs/materials` redirige.

## 6. Deploy

Sin migración de base. Orden de siempre: **API primero, después el panel**.
Durante la ventana, el panel viejo: la página Materiales falla al crear (POST 404) y
al editar el precio lo ignora; Gastos sigue andando (el `referenceField` se ignora).

## 7. Fuera de alcance
- Editar una compra en Gastos (`PATCH /expenses/:id`) no recalcula el precio del rollo.
- La validación de pertenencia de fichas al crear/editar gastos (tarea aparte ya abierta).
- Ocultar de Stock del mes las fichas descontinuadas con 0.

## 8. Docs
`calc3d-api/CLAUDE.md` y `calc3d-web/CLAUDE.md`: reemplazar las menciones a la página
Materiales (líneas ~261, ~305, ~349, ~501, ~588) por la ficha en Stock del mes, la
regla "el precio del filamento sale solo de la compra" y el borrado solo sin historial.
