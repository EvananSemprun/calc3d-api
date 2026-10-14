# Hito D — SEO (SSG) + responsive/a11y Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un buscador (y el primer render) vean `/tienda/` y cada `/producto/{slug}/` con el CONTENIDO ya escrito en el HTML (pre-render en el build) + `<head>` con meta/Open Graph/JSON-LD, las fichas en el `sitemap.xml`, y un pase responsive/a11y sobre todas las páginas rediseñadas.

**Architecture:** Hito **landing-only** (la API ya expone `/public/store/products` y `/products/{slug}`). Para que el HTML del build y el render del cliente **no diverjan**, las funciones de render se extraen a un módulo **puro** `assets/render.js` (ESM, sin DOM ni `window`), importado por `app.js` (navegador) y por un plugin de build en `vite.config.ts` (Node). El plugin consulta la API en el build (con reintentos; **falla el build** si no responde), pre-renderiza la vitrina y cada ficha, y alimenta el sitemap con los slugs. El JS del cliente sigue potenciando lo interactivo re-renderizando con las MISMAS funciones (markup idéntico). Después, un pase responsive (390×844+) y los arreglos de a11y diferidos del Hito A.

**Tech Stack:** Vite estático sin framework, JS vanilla ESM, `node:test` (sin deps nuevas), nginx en prod.

**Spec:** `calc3d-api/docs/superpowers/specs/2026-10-12-tienda-rediseno-banano-design.md` (Hito D; decisiones del 2026-10-14).

## Global Constraints

- **Repo único: `calc3d-landing`.** Commit por tarea en `main`. **NUNCA push** (la landing hoy no está publicada, pero el remoto es de producción; un push a `main` despliega cuando se publique).
- **No agregar dependencias nuevas.** Los tests de funciones puras van con `node:test` (incluido en Node). El pre-render usa `fetch` nativo de Node 22.
- **`assets/render.js` es PURO**: sin `window`, `document`, `localStorage`, `location`, `fetch`. Solo entra data y sale un string. Es la fuente ÚNICA de markup para build y navegador — si una función de render se duplica, build y cliente divergen (el bug que este hito viene a evitar).
- **El build FALLA si la API no responde** (tras reintentos con espera para el cold start de Render). Nunca se publica una tienda sin el pre-render.
- **El cliente sigue re-renderizando** tras `BL.load()`, reusando las mismas funciones puras: el markup es idéntico, así que el pre-render es aditivo (crawlers + primer paint), no una fuente de verdad paralela.
- **Sin cambios de comportamiento en el navegador en T1–T3** (son extracciones): la tienda, la home y la ficha se ven y funcionan igual que antes.
- **`VITE_SITE_URL`** ya existe (sin ella no se emite sitemap). **`VITE_API_URL`** decide contra qué API consulta el build (igual que el cliente; fallback `http://localhost:3001/api`).
- Idioma de UI y errores: **español**. Escapar SIEMPRE el contenido del dueño en el HTML (`escapeHtml`/`escapeAttr`), también en el build.

## Review Focus

- **El HTML pre-renderizado y el render del cliente coinciden** (mismo producto → mismo markup): si divergen, el cliente "parpadea" o el crawler ve algo distinto del usuario. Lo cubre usar la MISMA función pura en los dos lados; test en T1/T2 compara el string.
- **Dato del dueño con `<`, `"`, `&`, o un `javascript:` en un campo** → escapado en el HTML pre-renderizado (no solo en el cliente). Tests de `escapeHtml`/`metaTagsFor`/`jsonLdProduct` en T1/T3.
- **La API no responde en el build** (Render dormido) → reintenta y, si sigue caída, **falla** con mensaje claro; no emite fichas a medias ni un sitemap con URLs sin página. Test/verificación en T4.
- **Una ficha sin foto / sin specs / sin opciones / `compareAtUsd` null** → el pre-render no rompe y el JSON-LD omite lo que no tiene (no inventa `image` ni `price` inválidos). Tests en T2/T3.
- **Año del footer con la API caída** → se muestra igual (hoy sale de `blPintarNegocio()`, que no corre si `BL.load()` falla). Arreglo + verificación en T5.

---

### Task 1: Extraer `render.js` — escapes, `adapt`, tarjeta de producto

**Files:**
- Create: `calc3d-landing/assets/render.js`
- Create: `calc3d-landing/assets/render.test.js`
- Modify: `calc3d-landing/assets/app.js` (importar en vez de definir; wrappers de navegador)
- Modify: `calc3d-landing/package.json` (script `test`)

**Interfaces:**
- Produces (en `render.js`):
  - `export function escapeHtml(s): string`
  - `export function escapeAttr(s): string`
  - `export function adapt(p): AdaptedProduct` (misma forma que hoy)
  - `export function formatPriceHtml(usd: number, rate: { rate:number, currencyCode:string } | null): string`
  - `export function renderCard(p: AdaptedProduct, rate): string` (lo que hoy hace `blTarjetaProducto`)
- `app.js` mantiene `window.blAdapt`, `window.esc`, `window.blTarjetaProducto`, `window.formatPrice` con el MISMO contrato que hoy (un solo argumento), inyectando `BL.info.rate`.

- [ ] **Step 1: Agregar el script de test y escribir el test que falla**

En `calc3d-landing/package.json`, agregar a `scripts`: `"test": "node --test"`.

Crear `calc3d-landing/assets/render.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, adapt, renderCard, formatPriceHtml } from './render.js';

test('escapeHtml neutraliza < > & " \'', () => {
  assert.equal(escapeHtml('<b>"x"&\'y\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
});

test('adapt mapea la forma de la API a la de la vitrina', () => {
  const p = adapt({
    slug: 'llavero', name: 'Llavero', category: { slug: 'llaveros', name: 'Llaveros' },
    priceUsd: 3.5, compareAtUsd: 5, summary: 'PLA', kind: 'PHYSICAL', minQty: 2,
    material: 'PLA', badge: 'Nuevo', custom: true, leadTimeDays: 5,
    colors: [{ value: 'Rojo', swatchHex: '#f00' }],
  });
  assert.equal(p.id, 'llavero');
  assert.equal(p.price, 3.5);
  assert.equal(p.compareAt, 5);
  assert.equal(p.cat, 'llaveros');
  assert.deepEqual(p.colors, ['Rojo']);
});

test('renderCard escapa el nombre e inserta el tachado cuando hay oferta', () => {
  const p = adapt({ slug: 'x', name: 'Taza <script>', priceUsd: 10, compareAtUsd: 15, minQty: 1 });
  const html = renderCard(p, null);
  assert.ok(html.includes('Taza &lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('$15.00')); // precio tachado
});

test('formatPriceHtml sin tasa es solo USD; con tasa agrega el equivalente', () => {
  assert.ok(!formatPriceHtml(10, null).includes('price-alt'));
  const conBs = formatPriceHtml(10, { rate: 40, currencyCode: 'VES' });
  assert.ok(conBs.includes('price-alt'));
  assert.ok(conBs.includes('VES'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL ("Cannot find module './render.js'").

- [ ] **Step 3: Crear `render.js` moviendo las funciones desde `app.js`**

Crear `calc3d-landing/assets/render.js` con las funciones **movidas tal cual** desde `app.js` (mismas implementaciones), parametrizando la tasa:

```js
// Módulo de render PURO: sin DOM, sin window. Fuente ÚNICA del markup, usada por
// el navegador (app.js) y por el build (vite.config.ts) para que no diverjan.

export function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function escapeAttr(s) {
  return escapeHtml(s);
}

export function adapt(p) {
  const colorList = (p.colors ?? []).map((c) => ({ value: c.value, hex: c.swatchHex }));
  return {
    id: p.slug, name: p.name, cat: p.category?.slug ?? '', catLabel: p.category?.name ?? '',
    price: p.priceUsd, compareAt: p.compareAtUsd, desc: p.summary ?? '', kind: p.kind,
    minQty: p.minQty, material: p.material ?? null,
    materialKey: (p.material ?? '').trim().toLowerCase(),
    badge: p.badge ?? null, custom: !!p.custom, requiresOptions: !!p.requiresOptions,
    specs: p.specs ?? [], ship: p.leadTimeDays != null ? `${p.leadTimeDays} días` : null,
    image: p.image ?? (p.images ? p.images[0] : null),
    images: p.images ?? null, description: p.description ?? null,
    optionGroups: p.optionGroups ?? [],
    colorList, colors: colorList.map((c) => c.value),
  };
}

/** Precio USD con el equivalente en la moneda de la tasa (o solo USD si no hay). */
export function formatPriceHtml(usd, rate) {
  const base = `$${usd.toFixed(2)}<small> USD</small>`;
  if (!rate) return base;
  const alt = (usd * rate.rate).toLocaleString('es-VE', { maximumFractionDigits: 2 });
  return `${base}<span class="price-alt">≈ ${alt} ${rate.currencyCode}</span>`;
}

/** Tarjeta de producto (lo que hoy hace blTarjetaProducto). `rate` para el precio. */
export function renderCard(p, rate) {
  // ... COPIAR el cuerpo actual de blTarjetaProducto de app.js (líneas ~707-751),
  // reemplazando `escapeHtml`/`escapeAttr` por los de este módulo y `formatPrice(p.price)`
  // por `formatPriceHtml(p.price, rate)`. NO cambiar el markup.
}
```

> Acción concreta: cortar de `app.js` las definiciones de `escapeHtml`, `escapeAttr`, `adapt`, `formatPrice` y `blTarjetaProducto`, pegarlas acá, y en `renderCard` cambiar la llamada interna `formatPrice(p.price)` → `formatPriceHtml(p.price, rate)`. El resto del markup queda idéntico.

- [ ] **Step 4: En `app.js`, importar y dejar wrappers de navegador**

Al tope de `app.js`:

```js
import { escapeHtml, escapeAttr, adapt, formatPriceHtml, renderCard } from './render.js';
```

Donde estaban las definiciones, dejar los wrappers que inyectan la tasa del negocio (para que TODOS los llamadores actuales sigan con un solo argumento):

```js
// Wrappers de navegador: la tasa sale del negocio cargado (BL.info.rate).
function formatPrice(usd) { return formatPriceHtml(usd, BL.info.rate); }
function blTarjetaProducto(p) { return renderCard(p, BL.info.rate); }
```

Mantener las asignaciones `window.*` existentes (`window.esc = escapeHtml`, `window.blAdapt = adapt`, `window.blTarjetaProducto = blTarjetaProducto`, `window.formatPrice = formatPrice`). `escapeAttr` sigue disponible en `app.js` por el import.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd calc3d-landing && node --test`
Expected: PASS.

- [ ] **Step 6: Verificar que el navegador NO cambió**

Run: `cd calc3d-landing && pnpm build` (debe compilar sin error). Luego con el dev server (5182) + API (3001): abrir `/` y `/tienda/`, confirmar en consola **cero errores** (`read_console_messages onlyErrors`) y que las tarjetas se ven con precio (y Bs si hay tasa). `window.blTarjetaProducto` sigue existiendo y devolviendo el mismo markup.

- [ ] **Step 7: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js assets/app.js package.json && git commit -m "refactor(landing): extrae render puro (escapes, adapt, tarjeta) a render.js + tests"
```

---

### Task 2: `renderFichaHtml` — cuerpo de la ficha, puro

**Files:**
- Modify: `calc3d-landing/assets/render.js` (agregar `renderFichaHtml`)
- Modify: `calc3d-landing/assets/render.test.js`
- Modify: `calc3d-landing/producto/index.html` (el `Pdp.render` usa la función pura)

**Interfaces:**
- Consumes: `escapeHtml`/`escapeAttr`/`formatPriceHtml` de Task 1.
- Produces: `export function renderFichaHtml(p, opts): string` — `opts = { elegido?, cantidad?, fotoActiva?, rate? }` con defaults (`elegido` = primera opción de cada grupo obligatorio, `cantidad` = `p.minQty || 1`, `fotoActiva` = 0, `rate` = null). Devuelve el `innerHTML` del `<div class="pdp">…` idéntico al que arma `Pdp.render` hoy.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `calc3d-landing/assets/render.test.js`:

```js
import { renderFichaHtml } from './render.js';

const ficha = adapt({
  slug: 'llavero', name: 'Llavero <x>', priceUsd: 10, compareAtUsd: null, minQty: 1,
  summary: 'Resumen', description: 'Descripción larga', kind: 'PHYSICAL', material: 'PLA',
  leadTimeDays: 3, badge: 'Top', custom: true,
  images: [{ url: 'https://cdn/x.jpg', alt: 'foto', width: 800, height: 800 }],
  specs: [{ label: 'Alto', value: '5cm' }],
  optionGroups: [{ name: 'Color', required: true, options: [
    { value: 'Rojo', priceDeltaUsd: 0, swatchHex: '#f00' },
    { value: 'Grande', priceDeltaUsd: 3, swatchHex: null },
  ] }],
});

test('renderFichaHtml arma el nombre (escapado), precio y specs con defaults', () => {
  const html = renderFichaHtml(ficha, { rate: null });
  assert.ok(html.includes('<h1 class="h2">Llavero &lt;x&gt;</h1>'));
  assert.ok(html.includes('$10.00')); // precio base (opción Rojo = +0)
  assert.ok(html.includes('Especificaciones'));
  assert.ok(html.includes('Alto'));
  // La primera opción obligatoria arranca elegida.
  assert.ok(html.includes('pdp-opt on'));
});

test('renderFichaHtml no rompe sin fotos ni specs ni opciones', () => {
  const simple = adapt({ slug: 's', name: 'Simple', priceUsd: 5, minQty: 1 });
  const html = renderFichaHtml(simple, {});
  assert.ok(html.includes('sin foto'));
  assert.ok(!html.includes('Especificaciones'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL ("renderFichaHtml is not a function" o import undefined).

- [ ] **Step 3: Agregar `renderFichaHtml` a `render.js`**

Mover la construcción del string de `Pdp.render` (producto/index.html, el bloque que arma `galeria`/`insignias`/`hechos`/`grupos`/`specs` y el `<div class="pdp">…</div>`) a `render.js` como función pura. La firma:

```js
export function renderFichaHtml(p, { elegido, cantidad, fotoActiva = 0, rate = null } = {}) {
  const elegidas = elegido ?? Object.fromEntries(
    (p.optionGroups ?? [])
      .filter((g) => g.required && g.options.length)
      .map((g) => [g.name, g.options[0].value]),
  );
  const cant = cantidad ?? (p.minQty || 1);
  const precio = (() => {
    let t = p.price;
    for (const g of p.optionGroups ?? []) {
      const op = g.options.find((o) => o.value === elegidas[g.name]);
      if (op) t += op.priceDeltaUsd || 0;
    }
    return t;
  })();
  // ... COPIAR el armado de galeria/insignias/hechos/grupos/specs y el `<div class="pdp">…`
  // de Pdp.render, usando `elegidas`, `cant`, `fotoActiva`, y `formatPriceHtml(precio, rate)`.
  // Markup idéntico al actual.
  return `…`;
}
```

- [ ] **Step 4: `Pdp.render` usa la función pura**

En `producto/index.html`, importar `renderFichaHtml` (el `<script type="module">` del Pdp puede `import { renderFichaHtml } from '/assets/render.js'`). Reemplazar el armado del string por:

```js
document.getElementById('pdp').innerHTML = renderFichaHtml(this.producto, {
  elegido: this.elegido, cantidad: this.cantidad, fotoActiva: this.fotoActiva, rate: BL.info.rate,
});
// ...y dejar el cableado de eventos (thumbs, opts, cantidad, agregar) EXACTAMENTE como está.
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd calc3d-landing && node --test`
Expected: PASS.

- [ ] **Step 6: Verificar la ficha en el navegador (sin cambios)**

`pnpm build` OK. Con API+dev: abrir una ficha real (`/producto/{slug}`), confirmar cero errores de consola, que se ve igual (galería, precio con recargo al cambiar opción, agregar al carrito, specs).

- [ ] **Step 7: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js producto/index.html && git commit -m "refactor(landing): cuerpo de la ficha a renderFichaHtml puro + test"
```

---

### Task 3: Helpers de `<head>` — meta, Open Graph y JSON-LD

**Files:**
- Modify: `calc3d-landing/assets/render.js` (agregar `metaTagsFor`, `jsonLdProduct`)
- Modify: `calc3d-landing/assets/render.test.js`

**Interfaces:**
- Produces:
  - `export function metaTagsFor(p, { siteUrl, path }): string` — devuelve las etiquetas de `<head>` (title NO; title va aparte) para una ficha: `<meta name="description">`, `<link rel="canonical">`, Open Graph (`og:type=product`, `og:title`, `og:description`, `og:url`, `og:image` si hay), `<meta property="product:price:amount/currency">`. Todo escapado.
  - `export function jsonLdProduct(p, { siteUrl, path }): string` — un `<script type="application/ld+json">` con el schema `Product` (name, description, image[], offers{price, priceCurrency:'USD', availability}). Omite `image` si no hay; el JSON se serializa con `JSON.stringify` (no concatenación), que ya escapa comillas; además se escapa `<` para que no cierre el `</script>`.
  - `export function tituloFicha(p, businessName): string` — `"{name} — {businessName}"`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `render.test.js`:

```js
import { metaTagsFor, jsonLdProduct, tituloFicha } from './render.js';

const ctx = { siteUrl: 'https://bananolab.com', path: '/producto/llavero/' };

test('metaTagsFor: description, canonical y OG, todo escapado', () => {
  const p = adapt({ slug: 'llavero', name: 'Llavero "A"', priceUsd: 9.5, summary: 'PLA <b>', minQty: 1,
    images: [{ url: 'https://cdn/x.jpg' }] });
  const h = metaTagsFor(p, ctx);
  assert.ok(h.includes('rel="canonical" href="https://bananolab.com/producto/llavero/"'));
  assert.ok(h.includes('property="og:type" content="product"'));
  assert.ok(h.includes('PLA &lt;b&gt;'));
  assert.ok(h.includes('og:image') && h.includes('https://cdn/x.jpg'));
  assert.ok(h.includes('product:price:amount" content="9.50"'));
});

test('metaTagsFor sin foto omite og:image', () => {
  const p = adapt({ slug: 's', name: 'Simple', priceUsd: 5, minQty: 1 });
  assert.ok(!metaTagsFor(p, ctx).includes('og:image'));
});

test('jsonLdProduct arma Product con offers USD y neutraliza </script>', () => {
  const p = adapt({ slug: 'x', name: 'Taza </script>', priceUsd: 12, summary: 'desc', minQty: 1 });
  const s = jsonLdProduct(p, ctx);
  assert.ok(s.includes('"@type":"Product"'));
  assert.ok(s.includes('"priceCurrency":"USD"'));
  assert.ok(s.includes('"price":"12.00"'));
  assert.ok(!s.includes('</script>')); // el < del nombre va escapado como <
});

test('tituloFicha', () => {
  const p = adapt({ slug: 'x', name: 'Llavero', priceUsd: 1, minQty: 1 });
  assert.equal(tituloFicha(p, 'Banano Lab'), 'Llavero — Banano Lab');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd calc3d-landing && node --test assets/render.test.js`
Expected: FAIL (funciones no existen).

- [ ] **Step 3: Implementar los helpers en `render.js`**

```js
export function tituloFicha(p, businessName) {
  return `${p.name} — ${businessName}`;
}

export function metaTagsFor(p, { siteUrl, path }) {
  const url = `${siteUrl}${path}`;
  const desc = p.desc || p.description || `${p.name} — impresión 3D a pedido.`;
  const foto = p.image?.url;
  const lines = [
    `<meta name="description" content="${escapeAttr(desc)}">`,
    `<link rel="canonical" href="${escapeAttr(url)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:title" content="${escapeAttr(p.name)}">`,
    `<meta property="og:description" content="${escapeAttr(desc)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    foto ? `<meta property="og:image" content="${escapeAttr(foto)}">` : '',
    `<meta property="product:price:amount" content="${p.price.toFixed(2)}">`,
    `<meta property="product:price:currency" content="USD">`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function jsonLdProduct(p, { siteUrl, path }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.desc || p.description || p.name,
    ...(p.image?.url ? { image: [p.image.url] } : {}),
    offers: {
      '@type': 'Offer',
      price: p.price.toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${siteUrl}${path}`,
    },
  };
  // `<` escapado a < para que un nombre con </script> no cierre el bloque.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd calc3d-landing && node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd calc3d-landing && git add assets/render.js assets/render.test.js && git commit -m "feat(landing): helpers de head (meta/OG/JSON-LD) para fichas + tests"
```

---

### Task 4: Plugin de pre-render (SSG) + fichas en el sitemap

**Files:**
- Modify: `calc3d-landing/vite.config.ts` (plugin `prerender()`; el `seo()` incluye los slugs)

**Interfaces:**
- Consumes: `render.js` (`adapt`, `renderCard`, `renderFichaHtml`, `metaTagsFor`, `jsonLdProduct`, `tituloFicha`) importado en Node.
- Produces: en `dist/`: `producto/{slug}/index.html` por cada producto (con `<head>` meta/OG/JSON-LD + `<body>` ficha pre-renderizada), `/tienda/index.html` con la grilla pre-renderizada, y `sitemap.xml` con esas fichas.

- [ ] **Step 1: Plugin que consulta la API en el build con reintentos**

En `vite.config.ts`, agregar un módulo-scope `let catalogo: any[] = []` (compartido con `seo()`) y un plugin:

```ts
import { adapt, renderCard, renderFichaHtml, metaTagsFor, jsonLdProduct, tituloFicha } from './assets/render.js';

const API = (process.env.VITE_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
const SITE = (process.env.VITE_SITE_URL ?? '').trim().replace(/\/+$/, '');

async function fetchConReintentos(url: string, intentos = 6): Promise<any> {
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      ultimoError = new Error(`HTTP ${r.status}`);
    } catch (e) { ultimoError = e; }
    // Espera creciente para el cold start de Render (~50s).
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`No se pudo consultar ${url} tras ${intentos} intentos: ${ultimoError}`);
}
```

- [ ] **Step 2: Pre-renderizar la vitrina por el pipeline de Vite, y las fichas sobre el HTML ya construido**

> **Por qué no `emitFile` con plantillas crudas:** Vite **hashea** `app.js`/`styles.css` (`app-<hash>.js`) y resuelve los parciales (`<!--#include-->`) recién en `transformIndexHtml`. Emitir la plantilla cruda dejaría refs de assets rotas y sin header/footer. Solución: la **vitrina** (que es un input del build) se modifica en `transformIndexHtml` (corre con los assets ya resueltos); las **fichas por slug** (que NO son inputs) se escriben en `closeBundle` usando el `dist/producto/index.html` **ya construido** como plantilla — ese archivo ya tiene los assets hasheados y los parciales resueltos.

```ts
function prerender(): Plugin {
  let infoRate: any = null;
  let outDir = 'dist';
  return {
    name: 'prerender',
    configResolved(config) { outDir = config.build.outDir; },
    async buildStart() {
      const info = await fetchConReintentos(`${API}/public/store/info`);
      infoRate = info?.rate ?? null;
      const { products } = await fetchConReintentos(`${API}/public/store/products`);
      catalogo = [];
      for (const card of products) {
        catalogo.push(await fetchConReintentos(`${API}/public/store/products/${encodeURIComponent(card.slug)}`));
      }
      this.info(`[prerender] ${catalogo.length} fichas desde ${API}`);
    },
    // La VITRINA es un input: se inyecta la grilla en el HTML final (assets ya resueltos).
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!/\/tienda\/index\.html$/.test(ctx.path) && !/^tienda\/index\.html$/.test(ctx.path)) return html;
        const grid = catalogo.map((raw) => renderCard(adapt(raw), infoRate)).join('');
        return html.replace(
          /<div class="grid shop-grid" id="shopGrid">[\s\S]*?<\/div>/,
          `<div class="grid shop-grid" id="shopGrid">${grid}</div>`,
        );
      },
    },
    // Las FICHAS por slug no son inputs: se escriben a disco usando el producto/index.html
    // YA CONSTRUIDO (assets hasheados + parciales resueltos) como plantilla.
    closeBundle() {
      const plantilla = readFileSync(resolve(outDir, 'producto/index.html'), 'utf8');
      const businessName = 'Banano Lab';
      for (const raw of catalogo) {
        const p = adapt(raw);
        const path = `/producto/${p.id}/`;
        const head = `<title>${escapeHtml(tituloFicha(p, businessName))}</title>\n` +
          metaTagsFor(p, { siteUrl: SITE, path }) + '\n' + jsonLdProduct(p, { siteUrl: SITE, path });
        const cuerpo = renderFichaHtml(p, { rate: infoRate });
        const html = plantilla
          .replace(/<title>[\s\S]*?<\/title>/, head)
          .replace('<div class="shop-state"><strong>Cargando…</strong></div>', cuerpo);
        mkdirSync(resolve(outDir, `producto/${p.id}`), { recursive: true });
        writeFileSync(resolve(outDir, `producto/${p.id}/index.html`), html);
      }
    },
  };
}
```

Agregar los imports de Node que falten en `vite.config.ts`: `writeFileSync`, `mkdirSync` (de `node:fs`).

> La ficha "base" `dist/producto/index.html` queda como está (es la que sirve nginx para un slug sin pre-render, y el fallback del cliente). nginx ya sirve `/producto/{slug}/` → como ahora existe `dist/producto/{slug}/index.html`, lo servirá directo (verificar que la config de nginx sirva el `index.html` del subdirectorio; si usa `try_files`, el archivo estático gana).

- [ ] **Step 3: El `seo()` incluye las fichas en el sitemap**

En la función `sitemap()` del plugin `seo()`, después de las `PAGINAS`, agregar las fichas desde `catalogo` (ya poblado en `buildStart` de `prerender`, que corre antes):

```ts
const fichas = catalogo.map((raw) => {
  return `  <url>\n    <loc>${base}/producto/${encodeURIComponent(raw.slug)}/</loc>\n  </url>`;
});
// urls = [...urlsDePaginas, ...fichas]
```

Registrar `prerender()` en `plugins` ANTES de `seo()` (para que `catalogo` esté poblado cuando `seo` genere el sitemap) y después de `parciales()`.

- [ ] **Step 4: Verificar el build contra una API local**

Con la API (3001) levantada y datos locales:

Run: `cd calc3d-landing && VITE_SITE_URL=https://bananolab.test pnpm build`
Expected: build OK; el log dice "[prerender] N fichas".

Verificar el output (sin navegador, leyendo los archivos de `dist/`):
- `dist/producto/{slug}/index.html` existe por cada producto y **contiene** el nombre del producto en el `<body>` (no "Cargando…"), el `<title>` con el nombre, `og:type=product`, el `<script type="application/ld+json">` con `"@type":"Product"`, y el header/footer (parciales resueltos).
- `dist/tienda/index.html` tiene las tarjetas en `#shopGrid` (no el skeleton).
- `dist/sitemap.xml` lista `/producto/{slug}/` además de las páginas.
- `dist/robots.txt` OK.

Comandos de verificación (grep sobre dist):
```bash
ls dist/producto/*/index.html | head
grep -l 'application/ld+json' dist/producto/*/index.html | head -1
grep -c '<url>' dist/sitemap.xml
```

- [ ] **Step 5: Verificar que el cliente re-renderiza sin romper (no diverge)**

Con el build servido (`pnpm preview`) + API: abrir una ficha pre-renderizada. Confirmar: el contenido se ve de inmediato (pre-render), el JS hidrata sin errores de consola, y al interactuar (cambiar opción, agregar al carrito) funciona. El markup pre-renderizado y el del cliente salen de la misma función, así que no hay salto estructural.

- [ ] **Step 6: Commit**

```bash
cd calc3d-landing && git add vite.config.ts && git commit -m "feat(landing): pre-render SSG de fichas y vitrina + fichas en el sitemap"
```

---

### Task 5: A11y — menú móvil, carrusel, un solo h1, año del footer

**Files:**
- Modify: `calc3d-landing/partials/header.html` (`aria-expanded`/`aria-controls` en `.nav-toggle`)
- Modify: `calc3d-landing/assets/app.js` (`blToggleNav` actualiza `aria-expanded`; año del footer independiente de la API)
- Modify: `calc3d-landing/index.html` (ARIA del carrusel; un solo `h1`)

**Interfaces:** sin interfaces compartidas nuevas.

- [ ] **Step 1: `aria-expanded` en el botón del menú**

En `partials/header.html`, al `<button class="nav-toggle" ...>` agregar `aria-expanded="false"` y `aria-controls="navLinks"`.

En `app.js`, `blToggleNav`:

```js
function blToggleNav() {
  const links = document.querySelector('.nav-links');
  const abierto = links?.classList.toggle('open');
  document.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(!!abierto));
}
```

- [ ] **Step 2: Año del footer aunque la API esté caída**

En el bloque de arranque de `app.js` (`window.addEventListener('DOMContentLoaded', …)`), setear el año SIEMPRE (no depende de la API):

```js
document.querySelectorAll('[data-bl="year"]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
```

(Queda duplicado con `blPintarNegocio()`, que lo sigue poniendo; es idempotente y barato. Alternativa: sacarlo de `blPintarNegocio`. Dejar el seteo temprano es lo que garantiza que salga con la API caída.)

- [ ] **Step 3: Carrusel — patrón ARIA tablist/tab/tabpanel**

En `index.html`, el `#heroCarousel`: las slides fijas (`<article class="carousel-slide">`) llevan `id="slide-0"`, `id="slide-1"`, … `role="group"` → `role="tabpanel"` con `aria-labelledby` del dot, o más simple y correcto para un carrusel: marcar los **dots** como `role="tab"` (ya lo son) con `aria-controls="slide-N"` y `aria-selected`, y las slides con `role="tabpanel"` + `aria-roledescription="diapositiva"`. En el script del carrusel (inline), al crear cada dot agregar `d.setAttribute('aria-controls', 'slide-'+n)` y en `go()` setear `aria-selected` del dot activo (ya se hace `aria-selected`), y `slides[i].setAttribute('aria-hidden', ...)`. Asignar ids a las slides al inicio del script:

```js
slides.forEach((s, n) => { s.id = 'slide-' + n; s.setAttribute('role', 'tabpanel'); s.setAttribute('aria-roledescription', 'diapositiva'); });
```

Y en el rebuild de banners administrados, emitir las slides con los mismos atributos.

- [ ] **Step 4: Un solo `h1` en la home**

En `index.html`, el hero fijo tiene un `<h1 class="h1">` por slide (3 slides = 3 h1). Dejar `<h1 class="h1">` SOLO en la primera slide y cambiar las otras a `<h2 class="h1">` (misma clase de estilo, distinto tag). En el rebuild de banners (script del carrusel), emitir la primera slide con `<h1>` y el resto con `<h2>` (índice `n === 0 ? 'h1' : 'h2'`). Verificar que `/tienda/`, `/producto/` e `/impresion-3d/` tengan exactamente un `h1` (la ficha ya usa `<h1 class="h2">` para el nombre; tienda tiene uno en `.shop-head`; revisar impresion-3d).

- [ ] **Step 5: Verificar en el navegador**

`pnpm build` OK. Con dev + API:
- Menú móvil (resize a 390×844): el botón tiene `aria-expanded` que alterna a `true`/`false` al abrir/cerrar (verificar con `read_page` o JS).
- Año del footer: con la API **detenida**, recargar `/` y confirmar que el año igual aparece.
- Carrusel: `document.querySelectorAll('#heroCarousel [role=tab]')` tienen `aria-controls` y el activo `aria-selected="true"`; las slides son `role="tabpanel"`.
- `document.querySelectorAll('h1').length === 1` en `/`, `/tienda/`, `/producto/{slug}`, `/impresion-3d/`.

- [ ] **Step 6: Commit**

```bash
cd calc3d-landing && git add partials/header.html assets/app.js index.html && git commit -m "a11y(landing): aria-expanded del menu, ARIA del carrusel, un h1 por pagina, ano del footer sin API"
```

---

### Task 6: Pase responsive 390×844+ en todas las páginas

**Files:**
- Modify: `calc3d-landing/assets/styles.css` (ajustes puntuales)
- Modify: las páginas que lo necesiten según la auditoría.

**Interfaces:** ninguna.

- [ ] **Step 1: Auditar el desborde horizontal a 390×844 en cada página**

Con dev + API, `resize_window` a 390×844 (mobile) y recargar. Para cada una de `/`, `/tienda/`, `/producto/{slug}`, `/impresion-3d/`, medir en el navegador:

```js
// ¿hay scroll horizontal? qué elemento desborda?
const w = document.documentElement.clientWidth;
const culpables = [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > w + 1)
  .map((e) => e.tagName + '.' + (e.className || '').toString().split(' ')[0]);
({ scrollX: document.documentElement.scrollWidth - w, culpables: [...new Set(culpables)].slice(0, 10) });
```

Anotar en el ledger, por página, `scrollWidth - clientWidth` (debe ser 0) y los elementos que desbordan.

- [ ] **Step 2: Arreglar lo que desborde**

Para cada culpable, el arreglo mínimo en `styles.css` (o la página): `min-width:0` en flex items que no encogen, `max-width:100%` en imágenes/tablas, `flex-wrap`, `overflow-x:auto` en una tabla ancha (`.pdp-specs`), tamaños con `clamp()` en vez de fijos. **No** rediseñar: solo evitar el desborde y que el contenido sea legible y tocable (áreas de toque ≥ 44px donde haya botones chicos).

- [ ] **Step 3: Verificar que no hay desborde en ninguna página**

Re-correr el script del Step 1 en las 4 páginas a 390×844: `scrollWidth - clientWidth === 0` en todas. Tomar una captura de cada una (`computer screenshot`) como evidencia.

- [ ] **Step 4: Verificar que no se rompió el escritorio**

`resize_window` preset `desktop`, recargar las 4 páginas, confirmar que se ven bien (cero errores de consola, layout intacto).

- [ ] **Step 5: Commit**

```bash
cd calc3d-landing && git add -A && git commit -m "responsive(landing): sin desborde horizontal a 390px en todas las paginas"
```

---

## Self-Review

**Spec coverage:**
- SSG de contenido completo de `/tienda/` y `/producto/{slug}/` → T1 (card) + T2 (ficha) + T3 (head) + T4 (plugin). ✔
- Build falla si la API no responde → T4 `fetchConReintentos` + sin try/catch que lo trague. ✔
- Fichas en el sitemap → T4 Step 3. ✔
- Módulo puro compartido para no divergir → T1–T3. ✔
- Responsive 390×844+ → T6. ✔
- A11y diferidos del Hito A (menú, carrusel, h1, año footer) → T5. ✔

**Placeholder scan:** los pasos de T1/T2 dicen "COPIAR el cuerpo actual de X": no es un placeholder de diseño, es una extracción mecánica de código existente y nombrado con su ubicación exacta; el markup objetivo es el que ya existe. El resto trae código real.

**Type/nombre consistency:** `adapt`/`renderCard`/`renderFichaHtml`/`metaTagsFor`/`jsonLdProduct`/`tituloFicha`/`formatPriceHtml` se definen en T1–T3 y se consumen con esos nombres en T4. Los wrappers de navegador (`formatPrice`, `blTarjetaProducto`) conservan el contrato de un argumento que usan home/tienda/producto. ✔

**Review Focus:** (1) no-divergencia → misma función pura, tests de markup en T1/T2; (2) escape de datos del dueño en el build → tests de escape en T1/T3; (3) API caída en el build → T4 falla con reintentos; (4) ficha sin foto/specs/opciones/compareAt → tests en T2/T3; (5) año del footer con API caída → T5 Step 2 + verificación. ✔

**Hashing de assets (resuelto en T4 Step 2):** Vite hashea `app.js`/`styles.css`, así que NO se emiten plantillas crudas. La vitrina se inyecta vía `transformIndexHtml` (post, assets ya resueltos) y las fichas se escriben en `closeBundle` usando el `dist/producto/index.html` ya construido como plantilla (hereda assets hasheados + parciales resueltos). Queda por verificar en T4 Step 4 que nginx (`calc3d-landing/nginx.conf`) sirva `dist/producto/{slug}/index.html` para `/producto/{slug}/` (con `try_files` el archivo estático gana; si reescribe todo `/producto/` a `producto/index.html`, ajustar para que un subdirectorio con `index.html` tenga prioridad).
