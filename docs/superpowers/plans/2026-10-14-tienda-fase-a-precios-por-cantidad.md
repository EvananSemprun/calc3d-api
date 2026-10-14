# Fase A — Precios por cantidad (tienda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un producto de la tienda cueste distinto según la cantidad pedida (mayoreo por descuento %), configurable desde la edición del producto y aplicado por el servidor en el pedido.

**Architecture:** Un campo `priceTiers` (JSON `[{minQty, discountPct}]`) en `StoreProduct`. Un helper puro `precioConTramos` en `shared` decide el precio unitario según la cantidad. El pedido (`store-requests`) lo aplica después de los recargos de opción — el precio lo decide el SERVIDOR. El panel edita los tramos; la landing muestra la tabla de mayoreo y recalcula el unitario en vivo (reusando la misma lógica, reimplementada mínima y testeada en la landing porque no importa `@calc3d/shared`).

**Tech Stack:** NestJS + Prisma (api), Zod + Jest en `packages/shared`, React + vitest (web), Vite estático + `node:test` (landing).

**Spec:** `calc3d-api/docs/superpowers/specs/2026-10-14-tienda-precios-por-cantidad-y-foto-por-color-design.md` (Feature A).

## Global Constraints

- **Commit por tarea en `main` de CADA repo. NUNCA push** (un push a `main` de api/web despliega a producción).
- **`shared` se edita SOLO en `calc3d-api`.** Tras editarlo: `pnpm --filter @calc3d/shared build` + `pnpm test:shared`; en `calc3d-web`, `pnpm sync:shared` + recompilar + `pnpm test:shared`.
- **Subir `SHARED_VERSION` (packages/shared/src/version.ts) Y el `version` de packages/shared/package.json a `0.55.0`, en AMBOS repos a la par.** El `sync:shared` copia solo `src`; el `package.json` de shared en web se bumpea a mano.
- **NO correr `pnpm -r build` con la API en watch** (la tumba). Verificar tipos con `pnpm --filter @calc3d/api exec tsc --noEmit -p apps/api/tsconfig.json` (desde la raíz) o `npx tsc --noEmit -p tsconfig.json` dentro de `apps/api`.
- **El precio lo decide el SERVIDOR.** El pedido manda `{slug, qty, options}`; nada de precio/descuento/tramo del body se mira. El tramo se aplica en `priceItems`.
- **Lista blanca pública:** `priceTiers` sale por la API pública, pero nada interno (id/organizationId/costAtPublish).
- **Descuento como FRACCIÓN** (0.10 = 10 %), como el resto del motor.
- Idioma de UI y errores: **español**.

## Review Focus

- **Un `unitPrice`/`discount`/`tier` en el payload del pedido** → se ignora; el total usa el precio con descuento que calcula el servidor. (Test en Task 3.)
- **`qty` justo en el borde de un tramo** (minQty del tramo) → el descuento SÍ aplica (borde inclusivo); un `qty` por debajo del primer tramo → precio base. (Test en Task 1.)
- **Tramos inválidos** (minQty no creciente, duplicado, por debajo del `minQty` del producto, discountPct ≥ 1 o < 0) → el schema los rechaza con 400. (Test en Task 1.)
- **Producto sin `priceTiers`** (la enorme mayoría) → precio base, sin cambios de comportamiento. (Test en Task 1 y Task 3.)
- **Interacción con `compareAtUsd`/Flash Sale** → el tramo descuenta sobre `priceUsd`; el tachado sigue siendo `compareAtUsd`. No se apilan dos descuentos sobre el mismo número. (Test en Task 1: `precioConTramos` ignora compareAt.)

---

### Task 1: Contrato + helper `precioConTramos` (`shared`)

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/store.ts` (StorePriceTierSchema + priceTiers en StoreProductCreateSchema)
- Create: `calc3d-api/packages/shared/src/calc/store-pricing.ts`
- Create: `calc3d-api/packages/shared/src/calc/store-pricing.spec.ts`
- Modify: `calc3d-api/packages/shared/src/index.ts` (export del helper si hace falta)
- Modify: `calc3d-api/packages/shared/src/version.ts` y `package.json` (bump 0.55.0)

**Interfaces:**
- Produces:
  - `StorePriceTierSchema` = `{ minQty: number≥2, discountPct: number en [0,1) }`
  - `StoreProductCreateSchema` gana `priceTiers: StorePriceTier[]` (default `[]`), validado creciente / sobre el mínimo del producto.
  - `export function precioConTramos(baseUnit: number, qty: number, tiers: StorePriceTier[]): number`

- [ ] **Step 1: Escribir el test que falla (helper)**

Crear `calc3d-api/packages/shared/src/calc/store-pricing.spec.ts`:

```ts
import { precioConTramos } from './store-pricing';

const tiers = [
  { minQty: 10, discountPct: 0.1 },
  { minQty: 25, discountPct: 0.2 },
];

describe('precioConTramos', () => {
  it('sin tramos devuelve el precio base', () => {
    expect(precioConTramos(5, 100, [])).toBe(5);
  });
  it('qty por debajo del primer tramo = precio base', () => {
    expect(precioConTramos(5, 9, tiers)).toBe(5);
  });
  it('borde inclusivo: en el minQty del tramo aplica', () => {
    expect(precioConTramos(10, 10, tiers)).toBeCloseTo(9, 10); // 10 % off
  });
  it('toma el MAYOR tramo aplicable', () => {
    expect(precioConTramos(10, 30, tiers)).toBeCloseTo(8, 10); // 20 % off
  });
  it('entre tramos usa el de abajo', () => {
    expect(precioConTramos(10, 24, tiers)).toBeCloseTo(9, 10);
  });
  it('no toca compareAt ni nada: solo descuenta el baseUnit que recibe', () => {
    expect(precioConTramos(12, 100, [{ minQty: 2, discountPct: 0.5 }])).toBeCloseTo(6, 10);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared -- store-pricing`
Expected: FAIL ("Cannot find module './store-pricing'").

- [ ] **Step 3: Escribir el helper**

Crear `calc3d-api/packages/shared/src/calc/store-pricing.ts`:

```ts
import Decimal from 'decimal.js';
import type { StorePriceTier } from '../schemas/store';

/**
 * Precio unitario tras aplicar el MAYOR tramo cuyo minQty <= qty. Sin tramos
 * aplicables, devuelve baseUnit. El descuento es sobre el unitario que entra
 * (ya con recargos de opción); compareAt/Flash Sale no se tocan acá.
 */
export function precioConTramos(baseUnit: number, qty: number, tiers: StorePriceTier[]): number {
  const aplicable = [...tiers]
    .filter((t) => qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  if (!aplicable) return baseUnit;
  return new Decimal(baseUnit).mul(1 - aplicable.discountPct).toDecimalPlaces(4).toNumber();
}
```

> `decimal.js` ya es dependencia de `shared` (el motor lo usa). Si `index.ts` reexporta por carpeta, agregar el export de `store-pricing` donde corresponda.

- [ ] **Step 4: Escribir el test del schema (tramos) y el schema**

Agregar a `store-pricing.spec.ts` (o un spec de schema) los casos de validación, importando `StoreProductCreateSchema`:

```ts
import { StoreProductCreateSchema } from '../schemas/store';

const prod = { name: 'X', priceUsd: 10, minQty: 1 };

describe('priceTiers en StoreProductCreateSchema', () => {
  it('acepta tramos crecientes', () => {
    const r = StoreProductCreateSchema.safeParse({ ...prod, priceTiers: [{ minQty: 10, discountPct: 0.1 }, { minQty: 25, discountPct: 0.2 }] });
    expect(r.success).toBe(true);
  });
  it('rechaza minQty no creciente', () => {
    expect(StoreProductCreateSchema.safeParse({ ...prod, priceTiers: [{ minQty: 25, discountPct: 0.2 }, { minQty: 10, discountPct: 0.1 }] }).success).toBe(false);
  });
  it('rechaza minQty duplicado', () => {
    expect(StoreProductCreateSchema.safeParse({ ...prod, priceTiers: [{ minQty: 10, discountPct: 0.1 }, { minQty: 10, discountPct: 0.2 }] }).success).toBe(false);
  });
  it('rechaza un tramo que no supera el minQty del producto', () => {
    expect(StoreProductCreateSchema.safeParse({ ...prod, minQty: 10, priceTiers: [{ minQty: 10, discountPct: 0.1 }] }).success).toBe(false);
  });
  it('rechaza discountPct fuera de [0,1)', () => {
    expect(StoreProductCreateSchema.safeParse({ ...prod, priceTiers: [{ minQty: 10, discountPct: 1 }] }).success).toBe(false);
  });
  it('sin priceTiers es válido (default [])', () => {
    const r = StoreProductCreateSchema.safeParse(prod);
    expect(r.success && r.data.priceTiers).toEqual([]);
  });
});
```

En `store.ts`, antes de `StoreProductCreateSchema`:

```ts
export const StorePriceTierSchema = z.object({
  minQty: z.number().int().min(2, 'El tramo empieza desde 2 unidades'),
  discountPct: z.number().min(0).lt(1, 'El descuento va entre 0 y menos de 1'),
});
export type StorePriceTier = z.infer<typeof StorePriceTierSchema>;
```

Agregar `priceTiers` dentro del `z.object` de `StoreProductCreateSchema` (junto a `optionGroups`):

```ts
  priceTiers: z.array(StorePriceTierSchema).max(8).default([]),
```

Y envolver el objeto con `.superRefine` (como se hizo con el banner update): validar que `priceTiers` esté estrictamente creciente por `minQty`, sin duplicados, y que el primer `minQty` sea `> minQty` del producto:

```ts
  .superRefine((val, ctx) => {
    const tiers = val.priceTiers ?? [];
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].minQty <= tiers[i - 1].minQty) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceTiers', i, 'minQty'], message: 'Los tramos tienen que ir de menor a mayor cantidad' });
      }
    }
    const min = val.minQty ?? 1;
    if (tiers[0] && tiers[0].minQty <= min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priceTiers', 0, 'minQty'], message: 'El primer tramo tiene que superar el mínimo del producto' });
    }
  });
```

> `StoreProductUpdateSchema = StoreProductCreateSchema.partial()` seguirá funcionando (ZodEffects soporta `.partial()` sobre el objeto base antes del refine — si da problema de tipos, replicar el patrón del Hito B/C: declarar el update como el mismo objeto con `.partial()` aplicado antes del refine, o un objeto propio). Verificar que `tsc` compile.

- [ ] **Step 5: Bump de versión + correr toda la suite**

`SHARED_VERSION = '0.55.0'` y `package.json` version `0.55.0`.
Run: `cd calc3d-api && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: PASS (helper + schema + suite completa sin regresiones).

- [ ] **Step 6: Commit**

```bash
cd calc3d-api && git add packages/shared/src/schemas/store.ts packages/shared/src/calc/store-pricing.ts packages/shared/src/calc/store-pricing.spec.ts packages/shared/src/version.ts packages/shared/package.json packages/shared/src/index.ts && git commit -m "feat(shared): tramos de precio por cantidad + precioConTramos (0.55.0)"
```

---

### Task 2: Modelo + persistencia + exposición pública (API)

**Files:**
- Modify: `calc3d-api/apps/api/prisma/schema.prisma` (model `StoreProduct`: `priceTiers Json @default("[]")`)
- Create: migración `<ts>_store_price_tiers`
- Modify: `calc3d-api/apps/api/src/store/store.service.ts` (create/update guardan `priceTiers`)
- Modify: `calc3d-api/apps/api/src/store-public/store-public.service.ts` (card expone `priceTiers`)
- Modify: `calc3d-api/apps/api/src/store-public/store-public.service.spec.ts`

**Interfaces:**
- Consumes: `priceTiers` del DTO (Task 1).
- Produces: `priceTiers` persistido y expuesto en `PublicProductCard` (`{minQty, discountPct}[]`).

- [ ] **Step 1: Agregar la columna Prisma**

En `model StoreProduct`, junto a `specs`:

```prisma
  /// Tramos de precio por cantidad: [{ minQty, discountPct }] (fracción). JSON
  /// como specs; el descuento lo aplica el servidor en el pedido.
  priceTiers Json @default("[]")
```

- [ ] **Step 2: Migración (parar la API en watch primero)**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec prisma migrate dev --name store_price_tiers`
Expected: `ALTER TABLE "StoreProduct" ADD COLUMN "priceTiers" JSONB NOT NULL DEFAULT '[]'`.

- [ ] **Step 3: Persistir en create/update**

En `store.service.ts`, en el `data` de `create` (línea ~94) y de `update` (línea ~140), agregar el passthrough de `priceTiers`:

```ts
// create: dentro de data { ... }
priceTiers: dto.priceTiers ?? [],
// update: dentro de data { ... } (solo si vino)
...(dto.priceTiers !== undefined && { priceTiers: dto.priceTiers }),
```

> Prisma acepta el array JSON directo. El `productInclude` ya trae el campo escalar.

- [ ] **Step 4: Escribir el test público que falla**

En `store-public.service.spec.ts`, al fixture `PRODUCTO` agregar `priceTiers: [{ minQty: 10, discountPct: 0.1 }]`, y un test:

```ts
it('la vitrina expone los tramos de precio por cantidad', async () => {
  const { service } = makeService();
  const { products } = await service.list();
  expect(products[0].priceTiers).toEqual([{ minQty: 10, discountPct: 0.1 }]);
});
```

- [ ] **Step 5: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public.service`
Expected: FAIL (`priceTiers` undefined en la card).

- [ ] **Step 6: Exponer `priceTiers` en la card**

En `store-public.service.ts`, en la interfaz `PublicProductCard` agregar `priceTiers: { minQty: number; discountPct: number }[]`, y en `card()` mapear:

```ts
priceTiers: Array.isArray(p.priceTiers)
  ? (p.priceTiers as { minQty: number; discountPct: number }[]).map((t) => ({ minQty: Number(t.minQty), discountPct: Number(t.discountPct) }))
  : [],
```

Agregar `priceTiers: unknown` al tipo del parámetro de `card()`.

- [ ] **Step 7: Correr los tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-public.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
cd calc3d-api && git add apps/api/prisma apps/api/src/store/store.service.ts apps/api/src/store-public/store-public.service.ts apps/api/src/store-public/store-public.service.spec.ts && git commit -m "feat(api): columna priceTiers + persistencia + exposicion publica"
```

---

### Task 3: Aplicar los tramos en el pedido (API)

**Files:**
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.ts` (`priceItems` aplica `precioConTramos`)
- Modify: `calc3d-api/apps/api/src/store-requests/store-requests.service.spec.ts`

**Interfaces:**
- Consumes: `precioConTramos` (Task 1), `priceTiers` del producto (Task 2).

- [ ] **Step 1: Escribir el test que falla**

En `store-requests.service.spec.ts`, agregar un producto con `priceTiers` y un test que pida una cantidad que alcanza el tramo, afirmando que el `unitPrice`/total usan el descuento del servidor y que un `unitPrice` en el body se ignora. (Seguir el patrón del fixture de ese spec — el mock de `storeProduct.findFirst`/`findMany` debe devolver `priceTiers`.) Ejemplo del núcleo:

```ts
it('aplica el tramo por cantidad y NO mira ningún precio del cliente', async () => {
  // producto base $10, tramo 10+ = 20% off
  mockProducto({ priceUsd: '10.0000', minQty: 1, priceTiers: [{ minQty: 10, discountPct: 0.2 }], optionGroups: [] });
  const res = await service.create(ORG, { customer: CLIENTE, items: [{ slug: 'x', qty: 10, options: {}, unitPrice: 999 }] as any });
  // 10 u a $8 c/u = $80
  expect(res /* o la línea/total que exponga el service */).toMatchObject({ /* total 80 */ });
});
```

> Ajustar al shape real que devuelve `create`/`priceItems` en ese spec (revisar los tests existentes del archivo para el patrón exacto de aserción y de mock).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service`
Expected: FAIL (hoy cobra $100, no $80).

- [ ] **Step 3: Aplicar el tramo en `priceItems`**

En `store-requests.service.ts`, importar `precioConTramos` de `@calc3d/shared`, y en `priceItems()` después de sumar los recargos de opción (tras el `unitPrice += Number(option.priceDeltaUsd)`, antes del `push`), aplicar:

```ts
const tiers = Array.isArray(product.priceTiers) ? (product.priceTiers as any[]) : [];
unitPrice = precioConTramos(unitPrice, item.qty, tiers);
```

Asegurar que la consulta del producto en `priceItems` (findFirst/findMany) traiga `priceTiers` (es escalar, sale por defecto salvo `select`).

- [ ] **Step 4: Correr los tests + tipos**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest store-requests.service && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add apps/api/src/store-requests && git commit -m "feat(api): el pedido aplica los tramos de precio por cantidad (server-side)"
```

---

### Task 4: Editor de tramos en el panel (web)

**Files:**
- Modify: `calc3d-web/packages/shared/package.json` (bump 0.55.0 tras sync)
- Modify: `calc3d-web/apps/web/src/pages/StoreProductDetail.tsx` (sección "Precios por cantidad")
- Create: `calc3d-web/apps/web/src/pages/StoreProductDetail.tramos.spec.tsx` (jsdom)

**Interfaces:**
- Consumes: `StorePriceTier` / `priceTiers` del DTO (sincronizado).

- [ ] **Step 1: Sincronizar shared y bumpear versión**

Run: `cd calc3d-web && pnpm sync:shared` ; subir `version` a `0.55.0` en `packages/shared/package.json` ; `pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: PASS (0.55.0, incluye store-pricing).

- [ ] **Step 2: Escribir el test de pantalla que falla**

Crear `StoreProductDetail.tramos.spec.tsx` (patrón de los spec jsdom del repo: mock `@/lib/api`): monta la pantalla con un producto, abre/usa la sección "Precios por cantidad", agrega un tramo (desde 10, 10 %), guarda, y afirma que el `PATCH`/`POST` manda `priceTiers: [{minQty:10, discountPct:0.1}]`. (Reusar el patrón de `pages/*.spec.tsx` existentes; mockear `api.get` para devolver el producto y catálogos, `api.patch` para capturar el DTO.)

- [ ] **Step 3: Correr y verificar que falla**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- StoreProductDetail.tramos`
Expected: FAIL (no existe la sección / no manda priceTiers).

- [ ] **Step 4: Implementar la sección**

En `StoreProductDetail.tsx`: estado `tramos` (array `{minQty, discountPct}`), inicializado desde `product.priceTiers`. Una sección con una fila por tramo (`NumberInput` para "Desde (cantidad)" y para "% de descuento", este último en % y se guarda como fracción `/100`), botón "Agregar tramo" y borrar por fila. Validación en cliente antes de guardar (creciente, por encima del `minQty`, % en 0–99) con `notify.error` que **avisa antes** de mandar. En el `guardar`/submit del producto, incluir `priceTiers: tramos` en el DTO.

> Seguir el patrón de "Mayoreo" de la calculadora (`features/calculator/analysis.tsx`) para el look, pero los datos son los del producto, no los del motor.

- [ ] **Step 5: Correr tests + build de tipos**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- StoreProductDetail.tramos && cd apps/web && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Smoke + commit**

Smoke opcional en el navegador (panel 5180 + API 3001): editar un producto, agregar un tramo, guardar, reabrir y ver que quedó. Luego:

```bash
cd calc3d-web && git add packages/shared apps/web/src/pages/StoreProductDetail.tsx apps/web/src/pages/StoreProductDetail.tramos.spec.tsx && git commit -m "feat(web): editor de precios por cantidad en la ficha del producto"
```

---

### Task 5: Tabla de mayoreo + recálculo en la ficha (landing)

**Files:**
- Modify: `calc3d-landing/assets/render.js` (`precioConTramos` + tabla de tramos en `renderFichaHtml`)
- Modify: `calc3d-landing/assets/render.test.js`
- Modify: `calc3d-landing/producto/index.html` (`Pdp.precio` aplica el tramo; recálculo al cambiar cantidad)

**Interfaces:**
- Consumes: `priceTiers` del producto público (Task 2), vía `adapt` (agregar el campo).

- [ ] **Step 1: Escribir el test que falla (helper landing)**

En `assets/render.test.js`, importar `precioConTramos` de `./render.js` y agregar:

```js
test('precioConTramos aplica el mayor tramo aplicable', () => {
  const t = [{ minQty: 10, discountPct: 0.1 }, { minQty: 25, discountPct: 0.2 }];
  assert.equal(precioConTramos(10, 9, t), 10);
  assert.ok(Math.abs(precioConTramos(10, 10, t) - 9) < 1e-9);
  assert.ok(Math.abs(precioConTramos(10, 30, t) - 8) < 1e-9);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL (`precioConTramos` no exportado).

- [ ] **Step 3: Implementar en render.js**

Agregar a `render.js` (puro, mismo criterio que shared; redondeo a 4 decimales con JS):

```js
/** Precio unitario tras el mayor tramo aplicable (minQty <= qty). Sin tramos, baseUnit.
 *  Reimplementa precioConTramos de shared: la landing no importa @calc3d/shared. */
export function precioConTramos(baseUnit, qty, tiers) {
  const t = (tiers || []).filter((x) => qty >= x.minQty).sort((a, b) => b.minQty - a.minQty)[0];
  if (!t) return baseUnit;
  return Math.round(baseUnit * (1 - t.discountPct) * 10000) / 10000;
}
```

En `adapt(p)` agregar `priceTiers: p.priceTiers ?? []`. En `renderFichaHtml`, si `p.priceTiers.length`, incluir una **tabla de mayoreo** bajo el precio ("Desde N u: $X c/u — ahorrás Y %"), calculada con `precioConTramos(p.price, tier.minQty, p.priceTiers)`.

- [ ] **Step 4: Recalcular el unitario al cambiar la cantidad**

En `producto/index.html`, `Pdp.precio()` ya suma recargos de opción; aplicarle el tramo con la cantidad actual: `return precioConTramos(base + recargos, this.cantidad, this.producto.priceTiers)`. Importar `precioConTramos` en el módulo del Pdp. Al cambiar la cantidad (`data-cant`), re-renderizar o actualizar el precio mostrado (hoy solo actualiza `cantVal`; que también recalcule `.pdp-price`). El precio del carrito/WhatsApp usa `this.precio()`; **el que manda sigue siendo el del servidor** al confirmar.

- [ ] **Step 5: Correr tests + build + verificación en navegador**

Run: `cd calc3d-landing && node --test && pnpm build`
Expected: PASS, build OK.
Verificación (API + landing + un producto local con `priceTiers` inyectado): abrir la ficha, ver la tabla de mayoreo, subir la cantidad al tramo y confirmar que el precio unitario baja. Revertir el dato de prueba.

- [ ] **Step 6: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js producto/index.html && git commit -m "feat(landing): tabla de mayoreo y recalculo del unitario por cantidad"
```

---

## Self-Review

**Spec coverage (Feature A):** §4.1 modelo → T2. §4.2 contrato+helper → T1. §4.3 pedido → T3. §4.4 público → T2. §4.5 panel → T4. §4.6 landing → T5. §4.7 compareAt (el tramo descuenta sobre priceUsd, no se apila) → T1 (test "no toca compareAt") + T5 (usa p.price). ✔

**Placeholder scan:** T3 Step 1 dice "ajustar al shape real del spec de store-requests" — es una instrucción de adaptación a un patrón existente nombrado (el archivo tiene sus fixtures), no un placeholder de diseño; el núcleo del test (qty 10 → $80, unitPrice del body ignorado) está dado. T4 Step 2/4 referencian "el patrón de los spec jsdom" nombrando archivos reales. Aceptable; el resto trae código real. ✔

**Type consistency:** `precioConTramos(baseUnit, qty, tiers)` y `StorePriceTier{minQty, discountPct}` se usan igual en T1 (shared), T3 (api), T5 (landing, reimplementado con misma firma). `priceTiers` en la card (T2) y en `adapt` (T5). ✔

**Review Focus:** payload con precio del cliente → T3; borde de tramo / qty baja → T1; tramos inválidos → T1; sin tramos → T1+T3; compareAt → T1. ✔
