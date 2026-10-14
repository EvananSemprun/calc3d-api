# Personalización del cliente (foto + nota) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en los productos marcados `custom` el cliente pueda agregar al pedir una nota corta y una foto opcional que llegan a la bandeja del panel.

**Architecture:** La foto se sube directo a R2 con una URL firmada que entrega un endpoint público nuevo (clave generada por el servidor bajo `custom-uploads/`, firma acotada en tipo/tamaño, rate-limit de la bandeja). Al enviar el pedido, el servidor revalida cada clave con `HeadObject` y guarda `customNote`/`customImageKey` en la línea JSON del `StoreRequest`. La bandeja expone la URL (nunca la clave); descartar/borrar limpia R2.

**Tech Stack:** NestJS + Prisma + SDK de S3 (R2) en `calc3d-api`; Zod + Jest en `packages/shared`; React + vitest en `calc3d-web`; Vite estático + node:test en `calc3d-landing`.

**Spec:** `calc3d-api/docs/superpowers/specs/2026-10-14-tienda-personalizacion-cliente-design.md`

## Global Constraints

- **Commit por tarea en `main` de CADA repo. NUNCA push.**
- **`shared` se edita en `calc3d-api`**, se trae a web con `pnpm sync:shared`; subir `SHARED_VERSION` + `package.json` a **0.57.0** en ambos repos a la par.
- **NO `pnpm -r build` con la API en watch**; tipos con `tsc --noEmit`. La suite DOM de `calc3d-web` corre con `--no-file-parallelism`.
- **Subida acotada:** `STORE_IMAGE_MIME_TYPES` (PNG/JPEG/WebP) y `STORE_IMAGE_MAX_BYTES` (5 MB). Clave bajo `custom-uploads/`, generada por el servidor.
- **Lista blanca:** la bandeja devuelve `customImageUrl`, nunca `customImageKey`.
- **El precio no cambia** por personalizar; sigue saliendo del servidor.
- Idioma: **español**. Despliegue: **API antes que la landing**.

## Review Focus

- **`customImageKey` fuera del prefijo `custom-uploads/`, de otro objeto o de tipo no aceptado** → el envío del pedido se rechaza con 400 y no se crea nada. (Test en Task 3.)
- **Personalización en un producto con `custom = false`** → 400. (Test en Task 3.)
- **La bandeja nunca filtra el `customImageKey` crudo** (solo `customImageUrl`). (Test en Task 3.)
- **Descartar o borrar una solicitud con fotos** → se llama `storage.remove` por cada clave; una CONFIRMADA no se toca. (Test en Task 3.)
- **R2 no configurado** → el endpoint de subida responde 503 y la landing esconde el cargador sin romper el pedido. (Test en Task 2 api; verificación de navegador en Task 5.)

---

### Task 1: Contrato — nota + foto por ítem (`shared`)

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/store-request.ts`
- Modify: `calc3d-api/packages/shared/src/schemas/store-request.spec.ts` (si no existe, crearlo)
- Modify: `calc3d-api/packages/shared/src/version.ts` + `packages/shared/package.json` (0.57.0)

**Interfaces:**
- Produces: `StoreRequestItemSchema` gana `customNote?: string` (trim, ≤500) y `customImageKey?: string` (≤200). Se reexporta `StoreImageUploadUrlSchema` para el endpoint público (ya existe en `store.ts`).

- [ ] **Step 1: Escribir el test que falla**

En `store-request.spec.ts`:

```ts
import { StoreOrderRequestSchema } from './store-request';

it('un ítem acepta customNote y customImageKey opcionales', () => {
  const r = StoreOrderRequestSchema.safeParse({
    customer: { name: 'Ana', phone: '04120000000' },
    items: [{ slug: 'llavero', qty: 1, options: {}, customNote: 'con mi logo', customImageKey: 'org/custom-uploads/2026-10/x.png' }],
  });
  expect(r.success).toBe(true);
  if (r.success) {
    expect(r.data.items[0].customNote).toBe('con mi logo');
    expect(r.data.items[0].customImageKey).toBe('org/custom-uploads/2026-10/x.png');
  }
});

it('una nota demasiado larga se rechaza', () => {
  const r = StoreOrderRequestSchema.safeParse({
    customer: { name: 'Ana', phone: '04120000000' },
    items: [{ slug: 'llavero', qty: 1, options: {}, customNote: 'x'.repeat(501) }],
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared -- store-request`
Expected: FAIL (hoy el ítem descarta `customNote`/`customImageKey`).

- [ ] **Step 3: Agregar los campos**

En `store-request.ts`, dentro de `StoreRequestItemSchema`:

```ts
export const StoreRequestItemSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  qty: z.number().int().positive().max(STORE_REQUEST_MAX_QTY, 'Cantidad demasiado alta'),
  options: z.record(z.string().max(40), z.string().max(60)).default({}),
  /** Personalización opcional (solo en productos `custom`). La foto se sube antes
   *  y acá viaja su clave; el servidor la revalida contra el almacenamiento. */
  customNote: z.string().trim().max(500, 'La nota no puede pasar de 500 caracteres').optional(),
  customImageKey: z.string().max(200).optional(),
});
```

Y al final del archivo, reexportar el schema de subida para el endpoint público:

```ts
export { StoreImageUploadUrlSchema, type StoreImageUploadUrlDto } from './store';
```

- [ ] **Step 4: Bump + suite**

`SHARED_VERSION = '0.57.0'` (en `version.ts`) y `version` en `package.json`.
Run: `pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add packages/shared/src/schemas/store-request.ts packages/shared/src/schemas/store-request.spec.ts packages/shared/src/version.ts packages/shared/package.json && git commit -m "feat(shared): nota y foto del cliente por item del pedido (0.57.0)"
```

---

### Task 2: Endpoint público de subida a R2 (API)

**Files:**
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.ts` (nuevo método `createCustomUploadUrl`)
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.module.ts` (ruta en el controller público + inyección de `ObjectStorageService`)
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.spec.ts`

**Interfaces:**
- Consumes: `ObjectStorageService.createUploadUrl({organizationId, prefix, contentType, contentLength})` y `.configured` (ya existen).
- Produces: `POST /api/public/store/uploads/custom-url` body `{contentType, contentLength}` → `{key, url, headers, expiresInSeconds}`; 503 si R2 no está configurado.

- [ ] **Step 1: Escribir el test que falla**

En `store-requests.service.spec.ts` (el mock de `makeService`/deps tendrá que incluir `storage`, ver más abajo):

```ts
it('createCustomUploadUrl pide la URL bajo el prefijo custom-uploads', async () => {
  const { service, storage } = makeService();
  storage.configured = true;
  storage.createUploadUrl.mockResolvedValue({ key: 'org-A/custom-uploads/2026-10/x.png', url: 'https://firmada', headers: {}, expiresInSeconds: 300 });
  const r = await service.createCustomUploadUrl({ contentType: 'image/png', contentLength: 1000 });
  expect(storage.createUploadUrl).toHaveBeenCalledWith(
    expect.objectContaining({ organizationId: ORG, prefix: 'custom-uploads', contentType: 'image/png', contentLength: 1000 }),
  );
  expect(r.key).toContain('custom-uploads');
});

it('createCustomUploadUrl falla con 503 si R2 no está configurado', async () => {
  const { service, storage } = makeService();
  storage.configured = false;
  await expect(service.createCustomUploadUrl({ contentType: 'image/png', contentLength: 1000 }))
    .rejects.toBeInstanceOf(ServiceUnavailableException);
});
```

> El mock de deps de este spec hoy no tiene `storage`. Agregarlo en `makeService`:
> ```ts
> const storage = {
>   configured: true,
>   createUploadUrl: jest.fn(),
>   head: jest.fn(),
>   remove: jest.fn().mockResolvedValue(undefined),
>   publicUrl: (k: string) => `https://cdn.example/${k}`,
> };
> const service = new StoreRequestsService(prisma as never, config as never, storage as never);
> return { service, prisma, storage, ... };
> ```
> y el constructor del servicio pasa a recibir `storage` (Step 3).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service`
Expected: FAIL (no existe `createCustomUploadUrl`).

- [ ] **Step 3: Implementar el método y la ruta**

En `store-requests.service.ts`, inyectar el storage y agregar el método:

```ts
// En el constructor, sumar: private readonly storage: ObjectStorageService
import { ObjectStorageService } from '../storage/object-storage.service';
import { ServiceUnavailableException } from '@nestjs/common';
import type { StoreImageUploadUrlDto } from '@calc3d/shared';

async createCustomUploadUrl(dto: StoreImageUploadUrlDto) {
  const organizationId = this.organizationId; // getter que ya lee STORE_ORGANIZATION_ID
  if (!this.storage.configured) {
    throw new ServiceUnavailableException('La carga de fotos no está disponible');
  }
  return this.storage.createUploadUrl({
    organizationId,
    prefix: 'custom-uploads',
    contentType: dto.contentType,
    contentLength: dto.contentLength,
  });
}
```

En `store-requests.module.ts`, dentro de `StoreRequestsPublicController` (ya tiene `@UseGuards(ProxyThrottlerGuard)` + `@Throttle({ default: { limit: 5, ttl: 60_000 } })`):

```ts
@Post('uploads/custom-url')
createCustomUploadUrl(@Body(new ZodValidationPipe(StoreImageUploadUrlSchema)) dto: StoreImageUploadUrlDto) {
  return this.service.createCustomUploadUrl(dto);
}
```

(Importar `StoreImageUploadUrlSchema`, `StoreImageUploadUrlDto` de `@calc3d/shared` y `ObjectStorageService` en el módulo; el `StorageModule` ya está disponible o se importa como en `store.module.ts`.)

- [ ] **Step 4: Correr tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add apps/api/src/store-requests packages/shared && git commit -m "feat(api): endpoint publico de subida de foto del cliente (URL firmada a R2)"
```

---

### Task 3: Verificación en el envío + bandeja + limpieza de R2 (API)

**Files:**
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.ts` (`priceItems`, `list`/`get` serializan, `discard`/`remove` limpian R2, `toOrderLines` suma la nota)
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.spec.ts`

**Interfaces:**
- Consumes: `customNote`/`customImageKey` del ítem (Task 1); `storage.head(key)`, `storage.remove(key)`, `storage.publicUrl(key)` (Task 2 ya inyectó storage).
- Produces: la línea guardada gana `customNote?`/`customImageKey?`; `list`/`get` devuelven cada línea con `customNote` y `customImageUrl` (sin `customImageKey`).

- [ ] **Step 1: Escribir los tests que fallan**

En `store-requests.service.spec.ts` (el producto de prueba debe tener `custom: true` y `images`/`optionGroups` según el mock existente):

```ts
it('rechaza una customImageKey fuera del prefijo custom-uploads', async () => {
  const { service } = makeService(); // producto 'llavero' con custom: true
  await expect(service.createOrder({
    customer: { name: 'Ana', phone: '04120000000' },
    items: [{ slug: 'llavero', qty: 1, options: {}, customImageKey: 'org-A/store/otro/x.png' }],
  })).rejects.toThrow(/foto/i);
});

it('rechaza personalizar un producto que no es custom', async () => {
  const { service } = makeService({ productOverride: { custom: false } });
  await expect(service.createOrder({
    customer: { name: 'Ana', phone: '04120000000' },
    items: [{ slug: 'llavero', qty: 1, options: {}, customNote: 'hola' }],
  })).rejects.toThrow(/no admite personaliz/i);
});

it('verifica la foto con HeadObject y guarda nota+clave en la línea', async () => {
  const { service, prisma, storage } = makeService();
  storage.head.mockResolvedValue({ contentType: 'image/png', contentLength: 1000 });
  await service.createOrder({
    customer: { name: 'Ana', phone: '04120000000' },
    items: [{ slug: 'llavero', qty: 1, options: {}, customNote: 'con logo', customImageKey: 'org-A/custom-uploads/2026-10/x.png' }],
  });
  const data = prisma.storeRequest.create.mock.calls[0][0].data;
  expect(data.lines[0].customNote).toBe('con logo');
  expect(data.lines[0].customImageKey).toBe('org-A/custom-uploads/2026-10/x.png');
});

it('la bandeja expone customImageUrl y NUNCA el customImageKey', async () => {
  const { service, prisma } = makeService();
  prisma.storeRequest.findMany.mockResolvedValue([{
    id: 'r1', kind: 'ORDER', status: 'NEW', customerName: 'Ana', customerPhone: '0412', customerPhoneKey: '58412', customerNote: null,
    lines: [{ slug: 'llavero', description: 'Llavero', quantity: 1, options: {}, unitPrice: 3.5, customNote: 'con logo', customImageKey: 'org-A/custom-uploads/2026-10/x.png' }],
    totalUsd: 3.5, description: null, createdAt: new Date(), reviewedAt: null, client: null, order: null,
  }]);
  const out = await service.list(ORG);
  expect(JSON.stringify(out)).not.toContain('custom-uploads'); // la clave no sale
  expect(out[0].lines[0].customImageUrl).toBe('https://cdn.example/org-A/custom-uploads/2026-10/x.png');
  expect(out[0].lines[0]).not.toHaveProperty('customImageKey');
});

it('descartar borra las fotos de R2; confirmar no', async () => {
  const { service, prisma, storage } = makeService();
  const conFoto = { id: 'r1', organizationId: ORG, status: 'NEW', lines: [{ slug: 'x', description: 'X', quantity: 1, options: {}, unitPrice: 1, customImageKey: 'org-A/custom-uploads/2026-10/x.png' }], client: null, order: null, customerPhoneKey: '', customerName: 'A', customerPhone: '0', customerNote: null, kind: 'ORDER', description: null, createdAt: new Date(), reviewedAt: null };
  prisma.storeRequest.findFirst.mockResolvedValue(conFoto);
  await service.discard(ORG, 'r1');
  expect(storage.remove).toHaveBeenCalledWith('org-A/custom-uploads/2026-10/x.png');
});
```

> Nota: adaptar `makeService` para aceptar `productOverride` y para que `prisma.storeProduct.findMany` devuelva un producto con `custom` (hoy quizá no lo incluye). `createOrder` es el método público que hoy atiende `POST /orders` (ver su nombre real en el service; si se llama distinto, usar ese).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service`
Expected: FAIL (no se verifica la clave, no se guardan los campos, `list` no serializa).

- [ ] **Step 3: Implementar**

En `priceItems` (dentro del `items.map`, que pasa a ser `async` → usar `Promise.all`):

```ts
// product ya viene de bySlug; incluir `custom` en el select/include del findMany (ya trae la fila entera).
const tienePersonalizacion = item.customNote != null || item.customImageKey != null;
if (tienePersonalizacion && !product.custom) {
  throw new BadRequestException(`"${product.name}" no admite personalización`);
}
let customImageKey: string | undefined;
if (item.customImageKey) {
  const prefijo = `${organizationId}/custom-uploads/`;
  const obj = item.customImageKey.startsWith(prefijo) ? await this.storage.head(item.customImageKey) : null;
  const tipoOk = obj && obj.contentType && (STORE_IMAGE_MIME_TYPES as readonly string[]).includes(obj.contentType);
  const tamOk = obj && (obj.contentLength ?? 0) <= STORE_IMAGE_MAX_BYTES;
  if (!obj || !tipoOk || !tamOk) {
    throw new BadRequestException('La foto no es válida o no se subió correctamente');
  }
  customImageKey = item.customImageKey;
}
// en el objeto devuelto:
return { slug, description, quantity, options: chosen, unitPrice, ...(item.customNote ? { customNote: item.customNote } : {}), ...(customImageKey ? { customImageKey } : {}) };
```

(Importar `STORE_IMAGE_MIME_TYPES`, `STORE_IMAGE_MAX_BYTES` de `@calc3d/shared`. Extender el tipo local `PricedLine` con `customNote?: string; customImageKey?: string`.)

En `toOrderLines`, sumar la nota a la descripción:

```ts
const extra = [opciones, l.customNote ? `Nota: ${l.customNote}` : ''].filter(Boolean).join(' · ');
return { description: extra ? `${l.description} (${extra})` : l.description, quantity: l.quantity, unit: 'u', unitPrice: l.unitPrice };
```

En `list` y `get`, mapear las líneas a la forma pública (clave → URL). Extraer un helper:

```ts
private serialize = (r: { lines: unknown; [k: string]: unknown }) => ({
  ...r,
  lines: (Array.isArray(r.lines) ? r.lines : []).map((l: Record<string, unknown>) => {
    const { customImageKey, ...resto } = l;
    return { ...resto, ...(customImageKey ? { customImageUrl: this.storage.publicUrl(customImageKey as string) } : {}) };
  }),
});
// list: return (await this.prisma...findMany(...)).map(this.serialize);
// get: return this.serialize(request);
```

En `discard` y `remove`, antes de actualizar/borrar, juntar las claves y limpiarlas de R2 (mejor esfuerzo, fuera de cualquier transacción):

```ts
const keys = (Array.isArray(request.lines) ? request.lines : [])
  .map((l: Record<string, unknown>) => l.customImageKey as string | undefined)
  .filter((k): k is string => !!k);
// ...tras marcar DISCARDED / borrar la fila:
for (const key of keys) { try { await this.storage.remove(key); } catch { /* huérfano tolerable */ } }
```

- [ ] **Step 4: Correr tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add apps/api/src/store-requests && git commit -m "feat(api): verifica la foto del cliente, la guarda en la linea y limpia R2 al descartar"
```

---

### Task 4: La bandeja muestra la nota y la foto (web)

**Files:**
- Modify: `calc3d-web/packages/shared` (sync + bump 0.57.0 tras Task 1)
- Modify: `calc3d-web/apps/web/src/features/store/requests-api.ts` (tipos de línea: `customNote?`, `customImageUrl?`)
- Modify: `calc3d-web/apps/web/src/pages/StoreRequests.tsx` (render de la nota + miniatura por línea)
- Create: `calc3d-web/apps/web/src/pages/StoreRequests.personalizacion.spec.tsx`

**Interfaces:**
- Consumes: la respuesta de `GET /store/requests` con `lines[].customNote` y `lines[].customImageUrl` (Task 3).

- [ ] **Step 1: Sync + bump**

`cd calc3d-web && pnpm sync:shared`; `version` 0.57.0 en `packages/shared/package.json`; `pnpm --filter @calc3d/shared build && pnpm test:shared` → PASS.

- [ ] **Step 2: Escribir el test de pantalla que falla**

`StoreRequests.personalizacion.spec.tsx` (jsdom, mock `@/lib/api`): monta la bandeja con una solicitud cuya línea trae `customNote: 'con mi logo'` y `customImageUrl: 'https://cdn.example/x.png'`; afirma que se ve la nota y que hay un `<img>`/enlace con ese `src`/`href`. (Patrón de `Expenses.pantalla.spec.tsx`: mockear solo `@/lib/api`, envolver en `QueryClientProvider`.)

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- --project dom StoreRequests.personalizacion`
Expected: FAIL (la pantalla no dibuja nota ni foto).

- [ ] **Step 4: Implementar**

En `requests-api.ts`, el tipo de línea de la solicitud gana `customNote?: string | null` y `customImageUrl?: string | null`. En `StoreRequests.tsx`, por cada línea con `customNote` o `customImageUrl`, mostrar la nota (texto) y, si hay URL, una miniatura clickeable que abre la foto en una pestaña nueva (`<a href={url} target="_blank" rel="noopener"><img src={url} .../></a>`). Escapar no hace falta (React escapa), pero el texto va tal cual.

- [ ] **Step 5: Tests + tipos**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- --no-file-parallelism && cd apps/web && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd calc3d-web && git add packages/shared apps/web/src/features/store/requests-api.ts apps/web/src/pages/StoreRequests.tsx apps/web/src/pages/StoreRequests.personalizacion.spec.tsx && git commit -m "feat(web): la bandeja muestra la nota y la foto de personalizacion del cliente"
```

---

### Task 5: Ficha custom + subida en la tienda (landing)

**Files:**
- Modify: `calc3d-landing/assets/render.js` (`renderFichaHtml`: bloque de personalización si `p.custom`)
- Modify: `calc3d-landing/assets/render.test.js` (el bloque aparece solo con `custom` y `storageReady`)
- Modify: `calc3d-landing/producto/index.html` (`Pdp`: subir la foto al agregar, guardar nota+clave en el ítem)
- Modify: `calc3d-landing/assets/app.js` (`claveDeItem`, `Cart.add`, payload del `Checkout`, `BL.pedirUrlDeFoto`)

**Interfaces:**
- Consumes: `POST /public/store/uploads/custom-url` (Task 2); el ítem del pedido con `customNote`/`customImageKey` (Task 1); `p.custom` de la ficha pública (ya existe); `info.storageReady` — **ver nota**.

> ⚠️ **`storageReady` en la landing:** hoy `GET /public/store/info` no lo trae. Dos opciones, elegir en ejecución (ruling): (a) agregar `storageReady` a `info()` en `store-public.service.ts` (1 línea, `this.storage.configured`) — preferida; o (b) que `BL.pedirUrlDeFoto` trate un 503 como "sin subida" y esconda el cargador al vuelo. La opción (a) deja la ficha correcta desde el primer render.

- [ ] **Step 1: Escribir el test que falla (render.js)**

En `render.test.js`:

```js
test('renderFichaHtml muestra el bloque de personalización en un producto custom', () => {
  const p = adapt({ slug: 'x', name: 'X', priceUsd: 10, minQty: 1, custom: true });
  const html = renderFichaHtml(p, { storageReady: true });
  assert.ok(html.includes('data-bl="custom-note"'));
  assert.ok(html.includes('data-bl="custom-foto"'));
});

test('sin custom no hay bloque de personalización', () => {
  const p = adapt({ slug: 'y', name: 'Y', priceUsd: 10, minQty: 1, custom: false });
  assert.ok(!renderFichaHtml(p, { storageReady: true }).includes('data-bl="custom-note"'));
});

test('custom pero sin storageReady: hay nota, no cargador de foto', () => {
  const p = adapt({ slug: 'z', name: 'Z', priceUsd: 10, minQty: 1, custom: true });
  const html = renderFichaHtml(p, { storageReady: false });
  assert.ok(html.includes('data-bl="custom-note"'));
  assert.ok(!html.includes('data-bl="custom-foto"'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL (no existe el bloque).

- [ ] **Step 3: Implementar el bloque en `renderFichaHtml`**

`renderFichaHtml(p, { ..., storageReady = false })` suma, antes de `pdp-buy`, cuando `p.custom`:

```js
const personalizacion = p.custom ? `
  <div class="pdp-custom">
    <h4>Personalización</h4>
    <textarea data-bl="custom-note" maxlength="500" placeholder="Contanos qué querés (nombre, logo, color…)"></textarea>
    ${storageReady ? `<input type="file" data-bl="custom-foto" accept="${STORE_IMAGE_MIME_TYPES.join(',')}"><div class="pdp-custom-preview" data-bl="custom-preview"></div>` : ''}
  </div>` : '';
```

(insertarlo en el template; `STORE_IMAGE_MIME_TYPES` no está en la landing — definir la lista local `['image/png','image/jpeg','image/webp']` en `render.js`, como ya se hizo con `precioConTramos`.)

- [ ] **Step 4: Cableado en `producto/index.html` + `app.js`**

En `app.js`:
- `BL.pedirUrlDeFoto(file)` → `POST /public/store/uploads/custom-url` con `{contentType:file.type, contentLength:file.size}`, PUT a R2, devuelve `key`.
- `claveDeItem(id, opts, note, imageKey)` suma `note`/`imageKey` a la clave (dos personalizaciones distintas = ítems distintos).
- `Cart.add(id, qty, opts, unit, extra)` guarda `customNote`/`customImageKey` en el ítem (`extra`).
- `Checkout` (línea ~433): el map a `items` suma `customNote: i.customNote, customImageKey: i.customImageKey` cuando existan.

En `producto/index.html` (`Pdp`), al agregar:
- Leer la nota de `[data-bl="custom-note"]`.
- Si hay archivo en `[data-bl="custom-foto"]`, validar tipo/tamaño, mostrar preview, y subir con `BL.pedirUrlDeFoto` (botón "Agregar" en estado "Subiendo…"); con la `key`, llamar `Cart.add(id, qty, elegido, precioBase(), { customNote, customImageKey })`.
- Sin archivo, agregar solo con la nota.

- [ ] **Step 5: Tests + build + navegador**

Run: `cd calc3d-landing && node --test && pnpm build` (el build necesita la API local arriba; usar `VITE_API_URL` apuntando a ella si no está en 3001).
Expected: PASS, build OK.
Verificación de navegador (preview + built-in browser): en un producto `custom`, escribir una nota, elegir una foto, agregar al carrito y enviar el pedido; confirmar en la bandeja del panel que llegan nota + foto. Requiere R2 configurado; si no, verificar que el cargador no aparece y el pedido con nota sí entra.

- [ ] **Step 6: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js producto/index.html assets/app.js && git commit -m "feat(landing): personalizacion del cliente (nota + foto) en productos custom"
```

---

## Self-Review

**Spec coverage:** §Subida (endpoint público + firma acotada) → T2; §verificación en el envío + `custom=false` + prefijo → T3; §modelo (campos en el ítem y en la línea JSON) → T1 + T3; §bandeja (customImageUrl, sin key; nota en la descripción al confirmar) → T3 + T4; §descartar/borrar limpia R2 → T3; §landing (bloque custom, subida, esconder sin R2) → T5; §seguridad (tests) → repartidos. ✔

**Placeholder scan:** T5 deja una ruling explícita (de dónde sale `storageReady`) con las dos opciones y la preferida — es una decisión de ejecución, no un placeholder de código. El resto trae el código real. ✔

**Type consistency:** `customNote`/`customImageKey` (ítem y línea guardada), `customImageUrl` (salida de la bandeja), `createCustomUploadUrl(dto)`, `StoreImageUploadUrlSchema`/`Dto` usados igual en shared (T1), api (T2/T3), web (T4) y landing (T5). ✔

**Review Focus:** key fuera de prefijo/ajena/tipo malo → T3; `custom=false` → T3; lista blanca sin key → T3; descartar/borrar limpia R2 → T3; R2 apagado → T2 (503) + T5 (navegador). ✔

## Riesgo principal
La **subida anónima a R2** (T2+T3) es superficie de escritura nueva. El candado es: firma acotada en tipo/tamaño, clave generada por el servidor bajo `custom-uploads/`, `HeadObject` al enviar, rate-limit 5/min, y rechazo (no "ignorar") de una clave inválida. Va con sus tests antes de seguir.
