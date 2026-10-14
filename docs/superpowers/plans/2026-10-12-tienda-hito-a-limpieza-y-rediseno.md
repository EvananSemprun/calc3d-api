# Tienda Banano Lab — Hito A: Limpieza + rediseño visual — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reenfocar la tienda pública (`calc3d-landing`) en impresión 3D y rediseñar su home con la estructura estilo Bambu Lab y la identidad de marca Banano Lab, sin tocar backend.

**Architecture:** Sitio estático Vite (HTML + CSS + JS de navegador, **sin React**). Se quitan las páginas de programación y calculadora, se reescribe `assets/styles.css` (tipografía Poppins, activos de marca, tema navy ya existente) y el HTML de la home se rearma en bandas (barra info → carrusel fijo → Flash Sale placeholder oculto → destacados → bloques por categoría → beneficios → proceso → FAQ). Las páginas `/tienda/`, `/producto/` e `/impresion-3d/` se re-estilan **preservando intactos sus hooks de JS**. El catálogo sigue viniendo de la API pública; esta fase no cambia ningún contrato.

**Tech Stack:** Vite 6, HTML5, CSS (custom properties), JavaScript ES modules de navegador. Fuente Poppins (Google Fonts). Imágenes PNG de marca.

**Spec:** `docs/superpowers/specs/2026-10-12-tienda-rediseno-banano-design.md` (hito A; §2 alcance, §3 marca, §4 estructura de la home).

## Global Constraints

- **Stack sin React, sin Tailwind.** Solo Vite + HTML/CSS/JS. No agregar dependencias nuevas sin justificar.
- **Tema oscuro navy en todo el sitio.** Paleta exacta: `--ink-900:#000814`, `--ink-700:#001D3D`, `--ink-600:#003566`, `--yellow:#FFC300`, `--yellow-2:#FFD60A`. (Ya están en `:root`; se conservan.)
- **Tipografía Poppins**: `700` (Bold) para cuerpo/botones, `900` (Black) para títulos display. Vía Google Fonts (`@import` en `styles.css`).
- **Nada inventado** (§3, §4 del spec): sin contadores de proyectos/clientes, sin reseñas/estrellas, sin stock ("En stock"), sin garantías que no se dan. Solo contenido verdadero (materiales, proceso, "listo en N días").
- **El precio NUNCA se manda desde la landing.** Esta fase no toca el carrito ni el envío del pedido; no agregar `unitPrice` a ningún payload.
- **Escapar todo lo interpolado en HTML** con `esc`/`escapeHtml` de `app.js` (ya existen). Cualquier render nuevo que arme HTML con datos de la API usa `esc`.
- **Puerto 5182 fijo** (`vite.config.ts` `server.port` + `strictPort`): el navegador y la API validan ese origen exacto (CORS `STORE_ORIGIN`). No cambiarlo.
- **Activos de marca** se copian a `calc3d-landing/assets/brand/` y se versionan. Origen: `C:\Users\evanan-it\Downloads\3d\BananoLAB\` (carpetas `LOGOS/` y `MASCOTA/`).
- **No escribir la marca de inclusión literal (`<!--#include ...-->`) dentro de un comentario HTML**: un comentario anidado rompe el parser de Vite con un error que no menciona el parcial.
- **Convención que se retira:** `styles.css` deja de ser copia del diseño de Claude Design; la landing pasa a ser la fuente de verdad de su CSS. Actualizar el `CLAUDE.md` del repo (Tarea 10).
- **Git:** no commitear/pushear salvo pedido explícito. Cada tarea deja los cambios staged con su mensaje sugerido; el dueño decide cuándo commitea. (Un push a `main` despliega.)

## Review Focus

Entradas/condiciones que el spec implica y que conviene cubrir explícitamente:

1. **API caída al cargar la home.** La home no puede quedar en blanco: si `BL.load()` falla, las secciones dinámicas (destacados, bloques por categoría, Flash Sale) se ocultan y el resto de la página (hero, beneficios, proceso, FAQ) sigue en pie. (Cubierto en Tareas 5 y 6; verificar cortando la API.)
2. **Carrusel con `prefers-reduced-motion`.** El auto-avance debe detenerse cuando el usuario pidió menos movimiento. (Cubierto en Tarea 4.)
3. **Navegación por teclado y foco visible.** El carrusel (prev/next/dots), el toggle de menú móvil y los enlaces nuevos deben ser operables por teclado con foco visible. (Cubierto en Tareas 3, 4; regla `:focus-visible` ya existe en `styles.css`.)
4. **Categoría sin productos / catálogo vacío.** Un bloque de categoría sin productos no se renderiza; si no hay ninguna categoría con productos, la sección entera se oculta (no deja un título colgando). (Cubierto en Tarea 5.)
5. **Texto de banner/placeholder muy largo y pantalla angosta (360–390px).** El carrusel y las bandas no deben desbordar ni generar scroll horizontal a ancho de teléfono. (Verificar en cada tarea visual; el pase responsive dedicado es el Hito D.)

---

## Task 1: Quitar programación y calculadora

Elimina las dos páginas y TODA referencia a ellas (build, SEO, nav, pie, enlaces del inicio), dejando el sitio compilando y sin enlaces muertos.

**Files:**
- Delete: `programacion/index.html`, `calculadora/index.html` (y sus carpetas si quedan vacías)
- Modify: `vite.config.ts` (constante `PAGINAS` y `rollupOptions.input`)
- Modify: `partials/header.html:22-23` (enlaces de nav)
- Modify: `partials/footer.html:15-17` (columna "Qué hacemos")
- Modify: `index.html` (enlaces a `/programacion/` y `/calculadora/`)

**Interfaces:**
- Consumes: nada.
- Produces: un árbol sin `/programacion/` ni `/calculadora/`; `PAGINAS` y `rollupOptions.input` sin esas entradas. Las demás tareas asumen que esas rutas ya no existen.

- [ ] **Step 1: Borrar las dos páginas**

```bash
cd "calc3d-landing"
rm -rf programacion calculadora
```

- [ ] **Step 2: Sacarlas del build y del SEO en `vite.config.ts`**

En `const PAGINAS` quitar las entradas `'/programacion/'` y `'/calculadora/'`. En `build.rollupOptions.input` quitar las líneas `programacion: resolve(__dirname, 'programacion/index.html')` y `calculadora: resolve(__dirname, 'calculadora/index.html')`. Dejar `index`, `tienda`, `producto`, `impresion3d`.

- [ ] **Step 3: Quitar los enlaces muertos del header**

En `partials/header.html`, borrar estas dos líneas del bloque `<nav class="nav-links">`:

```html
      <a href="/programacion/">Programación</a>
      <a href="/calculadora/">Calculadora</a>
```

- [ ] **Step 4: Quitar los enlaces muertos del footer**

En `partials/footer.html`, la columna "Qué hacemos" queda solo con impresión 3D:

```html
      <div>
        <h4>Qué hacemos</h4>
        <a href="/impresion-3d/">Impresión 3D</a>
        <a href="/tienda/">Ver catálogo</a>
      </div>
```

- [ ] **Step 5: Quitar del inicio los enlaces a las páginas borradas**

En `index.html`, reemplazar las acciones del hero que apuntan a `/calculadora/` por solo el catálogo, y en la FAQ quitar el enlace `<a href="/calculadora/">estimar tu proyecto</a>` (dejar el texto plano). *(El inicio se reescribe entero en las Tareas 3–6; acá solo se eliminan los `href` muertos para que no haya 404.)* Buscar y resolver toda ocurrencia:

```bash
grep -rn "/programacion/\|/calculadora/" index.html partials/
```

Expected: sin resultados.

- [ ] **Step 6: Verificar que compila y el sitemap no lista páginas muertas**

```bash
cd "calc3d-landing" && pnpm build
```
Expected: build OK. Revisar que `dist/sitemap.xml` NO contenga `/programacion/` ni `/calculadora/`:
```bash
grep -c "programacion\|calculadora" dist/sitemap.xml
```
Expected: `0`.

- [ ] **Step 7: Verificar en el navegador que no quedan enlaces muertos**

Arrancar el preview (`preview_start {name:"sitio"}`), abrir `/`, `read_page` y confirmar que el nav y el pie no muestran "Programación" ni "Calculadora", y que ningún enlace apunta a esas rutas.

- [ ] **Step 8: Dejar los cambios listos**

```bash
git add -A
git commit -m "feat(landing): quitar programacion y calculadora de la tienda"
```

---

## Task 2: Base de marca — Poppins, activos y logo real

Cambia la tipografía a Poppins, copia los activos de marca al repo y reemplaza el "B" de texto por el isotipo/logo real en header y footer. La paleta navy/amarillo ya coincide con la marca y se conserva.

**Files:**
- Create: `assets/brand/` (copiar PNGs)
- Modify: `assets/styles.css:12` (import de fuentes) y `:root` `--font-display`/`--font-body` (líneas 48–49)
- Modify: `partials/header.html:17` (brand)
- Modify: `partials/footer.html:10` (brand)

**Interfaces:**
- Consumes: Tarea 1 (árbol sin páginas muertas).
- Produces: `assets/brand/` con los logos/mascotas; `--font-display`/`--font-body` = Poppins. Las tareas siguientes usan estos archivos de marca por su ruta `/assets/brand/<archivo>`.

- [ ] **Step 1: Copiar los activos de marca al repo**

```bash
mkdir -p "calc3d-landing/assets/brand"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/LOGOS/ICONO/ICONO AMARILLO.png"        "calc3d-landing/assets/brand/isotipo-amarillo.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/LOGOS/COMPOSICION/COMPOSICION COMPLETA SOLO AMARILLO.png" "calc3d-landing/assets/brand/logo-amarillo.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/LOGOS/LOGOTIPO/LOGOTIPO BLANCO.png"    "calc3d-landing/assets/brand/logotipo-blanco.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/BANANO_HOLA.png"               "calc3d-landing/assets/brand/banano-hola.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/BANANO_LAPTOP.png"             "calc3d-landing/assets/brand/banano-laptop.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/BANANO_CHAMBA.png"             "calc3d-landing/assets/brand/banano-chamba.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/BANANO_MOLESTO.png"            "calc3d-landing/assets/brand/banano-molesto.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/BANANO_PC_DAÑADA.png"          "calc3d-landing/assets/brand/banano-error.png"
cp "/c/Users/evanan-it/Downloads/3d/BananoLAB/BananoLAB/MASCOTA/IMPRESORA 3D.png"              "calc3d-landing/assets/brand/impresora-3d.png"
```
Verificar: `ls "calc3d-landing/assets/brand"` lista los 9 archivos.

- [ ] **Step 2: Cambiar el import de fuentes a Poppins**

En `assets/styles.css` reemplazar la línea 12 (import de Space Grotesk/Manrope/Space Mono) por:

```css
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
```

- [ ] **Step 3: Apuntar los tokens de fuente a Poppins**

En `:root` (líneas 48–49) dejar:

```css
  --font-display: 'Poppins', system-ui, sans-serif;
  --font-body: 'Poppins', system-ui, sans-serif;
```
Dejar `--font-mono` como está (no hay mono en la marca; se usa poco). En la regla de `h1,h2,h3` (línea 104) subir el peso display a `font-weight: 900` (Poppins Black) y, para `.kicker`, que usaba mono, cambiar `font-family: var(--font-mono)` por `var(--font-display)` con `font-weight:700`.

- [ ] **Step 4: Poner el logo real en el header**

En `partials/header.html`, reemplazar el `<a class="brand">` (línea 17) por el isotipo + logotipo reales:

```html
    <a class="brand" href="/" aria-label="Banano Lab — inicio">
      <img class="brand-logo" src="/assets/brand/isotipo-amarillo.png" alt="" width="34" height="34">
      <img class="brand-word" src="/assets/brand/logotipo-blanco.png" alt="Banano Lab" height="20">
    </a>
```
Agregar en `styles.css` (sección de nav) reglas mínimas: `.brand{display:inline-flex;align-items:center;gap:10px} .brand-logo{width:34px;height:auto} .brand-word{height:20px;width:auto}`. Conservar el atributo `data-bl="brand"` NO es necesario acá (el logo es imagen), pero dejar el `<a>` apuntando a `/`.

- [ ] **Step 5: Poner el logo real en el footer**

En `partials/footer.html` (línea 10) usar la misma composición que el header (isotipo + logotipo), quitando el `<span class="brand-mark">B</span>`.

- [ ] **Step 6: Verificar build + aspecto**

```bash
cd "calc3d-landing" && pnpm build
```
Expected: OK. Luego `preview_start {name:"sitio"}`, abrir `/`, tomar screenshot y confirmar: títulos en Poppins Black, logo real en header y pie, fondo navy, acentos amarillos. `read_console_messages` sin errores de carga de fuente/imagen.

- [ ] **Step 7: Dejar los cambios listos**

```bash
git add -A && git commit -m "feat(landing): tipografia Poppins y activos de marca Banano Lab"
```

---

## Task 3: Barra informativa superior

Agrega la franja fina informativa arriba del header (contenido fijo, editable por el dueño en el HTML).

**Files:**
- Modify: `partials/header.html` (agregar la barra ANTES de `<header class="nav">`)
- Modify: `assets/styles.css` (estilos `.topbar`)

**Interfaces:**
- Consumes: Tarea 2 (header con logo real).
- Produces: `.topbar` como primer elemento del parcial de cabecera.

- [ ] **Step 1: Agregar la barra al parcial de cabecera**

Al principio de `partials/header.html` (antes del comentario del `<header>`), insertar:

```html
<div class="topbar">
  <div class="container topbar-inner">
    <span>🍌 Impresión 3D a pedido en Venezuela — coordiná por WhatsApp</span>
  </div>
</div>
```

- [ ] **Step 2: Estilar la barra**

En `styles.css` agregar:

```css
.topbar{ background:var(--ink-700); color:var(--text-dim); font-size:13px; border-bottom:1px solid var(--card-line); }
.topbar-inner{ display:flex; justify-content:center; align-items:center; gap:10px; padding-block:8px; text-align:center; }
```

- [ ] **Step 3: Verificar**

`pnpm build` OK. Preview: la franja aparece arriba de todo, centrada, legible, sin romper en 360px (`resize_window {preset:"mobile"}` y screenshot).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(landing): barra informativa superior"
```

---

## Task 4: Carrusel hero con banners fijos (placeholder)

Reemplaza el hero de texto del inicio por un carrusel de 2–3 banners fijos (se vuelven administrables en el Hito B). Incluye auto-avance, puntos, prev/next, pausa al pasar el mouse y respeto por `prefers-reduced-motion`.

**Files:**
- Modify: `index.html` (reemplazar `<section class="hero">`, líneas 30–40)
- Modify: `assets/styles.css` (estilos `.carousel*`)
- Create (inline en `index.html`): script del carrusel

**Interfaces:**
- Consumes: Tarea 2 (activos de marca).
- Produces: `#heroCarousel` con `.carousel-slide`. El Hito B reemplazará el contenido fijo por datos de la API, conservando la misma estructura de clases.

- [ ] **Step 1: Markup del carrusel (3 slides fijos)**

En `index.html`, reemplazar toda la `<section class="hero">…</section>` por:

```html
<section class="carousel" id="heroCarousel" aria-roledescription="carrusel" aria-label="Destacados">
  <div class="carousel-track">
    <article class="carousel-slide is-active">
      <div class="container carousel-content">
        <div class="carousel-text">
          <span class="kicker">Impresión 3D</span>
          <h1 class="h1 text-balance">De la idea a la pieza. La imprimimos por vos.</h1>
          <p class="lead">Piezas por encargo en PLA, PETG, ABS, TPU y resina. Desde una unidad.</p>
          <a href="/tienda/" class="btn btn-primary btn-lg">Ver el catálogo</a>
        </div>
        <img class="carousel-art" src="/assets/brand/banano-hola.png" alt="" loading="eager">
      </div>
    </article>
    <article class="carousel-slide">
      <div class="container carousel-content">
        <div class="carousel-text">
          <span class="kicker">A tu medida</span>
          <h1 class="h1 text-balance">¿No está en el catálogo? Lo fabricamos.</h1>
          <p class="lead">Traés el archivo, la foto de una pieza rota o solo la idea. Te cotizamos por WhatsApp.</p>
          <a href="#" class="btn btn-primary btn-lg" data-bl="cotizar">Cotizar a medida</a>
        </div>
        <img class="carousel-art" src="/assets/brand/banano-chamba.png" alt="" loading="lazy">
      </div>
    </article>
    <article class="carousel-slide">
      <div class="container carousel-content">
        <div class="carousel-text">
          <span class="kicker">Hecho acá</span>
          <h1 class="h1 text-balance">Taller propio, producción bajo pedido.</h1>
          <p class="lead">Sin stock que se venza ni mínimos absurdos. Listo en los días que dice cada ficha.</p>
          <a href="/impresion-3d/" class="btn btn-primary btn-lg">Cómo trabajamos</a>
        </div>
        <img class="carousel-art" src="/assets/brand/impresora-3d.png" alt="" loading="lazy">
      </div>
    </article>
  </div>
  <button class="carousel-nav prev" aria-label="Anterior">‹</button>
  <button class="carousel-nav next" aria-label="Siguiente">›</button>
  <div class="carousel-dots" role="tablist" aria-label="Elegir banner"></div>
</section>
```

- [ ] **Step 2: Estilos del carrusel**

En `styles.css` agregar (navy, slides apiladas con fade):

```css
.carousel{ position:relative; overflow:hidden; background:var(--ink-800); }
.carousel-track{ position:relative; }
.carousel-slide{ position:absolute; inset:0; opacity:0; visibility:hidden; transition:opacity .5s var(--ease); }
.carousel-slide.is-active{ position:relative; opacity:1; visibility:visible; }
.carousel-content{ display:grid; grid-template-columns:1.2fr .8fr; align-items:center; gap:32px; padding-block:clamp(40px,7vw,96px); }
.carousel-art{ width:100%; max-width:340px; justify-self:center; height:auto; }
.carousel-nav{ position:absolute; top:50%; transform:translateY(-50%); z-index:2; width:44px; height:44px; border-radius:var(--radius-pill); border:1px solid var(--card-line-strong); background:rgba(0,8,20,.55); color:var(--text); font-size:26px; line-height:1; display:grid; place-items:center; }
.carousel-nav.prev{ left:14px; } .carousel-nav.next{ right:14px; }
.carousel-dots{ position:absolute; bottom:16px; left:0; right:0; display:flex; justify-content:center; gap:8px; z-index:2; }
.carousel-dots button{ width:9px; height:9px; border-radius:50%; border:0; background:var(--card-line-strong); }
.carousel-dots button[aria-selected="true"]{ background:var(--yellow); }
@media (max-width:760px){
  .carousel-content{ grid-template-columns:1fr; text-align:center; }
  .carousel-art{ order:-1; max-width:200px; }
  .carousel-nav{ display:none; }
}
```

- [ ] **Step 3: Script del carrusel (al final de `index.html`, antes de `</body>`, en su propio `<script type="module">`)**

```html
<script type="module">
// Carrusel del hero: avanza solo salvo que el usuario pida menos movimiento,
// se pausa al pasar el mouse y es operable por teclado (prev/next/puntos).
(function () {
  const root = document.getElementById('heroCarousel');
  if (!root) return;
  const slides = [...root.querySelectorAll('.carousel-slide')];
  const dotsBox = root.querySelector('.carousel-dots');
  let i = slides.findIndex((s) => s.classList.contains('is-active'));
  if (i < 0) i = 0;

  slides.forEach((_, n) => {
    const d = document.createElement('button');
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', `Banner ${n + 1}`);
    d.addEventListener('click', () => go(n, true));
    dotsBox.appendChild(d);
  });
  const dots = [...dotsBox.children];

  function go(n, stop) {
    slides[i].classList.remove('is-active');
    dots[i].setAttribute('aria-selected', 'false');
    i = (n + slides.length) % slides.length;
    slides[i].classList.add('is-active');
    dots[i].setAttribute('aria-selected', 'true');
    if (stop) pause();
  }
  go(i);

  root.querySelector('.prev').addEventListener('click', () => go(i - 1, true));
  root.querySelector('.next').addEventListener('click', () => go(i + 1, true));

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  function play() { if (!reduce && slides.length > 1) timer = setInterval(() => go(i + 1), 6000); }
  function pause() { if (timer) { clearInterval(timer); timer = null; } }
  root.addEventListener('mouseenter', pause);
  root.addEventListener('mouseleave', play);
  play();
})();
</script>
```

- [ ] **Step 4: Verificar comportamiento**

`pnpm build` OK. Preview `/`: el carrusel rota solo cada ~6s; prev/next y los puntos cambian de slide; al pasar el mouse se pausa. `resize_window {preset:"mobile"}`: una columna, imagen arriba, sin scroll horizontal. Con `emulate` de reduced-motion (o `resize_window {colorScheme}` no aplica; usar DevTools emulate si está disponible) confirmar que NO auto-avanza. Verificar foco visible al tabular hasta prev/next/puntos.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(landing): carrusel hero con banners fijos"
```

---

## Task 5: Bloques por categoría automáticos + tira de destacados

Reemplaza la sección "Del catálogo" por una tira de destacados + bloques por categoría generados desde la API (`BL.cats`/`BL.products`), con "Ver todo" a `/tienda/?cat=`.

**Files:**
- Modify: `index.html` (sección de catálogo, líneas 92–107, y el script inline de carga, líneas 218–241)
- Modify: `assets/styles.css` (estilos `.cat-block`)

**Interfaces:**
- Consumes: `BL.load()`, `BL.cats` (`[{key,label}]`), `BL.products` (`[{..., cat, price, name}]`), `blTarjetaProducto(p)`, `blEngancharTarjetas(el)`, `blPintarNegocio()`, `esc` — todos ya exportados en `assets/app.js`.
- Produces: `#destacados` (tira) y `#catBlocks` (contenedor de bloques). El Hito C insertará la sección Flash Sale ENTRE el carrusel y los destacados.

- [ ] **Step 1: Markup de las dos secciones**

En `index.html`, reemplazar la `<section class="section">…id="destacados"…</section>` actual por:

```html
<!-- Tira de destacados: primeras fichas reales del catálogo. -->
<section class="section" id="destacadosSection">
  <div class="container">
    <div class="eyebrow-row" style="margin-bottom:24px">
      <h2 class="h2">Lo más pedido</h2>
      <a href="/tienda/" class="btn btn-ghost btn-sm">Ver todo</a>
    </div>
    <div class="grid shop-grid" id="destacados">
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
    </div>
  </div>
</section>

<!-- Bloques por categoría, generados desde la API (orden por position del panel). -->
<div id="catBlocks"></div>
```

- [ ] **Step 2: Estilos del bloque de categoría**

```css
.cat-block{ padding-block:clamp(40px,6vw,80px); }
.cat-block:nth-of-type(even){ background:var(--ink-700); }
.cat-block .eyebrow-row{ margin-bottom:22px; }
```
(`.eyebrow-row`, `.shop-grid`, `.skeleton` ya existen.)

- [ ] **Step 3: Reescribir el script de carga del inicio**

Reemplazar el `<script type="module">` de carga (líneas 218–241) por uno que pinte destacados y bloques por categoría, degradando si la API falla:

```html
<script type="module">
// Lo dinámico del inicio: destacados + un bloque por categoría con productos.
// Si la API no responde, se ocultan SOLO las secciones dinámicas; hero,
// beneficios, proceso y FAQ siguen en pie.
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await BL.load();
  } catch (e) {
    console.error('No se pudo cargar el catálogo:', e);
    document.getElementById('destacadosSection').hidden = true;
    return;
  }
  blPintarNegocio();

  // Destacados
  const grid = document.getElementById('destacados');
  const destacados = BL.products.slice(0, 4);
  if (!destacados.length) {
    document.getElementById('destacadosSection').hidden = true;
  } else {
    grid.innerHTML = destacados.map(blTarjetaProducto).join('');
    blEngancharTarjetas(grid);
  }

  // Bloques por categoría (solo categorías CON productos).
  const cont = document.getElementById('catBlocks');
  const conProductos = BL.cats
    .map((c) => ({ ...c, items: BL.products.filter((p) => p.cat === c.key) }))
    .filter((c) => c.items.length > 0);

  cont.innerHTML = conProductos.map((c) => `
    <section class="section cat-block">
      <div class="container">
        <div class="eyebrow-row">
          <h2 class="h2">${esc(c.label)}</h2>
          <a href="/tienda/?cat=${encodeURIComponent(c.key)}" class="btn btn-ghost btn-sm">Ver todo</a>
        </div>
        <div class="grid shop-grid">${c.items.slice(0, 4).map(blTarjetaProducto).join('')}</div>
      </div>
    </section>`).join('');
  cont.querySelectorAll('.shop-grid').forEach((g) => blEngancharTarjetas(g));
});
</script>
```

- [ ] **Step 4: Verificar con la API arriba**

Arrancar la API: `cd calc3d-api && pnpm dev` (puerto 3001). Preview `/`: la tira "Lo más pedido" muestra fichas reales y debajo aparece un bloque por cada categoría con productos, cada uno con "Ver todo" que lleva a `/tienda/?cat=<key>` (clickearlo y confirmar que la tienda abre esa pestaña). `blEngancharTarjetas` deja funcionando "Agregar"/"Ver detalle". `read_console_messages` sin errores.

- [ ] **Step 5: Verificar degradación con la API caída**

Parar la API. Recargar `/`. Expected: la tira de destacados y los bloques NO aparecen (o quedan ocultos), y el hero/beneficios/proceso/FAQ siguen visibles. Sin errores que rompan la página (solo el `console.error` esperado).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(landing): destacados y bloques por categoria en el inicio"
```

---

## Task 6: Beneficios reales + proceso + FAQ (una sola historia: 3D)

Reescribe las secciones restantes del inicio para que cuenten solo impresión 3D (sin la mitad "digital"/programación), con una banda de beneficios verdaderos. Elimina las secciones de servicio digital y "soluciones" de software.

**Files:**
- Modify: `index.html` (secciones de "Soluciones", servicio físico/digital, proceso, FAQ, CTA final — líneas 42–213)
- Modify: `assets/styles.css` (estilos `.benefits`)

**Interfaces:**
- Consumes: Tareas 4 y 5 (carrusel y secciones dinámicas ya en su lugar).
- Produces: un inicio 100% impresión 3D. No expone hooks nuevos.

- [ ] **Step 1: Quitar la rejilla "Soluciones" de software y la sección de servicio digital**

En `index.html`, eliminar por completo: la `<section class="section section--blue">` de "Soluciones que construimos para tu negocio" (incluye las tarjetas de desarrollo web, tiendas, automatización, sistemas) y la `<section class="section">` del servicio DIGITAL (`svc--flip`, TypeScript/React/NestJS). Conservar la sección de servicio FÍSICO (impresión 3D) y reubicarla si hace falta.

- [ ] **Step 2: Agregar la banda de beneficios reales**

Insertar antes del proceso una banda con beneficios verdaderos (nada inventado):

```html
<section class="section section--blue">
  <div class="container">
    <div class="grid benefits">
      <div class="benefit"><h3>Hecho a pedido</h3><p class="dim">Producimos cuando encargás: sin stock viejo ni sobreproducción.</p></div>
      <div class="benefit"><h3>Atención por WhatsApp</h3><p class="dim">Coordinás directo con el taller, sin formularios eternos.</p></div>
      <div class="benefit"><h3>Listo en N días</h3><p class="dim">Cada ficha dice sus días de producción. Sin promesas vagas.</p></div>
      <div class="benefit"><h3>Pagás al coordinar</h3><p class="dim">En dólares o en bolívares a la tasa del día, como prefieras.</p></div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Estilar la banda**

```css
.benefits{ grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:22px; }
.benefit h3{ color:var(--yellow); margin-bottom:6px; }
```

- [ ] **Step 4: Ajustar proceso y FAQ a solo 3D**

En el proceso, el texto ya sirve para 3D (es genérico); quitar cualquier mención a "desarrollo". En la FAQ, eliminar la pregunta "¿También hacen software?" y cualquier referencia a programación. El CTA final queda apuntando a `data-bl="cotizar"` (ya está).

- [ ] **Step 5: Actualizar `<title>` y `meta description` del inicio**

En `index.html` `<head>`: título y descripción solo sobre impresión 3D, p. ej. `<title>Banano Lab — Impresión 3D a pedido en Venezuela</title>` y una descripción sin "software a medida".

- [ ] **Step 6: Verificar**

`pnpm build` OK. Preview `/`: recorrer toda la home de arriba a abajo (topbar → carrusel → destacados → bloques por categoría → servicio físico → beneficios → proceso → FAQ → CTA → footer). Confirmar que NO hay ninguna mención a programación/software/desarrollo (`get_page_text` y buscar "software", "programación", "desarrollo": sin resultados). Screenshot desktop y móvil.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(landing): inicio enfocado 100% en impresion 3D"
```

---

## Task 7: Rediseño de /impresion-3d/

Re-estila la página de servicio físico al sistema de marca y quita cualquier referencia cruzada a programación. Suma la mascota `impresora-3d.png`.

**Files:**
- Modify: `impresion-3d/index.html`
- Modify: `assets/styles.css` si hace falta algún ajuste puntual

**Interfaces:**
- Consumes: el sistema de clases/tokens ya actualizado (Tareas 2–6).
- Produces: nada nuevo.

- [ ] **Step 1: Leer el estado actual**

Abrir `impresion-3d/index.html` y listar su estructura (secciones, `<!--#include header-->`/`footer`, enlaces). Identificar cualquier `href` o texto que mencione programación/calculadora y quitarlo.

- [ ] **Step 2: Aplicar marca y mascota**

Asegurar que usa `.hero`/`.section`/`.kicker`/`.steps`/`.ticks` ya estilados. Agregar la ilustración `/assets/brand/impresora-3d.png` en el hero o en un bloque de servicio (con `alt=""` si es decorativa). Mantener el CTA a `data-bl="cotizar"`.

- [ ] **Step 3: Verificar**

`pnpm build` OK. Preview `/impresion-3d/`: coherente con la home (navy, Poppins, amarillo), sin menciones a software, mascota visible, responsive a 360px. `get_page_text` sin "programación/software".

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(landing): rediseno de la pagina de impresion 3D"
```

---

## Task 8: Rediseño de /tienda/

Re-estila la vitrina al sistema de marca **sin tocar la lógica de `Shop`**. Todos los `id`, `onclick`, `data-*` y la estructura que consume el script inline se preservan tal cual.

**Files:**
- Modify: `tienda/index.html` (solo markup de presentación y clases; NO el `<script>` de `Shop`)
- Modify: `assets/styles.css` (ajustes de `.shop-*`, `.filters`, `.tabs`, `.chip`, `.color-pick`)

**Interfaces:**
- Consumes: `Shop` (script inline existente) y los hooks que usa — **preservar exactamente**: ids `filters`, `materialGroup`, `materialFilters`, `colorGroup`, `colorFilters`, `priceRange`, `priceVal`, `catTabs`, `resultCount`, `sortSel`, `shopGrid`, `shopEmpty`, `shopError`, `footerCats`; y los `onclick="Shop.clear()"`, `Shop.onPrice(this.value)`, `Shop.apply()`, el toggle de `#filters`, `location.reload()`.
- Produces: nada nuevo.

- [ ] **Step 1: Inventariar los hooks a preservar**

```bash
grep -nE "id=\"|onclick=|data-bl=|oninput=|onchange=" "calc3d-landing/tienda/index.html"
```
Anotar cada uno; ninguno puede cambiar de nombre.

- [ ] **Step 2: Re-estilar presentación**

Ajustar `shop-head`, `shop-layout`, `filters`, `tabs`/`tab`, `chip`, `color-pick`, `shop-toolbar`, `shop-grid` y los estados (`shop-state`) al sistema navy/amarillo/Poppins. Cambios SOLO de clases/estilos y textos; el árbol de ids e `inline handlers` queda intacto.

- [ ] **Step 3: Verificar que la vitrina sigue funcionando**

Con la API arriba, preview `/tienda/`: cargan productos; las pestañas de categoría filtran (selección única); los chips de material y color filtran (multi); el rango de precio filtra; el selector de orden ordena; "Limpiar" resetea; `?cat=llaveros` en la URL preselecciona la pestaña. Probar "Agregar" y "Ver detalle" de una tarjeta. `read_console_messages` sin errores.

- [ ] **Step 4: Verificar estados límite**

Forzar un filtro sin resultados → `#shopEmpty` visible con botón "Limpiar". Parar la API y recargar → `#shopError` visible con "Reintentar". Mobile 360px: los filtros colapsan con el toggle, sin scroll horizontal.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(landing): rediseno de la vitrina (sin tocar la logica de Shop)"
```

---

## Task 9: Rediseño de /producto/

Re-estila la ficha de producto al sistema de marca **sin tocar su lógica** (galería, selectores de variante/color, cantidad, relacionados, agregar al carrito).

**Files:**
- Modify: `producto/index.html` (markup de presentación y clases; NO el `<script>` de la ficha)
- Modify: `assets/styles.css` (ajustes de la sección "Ficha de producto")

**Interfaces:**
- Consumes: el script de la ficha existente y sus hooks. **Preservar exactamente** todos los `id`, `data-*`, `onclick` y la estructura que el script lee (galería/miniaturas, grupos de opciones, selector de color, input de cantidad, `Cart.add`, migas, relacionados).
- Produces: nada nuevo.

- [ ] **Step 1: Inventariar los hooks a preservar**

```bash
grep -nE "id=\"|onclick=|data-bl=|data-|oninput=|onchange=" "calc3d-landing/producto/index.html"
```
Leer también el `<script>` inline de la ficha para entender qué ids/atributos consume; ninguno puede renombrarse.

- [ ] **Step 2: Re-estilar presentación**

Ajustar migas, galería + miniaturas, bloque de precio (incluido el equivalente en bolívares y el **precio tachado** `compareAtUsd` si la ficha ya lo muestra — queda listo para el Flash Sale del Hito C), selectores de variante/color, cantidad, especificaciones y relacionados, al sistema navy/amarillo/Poppins. Solo clases/estilos.

- [ ] **Step 3: Verificar que la ficha sigue funcionando**

Con la API arriba, abrir `/producto/<slug>` de un producto real (tomar un slug de `/tienda/`): galería cambia con miniaturas; elegir variante/color/cantidad; "Agregar" suma al carrito con el precio correcto (incluye recargos de opción); los relacionados enlazan a otras fichas; las migas enlazan a `/tienda/?cat=`. `read_console_messages` sin errores.

- [ ] **Step 4: Verificar estados límite**

Un producto con opciones obligatorias: la vitrina manda a la ficha (no agrega a ciegas) y la ficha exige elegir antes de agregar. Mobile 360px: galería y panel de compra sin desborde.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(landing): rediseno de la ficha de producto (sin tocar su logica)"
```

---

## Task 10: Actualizar la documentación del repo

Deja el `CLAUDE.md` de la landing coherente con el rediseño (páginas, convención de CSS, marca).

**Files:**
- Modify: `calc3d-landing/CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: doc al día.

- [ ] **Step 1: Actualizar la tabla de páginas y el estado**

En `CLAUDE.md`: quitar `/programacion/`, `/calculadora/` y el estimador de la tabla de páginas y de las menciones; describir la nueva home (barra info, carrusel, bloques por categoría, beneficios, proceso, FAQ).

- [ ] **Step 2: Reflejar que la landing es ahora la fuente de verdad de su CSS**

Reescribir la sección "El diseño viene de Claude Design" para decir que `assets/styles.css` ya **no** se copia/sincroniza: la landing es la fuente de verdad. Documentar la marca (paleta navy/amarillo, Poppins, activos en `assets/brand/`).

- [ ] **Step 3: Verificar y commit**

Releer el `CLAUDE.md` y confirmar que no quedó ninguna instrucción que contradiga el rediseño (p. ej. "copiar de Claude Design", enlaces a programación).

```bash
git add -A && git commit -m "docs(landing): actualizar CLAUDE.md tras el rediseno (hito A)"
```

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec (hito A):** eliminar programación/calculadora (T1) ✓; marca navy+Poppins+activos (T2) ✓; barra info (T3) ✓; carrusel fijo (T4) ✓; bloques por categoría + destacados (T5) ✓; beneficios + proceso + FAQ solo-3D (T6) ✓; rediseño impresión-3d/tienda/producto (T7–T9) ✓; convención de CSS + doc (T10) ✓. El Flash Sale (hito C) deja su hueco reservado entre carrusel y destacados (nota en T5); SEO pre-render y pase responsive dedicado son **Hito D** (otro plan).
- **Sin placeholders:** cada tarea trae código o pasos concretos; los re-estilos de páginas (T7–T9) listan los hooks exactos a preservar y usan el sistema de clases ya definido en T2–T6, verificando en navegador.
- **Consistencia de tipos/hooks:** los nombres de funciones (`BL.load`, `blTarjetaProducto`, `blEngancharTarjetas`, `blPintarNegocio`, `esc`) y de ids (`destacados`, `catBlocks`, `catTabs`, `shopGrid`, …) se usan igual en todas las tareas y coinciden con `app.js`/`tienda`.
- **Review Focus:** API caída (T5), reduced-motion (T4), teclado/foco (T3,T4), categoría vacía (T5), overflow a 360px (todas las visuales) — cada uno tiene su verificación en la tarea dueña.
