# Subcategorías de tienda — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una categoría de la tienda pueda tener una categoría madre, para que el catálogo de 500–1.000 productos se pueda navegar en dos niveles.

**Architecture:** `StoreCategory` gana una auto-relación `parentId` nullable. El árbol **no** se arma en la base ni con una consulta recursiva: la lista plana sigue viajando como hoy y una **función pura en `packages/shared`** la anida. Así hay **una sola definición** del árbol, que usan el panel y la tienda — el patrón de `deudaPorProveedor` y `groupPurchases`.

**Tech Stack:** NestJS + Prisma (PostgreSQL 18) · Zod en `packages/shared` · React 19 + TanStack Query + shadcn en `calc3d-web` · jest (api, shared) · vitest (web).

**Spec:** `calc3d-landing/docs/superpowers/specs/2026-11-07-rediseno-tienda-design.md`, §4.1.

---

## Global Constraints

- **Dos niveles, no más.** Una categoría con madre **no puede** ser madre. Se valida en el servidor y tiene test. Razón: las rutas de la tienda son `/tienda/<cat>/<sub>/`; profundidad libre las vuelve impredecibles.
- **El slug sigue siendo único por ORGANIZACIÓN**, no por madre. `StoreBanner.linkValue` guarda el slug suelto y `assertLink` lo busca solo por slug (`store-banners.service.ts:77-91`): si dos subcategorías pudieran compartir slug, ese destino queda ambiguo. Dos subcategorías llamadas «Autos» conviven: la segunda recibe `autos-2` por `uniqueCategorySlug`, que ya existe.
- **`parentId` es NULLABLE y sin `DEFAULT`.** Doctrina del repo (la lección de `paidBy`).
- **`packages/shared` se edita SOLO en `calc3d-api`.** En `calc3d-web` se trae con `pnpm sync:shared`. Subir `SHARED_VERSION` y el `version` del `package.json` a la par en los dos repos.
- **Orden de despliegue: API primero, panel después.** No se pushea nada (un push a `main` es un despliegue); se commitea por tarea.
- **Idioma:** mensajes de error, comentarios y UI en español.
- **Nada de `createTestingModule`.** Este repo instancia los servicios a mano: `new StoreService(prisma as never, ...)`. Mock de Prisma que **filtra sobre arrays**, al estilo de `apps/api/src/store/store-banners.service.spec.ts`.
- **Los tests afirman el MENSAJE del error**, no solo la clase, y cada test de aislamiento lleva su **hermano alcanzable**.

---

## Review Focus

Cinco cosas que el spec implica y que ninguna tarea testearía por su cuenta. Cada una tiene su test asignado a la tarea que es dueña del código.

1. **Un `PATCH` con `parentId` que no se persiste.** `updateCategory` escribe literalmente `{ name, slug }` (`store.service.ts:342`) y el hook del panel manda solo `{ name }` (`features/store/api.ts:133`). Son dos puntos donde el campo desaparece sin error. → Tareas 3 y 5.
2. **Un ciclo o un tercer nivel.** Hacer a una categoría madre de sí misma, o colgar una subcategoría de otra subcategoría. → Tarea 3.
3. **Borrar una categoría que tiene hijas.** Hoy `removeCategory` borra sin preguntar y las fichas caen a `categoryId: null` por el `SetNull`; las hijas quedarían huérfanas apuntando a un `parentId` que ya no existe. → Tarea 3.
4. **`GET /public/store/products?category=<slug de la madre>` que no trae las hijas.** El filtro es coincidencia exacta de slug (`store-public.service.ts:209`). Pedir «Llaveros» devolvería cero si todos los productos cuelgan de «Llaveros › Autos». → Tarea 4.
5. **Dos subcategorías con el mismo nombre bajo madres distintas.** El panel valida el duplicado de forma **global** (`StoreCategoriesModal.tsx:47`) y la vitrina filtra por **nombre**, no por id (`pages/Store.tsx:55`): las dos «Autos» colapsarían en una sola opción y mezclarían productos. → Tareas 6 y 8.

---

## Estructura de archivos

**`calc3d-api`**
- Crear: `packages/shared/src/calc/categorias-arbol.ts` — la función pura del árbol.
- Crear: `packages/shared/src/calc/categorias-arbol.spec.ts`
- Crear: `packages/shared/src/schemas/categoria-madre.spec.ts` — regresión del contrato.
- Crear: `apps/api/prisma/migrations/20261108120000_categoria_con_madre/migration.sql`
- Crear: `apps/api/src/store/store-categorias.service.spec.ts` — la red que hoy no existe.
- Modificar: `packages/shared/src/schemas/store.ts:178-184` · `packages/shared/src/index.ts` · `packages/shared/src/version.ts` · `packages/shared/package.json`
- Modificar: `apps/api/prisma/schema.prisma:791-807`
- Modificar: `apps/api/src/store/store.service.ts:317-350`
- Modificar: `apps/api/src/store-public/store-public.service.ts:151-158` y `:204-225`
- Modificar: `apps/api/src/store-public/store-public.service.spec.ts`

**`calc3d-web`** (después de que la API esté lista)
- Modificar: `apps/web/src/features/store/api.ts:47-52` y `:114-145`
- Modificar: `apps/web/src/features/store/StoreCategoriesModal.tsx`
- Modificar: `apps/web/src/pages/StoreProductDetail.tsx:430-456`
- Modificar: `apps/web/src/pages/Store.tsx:45-58` y `:152-166`
- Crear: `apps/web/src/features/store/StoreCategoriesModal.spec.tsx`
- Crear: `apps/web/src/pages/Store.filtro-categoria.spec.tsx`

---

### Task 1: La función pura del árbol y el contrato

**Files:**
- Create: `packages/shared/src/calc/categorias-arbol.ts`
- Create: `packages/shared/src/calc/categorias-arbol.spec.ts`
- Create: `packages/shared/src/schemas/categoria-madre.spec.ts`
- Modify: `packages/shared/src/schemas/store.ts:178-184`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/version.ts`, `packages/shared/package.json`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export interface CategoriaPlana { id: string; name: string; slug: string; position: number; parentId?: string | null }
  export interface CategoriaConHijas<T extends CategoriaPlana = CategoriaPlana> { categoria: T; hijas: T[] }
  export function arbolDeCategorias<T extends CategoriaPlana>(planas: T[]): CategoriaConHijas<T>[]
  export function descendientesDe<T extends CategoriaPlana>(planas: T[], id: string): T[]
  // StoreCategorySchema gana: parentId: z.string().nullable().optional()
  ```

- [ ] **Step 1: Escribir los tests que fallan**

En `categorias-arbol.spec.ts`, con `arbolDeCategorias`:
```ts
it('anida cada hija bajo su madre, en orden de position y después por nombre');
it('una categoría cuya madre no existe en la lista sube a la raíz'); // dato roto ⇒ visible, no perdida
it('ignora un parentId que apunta a sí misma'); // sube a la raíz, no desaparece
it('devuelve [] con una lista vacía');
```
Con `descendientesDe`: `it('devuelve las hijas directas de una madre')`, `it('devuelve [] para una hoja')` y `it('devuelve [] si el id no existe')`.

En `categoria-madre.spec.ts`, contra `StoreCategorySchema`:
```ts
it('acepta parentId con un id');
it('acepta parentId null (mover a la raíz)');
it('acepta que parentId no venga');
it('rechaza parentId numérico');
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd calc3d-api && pnpm test:shared`
Expected: FAIL, «Cannot find module './calc/categorias-arbol'».

- [ ] **Step 3: Implementar**

`arbolDeCategorias` recorre la lista **una vez** armando un índice por id y después reparte; no usa recursión (hay dos niveles). Orden: `position` asc, desempate `name` con `localeCompare(a, b, 'es')`, igual que `listCategories`. Una hija cuyo `parentId` no resuelve —o que se apunta a sí misma— se trata como raíz: perder una categoría por un dato roto es peor que mostrarla fuera de lugar.

En `schemas/store.ts`, agregar a `StoreCategorySchema` el campo `parentId: z.string().nullable().optional()`. ⚠️ `nullable` **y** `optional` son cosas distintas acá y las dos hacen falta: `null` significa «movela a la raíz» y ausente significa «no la toques».

Exportar en `index.ts`. Subir `SHARED_VERSION` y el `version` del `package.json` a **0.65.0**.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd calc3d-api && pnpm test:shared`
Expected: PASS.

- [ ] **Step 5: Validar un test rompiéndolo**

Invertir el desempate de orden (`name` descendente). La mutación **tiene que compilar**. Expected: al menos 1 test en rojo. Restaurar con **copia `cp`, nunca con `git checkout --`**.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): arbol de categorias y parentId en el contrato"
```

---

### Task 2: La migración

**Files:**
- Create: `apps/api/prisma/migrations/20261108120000_categoria_con_madre/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:791-807`

**Interfaces:**
- Produces: `StoreCategory.parentId String?`, relación `madre`/`hijas`, índice `StoreCategory_parentId_idx`.

- [ ] **Step 1: Escribir el SQL**

Cabecera de comentarios en español que explique **por qué** (el estilo del repo), después:
```sql
ALTER TABLE "StoreCategory" ADD COLUMN "parentId" TEXT;
CREATE INDEX "StoreCategory_parentId_idx" ON "StoreCategory"("parentId");
ALTER TABLE "StoreCategory" ADD CONSTRAINT "StoreCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "StoreCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
⚠️ **`ON DELETE RESTRICT`, no `CASCADE` ni `SET NULL`.** `CASCADE` borraría las hijas en silencio al borrar la madre; `SET NULL` las subiría a la raíz sin que nadie lo haya pedido. Con `RESTRICT`, la base es la última línea y el servicio da el mensaje (Tarea 3).
⚠️ **Nullable y sin `DEFAULT`**: las categorías que ya existen son raíces y eso es lo que `NULL` dice.

- [ ] **Step 2: Reflejarlo en `schema.prisma`**

Dentro de `model StoreCategory`, agregar:
```prisma
  parent   StoreCategory?  @relation("CategoriaMadre", fields: [parentId], references: [id], onDelete: Restrict)
  parentId String?
  children StoreCategory[] @relation("CategoriaMadre")
```
y `@@index([parentId])`. **No tocar** `@@unique([organizationId, slug])`.

- [ ] **Step 3: Aplicarla en local y verificar**

Run: `cd calc3d-api/apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: aplica 1 migración, sin fallidas.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): StoreCategory con madre (migracion)"
```

---

### Task 3: El servicio del panel persiste y valida la madre

**Files:**
- Create: `apps/api/src/store/store-categorias.service.spec.ts`
- Modify: `apps/api/src/store/store.service.ts:317-350`

**Interfaces:**
- Consumes: `StoreCategoryDto` (Tarea 1), ahora con `parentId`.
- Produces: `createCategory` y `updateCategory` persisten `parentId`; `removeCategory` corta si hay hijas. Firmas sin cambios.

- [ ] **Step 1: Escribir los tests que fallan**

Mock de Prisma que filtra sobre arrays, copiando el andamio de `store-banners.service.spec.ts`.
```ts
describe('Categorías — la madre se persiste')
  it('createCategory guarda el parentId que vino en el dto');
  it('⚠️ updateCategory guarda el parentId: hoy escribe solo { name, slug }'); // Review Focus 1
  it('updateCategory con parentId null mueve la categoría a la raíz');
  it('updateCategory SIN parentId no toca la madre que ya tenía');
describe('Categorías — dos niveles y nada de ciclos')          // Review Focus 2
  it('rechaza colgar una categoría de sí misma');
  it('rechaza colgar una categoría de una que ya tiene madre');  // tercer nivel
  it('rechaza darle madre a una categoría que ya tiene hijas');
  it('acepta colgar una hoja de una raíz (hermano alcanzable)');
describe('Categorías — borrar')                                 // Review Focus 3
  it('rechaza borrar una categoría con hijas, nombrando cuántas son');
  it('borra una categoría sin hijas (hermano alcanzable)');
describe('Categorías — aislamiento por organización')
  it('rechaza una madre de OTRA organización');
  it('acepta una madre de la propia organización (hermano alcanzable)');
```
Cada `rejects` afirma el **mensaje**, no solo la clase.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api test -- store-categorias`
Expected: FAIL.

- [ ] **Step 3: Implementar en `store.service.ts`**

Método privado nuevo:
```ts
private async assertMadreValida(organizationId: string, id: string | null, parentId: string | null | undefined): Promise<void>
```
Corta, en este orden, con `BadRequestException` y mensaje propio: madre igual a la categoría; madre inexistente o de otra organización (reusar `assertCategory`); madre que ya tiene madre («solo se admiten dos niveles»); y, si la categoría ya tiene hijas, no puede recibir madre.

En `createCategory`, pasar `parentId: dto.parentId ?? null` al `data`.
En `updateCategory`, agregar al `data` **solo si `dto.parentId !== undefined`**, para que un PATCH que no lo manda no lo borre.
En `removeCategory`, antes del `delete`, contar hijas y lanzar `BadRequestException` nombrando cuántas son.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api test`
Expected: PASS, y los 881 anteriores siguen verdes.

- [ ] **Step 5: Validar un test rompiéndolo**

Sacar `parentId` del `data` de `updateCategory` (la mutación compila). Expected: el test del Review Focus 1 en rojo. Restaurar con copia.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/store
git commit -m "feat(api): la categoria guarda su madre, con dos niveles y sin ciclos"
```

---

### Task 4: El endpoint público expone el árbol y el filtro incluye las hijas

**Files:**
- Modify: `apps/api/src/store-public/store-public.service.ts:151-158` y `:204-225`
- Modify: `apps/api/src/store-public/store-public.service.spec.ts`

**Interfaces:**
- Produces: `GET /api/public/store/categories` → `{ categories: [{ name, slug, parentSlug }] }` (plana, con el puntero; el árbol lo arma `arbolDeCategorias` del lado del consumidor). `GET /api/public/store/products?category=<slug>` incluye los productos de las subcategorías.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('categories() devuelve parentSlug de cada categoría, y null en las raíces');
it('⚠️ categories() NO filtra por lista blanca de más: sigue sin id, organizationId ni position');
it('list() con el slug de una madre trae los productos de sus hijas');  // Review Focus 4
it('list() con el slug de una hija trae solo los suyos (hermano alcanzable)');
it('list() sin categoría los trae todos');
```
El primero de lista blanca reusa la constante `PROHIBIDOS` y `clavesDe` que ya están en ese spec (líneas 120-135).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api test -- store-public`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `categories()`: ampliar el `select` a `{ name: true, slug: true, parent: { select: { slug: true } } }` y mapear a `{ name, slug, parentSlug: c.parent?.slug ?? null }`. ⚠️ **No exponer `id` ni `parentId`**: la lista blanca de este módulo es la regla, y el slug alcanza para la ruta pública. Declarar el tipo de retorno, que hoy falta: `Promise<{ categories: PublicCategory[] }>`, con `PublicCategory` ampliado con `parentSlug: string | null`.

En `list(categorySlug?)`: cambiar el `where` de coincidencia exacta por «esa categoría **o** las que la tienen de madre»:
```ts
{ category: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] } }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api test`
Expected: PASS.

- [ ] **Step 5: Validar un test rompiéndolo**

Volver el `where` de `list()` a la coincidencia exacta. Expected: el test del Review Focus 4 en rojo. Restaurar con copia.

- [ ] **Step 6: Verificación final de la API y commit**

Run: `cd calc3d-api && pnpm -r build && pnpm -r lint && pnpm -r test`
Expected: todo verde.
```bash
git add apps/api/src/store-public
git commit -m "feat(api): la tienda publica expone la madre y el filtro incluye las hijas"
```

---

### Task 5: El panel transporta `parentId` sin perderlo

**Files:**
- Modify: `calc3d-web/apps/web/src/features/store/api.ts:47-52` y `:114-145`

**Interfaces:**
- Consumes: el contrato de la Tarea 1.
- Produces:
  ```ts
  interface StoreCategory { id: string; name: string; slug: string; position: number; parentId: string | null }
  useCreateStoreCategory(): mutationFn (dto: { name: string; parentId?: string | null })
  useUpdateStoreCategory(): mutationFn ({ id, name, parentId }: { id: string; name: string; parentId?: string | null })
  ```

- [ ] **Step 1: Traer shared y verificar**

Run: `cd calc3d-web && pnpm sync:shared && pnpm test:shared`
Expected: PASS, `SHARED_VERSION` en `0.65.0` en los dos repos.

- [ ] **Step 2: Escribir el test que falla**

⚠️ **Corregido el 2026-11-07 tras la revisión de esta tarea.** La primera versión
pedía «al renombrar, el PATCH incluye el `parentId`», y eso **contradice la restricción
global** de este mismo plan: un PATCH que no manda `parentId` no debe tocar la madre.
Reenviar el `parentId` cacheado en un renombrado pisa con un valor viejo la madre que
otra sesión pudo cambiar — y en una raíz reenvía `null`, que es una **orden de mover**,
no un no-op. Mover de madre es una acción explícita (Tarea 6), no un efecto colateral de
renombrar.

Tests al nivel del hook, en `apps/web/src/features/store/StoreCategoriesModal.spec.tsx`
(archivo nuevo, se completa en la Tarea 6):
```tsx
it('renombrar NO manda parentId: el cuerpo del PATCH no trae la clave');
it('mover manda parentId con su valor');
it('mover a la raíz manda parentId: null');
```
⚠️ El primero **no** se puede afirmar con `toHaveBeenCalledWith`: trata `parentId:
undefined` igual que la clave ausente. Hay que mirar el cuerpo real:
`expect('parentId' in cuerpo).toBe(false)`.

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm test -- --project dom StoreCategoriesModal`
Expected: FAIL, el cuerpo del PATCH no trae `parentId`.

- [ ] **Step 4: Implementar**

Agregar `parentId: string | null` a la interfaz `StoreCategory`. En `useCreateStoreCategory` y `useUpdateStoreCategory`, ampliar el DTO inline y **mandar `parentId` explícitamente** en el cuerpo. ⚠️ Es el punto exacto donde el campo se perdía: `useUpdateStoreCategory` desestructuraba `{ id, name }` y mandaba `{ name }`.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `cd calc3d-web && pnpm test -- --project dom StoreCategoriesModal`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/store/api.ts packages/shared
git commit -m "feat(web): los hooks de categoria llevan la madre"
```

---

### Task 6: El gestor de categorías muestra y edita el árbol

**Files:**
- Modify: `calc3d-web/apps/web/src/features/store/StoreCategoriesModal.tsx`
- Modify: `calc3d-web/apps/web/src/features/store/StoreCategoriesModal.spec.tsx`

**Interfaces:**
- Consumes: hooks de la Tarea 5; `arbolDeCategorias` de shared.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('lista las hijas debajo de su madre, sangradas');
it('el alta permite elegir una categoría madre y la manda en el POST');
it('el selector de madre NO ofrece una categoría que ya tiene madre');  // dos niveles
it('⚠️ dos subcategorías con el mismo nombre bajo madres distintas se permiten'); // Review Focus 5
it('sigue rechazando dos hermanas con el mismo nombre');
it('al borrar una categoría con hijas, avisa y no llama al DELETE');
```
Montar con `QueryClientProvider` + `TooltipProvider` + **`ConfirmProvider`** (el modal usa `useConfirm`).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd calc3d-web && pnpm test -- --project dom StoreCategoriesModal`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Pintar con `arbolDeCategorias`: cada madre y debajo sus hijas con sangría y un prefijo visual. Agregar al formulario de alta un `Select` «Categoría madre» con `<option value="">Ninguna (categoría principal)</option>` más las raíces. ⚠️ **El `Select` del repo ignora `<optgroup>`**: la jerarquía va en el texto de la `<option>`. A partir de 8 opciones se convierte solo en el buscable; no hay que hacer nada para eso.

⚠️ **Cambiar la validación de duplicado**: hoy es global (`categories.some(c => c.name.toLowerCase() === …)`, línea 47). Pasa a comparar **solo entre hermanas**, porque «Autos» bajo Llaveros y «Autos» bajo Figuras son dos cosas distintas y legítimas.

⚠️ **`enUso` cuenta solo productos directos** (línea 42). Al borrar una madre, el aviso tiene que considerar también los de sus hijas, o el número miente.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd calc3d-web && pnpm test -- --project dom StoreCategoriesModal`
Expected: PASS.

- [ ] **Step 5: Verificar renderizado**

Levantar el panel (`pnpm dev`, puerto **5180**) con la API en 3001, abrir el gestor de categorías, crear una madre y una hija, y **medir en el navegador** que la hija aparece sangrada bajo la madre y que el desplegable no ofrece la hija como madre. Una captura.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/store
git commit -m "feat(web): el gestor de categorias trabaja en dos niveles"
```

---

### Task 7: El selector de categoría del producto muestra la jerarquía

**Files:**
- Modify: `calc3d-web/apps/web/src/pages/StoreProductDetail.tsx:430-456`

**Interfaces:**
- Consumes: `arbolDeCategorias`.

- [ ] **Step 1: Escribir el test que falla**

En `apps/web/src/pages/StoreProductDetail.tramos.spec.tsx` ya se mockea `/store/categories`; agregar ahí:
```tsx
it('el selector de categoría lista las hijas sangradas bajo su madre');
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm test -- --project dom StoreProductDetail`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Recorrer `arbolDeCategorias` y emitir las `<option>` en orden madre→hijas, con la hija sangrada en su texto (`'  ' + c.name`). Agregar el **`aria-label="Categoría"`** que hoy le falta a ese `Select`: sin él, ni un lector de pantalla ni un test lo encuentran por rol.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd calc3d-web && pnpm test -- --project dom StoreProductDetail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/StoreProductDetail.tsx
git commit -m "feat(web): el selector de categoria del producto muestra la jerarquia"
```

---

### Task 8: La vitrina filtra por id, no por nombre

**Files:**
- Modify: `calc3d-web/apps/web/src/pages/Store.tsx:45-58` y `:152-166`
- Create: `calc3d-web/apps/web/src/pages/Store.filtro-categoria.spec.tsx`

**Interfaces:**
- Consumes: `arbolDeCategorias`.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('⚠️ dos subcategorías homónimas bajo madres distintas NO se mezclan al filtrar'); // Review Focus 5
it('filtrar por una madre incluye los productos de sus hijas');
it('una categoría que ya no existe deja el filtro en «todas» y no vacía la vitrina');
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd calc3d-web && pnpm test -- --project dom Store.filtro-categoria`
Expected: FAIL — hoy el filtro compara `p.category?.name`.

- [ ] **Step 3: Implementar**

Cambiar el estado del filtro de nombre a **`categoryId`**, derivar las opciones del hook `useStoreCategories()` (no de los productos: una madre cuyos productos están todos en hijas no aparecería), y al filtrar por una madre incluir sus descendientes vía `descendientesDe`. Mantener la regla del **valor seguro**: si el id guardado ya no existe, cae a «todas».

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd calc3d-web && pnpm test -- --project dom`
Expected: PASS, y los 283 anteriores siguen verdes.

- [ ] **Step 5: Validar un test rompiéndolo**

Volver la comparación a `p.category?.name`. Expected: el test del Review Focus 5 en rojo. Restaurar con copia.

- [ ] **Step 6: Verificación final y commit**

Run: `cd calc3d-web && pnpm -r build && pnpm -r lint && pnpm -r test`
Expected: todo verde.
```bash
git add apps/web/src/pages/Store.tsx apps/web/src/pages/Store.filtro-categoria.spec.tsx
git commit -m "feat(web): la vitrina filtra por id de categoria e incluye las hijas"
```

---

## Lo que este plan NO hace

- **No toca `StoreBanner`.** Sigue guardando el slug suelto y sigue funcionando, porque el slug se mantiene único por organización. Cuando la tienda pase a rutas `/tienda/<cat>/<sub>/`, `enlaceBanner()` tendrá que resolver la ruta — eso es del plan del rediseño, no de éste.
- **No reordena categorías.** `position` se sigue fijando al crear. No existe endpoint de reordenar y este plan no lo agrega.
- **No cambia las rutas de la tienda.** `calc3d-landing` es el plan siguiente.
- **No siembra datos sintéticos.** Es la fase 0b del spec.
