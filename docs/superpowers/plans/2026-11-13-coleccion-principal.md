# Colección principal de la tienda · Plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`. Los pasos van con `- [ ]` para marcarlos.

**Objetivo:** que el dueño decida desde el panel **qué se muestra en la portada de la tienda**
—con varias colecciones guardadas, cuál es la principal, ventana de fechas y vista previa— en
vez de depender de la insignia «Destacado» de cada ficha.

**Arquitectura:** una tabla `StoreCollection` con sus items (categorías y productos sueltos) y
sus exclusiones, calcada de los servicios hermanos que ya existen (`store-banners.service.ts`,
`store-categorias.service.ts`). **La RESOLUCIÓN —qué productos entran y en qué orden— es una
función PURA en `packages/shared`**, para que la vista previa del panel y el endpoint público
den exactamente la misma lista. La tienda la lee **en vivo**, como el resto del catálogo.

**Stack:** NestJS + Prisma (`calc3d-api/apps/api`, tests **Jest**), motor puro
(`calc3d-api/packages/shared`, **Jest**), panel React (`calc3d-web/apps/web`, **vitest**) y
tienda Astro + React (`calc3d-landing`, **vitest**).

**Spec:** [`../specs/2026-11-10-tienda-coleccion-y-filamentos-design.md`](../specs/2026-11-10-tienda-coleccion-y-filamentos-design.md) (punto 12)

## Global Constraints

- **`packages/shared` se edita SOLO en `calc3d-api`**; después `pnpm sync:shared` en web.
  Subir `SHARED_VERSION` **y** el `version` de su `package.json` a la par.
- **La organización sale de `STORE_ORGANIZATION_ID`, JAMÁS de un parámetro del cliente.**
- **El endpoint público arma su respuesta con lista blanca A MANO en el service**, nunca la
  fila de Prisma. Es la regla de todo `store-public/`.
- **Un commit por tarea. NUNCA `git push`.** Sin `--no-verify` ni flags interactivos.
- Español en UI, errores y comentarios; **tuteo, nunca voseo** (hay test guardián). Los
  comentarios explican **por qué**.
- **La mutación tiene que COMPILAR.** Si al romper algo jest no imprime conteo, no se midió
  nada. Usar una condición imposible pero válida, no `if (false)` ni `?? `.
- Al mutar `packages/shared/src` y correr un test de `apps/api`: **recompilar** `dist/cjs`
  entre mutar y correr, y otra vez al restaurar. La API no lee la fuente.
- Restaurar con copia `cp`, **nunca `git checkout --`**.

## Review Focus

Cinco modos de falla que el spec implica y que ninguna tarea prueba sola:

1. **La vista previa muestra algo distinto de lo que publica.** Es el modo de falla central: si
   el panel resuelve la lista por su cuenta, el dueño aprueba una portada y sale otra. → Tarea 2,
   paso 1 (la resolución es UNA función pura; el panel y el público la llaman).
2. **Un producto oculto o borrado sigue apareciendo en la colección.** Misma familia que el
   banner con destino colgado: el dato roto se resuelve en el borde. → Tarea 2, paso 5.
3. **Dos colecciones marcadas como principal a la vez**, o ninguna. El índice único parcial lo
   impide en la base, no solo en el servicio. → Tarea 3, paso 3.
4. **La ventana de fechas se evalúa con el reloj del servidor**, que corre en UTC: desde las
   20:00 de Caracas una colección se activa o muere un día antes. `now` entra como PARÁMETRO.
   → Tarea 3, paso 1.
5. **Sin colección activa la portada queda VACÍA** en vez de caer a «Destacados». Es el estado
   más probable el día uno. → Tarea 5, paso 1.

---

### Task 1: El modelo y el CRUD de colecciones

**Files:**
- Modify: `apps/api/prisma/schema.prisma` + migración **aditiva**
- Create: `apps/api/src/store/store-colecciones.service.ts` + su spec
- Modify: `apps/api/src/store/store.module.ts`
- Modify: `packages/shared/src/schemas/store.ts`

**Interfaces:**
- Produces: `StoreCollection { id, organizationId, nombre, titulo, subtitulo?, verTodoTipo:
  'CATEGORIA'|'COLECCION'|'NONE', verTodoValor?, esPrincipal: boolean, visible: boolean,
  startsAt?: Date, endsAt?: Date }`; `StoreCollectionItem { collectionId, categoryId?,
  productId?, position: number }`; `StoreCollectionExclusion { collectionId, productId }`.
- Produces: `StoreCollectionUpsertSchema` en `shared/schemas/store.ts`.

- [ ] **Paso 1: Escribir los tests del CRUD** en `store-colecciones.service.spec.ts`

```ts
it('crea una colección con sus categorías y productos sueltos', …);
it('una categoría de otra organización se rechaza con 404', …);   // IDOR
it('…y la propia SÍ se acepta', …);                                // hermano alcanzable
it('un producto de otra organización se rechaza con 404', …);      // IDOR
it('…y el propio SÍ se acepta', …);                                // hermano alcanzable
it('editar NO duplica los items: hace diff por id', …);
```

⚠️ **El diff por id no es un lujo**: borrar y recrear los items en cada edición es lo que hizo
perder las fotos por color al editar un producto (ver el `CLAUDE.md`, «foto por color»).

- [ ] **Paso 2: Correr** → FAIL.

- [ ] **Paso 3: Migración aditiva** con las tres tablas, `onDelete: Cascade` desde la colección
  y desde `StoreProduct`/`StoreCategory` hacia sus items.

- [ ] **Paso 4: Implementar el servicio**, copiando la forma de `store-banners.service.ts`
  (scope por organización en cada consulta, validación de pertenencia antes de escribir).

- [ ] **Paso 5: Correr** → PASS. **Paso 6: Commit.**

---

### Task 2: La resolución — qué productos entran y en qué orden

**Files:**
- Create: `packages/shared/src/calc/coleccion.ts` + su spec

**Interfaces:**
- Produces: `resolverColeccion(items, exclusiones, catalogo): ProductoDeColeccion[]`, donde
  `catalogo` es la lista de productos **visibles** con su `categoryId`.

⚠️ **Es UNA sola definición y la llaman los DOS lados** (la vista previa del panel y el
endpoint público). Si el panel la recalcula, el dueño aprueba una portada y sale otra — el modo
de falla número 1 del spec.

- [ ] **Paso 1: Escribir los tests**

```ts
it('una categoría trae sus productos, en el orden de la categoría', …);
it('un producto suelto se agrega aunque su categoría no esté', …);
it('una exclusión saca un producto que entró por su categoría', …);
it('el orden lo manda `position`, no el alfabético ni el id', …);
it('un producto que entra por categoría Y suelto aparece UNA vez', …);
it('un producto OCULTO no entra, aunque esté listado', …);
it('un producto BORRADO no rompe: se saltea', …);
```

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** Función pura, sin Prisma.
- [ ] **Paso 4: Correr** → PASS.

- [ ] **Paso 5: Subir `SHARED_VERSION` y el `version` del package.json**, `pnpm sync:shared` en
  `calc3d-web` y `pnpm test:shared`. **Paso 6: Commit.**

---

### Task 3: Varias colecciones, cuál es la principal y la ventana de fechas

**Files:**
- Modify: `apps/api/src/store/store-colecciones.service.ts` + su spec
- Modify: `packages/shared/src/calc/coleccion.ts` + su spec
- Modify: la migración (índice único parcial, a mano: Prisma no lo declara)

**Interfaces:**
- Produces: `coleccionVigente(colecciones, now): StoreCollection | null`.

- [ ] **Paso 1: Escribir los tests de vigencia**

```ts
it('la principal gana sobre las demás', …);
it('una colección fuera de su ventana de fechas NO está vigente', …);
it('los bordes son INCLUSIVOS: el primer y el último día cuentan', …);
it('sin fechas, la colección vale siempre', …);
it('una colección NO visible nunca está vigente', …);
```

⚠️ **`now` entra como PARÁMETRO**, no se lee del reloj adentro — la misma convención que
`activeSale`, `cashChainCuts` y `facturasAtrasadas`. Un test contra el reloj pasa hoy y falla
solo algún martes. Quien llama pasa el día **local**.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar**, más
  `POST /store/colecciones/:id/principal` con **índice único parcial** en la base
  (`StoreCollection_org_principal_key`), desmarcando y marcando **dentro de una transacción**
  — igual que `Counterparty`/`CashAccount`.
- [ ] **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 4: La pantalla del panel

**Files:**
- Create: `calc3d-web/apps/web/src/pages/StoreColecciones.tsx` + su spec
- Create: `calc3d-web/apps/web/src/features/store/colecciones-api.ts`
- Modify: `calc3d-web/apps/web/src/App.tsx` (ruta `/store/colecciones`)

- [ ] **Paso 1: Escribir los tests de cableado** (`.spec.tsx`, jsdom)

```ts
it('elegir una categoría la agrega a la colección', …);
it('el buscador agrega un producto suelto', …);
it('se puede excluir un producto que entró por su categoría', …);
it('reordenar cambia el `position` que se manda', …);
it('«hacer principal» manda el id correcto', …);
it('guardar manda las fechas tal cual, en AAAA-MM-DD', …);
```

⚠️ **jsdom no tiene layout**: acá se prueba el CABLEADO (que llame y dibuje), no la geometría.
Si hace falta medir algo visual, se mide en navegador.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar** con los componentes que ya usa
  `StoreBanners.tsx`. **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 5: El endpoint público y la tienda

**Files:**
- Modify: `apps/api/src/store-public/store-public.service.ts` + su spec
- Modify: `calc3d-landing/src/lib/portada.ts` + su spec
- Modify: el componente de la portada que hoy dibuja «Destacados»

**Interfaces:**
- Consumes: `resolverColeccion` y `coleccionVigente` de la Tarea 2 y 3.
- Produces: `GET /public/store/coleccion` → `{ titulo, subtitulo, verTodo, productos[] }`.

- [ ] **Paso 1: Escribir los tests**

```ts
it('publica la colección vigente con sus productos resueltos', …);
it('SIN colección vigente cae a «Destacados», no a una lista vacía', …);
it('nunca publica ids internos ni la fila cruda de Prisma', …);
it('un «Ver todo» que apunta a una categoría borrada degrada a NONE', …);
```

⚠️ **La caída a «Destacados» es el estado del día uno**, no un caso raro: sin colección creada
la portada tiene que verse igual que hoy. `destacadosDe` y `TOPE_DESTACADOS_TIENDA` ya existen
en `calc3d-landing/src/lib/portada.ts`.

⚠️ **El «Ver todo» colgado DEGRADA a `NONE`**, no publica un enlace muerto — la misma regla que
los banners.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar**, con la **lista blanca a mano** en el
  service. **Paso 4: Correr** → PASS. **Paso 5: Commit.**

---

### Task 6: La vista previa antes de publicar

**Files:**
- Modify: `calc3d-web/apps/web/src/pages/StoreColecciones.tsx` + su spec
- Modify: `apps/api/src/store/store-colecciones.service.ts` (endpoint de previsualización)

- [ ] **Paso 1: Escribir el test**

```ts
it('la vista previa muestra EXACTAMENTE los productos que publicaría', …);
it('la vista previa de una colección no vigente igual se puede ver', …);
```

⚠️ **La vista previa pide la lista AL SERVIDOR** (`GET /store/colecciones/:id/preview`), que la
resuelve con la misma `resolverColeccion` que el endpoint público. **No la arma el panel.** Una
previa calculada aparte es una segunda definición y mentiría el día que una de las dos cambie.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3: Implementar.** **Paso 4: Correr** → PASS.
- [ ] **Paso 5: Commit.**

---

### Task 7: Verificación en navegador y cierre

- [ ] **Paso 1: Todo verde** — `pnpm test:shared`, `pnpm -r test` y `tsc --noEmit` en los tres
  repos.
- [ ] **Paso 2: Medir en el navegador, no suponer.** Crear una colección con dos categorías y
  una exclusión, verla en la vista previa, publicarla y comprobar que la portada muestra **la
  misma lista y en el mismo orden**. A 375 px y en escritorio.
- [ ] **Paso 3: Borrar la colección de prueba** y comprobar que la portada vuelve a «Destacados».
- [ ] **Paso 4: Actualizar el `CLAUDE.md`** de `calc3d-api` y de `calc3d-landing` con la regla
  de la resolución única. **Paso 5: Commit.**
