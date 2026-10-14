# Hito C — Flash Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una ventana de oferta (título + fechas) administrable desde el panel, que en la home pública enciende una sección Flash Sale con contador regresivo y los productos en oferta; el pedido se sigue cobrando `priceUsd` (solo tacha).

**Architecture:** Tres campos nuevos en `Settings` (`saleTitle/saleStartsAt/saleEndsAt`), un helper puro `activeSale` que decide si la ventana está vigente, y un endpoint público dedicado `GET /public/store/sale` que devuelve la ventana + los productos con `compareAtUsd > priceUsd` reutilizando la lista blanca existente. El panel edita las fechas en hora de Venezuela (se guardan en UTC). La landing agrega una sección con contador que consume ese endpoint; si viene vacío, no renderiza. El tachado de catálogo/ficha **no se toca** (ya existe, siempre visible).

**Tech Stack:** NestJS + Prisma (api), Zod en `packages/shared`, React + TanStack Query + vitest (web), Vite estático sin framework + JS vanilla (landing).

**Spec:** `calc3d-api/docs/superpowers/specs/2026-10-12-tienda-rediseno-banano-design.md` (Hito C; decisiones del 2026-10-13 en §6.2/§6.3/§7/§10).

## Global Constraints

- **Commit por tarea en `main` de CADA repo. NUNCA push** (un push a `main` despliega a producción — Render/Railway/Pages).
- **`shared` se edita SOLO en `calc3d-api`.** Tras editarlo: `pnpm --filter @calc3d/shared build` + `pnpm test:shared`; en `calc3d-web`, `pnpm sync:shared` (copia `src`) + recompilar + `pnpm test:shared`.
- **Subir `SHARED_VERSION` (packages/shared/src/version.ts) Y el `version` de packages/shared/package.json a `0.54.0`, en AMBOS repos a la par.** `sync:shared` copia solo `src`, así que el `package.json` de shared en `calc3d-web` se bumpea a mano.
- **NO correr `pnpm -r build` con la API en watch**: la tumba. Verificar tipos con `tsc --noEmit` (`pnpm --filter @calc3d/api exec tsc --noEmit -p apps/api/tsconfig.json`) o parar el watch.
- **Venezuela = `America/Caracas`, offset FIJO `-04:00`** (sin horario de verano desde 2016). La conversión hora-local↔UTC del panel usa ese offset fijo.
- **`GET /public/store/info` NO se toca.** La ventana va en el endpoint dedicado `GET /public/store/sale`.
- **El pedido sigue cobrando `priceUsd`.** El Flash Sale es presentación: no agrega ningún camino para que el precio/compareAt viaje desde el cliente.
- **Las fechas de la oferta son INSTANTES** (ISO datetime con zona), no fechas de día pelado: la constante `FECHA` de `schemas/api.ts` (que valida `AAAA-MM-DD`) NO aplica acá.
- Idioma de UI y errores: **español**.

## Review Focus

- **`saleEndsAt` ≤ `saleStartsAt`** → el schema debe rechazar con 400 y mensaje claro, en vez de guardar una ventana imposible. (Test en Task 1.)
- **`PATCH /settings` con una sola de las dos fechas, o con una fecha basura** (`'ayer'`, `'2026-13-40T00:00Z'`) → el `.superRefine` no debe romper cuando falta una, y `z.string().datetime` debe rechazar lo no-ISO. (Tests en Task 1.)
- **Ventana activa pero ningún producto con `compareAtUsd > priceUsd`** → `GET /public/store/sale` devuelve `{ sale: null }` (la sección no se renderiza), no una ventana con lista vacía. (Test en Task 3.)
- **Lista blanca de `/public/store/sale`**: la respuesta no debe filtrar `id`, `organizationId`, `costAtPublish` ni la clave de R2, y la organización sale de `STORE_ORGANIZATION_ID`, nunca del cliente. (Tests en Task 3.)
- **Conversión horaria Caracas↔UTC en el panel**: 18:00 Caracas ⇄ 22:00Z, ida y vuelta, sin corrimiento de día. (Tests en Task 4.)

---

### Task 1: Contratos `shared` — campos de la ventana en `SettingsUpdateSchema`

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/api.ts:191-235` (`SettingsUpdateSchema`)
- Modify: `calc3d-api/packages/shared/src/version.ts` (`SHARED_VERSION`)
- Modify: `calc3d-api/packages/shared/package.json` (`version`)
- Test: `calc3d-api/packages/shared/src/schemas/sale-window.spec.ts` (crear)

**Interfaces:**
- Produces: `SettingsUpdateSchema` gana `saleTitle?: string | null`, `saleStartsAt?: string | null`, `saleEndsAt?: string | null` (ISO datetime), con validación cruzada `saleEndsAt > saleStartsAt`. `SettingsUpdateDto` incluye los tres.

- [ ] **Step 1: Escribir el test que falla**

Crear `calc3d-api/packages/shared/src/schemas/sale-window.spec.ts`:

```ts
import { SettingsUpdateSchema } from './api';

describe('SettingsUpdateSchema — ventana de Flash Sale', () => {
  const base = {
    saleTitle: 'Oferta de octubre',
    saleStartsAt: '2026-10-20T22:00:00.000Z',
    saleEndsAt: '2026-10-27T03:59:00.000Z',
  };

  it('acepta una ventana válida', () => {
    expect(SettingsUpdateSchema.safeParse(base).success).toBe(true);
  });

  it('acepta null en los tres (limpiar la ventana)', () => {
    const r = SettingsUpdateSchema.safeParse({
      saleTitle: null,
      saleStartsAt: null,
      saleEndsAt: null,
    });
    expect(r.success).toBe(true);
  });

  it('acepta que no vengan (update parcial de otros campos)', () => {
    expect(SettingsUpdateSchema.safeParse({ kwhPrice: 0.1 }).success).toBe(true);
  });

  it('rechaza fin <= inicio', () => {
    const r = SettingsUpdateSchema.safeParse({
      ...base,
      saleEndsAt: base.saleStartsAt, // igual al inicio
    });
    expect(r.success).toBe(false);
  });

  it('no rompe si viene solo una de las dos fechas', () => {
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: base.saleStartsAt }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ saleEndsAt: base.saleEndsAt }).success).toBe(true);
  });

  it('rechaza una fecha que no es ISO datetime', () => {
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: 'ayer' }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ saleStartsAt: '2026-10-20' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared -- sale-window`
Expected: FAIL (los campos no existen aún; `SettingsUpdateSchema` los descarta y "rechaza fin <= inicio" no falla).

- [ ] **Step 3: Agregar los campos + la validación cruzada**

En `calc3d-api/packages/shared/src/schemas/api.ts`, dentro del `z.object({...})` de `SettingsUpdateSchema` (antes del `})` de cierre en la línea 234), agregar:

```ts
  /** Flash Sale: título de la oferta mostrado en la home (null = sin título). */
  saleTitle: z.string().max(80).nullable().optional(),
  /** Inicio de la ventana de oferta (ISO datetime; null = sin ventana). */
  saleStartsAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** Fin de la ventana de oferta (ISO datetime; null = sin ventana). */
  saleEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
```

Y envolver el objeto con `.superRefine` **inmediatamente después del `})`** que cierra el `z.object` (reemplazando el `;` de la línea 234 por el refine). El `z.object({...})` pasa a asignarse así:

```ts
export const SettingsUpdateSchema = z
  .object({
    // ... todos los campos existentes + los tres nuevos ...
  })
  .superRefine((val, ctx) => {
    if (
      val.saleStartsAt != null &&
      val.saleEndsAt != null &&
      new Date(val.saleEndsAt) <= new Date(val.saleStartsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['saleEndsAt'],
        message: 'La oferta debe terminar después de empezar',
      });
    }
  });
```

> Nota (como en el `StoreBannerUpdateSchema` del Hito B): envolver con `.superRefine` convierte el schema en `ZodEffects`. `z.infer` sigue funcionando; `SettingsUpdateSchema.parse(...)` en el `ZodValidationPipe` sigue funcionando. No se usa `.partial()`/`.shape` sobre este schema en ningún lado (verificado: los consumidores usan el tipo `SettingsUpdateDto` y `.parse`).

- [ ] **Step 4: Bump de versión**

En `calc3d-api/packages/shared/src/version.ts`, subir `SHARED_VERSION` a `'0.54.0'`.
En `calc3d-api/packages/shared/package.json`, subir `"version"` a `"0.54.0"`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: PASS (incluida `sale-window.spec.ts` y la suite completa de shared sin regresiones).

- [ ] **Step 6: Commit**

```bash
cd calc3d-api && git add packages/shared/src/schemas/api.ts packages/shared/src/schemas/sale-window.spec.ts packages/shared/src/version.ts packages/shared/package.json && git commit -m "feat(shared): ventana de Flash Sale en SettingsUpdateSchema (0.54.0)"
```

---

### Task 2: Modelo `Settings` + migración + helper `activeSale`

**Files:**
- Modify: `calc3d-api/apps/api/prisma/schema.prisma:204-247` (model `Settings`)
- Create: migración en `calc3d-api/apps/api/prisma/migrations/<timestamp>_flash_sale/migration.sql`
- Create: `calc3d-api/apps/api/src/store-public/active-sale.ts`
- Test: `calc3d-api/apps/api/src/store-public/active-sale.spec.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - Columnas `saleTitle TEXT NULL`, `saleStartsAt TIMESTAMP NULL`, `saleEndsAt TIMESTAMP NULL` en `Settings`.
  - `export interface SaleWindow { title: string | null; startsAt: string; endsAt: string }`
  - `export function activeSale(settings: { saleTitle: string | null; saleStartsAt: Date | null; saleEndsAt: Date | null }, now: Date): SaleWindow | null`

- [ ] **Step 1: Escribir el test que falla**

Crear `calc3d-api/apps/api/src/store-public/active-sale.spec.ts`:

```ts
import { activeSale } from './active-sale';

const start = new Date('2026-10-20T22:00:00.000Z');
const end = new Date('2026-10-27T03:59:00.000Z');
const settings = { saleTitle: 'Oferta', saleStartsAt: start, saleEndsAt: end };

describe('activeSale', () => {
  it('null si falta alguna fecha', () => {
    expect(activeSale({ saleTitle: 'x', saleStartsAt: null, saleEndsAt: end }, start)).toBeNull();
    expect(activeSale({ saleTitle: 'x', saleStartsAt: start, saleEndsAt: null }, start)).toBeNull();
    expect(activeSale({ saleTitle: null, saleStartsAt: null, saleEndsAt: null }, start)).toBeNull();
  });

  it('null antes de empezar', () => {
    expect(activeSale(settings, new Date('2026-10-20T21:59:00.000Z'))).toBeNull();
  });

  it('null después de terminar', () => {
    expect(activeSale(settings, new Date('2026-10-27T04:00:00.000Z'))).toBeNull();
  });

  it('devuelve la ventana dentro del rango (bordes inclusivos), con fechas en ISO', () => {
    const r = activeSale(settings, new Date('2026-10-22T10:00:00.000Z'));
    expect(r).toEqual({
      title: 'Oferta',
      startsAt: '2026-10-20T22:00:00.000Z',
      endsAt: '2026-10-27T03:59:00.000Z',
    });
    expect(activeSale(settings, start)).not.toBeNull(); // inicio inclusivo
    expect(activeSale(settings, end)).not.toBeNull(); // fin inclusivo
  });

  it('conserva title null', () => {
    const r = activeSale({ saleTitle: null, saleStartsAt: start, saleEndsAt: end }, start);
    expect(r?.title).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest active-sale`
Expected: FAIL con "Cannot find module './active-sale'".

- [ ] **Step 3: Escribir el helper**

Crear `calc3d-api/apps/api/src/store-public/active-sale.ts`:

```ts
/** Ventana de Flash Sale vigente, lista para publicar. */
export interface SaleWindow {
  title: string | null;
  startsAt: string;
  endsAt: string;
}

/**
 * Decide si la ventana de oferta está vigente AHORA. Es la ÚNICA definición de
 * "oferta activa": la usa el endpoint público. Bordes inclusivos.
 */
export function activeSale(
  settings: { saleTitle: string | null; saleStartsAt: Date | null; saleEndsAt: Date | null },
  now: Date,
): SaleWindow | null {
  const { saleTitle, saleStartsAt, saleEndsAt } = settings;
  if (!saleStartsAt || !saleEndsAt) return null;
  if (now < saleStartsAt || now > saleEndsAt) return null;
  return { title: saleTitle, startsAt: saleStartsAt.toISOString(), endsAt: saleEndsAt.toISOString() };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest active-sale`
Expected: PASS.

- [ ] **Step 5: Agregar las columnas al modelo Prisma**

En `calc3d-api/apps/api/prisma/schema.prisma`, dentro de `model Settings`, después del bloque de datos del negocio (tras `businessSigner  String?`, línea ~247) agregar:

```prisma
  // Flash Sale: ventana de oferta (una a la vez). Activa cuando now ∈ [inicio, fin]
  // y ambas están definidas. Solo TACHA: el pedido se cobra priceUsd (ver spec §10).
  saleTitle    String?
  saleStartsAt DateTime?
  saleEndsAt   DateTime?
```

- [ ] **Step 6: Generar la migración (parar la API en watch primero)**

Si la API corre en watch, pararla (si no, `prisma generate` falla con EPERM por la DLL del engine). Luego:

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec prisma migrate dev --name flash_sale`
Expected: crea `migrations/<timestamp>_flash_sale/migration.sql` con tres `ALTER TABLE "Settings" ADD COLUMN` nullable, y regenera el cliente.

- [ ] **Step 7: Verificar que compila y los tests pasan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest active-sale && pnpm --filter @calc3d/api exec tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS y exit 0.

- [ ] **Step 8: Commit**

```bash
cd calc3d-api && git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/store-public/active-sale.ts apps/api/src/store-public/active-sale.spec.ts && git commit -m "feat(api): columnas de Flash Sale en Settings + helper activeSale"
```

---

### Task 3: Endpoint público `GET /public/store/sale`

**Files:**
- Modify: `calc3d-api/apps/api/src/store-public/store-public.service.ts` (extraer `listCard`, agregar `sale()`)
- Modify: `calc3d-api/apps/api/src/store-public/store-public.module.ts` (agregar `@Get('sale')`)
- Test: `calc3d-api/apps/api/src/store-public/store-public.service.spec.ts` (agregar casos de `sale`)

**Interfaces:**
- Consumes: `activeSale` / `SaleWindow` de Task 2.
- Produces: `StorePublicService.sale(): Promise<{ sale: (SaleWindow & { products: PublicProductCard[] }) | null }>` y la ruta `GET /public/store/sale`.

- [ ] **Step 1: Escribir los tests que fallan**

En `calc3d-api/apps/api/src/store-public/store-public.service.spec.ts`, agregar al mock de Prisma el acceso a `settings.findUnique` y reutilizar `storeProduct.findMany`. Agregar un `describe`:

```ts
describe('sale()', () => {
  const ahora = new Date('2026-10-22T10:00:00.000Z');
  const ventana = {
    saleTitle: 'Oferta',
    saleStartsAt: new Date('2026-10-20T22:00:00.000Z'),
    saleEndsAt: new Date('2026-10-27T03:59:00.000Z'),
  };
  // Producto con descuento (compareAt > price) y uno sin descuento.
  const enOferta = { ...BASE_PRODUCT, slug: 'llavero', priceUsd: '3.5000', compareAtUsd: '5.0000' };
  const sinOferta = { ...BASE_PRODUCT, slug: 'taza', priceUsd: '8.0000', compareAtUsd: null };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(ahora);
  });
  afterEach(() => jest.useRealTimers());

  it('devuelve la ventana + solo los productos con compareAt > price, con lista blanca', async () => {
    prisma.settings.findUnique.mockResolvedValue(ventana);
    prisma.storeProduct.findMany.mockResolvedValue([enOferta, sinOferta]);
    const { sale } = await service.sale();
    expect(sale).not.toBeNull();
    expect(sale!.title).toBe('Oferta');
    expect(sale!.startsAt).toBe('2026-10-20T22:00:00.000Z');
    expect(sale!.products).toHaveLength(1);
    expect(sale!.products[0].slug).toBe('llavero');
    expect(sale!.products[0].compareAtUsd).toBe(5);
    // Lista blanca: nada interno.
    expect(sale!.products[0]).not.toHaveProperty('id');
    expect(sale!.products[0]).not.toHaveProperty('organizationId');
    expect(sale!.products[0]).not.toHaveProperty('costAtPublish');
  });

  it('{ sale: null } si no hay ventana activa', async () => {
    prisma.settings.findUnique.mockResolvedValue({ saleTitle: 'x', saleStartsAt: null, saleEndsAt: null });
    prisma.storeProduct.findMany.mockResolvedValue([enOferta]);
    expect(await service.sale()).toEqual({ sale: null });
  });

  it('{ sale: null } si la ventana está activa pero ningún producto tiene compareAt > price', async () => {
    prisma.settings.findUnique.mockResolvedValue(ventana);
    prisma.storeProduct.findMany.mockResolvedValue([sinOferta]);
    expect(await service.sale()).toEqual({ sale: null });
  });

  it('503 si falta STORE_ORGANIZATION_ID', async () => {
    config.get.mockReturnValue(undefined);
    await expect(service.sale()).rejects.toThrow();
  });
});
```

> Nota: `BASE_PRODUCT` es el fixture de producto que el spec ya usa (slug, name, kind, summary, priceUsd, compareAtUsd, leadTimeDays, minQty, material, badge, custom, category, images, optionGroups). Ajustar el nombre al que exista en el archivo. El `where` del mock `storeProduct.findMany` ya filtra por `organizationId` en el patrón del spec; mantenerlo.

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public.service`
Expected: FAIL ("service.sale is not a function").

- [ ] **Step 3: Extraer `listCard` y escribir `sale()`**

En `store-public.service.ts`:

1. Importar el helper al tope del archivo:

```ts
import { activeSale, type SaleWindow } from './active-sale';
```

2. Extraer la proyección de tarjeta-con-imagen que hoy está inline en `list()` (líneas 188-195) a un método privado, para que `list()` y `sale()` usen la MISMA lista blanca:

```ts
/** Proyección de tarjeta de vitrina (card + imagen + colores). Única lista
 *  blanca para el listado y para el Flash Sale: no pueden divergir. */
private listCard(p: Parameters<StorePublicService['card']>[0] & {
  images: { key: string; alt: string | null; width: number | null; height: number | null }[];
  optionGroups: { name: string; required: boolean; options: { value: string; swatchHex: string | null }[] }[];
}): PublicProductCard {
  return {
    ...this.card(p),
    image: p.images[0] ? this.image(p.images[0]) : null,
    colors: (p.optionGroups.find((g) => /color/i.test(g.name))?.options ?? [])
      .filter((o) => o.swatchHex)
      .map((o) => ({ value: o.value, swatchHex: o.swatchHex as string })),
    requiresOptions: p.optionGroups.some((g) => g.required && g.options.length > 0),
  };
}
```

Y reemplazar el `.map(...)` inline de `list()` por `products.map((p) => this.listCard(p))`.

3. Agregar el método `sale()` después de `banners()`:

```ts
/** Flash Sale: la ventana vigente + los productos en oferta. Vacío ({ sale: null })
 *  si no hay ventana activa O si ningún producto tiene compareAtUsd > priceUsd.
 *  Solo TACHA: el pedido se sigue cobrando priceUsd; acá no viaja ningún precio. */
async sale(): Promise<{ sale: (SaleWindow & { products: PublicProductCard[] }) | null }> {
  const organizationId = this.organizationId;
  const settings = await this.prisma.settings.findUnique({
    where: { organizationId },
    select: { saleTitle: true, saleStartsAt: true, saleEndsAt: true },
  });
  const window = settings ? activeSale(settings, new Date()) : null;
  if (!window) return { sale: null };

  const rows = await this.prisma.storeProduct.findMany({
    where: { organizationId, visible: true, compareAtUsd: { not: null } },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    include: {
      category: { select: { name: true, slug: true } },
      images: { orderBy: { position: 'asc' }, take: 1 },
      optionGroups: {
        orderBy: { position: 'asc' },
        include: { options: { orderBy: { position: 'asc' } } },
      },
    },
  });
  // Prisma no compara dos columnas; el "compareAt > price" se filtra acá.
  const products = rows
    .filter((p) => p.compareAtUsd != null && Number(p.compareAtUsd) > Number(p.priceUsd))
    .map((p) => this.listCard(p));
  if (!products.length) return { sale: null };

  return { sale: { ...window, products } };
}
```

- [ ] **Step 4: Agregar la ruta al controlador**

En `store-public.module.ts`, después del `@Get('banners')` (línea ~38):

```ts
  @Get('sale')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  sale() {
    return this.service.sale();
  }
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public && pnpm --filter @calc3d/api exec tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS y exit 0.

- [ ] **Step 6: Verificación por curl (API levantada en 3001)**

Run: `curl -s http://localhost:3001/api/public/store/sale`
Expected: `{"sale":null}` (sin ventana configurada) con `Cache-Control: public, max-age=60, s-maxage=300` y rate-limit.

- [ ] **Step 7: Commit**

```bash
cd calc3d-api && git add apps/api/src/store-public && git commit -m "feat(api): endpoint publico GET /public/store/sale (Flash Sale)"
```

---

### Task 4: Panel — helper de zona horaria Caracas↔UTC

**Files:**
- Create: `calc3d-web/apps/web/src/features/store/flash-sale-tz.ts`
- Test: `calc3d-web/apps/web/src/features/store/flash-sale-tz.spec.ts`
- Modify: `calc3d-web/packages/shared/package.json` (bump `version` a `0.54.0` tras `sync:shared`)

**Interfaces:**
- Produces:
  - `export function isoAInputVenezuela(iso: string | null): string` — ISO UTC → valor de `<input type="datetime-local">` en hora Caracas (`'YYYY-MM-DDTHH:mm'`), `''` si null.
  - `export function inputVenezuelaAIso(local: string): string | null` — valor del input (hora Caracas) → ISO UTC, `null` si vacío.

- [ ] **Step 1: Sincronizar shared y bumpear versión en web**

Run: `cd calc3d-web && pnpm sync:shared`
Luego en `calc3d-web/packages/shared/package.json` subir `"version"` a `"0.54.0"` (el `src/version.ts` ya vino con `0.54.0` por el sync).
Run: `cd calc3d-web && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: PASS (incluida `sale-window.spec.ts`, que llegó por el sync).

- [ ] **Step 2: Escribir el test que falla**

Crear `calc3d-web/apps/web/src/features/store/flash-sale-tz.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isoAInputVenezuela, inputVenezuelaAIso } from './flash-sale-tz';

describe('flash-sale-tz', () => {
  it('ISO UTC → input en hora de Venezuela (UTC-4)', () => {
    expect(isoAInputVenezuela('2026-10-20T22:00:00.000Z')).toBe('2026-10-20T18:00');
  });

  it('input en hora de Venezuela → ISO UTC', () => {
    expect(inputVenezuelaAIso('2026-10-20T18:00')).toBe('2026-10-20T22:00:00.000Z');
  });

  it('cruza el día para atrás sin corrimiento', () => {
    // 20:00 Caracas del 20 = 00:00Z del 21
    expect(inputVenezuelaAIso('2026-10-20T20:00')).toBe('2026-10-21T00:00:00.000Z');
    expect(isoAInputVenezuela('2026-10-21T00:00:00.000Z')).toBe('2026-10-20T20:00');
  });

  it('vacío/null se manejan sin romper', () => {
    expect(isoAInputVenezuela(null)).toBe('');
    expect(isoAInputVenezuela('')).toBe('');
    expect(inputVenezuelaAIso('')).toBeNull();
  });

  it('ida y vuelta es identidad', () => {
    const iso = '2026-12-01T03:30:00.000Z';
    expect(inputVenezuelaAIso(isoAInputVenezuela(iso))).toBe(iso);
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- flash-sale-tz`
Expected: FAIL ("Cannot find module './flash-sale-tz'").

- [ ] **Step 4: Escribir el helper**

Crear `calc3d-web/apps/web/src/features/store/flash-sale-tz.ts`:

```ts
// Venezuela usa un offset FIJO de UTC-4 (sin horario de verano desde 2016).
// El dueño piensa las fechas de la oferta en su hora; se guardan en UTC.
const OFFSET_MS = 4 * 60 * 60 * 1000;
const OFFSET = '-04:00';

/** ISO UTC → valor para <input type="datetime-local"> en hora de Venezuela. */
export function isoAInputVenezuela(iso: string | null): string {
  if (!iso) return '';
  const caracas = new Date(new Date(iso).getTime() - OFFSET_MS);
  // El instante desplazado, leído como UTC, ES la hora de pared en Caracas.
  return caracas.toISOString().slice(0, 16);
}

/** Valor de <input datetime-local> (hora de Venezuela) → ISO UTC. */
export function inputVenezuelaAIso(local: string): string | null {
  if (!local) return null;
  return new Date(`${local}:00${OFFSET}`).toISOString();
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- flash-sale-tz`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd calc3d-web && git add packages/shared apps/web/src/features/store/flash-sale-tz.ts apps/web/src/features/store/flash-sale-tz.spec.ts && git commit -m "feat(web): sync shared 0.54.0 + helper de zona horaria del Flash Sale"
```

---

### Task 5: Panel — diálogo "Flash Sale" en la pantalla Tienda

**Files:**
- Create: `calc3d-web/apps/web/src/features/store/FlashSaleDialog.tsx`
- Modify: `calc3d-web/apps/web/src/pages/Store.tsx` (botón que abre el diálogo)
- Test: `calc3d-web/apps/web/src/features/store/FlashSaleDialog.spec.tsx`

**Interfaces:**
- Consumes: `isoAInputVenezuela` / `inputVenezuelaAIso` de Task 4; `GET /settings` ya devuelve `saleTitle/saleStartsAt/saleEndsAt` (el service los incluye vía `withoutLogo`, sin cambios de backend).
- Produces: `export function FlashSaleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void })`.

- [ ] **Step 1: Escribir el test que falla**

Crear `calc3d-web/apps/web/src/features/store/FlashSaleDialog.spec.tsx` (patrón de `pages/Purchases.abonar.spec.tsx`: mockear solo `@/lib/api`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/overlays';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get: mocks.get, patch: mocks.patch },
  apiErrorMessage: () => 'falló',
}));

function settings(extra: Record<string, unknown> = {}) {
  return {
    data: {
      currency: 'USD', locale: 'es-VE', hasLogo: false, businessName: 'Banano Lab',
      saleTitle: null, saleStartsAt: null, saleEndsAt: null, ...extra,
    },
  };
}

async function montar() {
  mocks.get.mockImplementation((url: string) =>
    url === '/settings' ? Promise.resolve(settings()) : Promise.resolve({ data: null }),
  );
  mocks.patch.mockResolvedValue(settings());
  const { FlashSaleDialog } = await import('./FlashSaleDialog');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <FlashSaleDialog open onOpenChange={() => {}} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('FlashSaleDialog', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.patch.mockReset();
  });

  it('guarda las fechas convertidas a UTC', async () => {
    await montar();
    fireEvent.change(await screen.findByLabelText(/título/i), { target: { value: 'Oferta' } });
    fireEvent.change(screen.getByLabelText(/empieza/i), { target: { value: '2026-10-20T18:00' } });
    fireEvent.change(screen.getByLabelText(/termina/i), { target: { value: '2026-10-27T23:00' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/settings', {
      saleTitle: 'Oferta',
      saleStartsAt: '2026-10-20T22:00:00.000Z',
      saleEndsAt: '2026-10-28T03:00:00.000Z',
    }));
  });

  it('no guarda si el fin no es posterior al inicio', async () => {
    await montar();
    fireEvent.change(await screen.findByLabelText(/empieza/i), { target: { value: '2026-10-20T18:00' } });
    fireEvent.change(screen.getByLabelText(/termina/i), { target: { value: '2026-10-20T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await screen.findByText(/debe terminar después/i);
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('"Quitar oferta" manda los tres en null', async () => {
    await montar();
    fireEvent.click(await screen.findByRole('button', { name: /quitar oferta/i }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/settings', {
      saleTitle: null, saleStartsAt: null, saleEndsAt: null,
    }));
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- FlashSaleDialog`
Expected: FAIL ("Cannot find module './FlashSaleDialog'").

- [ ] **Step 3: Escribir el diálogo**

Crear `calc3d-web/apps/web/src/features/store/FlashSaleDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import { notify } from '@/components/toast';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { isoAInputVenezuela, inputVenezuelaAIso } from './flash-sale-tz';

interface SettingsSale {
  saleTitle: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
}

export function FlashSaleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery<SettingsSale>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  const [titulo, setTitulo] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Prellenar con lo guardado al abrir.
  useEffect(() => {
    if (!open || !data) return;
    setTitulo(data.saleTitle ?? '');
    setInicio(isoAInputVenezuela(data.saleStartsAt));
    setFin(isoAInputVenezuela(data.saleEndsAt));
    setError(null);
  }, [open, data]);

  const guardar = useMutation({
    mutationFn: (payload: SettingsSale) => api.patch('/settings', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notify.success('Oferta actualizada');
      onOpenChange(false);
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const startsAt = inputVenezuelaAIso(inicio);
    const endsAt = inputVenezuelaAIso(fin);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('La oferta debe terminar después de empezar.');
      return;
    }
    setError(null);
    guardar.mutate({ saleTitle: titulo.trim() || null, saleStartsAt: startsAt, saleEndsAt: endsAt });
  };

  const quitar = () => guardar.mutate({ saleTitle: null, saleStartsAt: null, saleEndsAt: null });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Flash Sale">
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Durante la ventana, la home muestra una sección con contador y los productos que tengan
          "precio tachado". El precio cobrado no cambia: solo se tacha. Las fechas van en hora de
          Venezuela.
        </p>
        <Field label="Título">
          <Input
            aria-label="Título"
            value={titulo}
            maxLength={80}
            placeholder="Oferta de octubre"
            onChange={(e) => setTitulo(e.target.value)}
          />
        </Field>
        <Field label="Empieza">
          <Input
            aria-label="Empieza"
            type="datetime-local"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
        </Field>
        <Field label="Termina">
          <Input
            aria-label="Termina"
            type="datetime-local"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={quitar} disabled={guardar.isPending}>
            Quitar oferta
          </Button>
          <Button type="submit" disabled={guardar.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
```

> Verificar las firmas reales de `Dialog`, `Field` e `Input` en `calc3d-web/apps/web/src/components/ui.tsx` y ajustar props si difieren (p. ej. si `Dialog` usa `onOpenChange`/`title` como acá, que es el patrón del repo). El `aria-label` en cada `Input` es necesario porque la etiqueta de `Field` no está asociada por `htmlFor` (nota del CLAUDE.md de web).

- [ ] **Step 4: Cablear el botón en la pantalla Tienda**

En `calc3d-web/apps/web/src/pages/Store.tsx`:

1. Importar: `import { FlashSaleDialog } from '@/features/store/FlashSaleDialog';` y agregar `Zap` (o `Flame`) a los iconos de `lucide-react`.
2. Estado: junto a `const [categorias, setCategorias] = useState(false);` agregar `const [flash, setFlash] = useState(false);`.
3. En la barra de botones (junto a "Categorías"), agregar:

```tsx
<Button variant="outline" onClick={() => setFlash(true)}>
  <Zap className="h-4 w-4" /> Flash Sale
</Button>
```

4. Antes del cierre del componente, junto a `<StoreCategoriesModal ... />`, agregar:

```tsx
<FlashSaleDialog open={flash} onOpenChange={setFlash} />
```

- [ ] **Step 5: Correr los tests y el build de tipos**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- FlashSaleDialog && pnpm --filter @calc3d/web exec tsc --noEmit`
Expected: PASS y exit 0.

- [ ] **Step 6: Smoke en el navegador (panel en 5180, API en 3001)**

Abrir `/store`, tocar "Flash Sale", cargar título + fechas, Guardar; reabrir y confirmar que las fechas vuelven en hora local. Luego `curl -s http://localhost:3001/api/public/store/sale` debe devolver la ventana si está vigente y hay un producto con `compareAtUsd > priceUsd` (si no, `{"sale":null}`).

- [ ] **Step 7: Commit**

```bash
cd calc3d-web && git add apps/web/src/features/store/FlashSaleDialog.tsx apps/web/src/features/store/FlashSaleDialog.spec.tsx apps/web/src/pages/Store.tsx && git commit -m "feat(web): control de Flash Sale en la pantalla Tienda"
```

---

### Task 6: Landing — sección Flash Sale con contador

**Files:**
- Modify: `calc3d-landing/index.html` (nueva `<section>` + nuevo `<script type="module">`)
- Modify: `calc3d-landing/assets/app.js` (exponer `window.blAdapt`)
- Modify: `calc3d-landing/assets/styles.css` (estilos del contador y del badge %OFF) — confirmar el nombre real del CSS
- Modify: `calc3d-landing/CLAUDE.md` (nota de la sección Flash Sale)

**Interfaces:**
- Consumes: `GET /public/store/sale`; `window.BL`, `window.blTarjetaProducto`, `window.blEngancharTarjetas`, `window.esc` (ya expuestos); `window.blAdapt` (nuevo).
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Exponer `adapt` en la landing**

En `calc3d-landing/assets/app.js`, junto a las asignaciones `window.*` (líneas 769-780), agregar:

```js
window.blAdapt = adapt;
```

> `adapt(p)` (línea 118) convierte la forma pública del producto (`priceUsd`, `compareAtUsd`, `image`, `colors`, `category`…) a la forma que consume `blTarjetaProducto` (`price`, `compareAt`, `colorList`, `catLabel`…). Reusarlo evita una segunda copia del adaptador.

- [ ] **Step 2: Agregar la sección al HTML**

En `calc3d-landing/index.html`, **entre el cierre del carrusel (línea ~66, `</section>` de `#heroCarousel`) y el comentario de destacados (línea ~68)**, insertar la sección (oculta por defecto; el script la muestra si hay oferta):

```html
<!-- Flash Sale: solo se muestra si hay una ventana activa CON productos (los trae la API). -->
<section class="section flash-sale" id="flashSale" hidden>
  <div class="container">
    <div class="eyebrow-row">
      <h2 class="h2" id="flashSaleTitle">Flash Sale</h2>
      <div class="flash-countdown" id="flashCountdown" aria-live="polite"></div>
    </div>
    <div class="grid shop-grid" id="flashSaleGrid"></div>
  </div>
</section>
```

- [ ] **Step 3: Agregar el script del Flash Sale**

En `index.html`, **después del `<script type="module">` del carrusel** (tras su cierre, línea ~300), agregar un nuevo módulo independiente (mismo patrón de la IIFE del carrusel: su propio `API`, su propio try/catch, no rompe la home si falla):

```html
<script type="module">
// Sección Flash Sale: consume GET /public/store/sale. Si no hay ventana activa
// o no hay productos en oferta, la respuesta es { sale: null } y la sección
// queda oculta. El contador corre en el navegador; al llegar a 0 muestra
// "Oferta finalizada" (no se auto-oculta en vivo). El precio cobrado no cambia.
(async function () {
  const root = document.getElementById('flashSale');
  if (!root) return;
  const API = (import.meta?.env?.VITE_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');

  let sale = null;
  try {
    const r = await fetch(`${API}/public/store/sale`);
    ({ sale } = await r.json());
  } catch {
    return; // la sección se queda oculta
  }
  if (!sale || !Array.isArray(sale.products) || !sale.products.length) return;

  // Título.
  document.getElementById('flashSaleTitle').textContent = sale.title || 'Flash Sale';

  // Productos: se adaptan con el MISMO adaptador del catálogo y se dibujan con
  // la MISMA tarjeta (ya muestra el precio tachado y la insignia "Oferta"). El
  // %OFF se agrega solo acá, sin tocar la tarjeta que usa el resto del sitio.
  const grid = document.getElementById('flashSaleGrid');
  grid.innerHTML = sale.products
    .map((raw) => {
      const p = window.blAdapt(raw);
      const off =
        p.compareAt && p.compareAt > p.price
          ? Math.round(((p.compareAt - p.price) / p.compareAt) * 100)
          : 0;
      const badge = off > 0 ? `<span class="flash-off">-${off}%</span>` : '';
      return `<div class="flash-item">${badge}${window.blTarjetaProducto(p)}</div>`;
    })
    .join('');
  window.blEngancharTarjetas(grid);

  root.hidden = false;

  // Contador regresivo.
  const box = document.getElementById('flashCountdown');
  const fin = new Date(sale.endsAt).getTime();
  const dos = (n) => String(n).padStart(2, '0');
  function tick() {
    const faltan = fin - Date.now();
    if (faltan <= 0) {
      box.textContent = 'Oferta finalizada';
      clearInterval(timer);
      return;
    }
    const s = Math.floor(faltan / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = s % 60;
    box.textContent = `${d > 0 ? `${d}d ` : ''}${dos(h)}:${dos(m)}:${dos(seg)}`;
  }
  tick();
  const timer = setInterval(tick, 1000);
})();
</script>
```

- [ ] **Step 4: Estilos**

Confirmar el nombre del archivo CSS de la landing (probablemente `assets/styles.css`; si es otro, usar ese) y agregar:

```css
.flash-sale .flash-countdown {
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  color: var(--yellow);
  font-variant-numeric: tabular-nums;
}
.flash-item { position: relative; }
.flash-item .flash-off {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  background: var(--yellow);
  color: #000814;
  font-weight: 800;
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 999px;
}
```

- [ ] **Step 5: Build de la landing**

Run: `cd calc3d-landing && pnpm build`
Expected: build OK, sin errores.

- [ ] **Step 6: Verificación en el navegador — FALLBACK (sin oferta)**

Con el panel SIN ventana activa, abrir la home (`pnpm dev`, 5182). La sección `#flashSale` debe quedar oculta y la home (carrusel, destacados, categorías) intacta. Confirmar en consola que no hay errores y `document.getElementById('flashSale').hidden === true`.

- [ ] **Step 7: Verificación en el navegador — HAPPY (con oferta)**

Configurar una ventana activa (desde el panel, o por SQL contra la base LOCAL) y asegurar que exista un `StoreProduct` visible con `compareAtUsd > priceUsd`. Recargar la home con fetch no-cache (la respuesta tiene `Cache-Control` de 60 s). La sección debe aparecer con el título, el contador corriendo y la tarjeta con precio tachado + `-XX%`. Revertir el dato de prueba al terminar.

- [ ] **Step 8: Actualizar el CLAUDE.md de la landing**

Agregar una nota breve en `calc3d-landing/CLAUDE.md` describiendo la sección Flash Sale (consume `GET /public/store/sale`, contador regresivo, oculta si `{ sale: null }`, el tachado de catálogo es independiente).

- [ ] **Step 9: Commit**

```bash
cd calc3d-landing && git add index.html assets/app.js assets/styles.css CLAUDE.md && git commit -m "feat(landing): seccion Flash Sale con contador regresivo"
```

---

## Self-Review

**Spec coverage:**
- §6.3 campos `Settings` + "activa cuando now ∈ [inicio, fin]" → Task 1 (schema) + Task 2 (modelo + `activeSale`). ✔
- §7 `GET /public/store/sale` dedicado, `/info` sin tocar → Task 3. ✔
- Panel: control título + fechas en hora de Venezuela → Task 4 (tz) + Task 5 (diálogo). ✔
- §4 banda 3: sección con contador, oculta sin ventana o sin productos, tachado de catálogo independiente → Task 6. ✔
- §10 "solo tacha", el pedido cobra `priceUsd`, sin camino nuevo de precio → no se agrega ningún endpoint de escritura ni campo de precio en el payload; la regresión existente de `store-requests` lo mantiene (sin cambios). ✔

**Placeholder scan:** sin "TBD"/"TODO"; todos los pasos traen código real. ✔

**Type consistency:** `activeSale`/`SaleWindow` (Task 2) se consumen con esos nombres en Task 3. `isoAInputVenezuela`/`inputVenezuelaAIso` (Task 4) se consumen con esos nombres en Task 5. `listCard`/`card` reutilizados en Task 3. `window.blAdapt` expuesto en Task 6 step 1 y consumido en step 3. ✔

**Review Focus:** las 5 líneas tienen su test — fin≤inicio (Task 1 + Task 5), fecha parcial/basura (Task 1), ventana activa sin productos (Task 3), lista blanca + org del servidor (Task 3), conversión horaria (Task 4). ✔
