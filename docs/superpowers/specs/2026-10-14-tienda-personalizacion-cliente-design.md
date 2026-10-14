# Personalización del cliente (foto + nota) en la tienda — Diseño

**Fecha:** 2026-10-14
**Repos:** `calc3d-api` (contrato + API pública + bandeja), `calc3d-landing` (ficha pública)
**Estado:** aprobado en brainstorming; pendiente de plan.

## Objetivo

En los productos que el dueño marca como personalizables, el cliente puede
agregar al pedir una **nota corta** y una **foto opcional** de lo que quiere.
Eso llega a la **bandeja** del panel para que el dueño lo vea, lo descargue y lo
produzca/edite antes de confirmar el pedido.

## Contexto y decisiones tomadas

La tienda es de **solo lectura salvo la bandeja** (`store-requests`): hoy la
única escritura pública es texto (`POST /public/store/orders` y
`/custom-requests`). Esta feature agrega la **primera subida de archivo
anónima**, así que es superficie nueva y va con tests de regresión.

Decisiones (brainstorming 2026-10-14, con el dueño):

1. **La foto se sube en el sitio, a R2** (no por WhatsApp). Queda enlazada al
   pedido en la bandeja.
2. **Reusa el flag `custom`** de `StoreProduct` ("Se puede personalizar"). No hay
   flag nuevo. La ficha pública ya expone `custom`, así que la landing sabe qué
   productos lo habilitan sin cambios de contrato para eso.
3. **Opcional**: se puede pedir el producto con o sin nota/foto.
4. **Una sola foto + una nota por ítem** del carrito (no varias fotos).
5. **La foto vive en la BANDEJA, no en el `Order`.** Al confirmar, la nota entra
   en la descripción de la línea (como ya entran las opciones); la foto se ve y
   se descarga desde la bandeja. Meter fotos en el `Order` sería otra feature.

## Subida a R2 en dos pasos (con candado)

Reusa el patrón probado del panel (`createImageUploadUrl` → PUT directo →
verificación con `HeadObject`), pero **sin sesión**:

- **Paso 1 — URL firmada pública.** `POST /public/store/uploads/custom-url` con
  `{ contentType, contentLength }`. Devuelve `{ key, url, headers }`.
  - La **clave la genera el servidor** bajo el prefijo
    `custom-uploads/{yyyy-mm}/{random}.<ext>` — el cliente NUNCA la elige.
  - `contentType` ∈ `STORE_IMAGE_MIME_TYPES` (PNG/JPEG/WebP) y `contentLength` ≤
    `STORE_IMAGE_MAX_BYTES` (5 MB), **acotados en la firma**.
  - **Rate-limit estricto** (el mismo grupo que la bandeja: 5/min por IP real,
    `ProxyThrottlerGuard`). Un pedido es un acto humano, no una ráfaga.
  - Si R2 no está configurado, responde `503` (como `storageReady: false`); la
    landing esconde el cargador y deja solo la nota.
- **Paso 2 — el cliente PUTea la foto DIRECTO a R2.** No pasa por la API (si
  pasara, cada imagen de varios MB chocaría contra el límite del body).
- **Verificación en el envío del pedido** (no hay endpoint de "confirmar" aparte;
  se verifica al mandar `POST /public/store/orders`): por cada ítem con
  `customImageKey`, el servidor valida con `HeadObject` que el objeto exista, sea
  del tipo aceptado, esté bajo el prefijo `custom-uploads/` y no pase el tope. Una
  clave inválida, ajena o fuera de prefijo → **400** (se RECHAZA, no se ignora —
  la misma regla que una opción que la ficha no tiene).

## Modelo de datos

Sin migración: las líneas del pedido viven en `StoreRequest.lines` (JSON).

- **Contrato (`shared/schemas/store-request.ts`)** — `StoreRequestItemSchema`
  gana:
  - `customNote?: string` (trim, ≤ 500).
  - `customImageKey?: string` (≤ 200; el servidor igual revalida el prefijo).
- **Línea guardada** (`StoreRequest.lines[]`, que hoy es
  `{ slug, name, quantity, options, unit, unitPrice }`): gana `customNote?` y
  `customImageKey?`. Es JSON, no cambia el esquema de Prisma.
- **Nuevo DTO de subida** (`StoreCustomUploadUrlSchema`): `{ contentType,
  contentLength }`, con las mismas reglas que `StoreImageUploadUrlSchema`.

Validaciones de servidor adicionales:

- Un ítem con `customNote`/`customImageKey` cuyo producto tiene `custom = false`
  → **400** (ese producto no habilita personalización). El servidor ya busca la
  ficha para calcular el precio; aprovecha ese paso.

## Lado del panel (bandeja)

- `GET /store/requests` (y el detalle) exponen, por línea, `customNote` y
  **`customImageUrl`** (la URL pública de la foto vía `storage.publicUrl(key)`).
  **Nunca el `customImageKey` crudo** (lista blanca, como el resto de la API).
- La pantalla de la bandeja (`calc3d-web`, `StoreRequests`) muestra, por línea
  personalizada, la **nota** y una **miniatura** clickeable (abre/descarga la
  foto). Queda fuera del alcance de ESTE spec el detalle visual fino; el plan lo
  cubre con lo mínimo para verla y descargarla.
- **`confirm()`**: `toOrderLines()` mete la `customNote` dentro de la descripción
  de la línea del pedido (donde ya mete las opciones). La foto **no** se copia al
  `Order`: se la vio/descargó en la bandeja.
- **`discard()` y `DELETE /store/requests/:id`**: borran las fotos de
  `custom-uploads/` de esa solicitud de R2 (no dejar huérfanos; mismo criterio
  que el borrado de fotos por opción). Una solicitud **confirmada conserva** sus
  fotos (el dueño las necesita para producir).

## Lado de la landing

- En la ficha de un producto con `custom = true`, un bloque **"Personalización"**:
  una `textarea` para la nota (≤ 500) y un `input[type=file]` **opcional** con
  preview local y validación de tipo/tamaño en el cliente (UX; el servidor
  revalida).
- Al cerrar el pedido (`Checkout`): si el ítem tiene foto, se **sube primero** a
  R2 (pide la URL firmada al paso 1, PUT directo) y el `key` resultante viaja en
  el ítem junto con `customNote`. Sin foto, solo viaja la nota.
- **Si `storageReady` es false** (la info pública ya lo trae, o el endpoint de
  subida responde 503): se esconde el cargador y queda solo la nota, sin romper
  el pedido.
- El carrito guarda `customNote`/`customImageKey` por ítem; dos ítems del mismo
  producto con personalización distinta son cosas distintas (ya existe
  `claveDeItem`, hay que incluir estos campos en la clave).
- El precio **no cambia** por personalizar: la nota/foto no tocan el total (el
  precio lo sigue calculando el servidor).

## Seguridad (tests de regresión obligatorios)

- **Subida anónima acotada**: la firma limita tipo y tamaño; la clave la genera
  el servidor bajo `custom-uploads/`; `HeadObject` revalida al enviar. Test: una
  `customImageKey` fuera de prefijo / de otro objeto / de tipo no aceptado → 400,
  y el pedido NO se crea.
- **Rate-limit**: el endpoint de URL firmada usa el throttler estricto (5/min).
- **Lista blanca**: la bandeja nunca devuelve `customImageKey`; solo
  `customImageUrl`. Test: `JSON.stringify` de la respuesta no contiene el key.
- **`custom = false` + personalización → 400.**
- **La nota es texto del cliente**: se escapa al mostrarse (la landing ya escapa
  todo; el panel también).
- **Descartar/borrar limpia R2**: test con número de llamadas a `storage.remove`.

## Fuera de alcance (v1)

- Fotos en el `Order` / en la nota de entrega.
- Varias fotos por ítem.
- Recorte/edición de la foto en el sitio.
- Limpieza de fotos de pedidos **abandonados** (subidos y nunca enviados): se
  acepta el huérfano ocasional en v1; se puede sumar un barrido después. Las
  descartadas/borradas sí se limpian.

## Repos y orden de despliegue

Cambia la forma de la respuesta pública (bandeja) y agrega un endpoint público,
así que **se despliega primero `calc3d-api` y después la landing** (la landing
nueva necesita el endpoint; la vieja no lo llama, así que no se rompe). `shared`
se edita en `calc3d-api` y se sube de versión.
