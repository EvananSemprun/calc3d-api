# Fase B — Foto por color (tienda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la foto de la ficha cambie según el color elegido: el dueño marca UN grupo de opciones como "define la foto", le asigna una o varias fotos a cada color de ese grupo, y al elegirlo en la tienda la galería cambia.

**Architecture:** `StoreImage` gana `optionId` (la foto pertenece a una opción) y `StoreOptionGroup` gana `drivesPhoto` (el grupo que manda la galería, a lo sumo uno por producto). Como atar una foto a una opción exige que la opción no cambie de id, el guardado del producto pasa de **borrar-recrear las opciones** a un **diff con ids estables**. La landing hace swap de galería con las fotos de la opción elegida del grupo foto.

**Tech Stack:** NestJS + Prisma (api), Zod + Jest en `packages/shared`, React + vitest (web), Vite estático (landing).

**Spec:** `calc3d-api/docs/superpowers/specs/2026-10-14-tienda-precios-por-cantidad-y-foto-por-color-design.md` (Feature B).

**Depende de:** Fase A desplegada (shared ≥ 0.55.0). Esta fase sube shared a **0.56.0**.

## Global Constraints

- **Commit por tarea en `main` de CADA repo. NUNCA push.**
- **`shared` se edita en `calc3d-api`**, se trae a web con `pnpm sync:shared`. Subir `SHARED_VERSION` + `package.json` a **0.56.0** en ambos repos a la par.
- **NO `pnpm -r build` con la API en watch**; tipos con `tsc --noEmit`.
- **Fotos en R2**: la asignación de foto por opción reusa el flujo de URL firmada que ya existe (`createImageUploadUrl` → subida directa → confirmar). Requiere R2 configurado (`storageReady`).
- **Lista blanca pública:** las fotos por opción salen con `url` (no `key`), sin `id`/`optionId`/`storeProductId`/`organizationId`.
- **A lo sumo UN grupo con `drivesPhoto` por producto** (el servidor lo valida: 400 si llegan dos).
- Idioma: **español**.

## Review Focus

- **Editar un producto (cambiar el nombre) NO debe desenganchar ni borrar las fotos de sus opciones** — el diff con ids estables conserva las opciones. (Test en Task 2.)
- **Dos grupos marcados `drivesPhoto`** → 400. (Test en Task 2.)
- **Una foto con `optionId` de una opción que no existe / de otro producto** al confirmar → rechazada. (Test en Task 3.)
- **Un color del grupo foto SIN fotos propias** → la ficha muestra la galería base, no se rompe. (Test en Task 3 público + Task 5 landing.)
- **Lista blanca:** las imágenes por opción no filtran `key`/`optionId`/ids internos. (Test en Task 3.)

---

### Task 1: Contrato — ids estables + `drivesPhoto` (`shared`)

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/store.ts` (ids opcionales en grupo/opción; `drivesPhoto` en grupo)
- Modify: `calc3d-api/packages/shared/src/schemas/store.spec.ts`
- Modify: `version.ts` + `package.json` (0.56.0)

**Interfaces:**
- Produces: `StoreOptionSchema` gana `id: z.string().optional()`; `StoreOptionGroupSchema` gana `id: z.string().optional()` y `drivesPhoto: z.boolean().default(false)`.

- [ ] **Step 1: Escribir el test que falla**

En `store.spec.ts` (o el spec de store schemas), agregar:

```ts
it('un grupo acepta id, drivesPhoto, y opciones con id', () => {
  const r = StoreProductCreateSchema.safeParse({
    name: 'X', priceUsd: 10, minQty: 1,
    optionGroups: [{
      id: 'grp1', name: 'Color', required: true, drivesPhoto: true,
      options: [{ id: 'op1', value: 'Rojo', swatchHex: '#ff0000' }],
    }],
  });
  expect(r.success).toBe(true);
  if (r.success) {
    expect(r.data.optionGroups[0].drivesPhoto).toBe(true);
    expect(r.data.optionGroups[0].id).toBe('grp1');
    expect(r.data.optionGroups[0].options[0].id).toBe('op1');
  }
});

it('drivesPhoto por defecto es false y los ids son opcionales', () => {
  const r = StoreProductCreateSchema.safeParse({
    name: 'X', priceUsd: 10, minQty: 1,
    optionGroups: [{ name: 'Color', options: [{ value: 'Rojo' }] }],
  });
  expect(r.success && r.data.optionGroups[0].drivesPhoto).toBe(false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared -- store`
Expected: FAIL (hoy el schema descarta `id`/`drivesPhoto`).

- [ ] **Step 3: Agregar los campos**

En `store.ts`:

```ts
export const StoreOptionSchema = z.object({
  id: z.string().optional(),
  value: z.string().min(1, 'La opción no puede estar vacía').max(60),
  priceDeltaUsd: price.default(0),
  swatchHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Usá un color en formato #RRGGBB').nullable().optional(),
});

export const StoreOptionGroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El grupo necesita un nombre').max(40),
  required: z.boolean().default(false),
  /** Marca el grupo cuyas opciones definen la foto de la ficha. A lo sumo uno por producto. */
  drivesPhoto: z.boolean().default(false),
  options: z.array(StoreOptionSchema).min(1, 'Agregá al menos una opción').max(40),
});
```

- [ ] **Step 4: Bump + suite**

`SHARED_VERSION='0.56.0'` + package.json. Run: `pnpm --filter @calc3d/shared build && pnpm test:shared` → PASS.

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add packages/shared/src/schemas/store.ts packages/shared/src/schemas/store.spec.ts packages/shared/src/version.ts packages/shared/package.json && git commit -m "feat(shared): ids estables de opciones + drivesPhoto en el grupo (0.56.0)"
```

---

### Task 2: Guardado con ids estables + validación `drivesPhoto` (API)

**Files:**
- Modify: `calc3d-api/apps/api/prisma/schema.prisma` → `model StoreOptionGroup` gana `drivesPhoto Boolean @default(false)`
- Create: migración `<ts>_option_group_drives_photo`
- Modify: `calc3d-api/apps/api/src/store/store.service.ts` (`update` hace diff en vez de deleteMany+recreate; validación de un solo `drivesPhoto`)
- Modify: `calc3d-api/apps/api/src/store/store.service.spec.ts` (o crear si no existe el caso)

**Interfaces:**
- Consumes: DTO con `id`/`drivesPhoto` (Task 1).
- Produces: al editar un producto, las opciones que siguen conservan su `id`.

- [ ] **Step 1: Columna + migración**

`model StoreOptionGroup`: agregar `drivesPhoto Boolean @default(false)`.
Run: `pnpm --filter @calc3d/api exec prisma migrate dev --name option_group_drives_photo`.

- [ ] **Step 2: Escribir el test que falla (ids estables + drivesPhoto único)**

En `store.service.spec.ts`, dos tests:

```ts
it('editar un producto NO cambia los ids de las opciones que siguen', async () => {
  // crear producto con un grupo Color (Rojo, Azul) → capturar los ids
  // editar el producto (cambiar name) mandando los grupos CON sus ids
  // volver a leer → los ids de Rojo/Azul son los MISMOS
});

it('rechaza dos grupos con drivesPhoto', async () => {
  await expect(service.update(ORG, id, { optionGroups: [
    { name: 'A', drivesPhoto: true, options: [{ value: 'x' }] },
    { name: 'B', drivesPhoto: true, options: [{ value: 'y' }] },
  ] } as any)).rejects.toThrow();
});
```

> Si `store.service.spec.ts` no existe o usa mock de Prisma, seguir el patrón del repo (mock que modela `storeOptionGroup`/`storeOption` con ids). Ver `store-public.service.spec.ts` para el estilo de mock.

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store.service`
Expected: FAIL (hoy `update` hace deleteMany → los ids cambian; no hay validación de drivesPhoto).

- [ ] **Step 4: Diff con ids estables**

En `store.service.ts` `update()` (hoy líneas ~137-160: `deleteMany` + recreate), reemplazar por un **diff dentro de la transacción**:
- Validar: a lo sumo un grupo con `drivesPhoto` (si no, `BadRequestException`).
- Traer los grupos actuales (con sus opciones) del producto.
- **Grupos:** los del DTO con `id` conocido → `update` (name/required/drivesPhoto/position); sin `id` → `create`; los actuales que no están en el DTO → `delete` (cascade borra sus opciones e imágenes).
- **Opciones dentro de cada grupo que sigue:** mismo diff por `id` (update value/priceDeltaUsd/swatchHex/position; create las nuevas; delete las que se fueron).
- `optionGroupsData` (línea ~323) se adapta o se complementa con un `optionGroupsUpsert`.

> Es la parte más delicada: va con los tests del Step 2 en verde. Mantener todo en la transacción `tx`.

- [ ] **Step 5: Correr tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd calc3d-api && git add apps/api/prisma apps/api/src/store/store.service.ts apps/api/src/store/store.service.spec.ts && git commit -m "feat(api): guardado de opciones con ids estables + un solo grupo drivesPhoto"
```

---

### Task 3: Foto por opción — modelo, subida y exposición pública (API)

**Files:**
- Modify: `calc3d-api/apps/api/prisma/schema.prisma` → `model StoreImage` gana `optionId String?` + relación a `StoreOption` (onDelete Cascade)
- Create: migración `<ts>_store_image_option`
- Modify: `calc3d-api/apps/api/src/store/store.service.ts` (confirmar imagen acepta `optionId`, validado)
- Modify: `calc3d-api/packages/shared/src/schemas/store.ts` (el DTO de confirmar imagen gana `optionId?`) + sync a web
- Modify: `calc3d-api/apps/api/src/store-public/store-public.service.ts` (ficha expone imágenes por opción + `drivesPhoto`)
- Modify: `calc3d-api/apps/api/src/store-public/store-public.service.spec.ts`

**Interfaces:**
- Produces: la ficha pública (`bySlug`) devuelve, por cada grupo, `drivesPhoto`, y por cada opción de ese grupo, `images: {url, alt, width, height}[]`.

- [ ] **Step 1: Columna + migración**

`model StoreImage`: `optionId String?` + `option StoreOption? @relation(fields:[optionId], references:[id], onDelete: Cascade)` y en `StoreOption` el back-relation `images StoreImage[]`.
Run: `prisma migrate dev --name store_image_option`.

- [ ] **Step 2: Escribir el test público que falla**

En `store-public.service.spec.ts`, al fixture del producto agregar un grupo con `drivesPhoto: true` cuya opción "Rojo" tenga una imagen (`images: [{key, alt,...}]` con `optionId`), y tests:

```ts
it('la ficha expone las fotos por opción del grupo que define la foto, con URL (sin key)', async () => {
  const ficha = await service.bySlug('llavero-mundial');
  const grupoFoto = ficha.optionGroups.find((g) => g.drivesPhoto);
  expect(grupoFoto).toBeTruthy();
  const rojo = grupoFoto.options.find((o) => o.value === 'Rojo');
  expect(rojo.images[0].url).toMatch(/^https:\/\/cdn\.example\//);
  expect(JSON.stringify(ficha)).not.toContain('optionId');
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public.service`
Expected: FAIL (hoy la ficha no trae `drivesPhoto` ni `images` por opción).

- [ ] **Step 4: Exponer en `bySlug`**

En `store-public.service.ts` `bySlug()`: el `include` de `optionGroups.options` suma `images` (orderBy position). En la proyección de `optionGroups`, agregar `drivesPhoto: g.drivesPhoto` y, por opción, `images: o.images.map((img) => this.image(img))` (reusa `image()`, que ya saca `url` sin `key`). La galería base (imágenes con `optionId = null`) sigue saliendo por `images` del producto como hoy — en el `include` del producto, filtrar las de nivel producto con `where: { optionId: null }` para no duplicar.

- [ ] **Step 5: Confirmar imagen con `optionId`**

En el DTO de confirmar imagen (`StoreImageConfirmSchema` en `shared/schemas/store.ts`), agregar `optionId: z.string().optional()`. En `store.service.ts` (confirmar, ~línea 243), si viene `optionId`: validar que la opción exista, sea del producto y de un grupo `drivesPhoto` (si no, `BadRequestException`), y guardarlo en `StoreImage.optionId`. (Sync shared a web después.)

- [ ] **Step 6: Correr tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public.service store.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
cd calc3d-api && git add apps/api/prisma apps/api/src/store apps/api/src/store-public packages/shared && git commit -m "feat(api): foto por opcion (StoreImage.optionId) + exposicion publica + confirmar con optionId"
```

---

### Task 4: Panel — grupo foto + subir foto por opción (web)

**Files:**
- Modify: `calc3d-web/packages/shared/package.json` (bump 0.56.0 tras sync)
- Modify: `calc3d-web/apps/web/src/pages/StoreProductDetail.tsx` (check `drivesPhoto` + subida por opción; preservar ids)
- Modify: `calc3d-web/apps/web/src/features/store/api.ts` (si hace falta, `uploadStoreImage` acepta `optionId`)
- Create: `calc3d-web/apps/web/src/pages/StoreProductDetail.fotoColor.spec.tsx`

**Interfaces:**
- Consumes: DTO con `id`/`drivesPhoto`/`optionId` (sincronizado 0.56.0).

- [ ] **Step 1: Sync + bump**

`cd calc3d-web && pnpm sync:shared`; `version` 0.56.0 en packages/shared/package.json; `pnpm --filter @calc3d/shared build && pnpm test:shared` → PASS.

- [ ] **Step 2: Escribir el test de pantalla que falla**

`StoreProductDetail.fotoColor.spec.tsx` (jsdom, mock `@/lib/api`): monta la pantalla; marca un grupo como "define la foto"; guarda; afirma que el DTO manda `drivesPhoto: true` en ese grupo y **conserva los `id`** de los grupos/opciones que ya existían (que el `editar` precargó con ids). (Mock `api.get` del producto con grupos que tienen ids; capturar `api.patch`.)

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- StoreProductDetail.fotoColor`
Expected: FAIL (no existe el check; o el DTO no manda ids/drivesPhoto).

- [ ] **Step 4: Implementar**

En `StoreProductDetail.tsx`:
- Al precargar (`editar`), **conservar `id`** de grupos y opciones en `GrupoEdit` (hoy el comentario dice "sin ids: se reemplazan"; ahora se guardan y se mandan).
- En `OpcionesEditor`, por grupo un check **"Este grupo define la foto"** (exclusivo: marcarlo desmarca los otros).
- En el grupo con `drivesPhoto`, por opción un botón **"Foto"** que abre el flujo de subida a R2 (`uploadStoreImage`, pasando `optionId` de esa opción) — requiere que la opción ya tenga `id` (producto guardado). Mostrar la miniatura si la opción ya tiene foto.
- En el submit, mandar `optionGroups` con sus `id` y `drivesPhoto`.

> Gating: la subida por opción necesita `storageReady` y que la opción exista (id). Si el producto es nuevo/sin guardar, avisar "guardá primero".

- [ ] **Step 5: Tests + tipos**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- StoreProductDetail.fotoColor && cd apps/web && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd calc3d-web && git add packages/shared apps/web/src/pages/StoreProductDetail.tsx apps/web/src/features/store/api.ts apps/web/src/pages/StoreProductDetail.fotoColor.spec.tsx && git commit -m "feat(web): grupo que define la foto + subir foto por color"
```

---

### Task 5: Landing — swap de galería al elegir color (landing)

**Files:**
- Modify: `calc3d-landing/assets/render.js` (`renderFichaHtml` usa las fotos de la opción elegida del grupo foto)
- Modify: `calc3d-landing/assets/render.test.js`
- Modify: `calc3d-landing/producto/index.html` (`Pdp` re-renderiza al cambiar la opción del grupo foto)

**Interfaces:**
- Consumes: la ficha pública con `drivesPhoto` por grupo e `images` por opción (Task 3), vía `adapt`.

- [ ] **Step 1: Escribir el test que falla**

En `render.test.js`, una ficha con un grupo `drivesPhoto` cuya opción elegida tiene imágenes propias → `renderFichaHtml` usa esas imágenes en la galería; una opción sin imágenes → usa la galería base.

```js
test('renderFichaHtml usa la foto de la opción elegida del grupo foto', () => {
  const p = adapt({ slug:'x', name:'X', priceUsd:10, minQty:1,
    images:[{url:'https://cdn/base.jpg'}],
    optionGroups:[{ name:'Color', required:true, drivesPhoto:true, options:[
      { value:'Rojo', images:[{url:'https://cdn/rojo.jpg'}] },
      { value:'Azul', images:[] },
    ]}],
  });
  const rojo = renderFichaHtml(p, { elegido:{ Color:'Rojo' } });
  assert.ok(rojo.includes('https://cdn/rojo.jpg'));
  const azul = renderFichaHtml(p, { elegido:{ Color:'Azul' } });
  assert.ok(azul.includes('https://cdn/base.jpg')); // sin foto propia → base
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL (hoy la galería no mira la opción elegida).

- [ ] **Step 3: Implementar**

En `adapt`, mapear por opción `images` y por grupo `drivesPhoto`. En `renderFichaHtml`, calcular `fotos`: si hay un grupo con `drivesPhoto` y la opción elegida de ese grupo tiene `images.length`, usar esas; si no, la galería base (`p.images`/`p.image`). El resto del armado (miniaturas, etc.) usa `fotos`.

- [ ] **Step 4: Re-render al cambiar la opción**

En `producto/index.html`, el handler de `.pdp-opt` ya hace `this.render()` al elegir — como `renderFichaHtml` ahora recalcula la galería según `this.elegido`, la foto cambia sola. Verificar que `fotoActiva` se resetee a 0 al cambiar de color (para no quedar en una miniatura inexistente).

- [ ] **Step 5: Tests + build + navegador**

Run: `cd calc3d-landing && node --test && pnpm build`
Expected: PASS, build OK.
Verificación (con un producto local con grupo foto + fotos por opción, requiere R2 o inyección en DB de `StoreImage` con `optionId`): abrir la ficha, cambiar el color del grupo foto, ver que la galería cambia. Revertir datos de prueba.

- [ ] **Step 6: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js producto/index.html && git commit -m "feat(landing): la galeria cambia segun el color elegido"
```

---

## Self-Review

**Spec coverage (Feature B):** §5.1 modelo (optionId + drivesPhoto) → T2 (drivesPhoto) + T3 (optionId). §5.2 ids estables → T1 (contrato) + T2 (diff). §5.3 público → T3. §5.4 panel → T4. §5.5 landing → T5. §6 tests de seguridad → repartidos (ids estables T2, un drivesPhoto T2, optionId ajeno T3, lista blanca T3). ✔

**Placeholder scan:** T2 Step 2 y T4 Step 2 describen el test remitiendo al "patrón del repo" por los nombres de archivo reales y dan el núcleo de las aserciones; T2 Step 4 describe el diff en prosa (es lógica, no un literal) con las reglas exactas (match por id, create sin id, delete faltantes). No hay "TBD"/"más tarde". Las partes de UI (T4) y del diff (T2) son las de mayor criterio; el ejecutor las implementa siguiendo las reglas dadas. ✔

**Type consistency:** `drivesPhoto` (grupo), `optionId` (imagen), `id` (grupo/opción) usados igual en shared (T1), api (T2/T3), web (T4) y landing (adapt, T5). `images` por opción con `{url,alt,width,height}` en T3 (público) y T5 (consumo). ✔

**Review Focus:** editar no desengancha fotos → T2; dos drivesPhoto → T2; optionId ajeno → T3; color sin foto → T3+T5; lista blanca → T3. ✔

## Riesgo principal
El **diff con ids estables (Task 2)** cambia cómo se persisten las opciones (hoy borrar-recrear). Es el núcleo de Fase B y donde un error se nota (fotos u opciones perdidas al editar). Va con sus tests en verde antes de seguir. Si en ejecución resulta demasiado invasivo, la alternativa (peor, documentada en el spec §8) es re-enlazar las fotos por VALOR del color tras recrear — se tomaría como ruling de ejecución.
