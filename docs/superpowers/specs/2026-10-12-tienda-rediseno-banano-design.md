# Rediseño de la tienda Banano Lab — Diseño

**Fecha:** 2026-10-12
**Repos afectados:** `calc3d-landing` (tienda pública), `calc3d-api` (backend), `calc3d-web` (panel admin)
**Estado:** propuesta — pendiente de revisión del dueño

> Repo de referencia (solo lectura, NO se toca): `proyecto_mayorista/backend-mayorista`.
> De ahí se porta el patrón de banners, adaptándolo a la infraestructura de calc3d.

---

## 1. Contexto y objetivo

La tienda pública de Banano Lab (`calc3d-landing`) es una vitrina estática (Vite, sin
React) que consume la API pública de `calc3d-api` y cierra los pedidos por WhatsApp. El
dueño quiere:

1. **Reenfocarla 100 % en impresión 3D**, quitando todo lo de programación.
2. **Rediseñar la home** con una estructura tipo e-commerce (referencia: tienda de Bambu
   Lab) y la **identidad de marca Banano Lab** (navy + amarillo, Poppins, mascota).
3. **Sumar banners administrables** y un **Flash Sale** con ventana y contador.
4. **Arreglar** el SEO de vitrina/fichas y revisar el responsive.

**Regla transversal:** todo ajuste de la tienda (productos, banners, descuentos, ventana de
oferta) se gestiona **desde el panel admin** (`calc3d-web`). Nada se edita a mano en la base.

**Stack sin cambios:** Vite estático + HTML/CSS/JS, sin React. (Se evaluó una reescritura
total y un cambio a React; se descartó porque la vitrina es de solo lectura, el HTML plano
se indexa mejor y el código actual —~800 líneas de JS, ~670 de CSS— es mantenible.)

---

## 2. Alcance

### Se elimina
- Página `/programacion/` (archivo, ruta, nav, footer, `vite.config.ts`, lista `PAGINAS`).
- Página `/calculadora/` (ídem) — con ella muere el `PRECIOS` provisional pendiente.
- El inicio deja de ser "las dos mitades del negocio"; pasa a una sola historia: impresión 3D.

### Páginas que quedan
`/` (home rediseñada) · `/tienda/` · `/producto/{slug}` · `/impresion-3d/`.
El modal de "pieza a medida" se conserva (es parte del flujo de impresión).

### En alcance
- Rediseño visual completo de la tienda con la marca Banano Lab, tema **oscuro (navy) en
  todo el sitio**.
- Home con la estructura de bandas de §4.
- Banners administrables (modelo + CRUD admin + endpoint público + consumo en la home).
- Flash Sale: ventana global (fechas) + contador + sección en la home.
- SEO: pre-render en el build de tienda y fichas.
- Revisión responsive/móvil del rediseño.

### Fuera de alcance (explícito)
- Pago real / pasarela (se mantiene carrito → WhatsApp).
- Cuentas de cliente (se mantiene pedido como invitado: nombre + WhatsApp).
- Stock real (se mantiene "listo en N días", producción bajo pedido).
- Multi-idioma, blog, reseñas, buscador.
- Múltiples promociones agendadas (una ventana de oferta a la vez — ver §6.3).
- Que el Flash Sale **cobre menos**: solo tacha el precio (decisión del 2026-10-12, ver §10).
- Automatizar el rebuild ante cambios de catálogo (el pre-render corre en cada deploy).

---

## 3. Dirección de marca y diseño

Fuente: manual de marca `CONTENIDO COMPLETO.pdf` + activos en `Downloads\3d\BananoLAB\`.

### Paleta (tokens CSS)
Tema **oscuro navy en todo el sitio**, amarillo como acento/CTA/precio.

| Token | HEX | Uso |
|---|---|---|
| `--navy-900` | `#000814` | Fondos más profundos, pie |
| `--navy-800` | `#001D3D` | Fondo base del sitio |
| `--navy-600` | `#003566` | Tarjetas, bandas, bordes sutiles |
| `--amber` | `#FFC300` | Acento secundario, insignias |
| `--yellow` | `#FFD60A` | CTA primario, precios, enlaces activos |

Texto: blanco / amarillo sobre navy. Contraste alto (ya cumple AA el amarillo sobre navy).

### Tipografía
**Poppins** (Google Fonts): `Bold (700)` para texto y botones, `Black (900)` para títulos de
banda y hero. Una sola familia.

### Logo e isotipo
De `BananoLAB/LOGOS/`: usar variantes **amarillo/blanco** sobre navy (header, pie). Isotipo
(el banano en el marco de escaneo) para el favicon y la foto de perfil.

### Mascota "Banano" (`BananoLAB/MASCOTA/`)
Uso con criterio (sin saturar):
- `BANANO_HOLA` → hero / bienvenida.
- `BANANO_LAPTOP` / `BANANO_CHAMBA` → sección de proceso / "cómo trabajamos".
- `IMPRESORA 3D` → página `/impresion-3d/`.
- `BANANO_MOLESTO` / `BANANO_PC_DAÑADA` → estados de error, 404, catálogo vacío.
- `BANANO_MINIBANANO` → acentos chicos.

### Activos en el repo
Los PNG elegidos se **copian a `calc3d-landing/assets/brand/`** (hoy viven fuera del repo, en
Downloads). Se versionan con el repo. (Si más adelante hay SVG, mejor; los PNG con fondo
transparente alcanzan.)

### Convención que se retira
`assets/styles.css` dejaba de "copiarse" del diseño de Claude Design y volvía a sincronizarse.
Con este rediseño, **la landing pasa a ser la fuente de verdad de su propio CSS**. Se
actualiza el `CLAUDE.md` del repo para reflejarlo.

---

## 4. Estructura de la home (de arriba a abajo)

Referencia de ritmo: tienda de Bambu Lab. Contenido: real, de la API; nada inventado.

1. **Barra informativa superior** — franja fina navy, un mensaje + (opcional) selector. El
   texto lo define el dueño. *(Contenido fijo por ahora; podría volverse administrable en
   otra vuelta — fuera de alcance.)*
2. **Carrusel de banners grandes (hero)** — Hito A: banners **fijos (placeholder)** en el
   código. Hito B: **administrables** desde el panel, sin rehacer el diseño.
3. **Flash Sale** — Hito C: sección con contador regresivo durante la ventana activa; muestra
   los productos con `compareAtUsd > priceUsd`. Si no hay ventana activa **o no hay productos en
   oferta**, la sección **no se renderiza**. El tachado de catálogo/ficha es independiente de la
   ventana (siempre visible donde haya descuento).
4. **Tira de destacados** — fila de productos destacados reales (de la API).
5. **Bloques por categoría** — automáticos desde `StoreCategory` (orden por `position`), cada
   uno con sus productos visibles y "Ver todo" → `/tienda/?cat={slug}`. Una categoría sin
   productos no genera bloque.
6. **Banda de beneficios reales** — hecho a pedido, atención por WhatsApp, pago al coordinar,
   "listo en N días". Nada de garantías que no se dan.
7. **Proceso + FAQ** — rediseñados (se conservan de la home actual).
8. **Footer**.

---

## 5. Hitos (orden de ejecución dentro del spec único)

### Hito A — Limpieza + rediseño visual (solo `calc3d-landing`, sin backend)
- Quitar `/programacion/` y `/calculadora/` y todas sus referencias (nav, footer,
  `vite.config.ts` → `rollupOptions.input` y `PAGINAS`, SEO).
- Copiar activos de marca a `assets/brand/`.
- Reescribir `assets/styles.css` con los tokens de §3 (tema oscuro navy, Poppins).
- Reescribir `index.html` (home) con las bandas de §4; carrusel con banners **fijos**.
- Ajustar `partials/header.html` y `footer.html` a la nueva marca y sin los enlaces muertos.
- Rediseñar `/impresion-3d/`, `/tienda/` y `/producto/{slug}` al nuevo tema.
- **Entregable:** la tienda se ve nueva y completa, sin depender de nada nuevo del backend.

### Hito B — Banners administrables (`api` + `web` + `landing`)
- **API:** modelo `StoreBanner` (§6.1), CRUD admin con permiso + auditoría, endpoint público
  `GET /public/store/banners`. Imagen a **R2** reutilizando el flujo de DOS pasos que ya usan
  las fotos de ficha (`storage/object-storage.service.ts`): el panel pide una **URL firmada**
  (`POST .../images/upload-url`), sube el archivo DIRECTO al bucket y confirma
  (`POST .../images`), y el backend verifica con `HeadObject` (tipo, tamaño, prefijo de clave
  `{organizationId}/...`). **NO** multipart con `FileInterceptor` (eso es del repo de
  referencia, que usa Cloudflare Images).
- **Panel:** pantalla/administrador de banners en `features/store/` (subir imagen, título,
  subtítulo, destino, orden, visible). Reordenar reutilizando el patrón de `ReorderControls`.
- **Landing:** el carrusel pasa de fijo a consumir `GET /public/store/banners`.

### Hito C — Flash Sale (`api` + `web` + `landing`) — **superficie de dinero**

> **Decisiones del 2026-10-13 (cuestionario):**
> 1. **La ventana SOLO manda la sección de la home.** El precio tachado de catálogo y ficha
>    **queda como está** (siempre visible donde `compareAtUsd > priceUsd`, más la insignia
>    "Oferta" — ver `calc3d-landing/assets/app.js`). La ventana NO condiciona ese tachado; solo
>    agrega/controla la sección Flash Sale de la home. Consecuencia explícita: la ventana no
>    cambia qué productos se ven en oferta, solo los resalta con urgencia y contador.
> 2. **Endpoint público dedicado** `GET /public/store/sale` (no se mete `sale` en `/info`).
> 3. **Fechas en hora de Venezuela** (America/Caracas, UTC−4) en el panel; se guardan en UTC.
> 4. **Sección vacía = no renderizar**: si la ventana está activa pero ningún producto tiene
>    `compareAtUsd > priceUsd`, la sección no aparece.

- **shared:** campos de oferta en el schema de `Settings` (título + fechas), validando
  `saleEndsAt > saleStartsAt`. Subir `SHARED_VERSION` + `package.json` a la par y `sync:shared`.
- **API:** campos de ventana en `Settings` (§6.3) + migración. Helper único `activeSale(settings,
  now)` → devuelve la ventana solo si `now ∈ [saleStartsAt, saleEndsAt]` y ambas fechas están
  definidas; si no, `null`. **Endpoint nuevo** `GET /public/store/sale` (mismo `Cache-Control` y
  `ProxyThrottlerGuard` que el resto del público): devuelve `{ title, startsAt, endsAt, products:
  [...] }` **solo si** hay oferta activa **y ≥1 producto** con `compareAtUsd > priceUsd`
  (reutilizando la lista blanca de productos que ya existe, orden de catálogo); si no, respuesta
  vacía (`{ sale: null }`). Así "sin ventana" y "ventana vacía" colapsan en lo mismo → el cliente
  simplemente no renderiza. **`GET /public/store/info` NO se toca.** Admin: guardar
  `saleTitle/saleStartsAt/saleEndsAt` bajo `JwtAuthGuard` donde vivan los ajustes de tienda.
- **Panel:** control de oferta (título + fecha/hora inicio y fin) en los ajustes de tienda,
  editado y mostrado en **hora de Venezuela** y guardado en UTC. El descuento por producto
  (`compareAtUsd`) **ya se edita** en `StoreProductDetail.tsx` — no se toca, solo se documenta
  que es la fuente del precio tachado.
- **Landing:** sección Flash Sale en la home que consulta `GET /public/store/sale`; si viene
  vacía, no renderiza. Si viene con datos: título + **contador regresivo** hasta `endsAt` + fila
  de esos productos con precio tachado y **% OFF** = `(compareAtUsd − priceUsd) / compareAtUsd`.
  El precio tachado y el % OFF se muestran pero **nunca se mandan** al backend; el pedido se cobra
  `priceUsd` (ver decisión en §10: **solo tacha**). Al llegar el contador a 0, muestra "Oferta
  finalizada" hasta recargar (no se auto-oculta en vivo). El tachado de catálogo/ficha no se toca.
- **Tests (§10).** Con "solo tacha", el hito es mayormente presentación: no cambia el cálculo
  del pedido ni el modelo del precio. Cubrir: `/public/store/sale` (solo visibles, solo con
  `compareAtUsd > priceUsd`, lista blanca sin campos internos, vacío fuera de ventana, vacío sin
  productos, respeta `STORE_ORGANIZATION_ID`), helper `activeSale` (antes/durante/después,
  fechas incompletas), y la regresión de que el pedido sigue cobrando `priceUsd` (un
  `unitPrice`/`compareAt` en el payload se ignora; el Flash Sale no agrega camino para mandar
  precio).

### Hito D — SEO + responsive

> **Decisiones del 2026-10-14 (cuestionario):**
> 1. **Pre-render de CONTENIDO COMPLETO (SSG)**, no solo metadatos: el `<body>` de `/tienda/` y
>    de cada `/producto/{slug}/` sale del build con los productos ya escritos en el HTML, más
>    `<head>` con meta description, canonical, Open Graph y JSON-LD `Product`. El JS del cliente
>    sigue potenciando lo interactivo.
> 2. **El build FALLA si la API no responde** (con reintentos/espera para el cold start de
>    Render): nunca se publica una tienda con el SEO roto.
> 3. **SEO y responsive/a11y van en UN solo plan** (hito landing-only; la API ya expone todo).

- **SEO:** para que el HTML del build y el render del cliente **no diverjan**, las funciones de
  render se extraen a un módulo **puro** (`assets/render.js`: `escapeHtml`/`escapeAttr`/`adapt`/
  `blTarjetaProducto`/`renderFichaHtml` + helpers de `<head>` `metaTagsFor`/`jsonLdProduct`),
  importado por `app.js` (navegador) **y** por un plugin de build en `vite.config.ts` (Node). El
  plugin consulta `${VITE_API_URL}/public/store/products` + `/products/{slug}` (con reintentos),
  pre-renderiza `/tienda/` y cada `/producto/{slug}/`, y **esos slugs entran al `sitemap.xml`**
  (hoy excluido a propósito). Tests de las funciones puras con `node:test` (sin deps nuevas).
- **Responsive:** revisión y ajuste móvil de todas las páginas rediseñadas (390×844 y arriba).
- **A11y (diferidos del Hito A):** `aria-expanded` del menú móvil; patrón ARIA del carrusel del
  hero (tablist/tab/`aria-selected`/`aria-controls` + slides como `tabpanel`); **un solo `h1` por
  página** (el hero tiene uno por slide); y el **año del footer** se setea aunque la API esté
  caída (hoy sale de `blPintarNegocio()`, que no corre si `BL.load()` falla).

---

## 6. Modelo de datos (cambios en `calc3d-api/apps/api/prisma/schema.prisma`)

### 6.1 Nuevo modelo `StoreBanner`
Multi-tenant (pertenece a `Organization`, como `StoreCategory`/`StoreProduct`). Imagen en R2
(se guarda la **clave**, no la URL, igual que `StoreImage`).

```prisma
enum StoreBannerLinkType {
  NONE
  CATEGORY
  PRODUCT
  URL
}

model StoreBanner {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String

  title      String
  subtitle   String?
  imageKey   String   // clave del objeto en R2 (como StoreImage.key)

  // Destino opcional, UN solo tipo por banner:
  linkType   StoreBannerLinkType @default(NONE)
  linkValue  String?             // slug de categoría, slug de producto, o URL http/https

  position   Int      @default(0)   // orden en el carrusel
  visible    Boolean  @default(true)

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([organizationId])
  @@index([organizationId, visible])
}
```

> Diferencia con el repo de referencia (mayorista): allí el banner ordena por `createdAt` y la
> imagen va a Cloudflare Images. Acá se agrega `position` (un carrusel necesita orden
> explícito) y la imagen va a **R2** (la infraestructura propia de calc3d). El destino es
> polimórfico de un solo tipo (`linkType` + `linkValue`) en vez de un FK a `productGroup`.

### 6.2 Validación de `linkValue` según `linkType`
- `NONE` → `linkValue` nulo.
- `CATEGORY` → slug de una `StoreCategory` existente de la organización.
- `PRODUCT` → slug de un `StoreProduct` visible de la organización.
- `URL` → http/https con protocolo (misma regla que el repo de referencia; un `javascript:`
  no debe terminar en un href). Validar en el DTO.

### 6.3 Ventana de Flash Sale en `Settings`
Campos nullables (una ventana a la vez):

```prisma
// En model Settings:
saleTitle    String?
saleStartsAt DateTime?
saleEndsAt   DateTime?
```

La oferta está **activa** cuando `now()` ∈ [`saleStartsAt`, `saleEndsAt`] y ambas fechas están
definidas. El descuento por producto sigue en `StoreProduct.compareAtUsd` (ya existe).

---

## 7. API (cambios en `calc3d-api`)

Controlador público actual: `@Controller('public/store')` con `info`, `categories`,
`products`, `products/:slug`.

- **Nuevo** `GET /public/store/banners` — lista los banners `visible: true` de la organización
  de la tienda, ordenados por `position`. Devuelve `{ title, subtitle, imageUrl, linkType,
  linkValue, position }`. Resuelve la URL pública de R2 (como hace hoy con las fotos de ficha).
- **Nuevo** `GET /public/store/sale` (decisión del 2026-10-13) — devuelve `{ title, startsAt,
  endsAt, products: [...] }` **solo si** la ventana está activa **y** hay ≥1 producto con
  `compareAtUsd > priceUsd`; si no, `{ sale: null }`. Los productos reutilizan la MISMA lista
  blanca que `GET /public/store/products` (orden de catálogo). **`GET /public/store/info` NO se
  toca** (el `sale` va en este endpoint dedicado, no en `info`).
- **Admin de banners** — nuevo módulo `banners/` (o dentro de `store/`): `POST`, `PUT /:id`,
  `DELETE /:id`, `GET`, `GET /:id`, guardados con `JwtAuthGuard` + rol + permiso. La imagen
  entra por el flujo de URL firmada de R2 (igual que `StoreImage`), no por multipart.
  **Auditoría con lista blanca** de campos (nunca el DTO entero), como el repo de referencia.
- **Admin de la ventana de oferta** — se expone vía el endpoint de ajustes existente (los
  campos nuevos de `Settings`).

Todos los endpoints públicos **nunca** devuelven costos ni origen de costeo (ya está fijado
con tests en `store-public.service.spec.ts`; mantener).

---

## 8. Panel admin (cambios en `calc3d-web`)

- **Banners:** nueva vista en `features/store/` + `api.ts`: subir imagen, título, subtítulo,
  destino (selector de tipo → categoría/producto/URL/ninguno), orden (reutilizar
  `ReorderControls`), visible. Punto de entrada desde `pages/Store.tsx`.
- **Ventana de oferta:** control de título + fechas (inicio/fin) donde vivan los ajustes de la
  tienda.
- **Descuento por producto:** ya existe ("Precio tachado (USD)" en `StoreProductDetail.tsx`).
  Solo se documenta su rol en el Flash Sale.
- **shared:** si cambian contratos Zod, se editan en `calc3d-api/packages/shared` (fuente de
  verdad) y se traen a `calc3d-web` con `pnpm sync:shared` (regla del monorepo). Subir
  `SHARED_VERSION` en ambos repos a la par.

---

## 9. Invariantes a NO romper (del CLAUDE.md)

- El **precio NUNCA se manda** desde la landing; lo calcula el servidor. El payload de pedido
  sigue siendo `{ slug, qty, options }`.
- Todo lo interpolado en HTML se **escapa** (`esc`/`escapeHtml`). Las URLs de banner solo
  http/https.
- **Nada inventado:** sin contadores falsos de proyectos/clientes, sin reseñas, sin stock, sin
  garantías que no se dan.
- Base de costeo en **USD**; bolívares son presentación con la tasa de la API.
- Puerto **5182** fijo (CORS `STORE_ORIGIN`); `strictPort`.
- Pedido como **invitado** (nombre + WhatsApp); la venta no se pierde si falla el guardado (se
  ofrece igual el botón de WhatsApp).

---

## 10. Seguridad y tests anti-exploit

> **DECISIÓN CERRADA (2026-10-12): el Flash Sale SOLO TACHA.** Durante la ventana se muestra
> `compareAtUsd` como precio viejo tachado y el % OFF, pero **el pedido se cobra `priceUsd`**
> (el precio efectivo NO baja). `compareAtUsd` sigue siendo "solo presentación", como dice hoy
> el schema. Esto quita la superficie de dinero del Hito C: la ventana y el contador son
> presentación pura, no cambian el modelo de datos del precio ni el cálculo del pedido.
> *(Si en el futuro se quiere que el Flash Sale cobre menos, es un cambio aparte con su propia
> lógica server-side y sus tests — fuera de alcance de este spec.)*

Aun con "solo tacha", el rediseño toca superficie sensible y conserva/extiende estas
regresiones (TDD de seguridad: primero el test que falla, después el fix):

- **El precio sigue sin viajar desde el cliente.** El pedido sigue mandando
  `{ slug, qty, options }` y el servidor cobra `priceUsd` + recargos. Un `unitPrice`/`compareAt`
  en el payload se ignora (regresión ya existente en `store-requests` — mantenerla). El Flash
  Sale **no** agrega un camino para mandar precio.
- **URL de banner maliciosa.** `linkType: URL` con `javascript:` u otro protocolo → rechazado
  por el DTO. Test de regresión nuevo.
- **IDOR de destino de banner.** `linkValue` de tipo `CATEGORY`/`PRODUCT` se valida contra la
  organización de la tienda, nunca contra un parámetro del cliente. Test.
- **Autorización.** Los endpoints de banners y de la ventana de oferta exigen sesión + rol +
  permiso. Test: sin sesión / rol insuficiente → 401/403.
- **Fuga de costos.** `GET /public/store/banners` e `info` no devuelven costos ni origen de
  costeo. Extender los tests de `store-public.service.spec.ts`.

---

## 11. Orden de ejecución

1. **Hito A** (landing-only): entrega valor visible sin tocar backend. Desbloquea todo.
2. **Hito B** (banners): el carrusel pasa de fijo a administrable.
3. **Hito D-SEO** puede ir en paralelo a B (es landing + build).
4. **Hito C** (Flash Sale): último, por ser superficie de dinero; va con sus tests en verde.
5. **Hito D-responsive:** cierre transversal sobre todo lo rediseñado.

Cada hito deja la tienda en un estado desplegable. Los repos **no se pushean** sin pedido del
dueño (un push a `main` es un despliegue — ver producción en el CLAUDE.md raíz).

---

## 12. Activos y pendientes

- **Activos de marca:** copiar de `Downloads\3d\BananoLAB\LOGOS\` y `\MASCOTA\` a
  `calc3d-landing/assets/brand/`. Elegir variantes amarillo/blanco para navy.
- **Barra informativa:** el dueño define el texto.
- **Banners placeholder (Hito A):** el dueño pasa 2-3 imágenes/textos, o se usan destacados
  reales mientras tanto.
- ~~Decisión de dinero (§10)~~ → **CERRADA el 2026-10-12: el Flash Sale solo tacha** (se cobra
  `priceUsd`). Sin superficie de dinero nueva en el Hito C.
