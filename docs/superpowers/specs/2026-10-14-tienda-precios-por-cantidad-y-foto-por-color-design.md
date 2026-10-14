# Tienda — Precios por cantidad + Foto por color (diseño)

**Fecha:** 2026-10-14
**Repos:** `calc3d-api` (shared + API), `calc3d-web` (panel), `calc3d-landing` (tienda).
**Estado:** borrador para revisión del dueño.

## 1. Objetivo

Dos capacidades nuevas del catálogo de la tienda, ambas configurables desde la
**edición del producto** en el panel:

- **(A) Precios por cantidad** — que un producto cueste distinto según cuánto se
  pida (mayoreo), y que el pedido lo aplique.
- **(B) Foto por color** — que la foto de la ficha cambie según el color elegido.

> Nota: lo de **"dos dimensiones de color" (base + paral) YA funciona hoy** con
> varios grupos de opciones; verificado el 2026-10-14. No es parte de este spec:
> se carga desde el panel (Producto → Opciones → varios grupos de color).

## 2. Decisiones tomadas por defecto (⚠️ CONFIRMAR en la revisión)

El cuestionario que las iba a cerrar se interrumpió sin registrar respuestas, así
que tomo las opciones recomendadas. Si alguna no es la que querés, se cambia acá
antes de pasar al plan:

1. **Estructura:** este spec cubre **A + B** (las dos son del lado admin, viven en
   la edición del producto). **(C) Personalización del cliente** (subir foto +
   nota al pedir) va en **su propio spec** — abre una subida pública de archivos,
   que es una superficie de seguridad distinta. Enfoque recomendado para C cuando
   llegue: el cliente escribe la nota en la tienda y **manda la foto por WhatsApp**
   junto al pedido (sin subida pública a nuestro almacenamiento).
2. **(A) Modelo de precio:** **descuento % por tramo** (ej. 10+ u → 10 % off,
   25+ u → 20 % off). Es el mismo concepto de "mayoreo" de la calculadora; el
   precio base y los recargos por opción quedan igual y el descuento se aplica
   sobre el precio unitario de la línea.
3. **(B) Qué define la foto:** **un grupo "define la foto"**. El dueño marca UN
   grupo de opciones (ej. el color principal) como el que manda la galería; cada
   opción de ESE grupo puede tener su(s) foto(s), y elegirla cambia la imagen. Los
   otros grupos (ej. "Color del paral") no cambian la foto. Sin combinatoria.

## 3. Alcance

### Dentro
- A: tramos de precio por cantidad por producto (datos + validación + aplicación
  en el pedido + exposición pública + panel + landing).
- B: una o varias fotos por opción del grupo "foto"; swap de galería en la ficha;
  edición en el panel; exposición pública.
- Preservar **ids estables de opciones** al guardar un producto (hoy se borran y
  recrean en bloque — ver §6), requisito de B.
- Tests de seguridad (el precio lo decide el servidor; lista blanca pública).

### Fuera (explícito)
- **(C) Personalización del cliente** (su propio spec).
- Stock/variantes con SKU por combinación (sigue vigente la decisión de "sin
  combinatoria").
- Precios por cantidad en la **calculadora/cotizaciones** (eso ya existe aparte;
  este spec es SOLO la tienda pública).

---

## 4. Feature A — Precios por cantidad

### 4.1 Modelo de datos
`StoreProduct` gana **`priceTiers Json @default("[]")`**: lista
`[{ minQty: number, discountPct: number }]` (fracción, 0.10 = 10 %), ordenada por
`minQty` ascendente. Es JSON y no una tabla, igual que `specs`/`fixedCosts`: son
pocos tramos por producto y no se consultan por separado. Migración aditiva.

### 4.2 Contrato (`shared`)
- `StorePriceTierSchema = z.object({ minQty: int ≥ 2, discountPct: number en [0,1) })`.
- `StoreProductCreateSchema` gana `priceTiers: z.array(StorePriceTierSchema).max(8).default([])`
  con un `.superRefine` que valida: `minQty` estrictamente creciente, sin
  duplicados, y `minQty > product.minQty` (un tramo por debajo del mínimo del
  producto no tiene sentido). `StoreProductUpdateSchema` lo hereda por `.partial()`.
- Helper puro `precioConTramos(baseUnit: number, qty: number, tiers)` en
  `shared/calc/store-pricing.ts`: devuelve el precio unitario tras aplicar el
  **mayor** tramo cuyo `minQty ≤ qty` (o `baseUnit` si ninguno aplica). Con tests
  (sin tramos, justo en el borde, entre tramos, qty < primer tramo).
- Bump `SHARED_VERSION` + `package.json` a la par (ambos repos).

### 4.3 Aplicación en el pedido (API)
En `store-requests.service.ts` `priceItems()` (hoy: `unitPrice = priceUsd +
Σ recargos`), después de sumar los recargos de opción se aplica el tramo:
`unitPrice = precioConTramos(unitPrice, item.qty, product.priceTiers)`.
**El precio sigue decidiéndolo el SERVIDOR**: el cliente manda `{slug, qty,
options}` y nada de precio/tramo viaja en el body (regresión existente, se
mantiene). El total del pedido ya es `Σ unitPrice × qty`.

### 4.4 Exposición pública
- `GET /public/store/products` y `/products/:slug`: la lista blanca gana
  `priceTiers` (array `{minQty, discountPct}`), para que la vitrina/ficha puedan
  mostrar la tabla y recalcular en vivo. No se filtra nada interno.

### 4.5 Panel
En `StoreProductDetail.tsx`, una sección **"Precios por cantidad"**: una tabla
editable de tramos (desde cantidad + % de descuento), con "Agregar tramo" y
validación en cliente (creciente, % 0–99, por encima del mínimo) que **avisa antes
de guardar**. Reusa `NumberInput`. Al guardar viaja en el DTO del producto.

### 4.6 Landing
En la ficha (`renderFichaHtml`), si el producto tiene `priceTiers`:
- Mostrar una **tabla de mayoreo** ("10+ u: $X c/u · ahorrás Y %").
- Al cambiar la cantidad en la ficha, **recalcular el precio unitario mostrado**
  con `precioConTramos` (misma función pura, si se puede importar en la landing;
  si no, se reimplementa mínima y se testea — preferible compartir). El precio del
  carrito/WhatsApp ya lo arma el cliente, pero **el que manda es el del servidor**
  al confirmar.
- La tarjeta de vitrina puede mostrar "desde $X por mayor" (opcional, YAGNI: se
  decide en el plan).

### 4.7 Interacción con Flash Sale / compareAt
El tramo es un **descuento sobre `priceUsd`**; `compareAtUsd` (tachado) y la
ventana de Flash Sale no cambian. Si hay tramo y compareAt a la vez, se muestra el
precio con tramo como vigente y el compareAt tachado (como hoy). No se combinan
dos descuentos sobre el mismo número salvo que el dueño lo quiera (se deja el
precio base como referencia del tramo).

---

## 5. Feature B — Foto por color

### 5.1 Modelo de datos
- `StoreImage` gana **`optionId String?`** (FK a `StoreOption`, `onDelete:
  Cascade`): una imagen puede pertenecer a una opción de color. Las imágenes con
  `optionId = null` son la **galería base** (lo de hoy).
- `StoreOptionGroup` gana **`drivesPhoto Boolean @default(false)`**: marca el grupo
  que define la foto. **A lo sumo UNO por producto** (se valida en el servicio: si
  llegan dos con `drivesPhoto`, 400). Solo las opciones de ese grupo pueden tener
  imágenes enlazadas.
- Migración aditiva.

### 5.2 Requisito: ids estables de opciones (⚠️ cambio de fondo)
Hoy, al guardar un producto, los grupos/opciones se **borran y recrean en bloque**
(no tienen id estable — ver `store.service.ts` y el comentario "sin ids: se
reemplazan como bloque al guardar"). Si una imagen apunta a una opción por id, ese
id cambiaría en cada guardado y la imagen quedaría colgada.

**Decisión:** el guardado de opciones pasa de *borrar-recrear* a **upsert con ids
estables** (diff: crear las nuevas, actualizar las que siguen por id, borrar las
que se fueron). El panel ya conserva los ids al editar (pasa a mandarlos). Así una
imagen enlazada a "Rojo" sobrevive a editar el título del producto.
- Riesgo/costo: toca `store.service.ts` (update de producto) y el editor del
  panel. Es la parte más delicada del spec; va con tests de que editar un producto
  **no** desengancha las fotos de sus opciones.

### 5.3 Exposición pública
- La ficha (`/products/:slug`) expone, por cada opción del grupo `drivesPhoto`, sus
  `images` (lista blanca: `url`/`alt`/`width`/`height`, vía `publicUrl`), y marca
  qué grupo es el que define la foto (`drivesPhoto: true`). La galería base sigue
  saliendo como hoy (imágenes con `optionId = null`).
- La tarjeta de vitrina no cambia (usa la primera imagen base).

### 5.4 Panel
En el editor de opciones (`OpcionesEditor` en `StoreProductDetail.tsx`):
- Un check **"Este grupo define la foto"** (exclusivo entre grupos).
- En ese grupo, cada opción gana un control para **subir/asignar su(s) foto(s)**,
  reutilizando el flujo de subida a R2 que ya existe para las fotos del producto
  (`uploadStoreImage`), guardando la imagen con `optionId`.
- Requiere `storageReady` (R2 configurado), como el resto de las fotos.

### 5.5 Landing
En la ficha, al elegir una opción del grupo que define la foto:
- Si esa opción tiene imágenes, la **galería principal cambia** a esas imágenes
  (y las miniaturas). Si no tiene, se muestra la galería base.
- Es presentación pura en `renderFichaHtml` + el cableado de `Pdp` (reusa el
  mismo módulo puro compartido del Hito D).

---

## 6. Seguridad y tests (TDD)

- **A — el tramo lo aplica el SERVIDOR.** Regresión: un pedido manda `{slug, qty,
  options}`; un `unitPrice`/`discount`/`tier` en el body se ignora. Test con un
  tramo y `qty` que lo alcanza → el total usa el precio con descuento del servidor,
  no uno del cliente.
- **A — `precioConTramos`** (shared): bordes inclusivos, mayor tramo aplicable,
  qty por debajo del primer tramo, lista vacía.
- **A — validación de tramos:** `minQty` creciente, por encima del mínimo del
  producto, `discountPct` en rango; el schema rechaza lo demás.
- **B — lista blanca pública:** las imágenes por opción salen con `url` (no `key`),
  sin `id`/`optionId`/`storeProductId`/`organizationId`.
- **B — ids estables:** editar un producto (cambiar nombre) **no** borra ni
  reengancha las imágenes de sus opciones (test del `store.service.ts`).
- **B — un solo grupo "foto":** dos grupos con `drivesPhoto` → 400.
- La organización pública sigue saliendo de `STORE_ORGANIZATION_ID`, nunca del
  cliente (regresión existente, se mantiene).

## 7. Orden sugerido de implementación
1. **A** entero (shared tramos + API pricing + público + panel + landing). Es
   independiente de B y desplegable solo.
2. **B**: primero el cambio de **ids estables** (con sus tests), después el modelo
   `optionId`/`drivesPhoto`, el público, el panel y la landing.

Cada feature deja la tienda en un estado desplegable. Los repos **no se pushean**
sin pedido del dueño.

## 8. Decisiones y riesgos abiertos
- Las **tres decisiones por defecto de §2** están sin confirmar — es lo primero a
  revisar.
- El cambio de **ids estables de opciones** (§5.2) es el mayor riesgo técnico:
  cambia cómo se guardan las opciones. Si se prefiere evitarlo, la alternativa es
  atar la imagen a la opción **por valor** (texto) dentro del grupo foto, que
  sobrevive a recrear pero se rompe si se renombra el color — peor. Por eso se
  elige ids estables.
- Compartir `precioConTramos` con la landing (ESM de shared) sería ideal para no
  duplicar; si el bundle de la landing no lo puede importar cómodo, se reimplementa
  mínimo y se testea con `node:test` (como el Hito D).
