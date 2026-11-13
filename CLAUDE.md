# CLAUDE.md — Calc3D API (Backend)

Backend de Calc3D (Calculadora de Precios para Impresión 3D). Repo pnpm que
contiene `apps/api` (NestJS + Prisma) + la copia **canónica** de
`packages/shared`. Idioma de errores y respuestas: **español**.

## shared (fuente de verdad)

Este repo es el **canónico** del paquete `packages/shared`. Si cambias el motor
de cálculo o los contratos (tipos/schemas), **este es el lugar donde se edita**;
luego hay que **sincronizarlo al repo web** (`calc3d-web`, que corre
`pnpm sync:shared` desde aquí) para que ambos queden alineados. No edites shared
en el repo web: se sobrescribe al sincronizar.

> ⚠️ **Si cambia la FORMA de una respuesta de la API, se despliega primero la
> API y después el panel.** Se despliegan por separado: un panel nuevo leyendo
> la respuesta vieja se cae al dibujar. Pasó en desarrollo el 2026-09-13 con la
> reposición por color (shared 0.11.0): la pantalla se actualizó en caliente,
> React Query conservaba el resumen viejo sin `brands` y `RestockCard` rompió en
> `g.brands.length`. En local se arregla recargando; en producción no.

## Estructura
- `packages/shared` — tipos, schemas Zod (contratos front/back) y **motor de
  cálculo puro** (decimal.js). Sin Nest ni DB. Tests Jest (caso del llavero).
  Emite **doble build**: CJS (`dist/cjs`, lo consume Nest) y ESM (`dist/esm`,
  lo consume el front). Si cambias `shared`, recompílalo antes de usarlo en api.
- `apps/api` — NestJS + Prisma (PostgreSQL). **App de un solo dueño**: hay login
  (JWT + refresh tokens) pero **sin registro público** — la cuenta del dueño se crea
  con el `seed`. La plomería multi-tenant (`organizationId` en todas las tablas, rol
  OWNER/COLLABORATOR) se conserva pero fijada a **una sola organización**. CRUD de
  catálogos, presupuestos, `POST /calc` y export PDF/CSV. Prefijo global `/api`.
  - **Módulo de finanzas** (`sales`, `expenses`): CRUD con filtro `?from&to` +
    `POST /sales/from-quote` (convierte un presupuesto en venta). Modelos `Sale`
    (fecha, monto, tipo COUNTER/ENCARGO, cliente?, quote?) y `Expense` —
    **ledger ÚNICO de dinero que sale** (fecha, categoría, descripción, monto,
    isInvestment, quantity?, `endDate?` = fin de período p. ej. publicidad) con
    **enlace polimórfico OPCIONAL** a un item de catálogo (`materialId`/`printerId`/
    `componentId` — **ya NO hay `packagingId`**: la tabla `Packaging` se fusionó en
    `Component` con un campo `scope`, ver "Catálogos"). No existe una tabla de compras
    de filamento aparte: una compra de filamento es un `Expense` con `materialId` +
    cantidad. Relación **1 catálogo ↔ N gastos**
    (compra inicial + recompras/mantenimientos), así no se duplica la identidad.
    Visible a OWNER y COLLABORATOR. Nota: los `Decimal` de Prisma llegan como
    **string** en JSON; el front los convierte con `Number()`.
  - **Multi-moneda (tasas con nombre)** (`exchange-rates/`): tabla `ExchangeRate`
    **append-only**; la IDENTIDAD de una tasa es su `label` (nombre libre, ej.
    "Dólar BCV", "Euro neto") — puede haber 2 tasas de la misma moneda (BCV vs
    paralelo). `currencyCode` = moneda DESTINO (formateo), `rate` = unidades de esa
    moneda por 1 USD. La fila más reciente por `label` es la vigente (`distinct:
    ['label']`). **La base/costeo/estadísticas son SIEMPRE USD**; la moneda es
    presentación. `GET /exchange-rates` lista vigentes y auto-refresca las AUTO
    vencidas: dólar→Bs desde `ve.dolarapi.com/v1/dolares/oficial` (sólido) y euro
    (best-effort, cruce USD/EUR, degrada a manual); el fallo NUNCA bloquea. `PUT`
    = crear/editar tasa (`{label,currencyCode,rate}`), `DELETE /:label`, `POST
    .../refresh`. `Settings.defaultRateLabel` = tasa ambiental por defecto (null =
    solo USD; `secondaryCurrency` quedó de legado). **Quote/Order/Product tienen
    `currencyLabel`** (moneda elegida; null = solo USD) y congelan snapshot
    `exchangeRates` = `{ <moneda>: { rate, source, at, label } }` (keyed por moneda
    con label dentro → retrocompatible; los lectores toman `Object.entries()[0]`).
    El motor NO convierte.
  - **Cobro protegido en bolívares (perfiles de tasa)** — capa de PRESENTACIÓN
    sobre el precio recomendado (no toca `calculateQuote`). Función pura
    `shared/calc/charge-equivalents.ts` (`computeChargeEquivalents({baseUsd,
    referenceLabel, rates})`, decimal.js): dada una tasa de REFERENCIA (el "dólar
    real", normalmente el paralelo/Binance) calcula `targetVes = baseUsd × tasaRef`
    (Bs a recibir para NO perder margen) y, por cada tasa VES disponible,
    `adjustedBaseUsd = targetVes / tasaPerfil` (precio USD a cotizar a esa tasa) y
    `shortfallVes = targetVes − baseUsd×tasaPerfil` (pérdida evitada). `Settings.
    protectionRateLabel` elige la referencia (null = default de la app,
    `DEFAULT_PROTECTION_LABEL = 'Binance / USDT'`). **Las 3 tasas de protección se
    siembran MANUAL** (no por integración BCV) e **idempotente por label** en el
    seed (`ensureProtectionRates`, corre aunque el demo ya exista): "Binance / USDT"
    (700, referencia), "BCV Dólar" (667), "BCV Euro" (685) — todas VES = Bs por USD,
    valores PLACEHOLDER que el dueño edita a mano en Config → Moneda. Tests:
    `charge-equivalents.spec.ts`.
  - **Bs en vivo vs congelado (Fase 2)** — los montos en bolívares de un documento
    se muestran a la tasa de HOY de la moneda que eligió (por `label` del snapshot)
    mientras el documento sigue vivo; se **congelan** al emitir el documento final.
    **Presupuestos: siempre en vivo** (no se cierran). **Pedidos**:
    `Order.settledAt` (null = Bs en vivo; fecha = congelados). El botón **"Emitir
    nota de entrega"** dispara `POST /orders/:id/settle` (con confirmación) que
    re-congela `exchangeRates` a la tasa de hoy y marca `settledAt` (idempotente);
    re-descargar solo baja el PDF. **Cada abono congela su tasa** al pagar
    (`Payment.rate/currencyCode/currencyLabel`, capturados en `addPayment` de la
    moneda del pedido). El motor NO convierte; USD sigue siendo la base y las estadísticas.
  - **Pedidos / encargos (Fase 3, fundación)** (`orders/orders.module.ts`,
    `features/orders/api.ts`): modelo `Order` (cliente obligatorio, `code`
    correlativo por organización a prueba de concurrencia = max+1, `deliveryDate?`,
    `status` enum QUOTED→CONFIRMED→IN_PRODUCTION→READY→DELIVERED/CANCELLED, `lines`
    JSON `[{description,quantity,unit,unitPrice}]`, snapshot `exchangeRates`) +
    `Payment` (abono, monto en moneda BASE). **El SALDO se DERIVA** (total de
    líneas − abonos) en el service con helpers puros de `shared/calc/order.ts`
    (`orderTotal/orderPaid/orderBalance`), NUNCA se almacena. `Client` extendido
    con `phone/rif/address/municipality/city/notes` opcionales (el viejo `zone`
    se reemplazó por `municipality`+`city`). Endpoints: CRUD `/orders` +
    `POST /orders/:id/payments` + `DELETE .../payments/:pid`. **Decisión: los
    abonos NO generan `Sale` todavía** (integración pagos→dashboard = pendiente,
    evita doble contabilidad — ver 3C).
  - **Documentos del negocio** (`documents/`): **un solo formato** para la nota de
    entrega y la cotización de cliente, calcado de la plantilla real de Word
    (`nota_entrega_*.docx`). `documents/business-doc.ts` es el **motor de dibujo**
    (pdfkit): página **Carta** (612×792 pt, márgenes 39,6/50,4), logo centrado,
    tabla de cabecera de 4 columnas, tabla de ítems con encabezado negro `#111111`
    y caja de total en la mitad derecha, renglones en blanco y doble firma; corta
    página repitiendo el encabezado y repinta el pie en cada página. Los colores y
    tamaños son los del `.docx` (`DOC_COLORS`/`DOC_SIZES`). Fuente **Helvetica**
    (sustituto de la del `.docx`; pdfkit no puede incrustar fuentes de Office).
    - `documents/business-identity.service.ts` = **única** fuente del emisor
      (nombre de la organización + `Settings.business*` + logo). No leer esos datos
      por separado en un documento nuevo.
    - `documents/delivery-note.service.ts` → `GET /orders/:id/delivery-note.pdf`.
      N.° = `Order.code` + año. Tabla Ítem/Descripción/Cantidad/Unidad/Observaciones
      **SIN precios** (es constancia de entrega, no factura).
    - `documents/quote-note.service.ts` → **`GET /orders/:id/cotizacion.pdf`**
      (colgaba del presupuesto hasta 2026-09-07). Un renglón por línea del
      pedido; sin líneas, falla en vez de emitir un documento vacío. **Es lo
      que se le manda al CLIENTE**: descripción, cantidad, precio unitario y total,
      más los extras del motor (diseño/urgencia/ajuste por mínimo) como renglones
      propios para que las cuentas cuadren. **NUNCA costos, márgenes ni mayoreo** —
      para eso está **`GET /store/products/:id/desglose.pdf`** (`ExportService`), que
      es **interno**, sale de la ficha (que tiene el `input`) y se recalcula con
      `calculateQuote` para que diga lo mismo que la pantalla. Fijado por
      `documents/quote-note.service.spec.ts`.
    - **Fechas en UTC** (`documents/document-format.ts`): `deliveryDate` se guarda a
      medianoche UTC; formatear en la zona local imprimía el día ANTERIOR. Validez
      de la cotización: `QUOTE_VALIDITY_DAYS = 15` (constante, sin UI todavía).
    - ⚠️ **"Hoy" y "este mes" se deciden en hora de Venezuela**, no con
      `new Date()` a pelo: el servidor corre en UTC y desde las 20:00 de Caracas
      ya cree que es mañana (o el mes siguiente, el último día). Usar
      `businessDateKey(now)` de shared (`'AAAA-MM-DD'`; `.slice(0, 7)` para el mes)
      y aceptar `now = new Date()` como parámetro para poder testear el borde.
      Arreglado el 2026-09-13 en `PrintersService.usage` (horas del mes) y en el
      nombre del Excel (`reporte-AAAA-MM-DD.xlsx`); tests:
      `printers/printers.service.spec.ts`, `reports/reports.controller.spec.ts`.
      `monthKey(fecha)` sigue siendo correcto para fechas YA guardadas (día 1 UTC).
    - ⚠️ **La regla completa son DOS clases de fecha, y la mitad equivocada
      produce el bug simétrico.** "Usá `businessDateKey` siempre" es tan falso
      como "usá `toISOString` siempre":
      - **Fecha de negocio** (`Sale.date`, `Expense.date`, `CashReconciliation.date`…):
        se guarda a medianoche UTC y **ya es** el día que el dueño eligió. Se lee
        con `toISOString().slice(0, 10)`. Pasarla por `businessDateKey` la corre
        **un día para atrás**.
      - **Instante real** (`createdAt`, `confirmedAt`, "ahora"): es un momento
        del tiempo. Se lee con `businessDateKey`. Leerla con `toISOString()` la
        corre **un día para adelante** desde las 20:00 de Caracas.

      El ejemplo vivo: `cash.service.ts` lee `Expense.date` con `toISOString`
      (fecha de negocio) y `backfill-importado.mjs` lee `createdAt` con
      `businessDateKey` (instante real). **Los dos están bien. "Unificar el
      helper" rompe uno de los dos.** (El tercer caso, `backfill-caja.mjs`, se
      borró al caer el enum `paidBy`; vive en el historial.)
    - `Quote.code` = correlativo por organización (max+1, igual que `Order`); cada
      versión duplicada toma el suyo. Los presupuestos previos se numeraron en la
      migración; sin correlativo el documento sale como `S/N-{año}`.
    - **Logo del negocio**: `Settings.logo` (BYTEA) + `logoMime`. Se guarda en la BD
      porque el disco del hosting es efímero. `PUT/GET/DELETE /settings/logo`; el
      data URL entra por JSON (por eso `main.ts` sube el límite del body a 2 MB) y
      se valida **tipo declarado + bytes mágicos + tamaño** (solo PNG/JPEG ≤ 1 MB;
      el SVG se rechaza a propósito). `GET /settings` **nunca** devuelve los bytes:
      solo `hasLogo`. Regresión: `settings/logo-upload.spec.ts`.
    - **Nombre del negocio**: vive en `Organization.name` (no hay módulo de
      organizaciones); se edita como `businessName` dentro de `PATCH /settings`, que
      lo separa del resto del DTO antes de tocar la tabla `Settings`.
    - Calendario mensual UTC por `deliveryDate`, coloreado por estado.
  - **Pedidos avanzado (Fase 3C)**: **cuentas por cobrar** (pedidos con saldo>0 por
    antigüedad). **WhatsApp-out** (botón `wa.me` con resumen; teléfono 0→58).
    **Editar líneas** del pedido. **Abonos→dashboard**: `GET /orders/payments?from&to`
    (ruta literal ANTES de `:id`); el Dashboard suma ventas + abonos como INGRESOS
    (flujo separado, sin generar `Sale`, sin doble conteo). **Ciclo de cotización**:
    conversión (aceptados/decididos), "por seguir" (SENT), "vencido" (DRAFT/SENT >
    7 días → recotizar). *(El link público de pedidos se eliminó con la capa SaaS.)*
  - ~~**Catálogo de productos (Fase 4)**~~ — **ELIMINADO el 2026-09-07**. El
    modelo `Product` y su módulo ya no existen: el catálogo único es
    `StoreProduct`, que absorbió el costeo (`input` + `costAtPublish`). La tabla
    se borró con 0 filas — la pantalla existió dos meses y nunca se usó. El
    recosteo se mudó tal cual a `store/recost.service.ts`. Spec:
    `docs/superpowers/specs/2026-09-07-catalogo-unico-design.md`.
  - **CRM + mapa + respaldo + onboarding (Fase 5)**:
    - **Contactos/CRM** (`clients.module.ts`, `features/contacts/api.ts`): el
      modelo `Client` gana `type ContactType` (CLIENT/SUPPLIER/ALLY/COMPETITOR,
      default CLIENT) + `lat`/`lng` opcionales. **Decisión: se EXTENDIÓ Client, no
      se unificó con Provider** (Provider sigue siendo el enlace transaccional de
      gastos; Client es el directorio CRM). `GET /clients/:id` trae `history`
      (quotes/orders/sales); `PATCH /clients/:id` es **parcial**
      (`ClientUpdateSchema`) para fijar solo coordenadas.
    - **Ubicación por coordenadas**: **sin geocodificación**; la ubicación se fija
      con lat/lng (click en mapa desde el front). `lat`/`lng` opcionales en `Client`.
    - **Respaldo de datos** (`backup/backup.module.ts`): `GET /backup/all.json`
      (respaldo COMPLETO de la org) + `GET /backup/csv/:entity` (clients/sales/
      expenses/products/orders). "Tus datos son tuyos": exportar nunca se bloquea.
    - **Plantillas/onboarding** (`onboarding/onboarding.module.ts`): `POST
      /onboarding/seed-templates` siembra materiales (PLA/PETG/ABS/TPU), 1 impresora
      e insumos comunes, **idempotente por nombre** (no duplica).
  - **Tienda / catálogo público (Fase 6)** — DOS módulos, y la separación importa:
    - `store/` (**panel**, tras `JwtAuthGuard`): CRUD de `StoreProduct`, sus fotos,
      sus grupos de opciones y `StoreCategory`.
    - `store-public/` (**sin sesión**, `/api/public/store/*`): la ÚNICA superficie
      abierta de la API. Solo lectura, rate limit por IP real (`ProxyThrottlerGuard`),
      `Cache-Control` para que el CDN absorba el tráfico, y **lista blanca de campos
      armada a mano en el service** — nunca la fila de Prisma. La organización sale de
      `STORE_ORGANIZATION_ID`, **jamás de un parámetro del cliente**. Regresión:
      `store-public/store-public.service.spec.ts`.
    - ⚠️ **`StoreProduct` ES el catálogo único** (2026-09-07). Antes había un
      `Product` aparte "porque un servicio no tiene `CalcInput`". El argumento
      solo valía si el catálogo único era `Product`, que EXIGE costeo; con la
      ficha como catálogo el costeo es **opcional** (`input` en null) y el
      servicio entra sin forzar nada. Los datos lo confirmaron: `Product` tenía
      0 filas y una de las 3 fichas ya era un servicio.
    - **El recosteo vive en `store/recost.service.ts`**: re-resuelve cada línea
      del `CalcInput` guardado contra el catálogo **por nombre** (el snapshot
      embebe precios, no ids). `list()` carga el catálogo UNA vez para todas las
      fichas; `recost` es null en las que no tienen costeo.
    - ⚠️ **EL MARGEN SE MIDE EN USDT, NO EN LA ETIQUETA DE LA TIENDA** (2026-11-08,
      shared 0.70.0). El costo se calcula en USDT —el dólar real con el que se
      compra el filamento— y el precio se publica en **dólares BCV**, que valen
      menos. Dividir uno por el otro INFLA el margen: ,50 con costo /usr/bin/bash,22 decía
      582 % cuando el real es 498 %. Y peor: **apagaba la alerta**, porque un
      producto bajo el piso lo seguía aparentando.
      - `productStatus(precio, costoAlGuardar, costoHoy, piso, conversion?)` acepta
        las dos tasas y devuelve `markupNow` (USDT, **el principal**),
        `markupNominal` (BCV, solo referencia), `priceUsdt` y `converted`.
      - ⚠️ **`converted: false` NO cae al nominal en silencio.** Si falta una tasa,
        los márgenes son nominales y quien los muestre **tiene que decirlo**: un
        margen inflado rotulado «real» es justo el error que esto vino a cerrar.
      - ⚠️ **Las tasas son las de HOY, no las del día que se publicó** (decisión
        del dueño). La alerta existe para cazar la erosión del margen, y que la
        brecha BCV/Binance se abra ES esa erosión: congelarlas la escondería. Lo
        que se esperaba ganar ya lo dice `markupAtSave`.
      - El recosteo las carga él (hasta ese día **no leía ninguna**): la de los
        precios por la etiqueta `RATE_LABELS.BCV_USD` —no hay configuración que
        diga «los precios están en BCV», es una convención del negocio— y la de
        referencia por `settings.protectionRateLabel`, la misma del cobro
        protegido de la calculadora. ⚠️ `ExchangeRate` es un **historial**: la
        vigente es la fila más nueva de esa etiqueta, no una fila por tasa.
      - ⚠️ **El piso de la alerta (`productAlertMinMarginPct`) está en 0,15 y la
        regla del dueño son 120 %**, así que la alerta prácticamente nunca salta.
        Convertirla a USDT no sirve de mucho mientras ese valor siga tan abajo; se
        le propuso 80 % y **queda pendiente de que él lo cambie** en Configuración.
      - Regresión: `store/recost.service.spec.ts` (el cableado: que BUSQUE las dos
        tasas, por qué etiqueta, y que tome la más nueva) + `calc/product.spec.ts`.
    - **El costo lo pone el SERVIDOR**: `costAtPublish` no está en el DTO. Se
      CALCULA corriendo el motor sobre el `input` que manda la calculadora, o se
      lee de la cotización enlazada (heredado). Si viajara en el cuerpo,
      cualquiera publicaría con un costo inventado y el margen sería mentira.
      Regresión: `store.service.spec.ts`.
    - **Sin stock**: la producción es bajo pedido y `leadTimeDays` ocupa ese lugar.
      Las opciones (color/tamaño) van **sin combinatoria** — no hay SKU por
      combinación porque no hay existencias que llevar; el recargo por opción alcanza.
      Si algún día hace falta stock por variante, hay que migrar a una matriz.
    - **Fotos en Cloudflare R2** (`storage/object-storage.service.ts`, SDK de S3 —
      R2 es compatible). Subida en DOS pasos: el panel pide una **URL firmada**
      (`POST .../images/upload-url`) y sube el archivo DIRECTO al bucket; después
      confirma (`POST .../images`) y el backend verifica con `HeadObject` que el
      objeto exista, sea del tipo declarado y no pase el tope — la clave se genera
      en el servidor bajo `{organizationId}/store/{id}/` y se exige ese prefijo al
      confirmar. Sin las variables `R2_*` la app arranca igual y `GET /store/status`
      devuelve `storageReady: false` para que el panel avise. El **logo del negocio
      sigue en la BD** a propósito: es un archivo suelto, no un catálogo.
    - **CORS**: `WEB_ORIGIN` admite lista separada por comas + `STORE_ORIGIN`.
    - `StoreProduct` tiene además datos de VITRINA que pedía el diseño: `material`
      (texto libre, etiqueta no enlazada al catálogo de filamentos), `badge`
      (insignia de esquina), `custom` (personalizable) y `specs` (JSON de pares
      label/valor — un campo libre en vez de una columna por dato, para no migrar
      cada vez que aparece una especificación nueva).
    - El listado publica `requiresOptions`: si el producto tiene grupos de opciones
      OBLIGATORIOS, la vitrina manda a la ficha en vez de agregar al carrito sin
      elegir, que cotizaría el precio base. Los recargos por opción solo viajan en
      la ficha individual.
    - El **listado** público trae `colors` (las opciones del grupo "Color" que
      tienen muestra): la vitrina filtra por color, y pedir la ficha de cada
      producto solo para eso sería absurdo. Consumidor: repo `calc3d-landing`
      (el sitio público de Banano Lab; se llamaba `calc3d-store` hasta la fusión).
    - **`GET /public/store/products?detail=full`** (2026-11-07): el catálogo CON todo lo
      de la ficha (descripción, specs, galería, opciones con recargo) en UNA petición.
      Existe para que la tienda construya sus ~1.000 fichas sin pedirlas una por una: el
      límite público es 120/min y el N+1 rompía el build. Sale del mismo `include` del
      listado, y agrega una consulta agrupada (no una por producto).
      - ⚠️ **El modo completo NO trae `image`**: la portada sale de `images[0]`. Quien lo
        consuma tiene que sacarla de la galería (`adapt` de `calc3d-landing` ya lo hace);
        leer `image` ahí da `undefined` y todas las tarjetas salen sin foto.
      - Respeta `?category=` (la madre incluye a sus hijas). Un valor distinto de `full`
        se trata como modo tarjeta.
    - ⚠️ **Siembra sintética (`SEED_CATALOGO_SINTETICO`)**: `=1` siembra ~1.000
      productos `sint-*` **visibles**, `=borrar` los elimina (productos y categorías con
      ese prefijo). Los dos modos **ROMPEN si el host de `DATABASE_URL` no es local**
      (`common/guarda-base-local.ts`, antes de conectarse): visibles significa publicados
      en la tienda, y con el `.env` de producción a mano la siembra metía mil productos
      falsos en `bananolab-3d.com`. Regresión: `common/guarda-base-local.spec.ts`.
  - **Bandeja de la tienda (pedidos que llegan del catálogo público)** —
    `store-requests/`. Es la **PRIMERA y ÚNICA escritura sin sesión** del sistema;
    hasta acá `/public/store/*` era solo lectura. Cuatro reglas que la sostienen:
    - **El precio lo calcula el SERVIDOR.** El cuerpo solo trae
      `{slug, qty, options}`; `priceItems()` busca la ficha, valida las opciones
      y suma los recargos. Si el precio viajara en el body, cualquiera compraría
      a $0.01 y llegaría al panel como venta legítima.
    - **Una opción/grupo que la ficha NO tiene se RECHAZA, no se ignora.** Ignorar
      parece más amable, pero si el nombre llega apenas distinto (una ñ mal
      codificada, un grupo renombrado con la página abierta) el recargo se pierde
      en silencio: la ficha dice $25.50 y el pedido entra en $24.
    - **Nada toca la operación ni el CRM hasta confirmar.** `StoreRequest`
      (kind ORDER/CUSTOM, status NEW/CONFIRMED/DISCARDED) es una **bandeja**.
      `confirm()` crea el `Client` —o lo **enlaza por teléfono normalizado**, que
      es lo que da historial por cliente **sin cuentas ni contraseñas**— y el
      `Order` en `QUOTED` con `originChannel: STORE`.
    - **Rate limit propio, mucho más duro**: 5/min por IP real (el catálogo de
      lectura tiene 120/min). Un pedido es un acto humano, no una ráfaga.
    - Las líneas se traducen al formato de pedido con `toOrderLines()`, que mete
      las opciones DENTRO de la descripción: el pedido y la nota de entrega solo
      muestran ese campo, así que dejarlas aparte era producir sin saber el color.
    - Una solicitud **a medida** se confirma como pedido SIN líneas (todavía no
      tiene precio) con la descripción en `notes`. NO puede ser un `Quote`: un
      presupuesto exige el snapshot completo del `CalcInput`, y "quiero un llavero
      con mi logo" no lo tiene.
    - **Decisión: pedido como INVITADO, sin registro de clientes.** Construir
      cuentas opcionales obliga igual al camino de invitado y suma registro,
      verificación de correo, recuperación y sesión pública — el doble de
      superficie de auth sin demanda medida. El teléfono da lo que se quería.
    - `AttributionChannel` ganó el valor **`STORE`**: sin él los pedidos del
      catálogo caían como "Sin atribuir" y quedaban fuera del ROI por campaña.
    - Regresión (18 tests): `store-requests/store-requests.service.spec.ts`.
  - **LA SEMANA DE LA TIENDA (2026-10-12 → 2026-10-16, shared 0.53.0 → 0.58.0)**
    — banners, Flash Sale, precios por cantidad, foto por color y
    personalización del cliente, más dos arreglos de dinero. Documentado el
    2026-10-19 **leyendo los commits**: se construyó sin tocar este archivo, así
    que lo de abajo se reconstruyó del código y de sus mensajes. Specs:
    `2026-10-12-tienda-rediseno-banano-design.md`,
    `2026-10-14-tienda-precios-por-cantidad-y-foto-por-color-design.md`,
    `2026-10-14-tienda-personalizacion-cliente-design.md` y
    `2026-10-14-reposicion-ingresos-cobrados-design.md`.
    - **Banners (shared 0.53.0, migración `store_banners`)** — `StoreBanner`,
      CRUD en el panel + `GET /public/store/banners` con la lista blanca de
      campos armada a mano, como el resto de `store-public/`.
      - ⚠️ **Un destino colgado DEGRADA a `NONE`, no publica un enlace muerto.**
        El banner apunta a una categoría o a una ficha; si después se borra o se
        oculta, el "Ver más" llevaba a un 404. Ahora el endpoint público lo
        degrada. Es la misma familia que "una opción que la ficha no tiene se
        RECHAZA, no se ignora": el dato roto se resuelve en el borde, no se
        publica.
      - ⚠️ **El destino se valida ANTES de subir la imagen** (`17ec7bd`, en el
        panel): al revés, un destino inválido dejaba el objeto huérfano en R2.
      - **EL FONDO DEL HERO (2026-11-11, shared 0.74.0, migración
        `20261111180000_fondo_del_banner`, aditiva y nullable)** —
        `StoreBanner.backgroundKey`: la imagen GRANDE que va detrás del texto, a
        todo el ancho, aparte del arte que reemplaza al banano. Son DOS imágenes
        independientes y el contrato lo dice **tipo por tipo**, en vez de dejarlo
        al criterio de quien dibuje:
        - **HERO exige AL MENOS UNA de las dos**, y el arte pasó a ser
          **OPCIONAL** (decisión del dueño). Un hero sin ninguna no es un banner:
          es un título flotando, y el filtro de la tienda lo descarta igual.
        - **CATEGORIA exige el arte y PROHÍBE el fondo**: su tarjeta no tiene
          dónde dibujarlo, así que aceptarlo era guardar un objeto en R2 que
          nadie muestra nunca. **TEXTO** sigue prohibiendo las dos.
        - ⚠️ **Se publica `backgroundUrl`, JAMÁS la clave** — con la clave se
          podría construir una ruta a objetos de otra organización (la misma
          regla que `customImageUrl` de la bandeja).
        - ⚠️ **La proyección pública se agregó A MANO en
          `store-public.service.ts`**, que es donde vive la lista blanca. Es
          exactamente el paso que se olvidó con los tramos por precio fijo el
          09/11: **guardar un campo y PUBLICARLO son dos cambios**, y el primero
          deja todos los tests en verde.
        - Reemplazar el fondo o borrar el banner borra el objeto viejo de R2
          (mejor esfuerzo), como el resto de las imágenes del módulo.
        - ⚠️ **Y había un tercer lugar que decidía si el banner se ve**: el
          filtro `bannersDeHero` de la tienda pedía `imageUrl`, así que un
          banner con solo fondo se guardaba bien y la portada **no lo mostraba
          nunca, sin un solo error**. Ver el `CLAUDE.md` de `calc3d-landing`.
        - Regresión: 7 tests en `schemas/store.spec.ts` y 2 en
          `store-public.service.spec.ts` (publica la URL, nunca la clave).
    - **Flash Sale (shared 0.54.0)** — tres columnas en `Settings`
      (`saleTitle`, `saleStartsAt`, `saleEndsAt`) + `GET /public/store/sale`.
      - ⚠️ **`activeSale(settings, now)` es la ÚNICA definición de "oferta
        vigente"** (`store-public/active-sale.ts`), con **bordes inclusivos** y
        `now` **como parámetro**, no leído del reloj adentro — la misma
        convención que `cashChainCuts`, `facturasAtrasadas` y
        `lecturaDeHorasPendiente`.
      - Sin las DOS fechas no hay oferta: una ventana a medias es `null`, no una
        oferta que empieza y no termina. El título sí puede faltar.
      - ⚠️ **LA OFERTA NO COBRA MENOS: solo tacha** (decisión del 2026-10-12,
        §10 del spec del rediseño). `priceItems()` **no la mira** — verificado
        leyendo el servicio, no suponiéndolo—, así que lo que se cobra no
        cambia. Si algún día descontara de verdad, hay que decidir cómo convive
        con los tramos de cantidad y con `compareAtUsd`.
      - ⚠️ **Y la ventana manda SOLO la sección de la home.** El precio tachado
        del catálogo y de la ficha sale de **`compareAtUsd`** y es
        independiente: existe con la ventana cerrada. Son dos cosas que se ven
        parecidas y se encienden por caminos distintos — confundirlas lleva a
        "apagué la oferta y los precios siguen tachados", que no es un bug.
    - **Precios por cantidad (shared 0.55.0, migración `store_price_tiers`;
      **precio fijo desde shared 0.72.0**)** — `StoreProduct.priceTiers`, expuesto
      en la ficha pública y aplicado por
      **`precioConTramos(baseUnit, qty, tiers, recargos)`**
      (`shared/calc/store-pricing.ts`).
      - ⚠️ **El descuento lo aplica el SERVIDOR**, en `priceItems()`. Es la misma
        regla que sostiene toda la bandeja: el cuerpo trae `{slug, qty,
        options}` y nada más. Un tramo aplicado en el navegador sería un precio
        del cliente.
      - Gana el **mayor tramo cuyo `minQty <= qty`**; sin ninguno aplicable,
        el unitario entra sin tocar, y **no toca** `compareAtUsd` ni la Flash Sale.
      - ⚠️ **DOS FORMAS de decir el precio de un tramo, y hay que leer las dos**
        (2026-11-08). `unitPriceUsd` es el precio unitario de LISTA de ese tramo,
        escrito a mano: es la forma nueva y la única que permite un precio
        redondo (de $1,50, un 27 % da $1,0950). `discountPct` es el descuento en
        fracción, la forma vieja. **`discountPct` NO se puede retirar**: hay
        fichas publicadas guardadas así —`identificadores-para-lapices` tiene
        `[{10, 0.17}, {20, 0.266}]`— y dejar de leerla las deja sin mayoreo **sin
        un solo error**. El contrato exige una de las dos; con las dos, gana el
        precio fijo (es lo que el dueño escribió, no una cuenta).
      - ⚠️ **No hubo migración de Prisma**: `priceTiers` es una columna **JSON**.
        Agregar un campo al tramo no toca el esquema — y por eso tampoco hay red
        de la base: lo único que separa un tramo válido de uno roto es el Zod.
      - ⚠️ **LA API PÚBLICA SE OLVIDÓ DE ENVIARLO, Y TARDÓ UN DÍA EN NOTARSE**
        (2026-11-09). `store-public.service.ts` armaba cada tramo a mano como
        `{ minQty, discountPct }`, así que un tramo por precio fijo salía con
        `Number(undefined)` = **NaN**, que en JSON viaja como `null`: la tienda
        mostraba el precio de LISTA en todos los tramos mientras el servidor
        cobraba el del tramo (lo lee de la base, no de esa proyección). Medido
        ese día en producción: la ficha decía **$15,00** por 10 identificadores
        y el pedido se cobraba **$12,50**. Ahora lo arma `tramoPublico`.
        - ⚠️ **La clave que no corresponde se OMITE, jamás viaja en `null`.**
          `precioConTramos` pregunta `unitPriceUsd !== undefined`: un `null`
          pasa esa guarda y el tramo pasa a valer **0**. Hay un test que lo fija.
        - ⚠️ **La lección**: guardar un campo nuevo y exponerlo son DOS cambios.
          El panel aprendió a guardarlo el 08/11, los tests de `shared` y del
          servicio de pedidos quedaron en verde, y la superficie que lo tenía
          que publicar nunca se tocó. Al agregar un campo a `priceTiers` —o a
          cualquier JSON que la tienda lea— pasá también por `tramoPublico`.
      - ⚠️ **Los RECARGOS de opción se suman al precio fijo**, y `recargos` es un
        parámetro **OBLIGATORIO** desde el 2026-11-08 (lo pidió la revisión de
        seguridad). Un precio fijo reemplaza al precio de LISTA, no a lo que el
        cliente eligió encima: si reemplazara todo, a partir del tramo el tamaño
        grande saldría **gratis**. Y con un default de 0 el servidor lo pasaba
        pero la ficha y el carrito no, así que el visitante habría visto $1,25 y
        pagado $2,75. Que el compilador obligue a decidir en cada llamada es la
        protección; quien quiere el precio de lista pasa 0 y **se lee que lo
        decidió**.
      - ⚠️ **Hoy ninguna ficha tiene tramos Y recargos a la vez** (medido en
        producción: el único con tramos no tiene recargos, y los dos que tienen
        recargos no tienen tramos). O sea que este agujero habría quedado
        **latente** y aparecido el día que el árbol de Navidad llevara mayoreo.
      - **`descuentoDeTramo(precioLista, tramo)`** deriva el "−17 %" para mostrar.
        Nunca para cobrar: hay **un** número guardado, no dos que mantener de
        acuerdo.
      - El editor del panel trabaja en **precios**, no en porcentajes, y traduce
        un tramo viejo a su precio al abrir la ficha. Ver el `CLAUDE.md` de
        `calc3d-web`.
      - ⚠️ **Es otra cosa que el mayoreo del motor de cálculo**
        (`calc/wholesale.ts`): aquel sugiere tramos respetando el piso de margen
        y vive en la calculadora; este es lo que la TIENDA cobra. Comparten la
        idea y no el código, a propósito.
    - **Foto por color (shared 0.56.0, migraciones `option_group_drives_photo`
      y `store_image_option`)** — `StoreOptionGroup.drivesPhoto` + 
      `StoreImage.optionId`: elegir un color cambia la foto de la ficha.
      - ⚠️ **El `update` del producto pasó a hacer DIFF POR ID** (crear /
        actualizar / borrar) en vez de borrar y recrear los grupos. Con el
        borrado y recreado, **editar cualquier cosa del producto borraba las
        fotos enlazadas a sus opciones** (caen en cascada): el usuario tocaba el
        nombre y perdía las fotos por color sin que nada fallara. Por eso las
        opciones necesitaron **ids estables**.
      - ⚠️ **Un solo grupo puede tener `drivesPhoto`**, y lo rechazan `create` y
        `update`: con dos, elegir color y elegir tamaño pelearían por la misma
        foto y el resultado dependería del orden.
      - ⚠️ **La galería base son las imágenes con `optionId` null.** Sin esa
        distinción, las fotos de opción se duplicaban en la galería.
      - ⚠️ **Al borrar una opción o un grupo, se borra su foto de R2**
        (`syncOptionGroups` junta las claves que caen en cascada y `update()`
        las borra **después del commit**, mejor esfuerzo, como `removeImage`).
        El borrado por diff dejaba el objeto huérfano en el bucket.
      - `confirmImage` acepta `optionId` y **valida que esa opción sea de un
        grupo `drivesPhoto` de ESTE producto**: si no, se podría colgar una foto
        de la opción de otra ficha.
    - **Personalización del cliente: foto + nota (shared 0.57.0)** — un ítem del
      pedido público puede llevar `customNote` y `customImageKey`.
      - ⚠️ **Es la SEGUNDA escritura sin sesión del sistema**, y encima acepta un
        archivo. `POST /public/store/uploads/custom-url` devuelve una URL
        firmada **acotada en tipo y tamaño**, con la clave generada por el
        servidor bajo `custom-uploads/`, y hereda el rate-limit **estricto**
        (5/min) del controller público. Sin R2 configurado responde **503** en
        vez de ofrecer una subida que va a fallar.
      - ⚠️ **La foto se VERIFICA al confirmar el pedido**, no se cree: la clave
        tiene que tener el prefijo y el objeto tiene que existir con el tipo y
        el tamaño declarados (`HeadObject`). Es el mismo doble paso que las
        fotos del panel.
      - ⚠️ **Personalizar un producto que NO es `custom` se RECHAZA.** Sin eso,
        cualquiera adjuntaba una imagen a cualquier ficha.
      - ⚠️ **La bandeja expone `customImageUrl`, NUNCA la clave**: la clave es
        interna del bucket y con ella se podría construir una ruta a objetos de
        otra organización.
      - ⚠️ **La nota se suma a la DESCRIPCIÓN al confirmar** (`toOrderLines`),
        igual que las opciones: el pedido y la nota de entrega solo muestran ese
        campo, así que dejarla aparte era producir sin saber qué pidió.
      - Descartar o borrar una solicitud **limpia las fotos de R2** (mejor
        esfuerzo). `GET /public/store/info` expone **`storageReady`** para que la
        tienda esconda el cargador cuando R2 no está configurado.
    - ⚠️ **REPOSICIÓN DE EQUIPOS: el ingreso es lo COBRADO, no lo facturado**
      (`9437878`, arreglo de dinero). `recovery()` sumaba ventas + el total de
      **TODOS** los pedidos, incluidos los **cotizados y los cancelados**: eso es
      plata que no entró. Ahora es **ventas + abonos (`Payment`)**, la misma
      definición que el "Resultado de la operación" del Dashboard, así las dos
      tarjetas de la misma pantalla coinciden. Test con número clavado y su
      contrafáctico (**135** contra los 170 de antes).
      - Es la **cuarta vez** que el mismo error aparece con otra cara: dos
        pantallas contando el mismo dinero por caminos distintos. Ver "Vendido
        de una campaña", "la dona Mostrador vs encargo" y "Caja y Deuda cuentan
        lo mismo".
    - **Campañas: "Lo que pagué" (shared 0.58.0, migración
      `campana_gasto_gestionado`)** — `Campaign.paidUsd` crea, actualiza o borra
      **UN** `Expense` de Publicidad enlazado (`Campaign.managedExpenseId`).
      - ⚠️ **El gastado real se sigue DERIVANDO de TODOS los `Expense`
        enlazados**, como desde el día uno. Lo nuevo es solo una puerta cómoda
        para cargar el pago desde la campaña; no es una segunda fuente.
      - ⚠️ **`managedExpenseId` existe para que editar NO duplique.** Sin él,
        cada guardado de la campaña habría creado otro gasto de Publicidad y la
        inversión se habría inflado sola. Poner el pago en 0 o en null **borra**
        ese gasto; editar la campaña sin tocar el pago lo deja como estaba.
      - Todo corre **dentro de la transacción** de crear/editar la campaña: un
        gasto creado con la campaña a medias quedaría huérfano.
      - Regresión: `campaigns.service.spec.ts` (crear / editar / borrar, que no
        se duplique al editar, y que editar sin tocar el pagado no lo mueva).
    - **En el panel**, de la misma tanda: pantalla de banners, control de Flash
      Sale, editor de tramos en la ficha, subida de foto por color, la bandeja
      mostrando nota y foto, atribuir un encargo a una campaña desde su detalle,
      y dos arreglos de UI — el **`Select` que en móvil se cerraba solo al abrir
      el teclado** (no autofoco en táctil + ignora el cierre por `resize`) y el
      botón **Editar** del detalle de campaña, que no existía en móvil.
  - **Autenticación y seguridad de cuentas** — `auth/` + `mail/mail.module.ts`:
    - **Login del dueño** (`POST /auth/login`): **no hay registro público**; la cuenta
      se crea con el `seed` (ver Comandos). Roles OWNER/COLLABORATOR se conservan en el
      modelo (un solo usuario = OWNER).
    - **Refresh tokens rotatorios** (`auth/token.service.ts`, tablas `RefreshToken`
      /`AuthToken`): access token JWT **corto** (`JWT_EXPIRES_IN`) + refresh opaco
      (48 bytes) guardado como **hash sha256** (nunca en claro). `POST /auth/refresh`
      **rota** (revoca el viejo, emite nuevo en la misma `family`); `POST /auth/logout`
      revoca. **Detección de reuso**: si llega un refresh ya revocado → se revoca TODA
      la familia (defensa ante robo).
    - **Recuperación de contraseña**: `forgot-password` (respuesta SIEMPRE genérica,
      no revela si el correo existe) + `reset-password` (revoca TODAS las sesiones).
      Tokens `AuthToken` de **un solo uso** con propósito y expiración.
    - **Correos con Resend** (`MailService`): SOLO para el enlace de reset de contraseña.
      Usa Resend si `RESEND_API_KEY` está configurada; si no, **modo dev** (registra el
      enlace en el log, NO lo expone en la respuesta HTTP). **En producción el enlace
      NO se registra**: lleva el token de reset y quien lea el log tomaría la cuenta;
      ahí se loguea el fallo de envío, que además avisa que el reset no funciona. Vars: `RESEND_API_KEY`,
      `MAIL_FROM`, `APP_URL`.
    - **Secreto de firma** (`auth/jwt-secret.ts`): fuente ÚNICA que resuelven tanto
      el `JwtModule` que firma como la estrategia que verifica (si cada uno lo leyera
      por su cuenta podrían divergir). **En producción no hay fallback**: sin
      `JWT_SECRET`, o con el valor de desarrollo, o con menos de 32 caracteres, la app
      NO arranca. Antes caía a `'dev-secret'`, escrito en el código: cualquiera que
      conociera un par usuario/organización podía firmar un token del dueño.
      Regresión: `auth/jwt-secret.spec.ts`.
    - **El seed no siembra credenciales conocidas**: con `NODE_ENV=production` exige
      `OWNER_PASSWORD` explícito y ya no imprime la contraseña en el log.
    - **Rate limiting** (`@nestjs/throttler` + `ProxyThrottlerGuard`): grupo estricto
      (login / forgot-password / reset-password) a **5/min** por **IP real** — que en
      producción son ~10 reales, ver abajo —; el resto
      (incluido `refresh`) usa el default del módulo (60/min). La IP real sale de
      `req.ip` (honra `trust proxy`, configurable con `TRUST_PROXY` en `main.ts`);
      `cf-connecting-ip` solo se usa si hay proxy confiable (si no, sería falsificable).
    - **Auditoría multi-tenant**: `common/multi-tenant.audit.spec.ts` fija que las
      lecturas por id filtran por `organizationId`.
    - **Pendiente/infra (NO código)**: endurecer el origen (firewall, bindear a 127.0.0.1).
  - **Publicidad / ROI (Fase 1)** (`campaigns/campaigns.module.ts`,
    `features/campaigns/`): modelo `Campaign` (nombre, plataforma, objetivo, estado,
    fechas, presupuesto USD). El **"gastado real" se DERIVA** de los `Expense`
    enlazados (categoría ADVERTISING + `campaignId`), NUNCA se almacena — reusa el
    ledger único, sin doble conteo. **Atribución**: `Quote`/`Order`/`Sale` ganan
    `originChannel` (enum `AttributionChannel`, null = sin atribuir) + `campaignId`;
    se **arrastra** al convertir cotización→venta (`from-quote`). **Métricas
    derivadas** (endpoint devuelve `stats` por campaña): inversión, total vendido
    (ventas atribuidas), ganancia (SOLO ventas con costo, es decir ligadas a
    cotización), #pedidos/#cotizaciones, ROAS. Helpers PUROS en
    `shared/calc/campaign.ts` (`roas`/`roi`/`costPer`/`netAfterAds`/`campaignHealth`
    → Rentable/Riesgo/Pérdida/Sin datos; ROAS-first, ROI solo con costo). Todo USD
    base. `campaign` con `onDelete: SetNull` en los documentos (borrar campaña
    desatribuye, no borra ventas). Tests: `campaign.spec.ts`.
    - **Fase 2**: `CampaignDetail` gana **vista por período**: el endpoint `get`
      devuelve `period = {sales, revenue}` = ventas de la org DENTRO de la ventana de
      fechas de la campaña, SIN importar atribución (estimación de arrastre, separada
      de los números atribuidos).
    - **Fase 3**: **Recomendación automática** — helper PURO `campaignRecommendation`
      en `shared/calc/campaign.ts` (fuente ÚNICA para UI y PDF, ROAS-first coherente con
      `campaignHealth`): sin inversión/sin ventas → `WAIT`; `LOSS` → `PAUSE`; `AT_RISK` →
      `REVIEW`; `PROFITABLE` con ROAS≥3 o ROI≥100 % → `SCALE`, si no `KEEP`. Devuelve
      `{action, title, reason}` (español). **Export** (reusa `fast-csv`+`pdfkit`, sin
      deps nuevas): `GET /campaigns/export.csv` (todas las campañas + métricas + salud +
      recomendación, Excel-compatible) y `GET /campaigns/:id/report.pdf` (informe por
      campaña); **rutas literales declaradas ANTES de `:id`**. **Bs del gasto congelado**:
      `ExpenseCreateSchema` gana
      `rate`/`currencyCode` (columnas ya existían); el tipo Publicidad guarda `amount`
      en USD base (= Bs ÷ tasa) + `rate`/`currencyCode='VES'` para presentación. Tests:
      `campaign.spec.ts` (recomendación).
    - **Métricas de la plataforma (2026-09-07)**: `Campaign` guarda `reach`,
      `conversations` y `profileVisits` (opcionales, migración
      `metricas_de_campana`) y el detalle deriva el **costo por conversación**.
      Desde 2026-10-01 (shared 0.18.0) también `followers` (seguidores ganados,
      columna "Seguidores" de Publicidad; migración `seguidores_de_campana`).
      Contrato fijado en `shared/src/schemas/campaign.spec.ts`.
    - ⚠️ **"Vendido" de una campaña = ventas + ENCARGOS atribuidos** (sin
      `QUOTED` ni `CANCELLED`), desde el 2026-10-02. Antes sumaba solo `Sale`, y
      desde "encargo = pedido" toda campaña daba $0: el Dashboard avisaba que
      ninguna rendía (Identificadores, ROAS 5,7×, salía "en riesgo"). Regresión:
      `campaigns/campaigns.service.spec.ts`.
      Son la ÚNICA medida de una campaña que todavía no generó venta atribuida:
      sin ellas el ROAS es 0× y no dice nada.
    - ⚠️ **`stats.quotes` volvió a calcularse el 2026-10-02** (= encargos
      atribuidos en estado `QUOTED`). Había dejado de devolverse al eliminarse
      los presupuestos (2026-09-07), pero el panel **nunca dejó de leerlo**: el
      tipo del front lo declara `number`, así que TypeScript afirmaba que estaba
      y nadie lo notó. `costPer(invested, undefined)` reventaba el detalle de
      **todas** las campañas con *"DecimalError: Invalid argument: undefined"*
      (la guarda `count <= 0` no atrapa `undefined`, porque `undefined <= 0` es
      `false`; con `null` sí habría funcionado). **Un tipo del front NO es un
      contrato**: la regresión que lo fija es `campaigns.service.spec.ts`
      ("el contrato de stats no pierde campos"), que recorre la lista de campos
      que el panel lee.
    - **Los helpers de `shared/calc/campaign.ts` toleran que falte un dato**
      (`roas`/`roi`/`costPer` → null, `netAfterAds` → trata el faltante como 0,
      `campaignHealth`/`campaignRecommendation` no lanzan). Son el borde entre
      el servidor y la UI: un campo que falta no puede tumbar una pantalla.
    - **ESTADO DERIVADO (`campaignLifecycle`, shared 0.19.0)**: el `status`
      guardado se queda viejo porque NADA lo mueve a `FINISHED` cuando pasa
      `endDate`. El Dashboard pedía "revisá estas campañas antes de seguir
      invirtiendo" sobre campañas terminadas hacía semanas — una orden
      imposible. `campaignLifecycle(status, endDate, hoy)` devuelve
      `RUNNING`/`PAUSED`/`FINISHED`; lo marcado a mano manda sobre la fecha.
      ⚠️ `hoy` llega como `'AAAA-MM-DD'` calculado por quien llama **en día
      LOCAL** (el motor es puro y no decide husos). Con una campaña cerrada,
      `campaignRecommendation` devuelve la acción **`CLOSED`** con un veredicto
      en pasado ("No rindió: costó $X y dejó $Y"), sin imperativos. ⚠️ **`serialize()` en
      `campaigns.module.ts` arma la respuesta CAMPO POR CAMPO**: un campo nuevo
      que no se agregue ahí existe en la base, pasa los tipos y **nunca llega al
      cliente**. Hay que tocar `serialize()`, `create()` y `update()`.
  - **Importación de las hojas del negocio** (`prisma/import-negocio.mjs` +
    `negocio-excel.json`, ignorado): clientes, encargos, publicidad, inversión en
    equipos e insumos. Mismo patrón que el de filamento: **sin `--commit` es un
    ENSAYO**, escribe en una transacción y **verifica contra el Excel antes y
    después** (montos cobrados y de pauta); si no cuadra, no escribe. Los encargos
    entran como pedidos **DELIVERED con su abono** (ya estaban cobrados; sin el
    abono quedan con saldo y no cuentan como ingreso). Atribución **conservadora**:
    "Instagram" → `ORGANIC` y "Personal" → `OTHER`, sin enlazarlos a ninguna
    campaña — inflar el ROI con ventas que quizá no vinieron de la pauta es
    mentirse a favor. **NO toca `Ventas`** (ver `docs/excel-vs-app.md` §6).
  - **Importación de gastos y ventas** (`prisma/import-gastos.mjs`,
    `prisma/import-ventas.mjs`): mismo patrón (ensayo por defecto, transacción,
    verificación contra el Excel). Dos reglas que valen para cualquier import
    futuro de esa hoja:
    - **`Gastos` se solapa con `Publicidad` y `Materiales` a propósito.** Tres de
      sus 19 filas ya estaban cargadas por esas hojas; el script las salta y
      **verifica que estén** antes de saltarlas, o no escribe.
    - **La fila 11 de `Ventas` NO es el mostrador**: está escrita a mano e
      incluye encargos (infla el mostrador un 200 %). El mostrador son las filas
      auxiliares 19-24. Los encargos viven solo como nota de texto y se
      descuentan **semana por semana** contra los pedidos ya cargados; un corte
      por fecha perdía $46. Resultado: 88 ventas COUNTER ($726) + 25 ENCARGO
      semanales ($1.323) + $184,96 en pedidos = **$2.233,96**, contra los
      $2.257,46 de la fila 11. Esos $23,50 son el descuadre de la hoja y NO se
      inventaron.
  - **Encargo = pedido (2026-09-14, shared 0.16.0).** Un encargo se registra
    SOLO como pedido (cliente, abonos, saldo). `SaleCreateSchema`/`SaleUpdateSchema`
    rechazan `kind: 'ENCARGO'` (400): una venta ENCARGO además del pedido sumaba el
    mismo dinero dos veces (ingresos = ventas + abonos). Las 25 ventas ENCARGO
    que existen (feb–ago) son el historial semanal del Excel, sin detalle: se
    leen y editan, no se crean. Solo `sincronizar-excel.mjs` las toca, vía Prisma
    y a propósito. Regresión: `sale.spec.ts` (shared) y `sales.controller.spec.ts`.
    En el panel "Pedidos" se llama **Encargos** (solo texto: rutas `/orders` y
    modelo `Order` siguen igual).
    - ⚠️ **Consecuencia: contar encargos por `Sale.kind` es ciego desde el
      2026-08-24** (la última venta `ENCARGO` importada). Lo que mide el canal
      de hoy son los **abonos**. Ya mordió dos veces: el "vendido" de una
      campaña (2026-10-02, daba $0 en todas) y la dona "Mostrador vs encargo"
      del Dashboard (2026-10-10, decía 100 % mostrador ocultando el 81 % que
      entró por 4 abonos). El reparto vive ahora en **`shared/calc/channels.ts`**
      (`repartoPorCanal(ventas, abonos)`, shared 0.36.0, 8 tests): encargos =
      ventas `ENCARGO` + abonos, mostrador = ventas `COUNTER`, y el total da
      ventas + abonos clavado — **los abonos nunca se convierten en `Sale`**.
      Si aparece una tercera pantalla que compare canales, usa esa función.
  - **Re-sincronización del Excel** (`prisma/sincronizar-excel.mjs`): los
    `import-*.mjs` son de carga INICIAL y fallan si ya hay datos; este compara
    contra la base y escribe **solo la diferencia**, así que se corre cada vez
    que el Excel cambie (ensayo por defecto, `--commit` para escribir).
    - ⚠️ **Un encargo se identifica por cliente + monto + DESCRIPCIÓN, jamás por
      fecha.** La fecha del Excel y la de la app pueden diferir por un día; pero
      *tolerar* días es PEOR que exigirla exacta: la hoja tiene dos encargos del
      mismo cliente por $10 en la misma semana ("2 macetas" y "2 materos") y con
      tolerancia el segundo se daba por cargado — una venta real que se perdía
      en silencio. Cada pedido de la base se consume una sola vez.
    - ⚠️ **Las filas auxiliares 19-24 de `Ventas` vienen VACÍAS**: eran fórmulas
      y el libro se guardó sin recalcular, así que `data_only=True` devuelve
      `None`. Hay que parsear el texto del día (`"Martes 3: 10$"`). Un lector
      que confíe en ellas ve un mostrador de $0 y **no falla**.
  - **Caja: obligaciones y conciliación (fase 1, 2026-10-05, shared 0.21.0)** —
    `cash/cash.service.ts` (el servicio salió de `cash.module.ts`, que quedó con
    el controller y re-exporta `CashService` porque `reports.module.ts` lo
    importa de ahí) + `shared/calc/cash.ts`, `obligations.ts` y `reconcile.ts`.
    Reemplaza la cascada de retiros y el "conteo de los lunes". Spec:
    `docs/superpowers/specs/2026-10-05-caja-saas-design.md`; plan:
    `docs/superpowers/plans/2026-10-05-caja-fase-1.md`.
    - ⚠️ **Quién pagó = `counterpartyId` en `Expense` y `LoanPayment`**
      (`null` = la caja). Una compra que paga la contraparte se anota UNA vez,
      como gasto con SU contraparte; el aporte sale solo. La hoja la anotaba
      dos veces y eso descuadraba. `OwnerMovement` es SOLO plata pura.
    - ⚠️ **Las obligaciones se DERIVAN, no se almacenan.** Una deuda con la
      contraparte ES un gasto suyo, una cuota suya o un aporte reembolsable,
      visto como deuda; su saldo es `monto − aplicaciones`, igual que
      `loanBalance`. Lo único que se persiste es **`DebtApplication`** (qué
      parte de qué pago cancela qué deuda), con un CHECK de "exactamente una
      obligación". **Murió la cascada por categoría**: `applyPayment` reparte
      FIFO por fecha (`Settings.debtApplicationOrder`, `OLDEST_FIRST`), con
      desempate por id para que el reparto sea reproducible. El excedente sale
      por `leftover` y es RETIRO, nunca deuda negativa ni gasto.
    - `businessCash` abrió dos líneas: `contributions` → `contributionsRefundable`
      + `contributionsCapital`, y `withdrawals` → `debtRepayments` + `ownerDraws`
      (de `movements[].applied`). `balance` da lo mismo que en 0.20.0.
    - **`CashCount` → `CashReconciliation`**, con `status DRAFT/CONFIRMED/VOID`.
      ⚠️ **Lo personal es un dato DECLARADO, no el residuo**: hasta 0.20.0 era
      `total − esperado`, y por construcción eso nunca daba faltante.
      `reconcile()` compara `total − personal` contra lo esperado; **nunca el
      total de la cuenta contra lo esperado**. Al confirmar se CONGELAN los
      importes (es un documento, no una vista) y `stale` avisa si después
      entraron movimientos con fecha anterior — sumando de vuelta el ajuste
      propio, o se encendería en toda conciliación ajustada.
    - **Atribución automática de faltantes: por CUENTA y APAGADA por defecto**
      (`CashAccount.autoAttributeShortfall`). Convierte un desconocido en una
      deuda saldada, así que la pantalla muestra el reparto antes de confirmar
      y deja escribir otra explicación. **Una diferencia A FAVOR no genera
      nada.** Idempotencia: `OwnerMovement.cashReconciliationId` es ÚNICO y
      `confirm` exige `DRAFT` (si no, 409). Anular borra el ajuste (sus
      aplicaciones caen en cascada) y deja la fila en el historial.
    - ⚠️ **`summary()` devuelve `plan`**: el reparto que haría `confirm()`, por
      el MISMO camino (contraparte de la CUENTA, obligaciones filtradas HASTA la
      fecha). El front NO puede deducirlo de `obligations`, que viene sin filtro
      y con la contraparte por defecto: conciliando con retraso mostraría deudas
      que el servidor va a ignorar.
    - `Counterparty` (OWNER/PARTNER/EXTERNAL_LENDER) y `CashAccount` sacan los
      nombres propios del código. **El nombre de la contraparte es un
      provisional** (`'Propietario'`): no hay en los datos ninguna fuente
      confiable del nombre real. Se renombra desde Configuración -> Caja.
    - Rutas: `GET /cash`, `POST/DELETE /cash/movements`,
      `PUT /cash/reconciliations`, `POST /cash/reconciliations/:id/confirm`,
      `POST /cash/reconciliations/:id/void`.
    - ⚠️ **UNA CUOTA ANULADA NO AMORTIZA, Y CAJA LO IGNORABA (2026-10-10).**
      Anular no borra: la fila queda en el historial con su motivo y el saldo
      **vuelve a subir**. Deuda lo hacía (`serialize()` calcula sobre los
      vigentes) y Caja no: leía `loan.payments` y `LoanPayment` enteros, así que
      anular una cuota subía el saldo allá y **no** acá — Caja **subestimaba la
      deuda** con el prestamista. Dos definiciones del mismo número.
      - ⚠️ **Desde 2026-10-11 la regla vive en el MOTOR**, no en el servicio:
        `LoanPaymentLike.voided` (lo ignora `loanPaid`, y con él `loanBalance`
        y `loanProgress`) y `CashLedger.loanPayments[].voided` (lo ignora
        `cashEntries`). El servicio **manda las anuladas con su marca** y no
        las filtra antes: filtrarlas dejaría la guarda sin ejercer, y una
        guarda que borrarla no tumba ningún test es peor que no tenerla.
        Regresiones: `loan.spec.ts` y `cash.spec.ts` en shared, más
        "Caja y Deuda cuentan lo mismo" en `cash.service.spec.ts`. Por
        mutación, devolver cualquiera de las dos al estado anterior tumba 3.
      - `vigentes()` (ahora en `cash/helpers-de-caja.ts`) **sigue existiendo**
        para lo que NO es el motor: las obligaciones con quien puso la cuota de
        su bolsillo y las etiquetas del desplegable. Que queden dos filtros es
        deliberado: ese decide qué se MUESTRA, el del motor decide qué AMORTIZA.
      - ⚠️ **NO va en el `where` de Prisma**: lo anulado viaja con su
        `voidedAt`. `loanBalance` y `cashEntries` no conocen `voidedAt`, así que
        con el filtro en SQL **ningún test ejercería la regla** —la base falsa
        de los specs no resuelve el `where` anidado de una relación— y borrarla
        no tumbaría nada: una guarda que parece puesta y no está. Es la misma
        lección del saldo a favor.
      - ⚠️ **Y HABÍA UNA CUARTA definición**: la hoja **Deuda del Excel**
        corría su propio `loanBalance(l.principal, l.payments)` sobre TODAS las
        cuotas, teniendo al lado el `balance`/`paid` que `LoansService` ya le
        entregaba bien. Ahora los usa tal cual y la cuota anulada sale marcada
        (`   pago ANULADO` + su motivo): su monto no entra en el "Saldo
        pendiente", así que sin la marca la columna no sumaba lo que decía el
        total y la hoja se contradecía a sí misma.
      - **Lo que falló no fue una cuenta, fue que nadie las comparó.** Por eso
        la regresión corre **las DOS lecturas sobre los mismos datos**:
        `cash.service.spec.ts`, "Caja y Deuda cuentan lo mismo" (6 tests, con
        `LoansService` y `CashService` sobre la misma base falsa; capital 750 y
        una cuota anulada de 50 → **650** en las dos, contra los **600** del
        contrafáctico) y `reports.controller.spec.ts` (3). Mutaciones: la guarda
        apagada tumba **3**, solo `lenderBalance` sin filtro **1**, solo las
        cuotas del ledger **2**, el predicado invertido **10**, el reporte
        recalculando **1** y la cuota anulada sin marca **1**.
      - Las únicas tablas con `voidedAt` son `LoanPayment`,
        `PurchaseInvoicePayment`, `PurchaseInvoice` y `CashReconciliation`:
        `Sale`, `Payment`, `Expense` y `OwnerMovement` se borran de verdad, así
        que no hay más gemelas de esta clase. Los abonos de compra ya se
        excluían (en el `where`, con su factura) y las conciliaciones por
        `status`.
  - ⚠️ **QUIÉN PAGÓ LOS GASTOS VIEJOS ES UN DEFAULT, NO UN DATO (auditoría del
    2026-10-19).** Repasados los 95 gastos de producción uno por uno. De los 77
    sin contraparte:
    - **1 ($25) nació de una FACTURA**: ahí `null` es **correcto** — el pagador
      es el de los abonos, no el del gasto. No se toca.
    - **5 ($110) se cargaron a mano** y están bien: los cuatro rollos del 09/10
      son de **la misma tanda** en la que el dueño SÍ marcó otros dos como
      suyos. Marcar dos de siete es una distinción deliberada, no un olvido.
    - **71 ($1.817,32) vienen del Excel, y nadie decidió nada sobre ellos.** La
      columna `paidBy` se creó el 2026-09-26 con
      `ADD COLUMN "paidBy" "PaidBy" NOT NULL DEFAULT 'BUSINESS'`: **todo gasto
      que ya existía quedó marcado como "lo pagó el negocio" automáticamente**.
      La migración a contrapartes tradujo `BUSINESS → null` fielmente, así que
      hoy ese `null` **parece** una decisión y es un valor por defecto.
    - El grueso es la **carga inicial de filamento del 31/08: 55 compras,
      $1.554**. Si fuera del bolsillo del dueño, el saldo pasaría de $286,53 a
      $1.840,53 y la deuda con él de $1.233,50 a $2.787,50 — más del quíntuple
      del saldo que la app muestra hoy.
    - ⚠️ **DECISIÓN DEL DUEÑO (2026-10-19): se queda como está.** No se acuerda,
      y el dato no existe en ningún lado: ni en la base, ni en el Excel, ni en
      el script que lo cargó (`sincronizar-hojas.mjs`, **nunca versionado** —
      lleva nombres de clientes— y borrado el 2026-10-04 con su lista
      `PAGADO_POR_VANAN`). **Mejor un desfase conocido que un número
      inventado.** Lo mismo para los $122 de mantenimiento y los $103 de
      publicidad del mismo período y el mismo default.
    - **Si algún día aparece un comprobante**, lo que hay que cambiar es
      `Expense.counterpartyId` (+ `refundable`): el gasto pasa a emitir dos
      asientos que se anulan en el saldo y dejan la deuda. Respaldo con
      `pg_dump` y ensayo antes, como se hizo con el de diseño.
    - ✅ **Lo que SÍ se corrigió ese día**: el pago al diseñador del 07/10 ($32)
      era el único gasto de diseño sin contraparte **contra diez hermanos que
      sí la tenían** — ese contraste es lo que lo delató, y el dueño confirmó
      que lo puso él. Saldo $254,53 → **$286,53**; deuda $1.201,50 →
      **$1.233,50**. El script eligió la contraparte **de los hermanos**, no por
      nombre, y se habría detenido si hubieran estado repartidos entre dos.
    - ⚠️ **Y una afirmación que llegó de afuera y era FALSA**: que
      `/printers/recovery` (0 %) y la fila "Equipos" de Caja ($504,33 recuperado)
      sean "dos endpoints leyendo lo mismo". **No lo son.** Reposición pregunta
      *cuánto de la máquina devolvió el negocio con su GANANCIA*
      (ingresos $2.793,18 − gastos operativos $2.775,15 = **$18,03**); la fila
      de Caja pregunta *cuánto de lo que puso el dueño YA SE LE DEVOLVIÓ*
      (2 `DebtApplication` = **$504,33**, la línea "Devoluciones a Evanan").
      Las dos son ciertas a la vez: **devolverle plata no es ganarla**.
      "Unificarlas" rompería uno de dos números correctos.
  - **El saldo HASTA una fecha (2026-10-10, shared 0.35.0)** —
    `GET /cash/balance?at=AAAA-MM-DD` devuelve `{ at, balance: BusinessCash }`
    con el mismo corte que ya usaba el esperado de una conciliación
    (`businessCash(ledger, hasta)`). Lo pide la **cadena del Dashboard**
    ("venías con $X · este mes $Y · te queda $Z") para que los tres números
    salgan de UNA definición, la de Caja.
    - ⚠️ **La fecha es obligatoria y tiene que existir en el calendario.** El
      regex a secas NO alcanza: el recorte del motor compara TEXTO, así que
      `at=2026-13-01` deja entrar todo 2026 y el "saldo hasta esa fecha" vuelve
      a ser el saldo entero — un número que parece bueno y miente sin avisar.
      Lo mismo si faltara: no puede valer por "toda la historia".
      ⚠️ **El chequeo del calendario vive en la constante `FECHA`**
      (`schemas/api.ts`), no en cada uso. Hasta el 2026-10-10 el `refine`
      estaba suelto en `CashBalanceQuerySchema` y sus **gemelas de escritura
      quedaban abiertas**: `'2026-02-30'` entraba por `OwnerMovementCreateSchema`
      y por el upsert de conciliaciones, y Prisma lo guardaba **corrido al 2 de
      marzo** — el movimiento quedaba en otro mes, el saldo "hasta el 28/2" no
      lo contaba y después aparecía como faltante sin causa visible. Un `date:
      FECHA` nuevo ya nace cerrado. Regresión:
      `schemas/fecha-calendario.spec.ts` (las tres puertas, con su hermano
      alcanzable) y `cash/cash.service.spec.ts` (contra el pipe REAL + metadata
      de Nest de `addMovement` y `saveReconciliation`).
      ⚠️ **Las otras OCHO puertas se cerraron el 2026-10-10 (shared 0.41.0).**
      `SaleCreateSchema`, `ExpenseCreateSchema`, `ExpenseWithDefinitionSchema`,
      `PaymentCreateSchema`, `LoanPaymentCreateSchema`,
      `PurchaseInvoiceUpsertSchema`, `PurchaseInvoicePaymentSchema` y
      `PurchaseReceiveSchema` eran `z.string().min(1)` y aceptaban cualquier
      texto; todas pasan por `new Date(dto.date)` en su servicio, así que el 30
      de febrero se guardaba el 2 de marzo. Ahora usan `FECHA` (y las
      gemelas de edición lo heredan por `.partial()`).
      - ⚠️ **`FECHA` se mudó al PRINCIPIO de `api.ts`.** Es un `const`: estando
        declarada en la sección de Caja, los schemas de arriba **no podían
        usarla** (TDZ al cargar el módulo) — esa fue la razón mecánica de que
        siguieran flojas. Si se vuelve a mover para abajo, vuelve el agujero.
      - **`FECHA_OPCIONAL`** (al lado) es para los campos donde "sin fecha" es
        válido: `Expense.endDate`, `PurchaseInvoice.expectedAt` y la fecha de
        una recepción. Acepta `''`/`null`/ausente porque **ya los aceptaba** (un
        `<input type="date">` vacío manda `''` y los servicios lo tratan como
        "no hay fecha"); exigirles fecha rompía el panel sin cerrar nada.
      - **Medido antes de apretar**: el panel manda SIEMPRE `AAAA-MM-DD`
        (`<Input type="date">`, `todayKey()` o `.slice(0, 10)`) y los
        importadores del Excel escriben por Prisma **sin pasar por estos
        schemas**. Nadie manda un ISO con hora, así que la forma es el día
        pelado. Si algún cliente lo necesitara, se amplía en la constante.
      - Regresión: `schemas/fecha-calendario.spec.ts` (shared, las 12 puertas
        con su hermano alcanzable) y **`common/fecha-calendario.audit.spec.ts`**
        (api), que prueba el `ZodValidationPipe` REAL y además lee la metadata
        de Nest: un schema cerrado con la ruta sin pipe no cierra nada y los
        tipos no lo notan.
      - ✅ **Y las TRES familias que faltaban se cerraron el 2026-10-10
        (shared 0.42.0)**: `CampaignCreateSchema.startDate` (con `FECHA`) y
        `.endDate`, `LoanCreateSchema.startDate`/`nextDueDate`/`closedAt` y
        `OrderCreateSchema.deliveryDate` (todas con `FECHA_OPCIONAL`, porque
        siguen siendo opcionales). No mueven plata del ledger pero el día se
        corre igual: un `nextDueDate` en marzo cuando se escribió el 30 de
        febrero es un **compromiso mal fechado**, y el `deliveryDate` **sale
        impreso en la nota de entrega** — la fecha corrida se la mostrás al
        cliente. **Medido en el panel, campo por campo**: `startDate:
        form.startDate` (día pelado), `endDate: form.endDate || null`,
        `deliveryDate || null`, `nextDueDate || null` y `closedAt` (que ese día
        el panel todavía no mandaba). Cero cambios en el cliente.
      - ⚠️ **`CampaignUpdateSchema.startDate` NO es nullable**: `.partial()`
        la vuelve `.optional()` y nada más. Ausente sí, `null` no — igual que
        antes de cerrarla. Por eso vive en la tabla de puertas obligatorias del
        spec y no en la de opcionales.
      - ⚠️ **El que impide que vuelva a quedar una gemela abierta es el
        INVENTARIO**, no la lista escrita a mano: el último test de
        `fecha-calendario.spec.ts` recorre TODOS los schemas exportados por
        `api.ts` y falla si un campo `*Date`/`*At`/`date` acepta
        `'2026-02-30'`. Excluye `*ViewSchema`/`*ResponseSchema` a propósito
        (describen lo que SALE; su `updatedAt` es un instante con hora, no un
        día de negocio). Un campo nuevo flojo aparece ahí **sin que nadie
        tenga que acordarse de ampliar la tabla**.
      - ✅ **Y LOS FILTROS DE LECTURA se cerraron el 2026-10-10 (shared
        0.47.0)**, que eran lo último que quedaba afuera. `GET /sales`,
        `/expenses`, `/orders/payments` y `/filament/purchases` eran
        `@Query('from') from?: string` **sin DTO ni pipe**; ahora van con
        **`RangoQuerySchema`** (`from`/`to` con `FECHA_OPCIONAL`), declarado
        **al lado de `FECHA`**, al principio de `api.ts`.
        - ⚠️ **No persisten nada y mienten igual, en las DOS direcciones.**
          Los servicios hacen `new Date(from)` y
          `new Date(`${to}T23:59:59.999Z`)`: `from=2026-02-30` arranca el **2
          de marzo** y la lista sale recortada **sin avisar** (ves menos ventas
          de las que hay), y `to=2026-02-31` termina el **3 de marzo** y
          muestra días que nadie pidió. Un `?from&to` no escribe, pero es con
          lo que el dueño mira su plata.
        - ⚠️ **Medido en el panel, filtro por filtro, ANTES de apretar**: los
          cuatro constructores de params filtran por verdad
          (`if (range.from) p.from = range.from`), así que con el preset "Todo"
          el parámetro **no viaja**; nadie manda `''` ni un ISO con hora. Por
          eso es `FECHA_OPCIONAL` y no `FECHA`.
        - ⚠️ **Pero la medición encontró un caso que SÍ rompe, y no era el
          esperado**: el Dashboard armaba el rango del mes a mano,
          `{ from: `${mes}-01`, to: `${mes}-31` }`, y **el 31 no existe en
          cinco meses del año**. O sea que la tarjeta del punto de equilibrio
          venía contando hasta TRES días del mes siguiente como ingresos "del
          mes" (febrero), con un número que seguía siendo plausible. Se
          arregló en el panel (`rangoDeMes`, el último día real, una sola
          definición que comparte con el preset "Este mes") **en el mismo
          despliegue**: sin eso, la validación devuelve 400 en noviembre.
        - ⚠️ **Y HABÍA QUINTOS, los dos con su gemela ya cerrada al lado**:
          `GET /goals?month=` (mientras `GET /goals/actuals` sí validaba con un
          schema) y `GET /printers/readings?month=` (mientras
          `GET /filament/stock|status|summary` usan `MonthSchema` desde
          siempre). Las dos van ahora con `MonthSchema`. El de lecturas era el
          peor: compara `r.month < month` como **TEXTO**, así que un `2026-13`
          dejaba entrar todo 2026 y la "lectura anterior" salía de otro mes —
          el mismo error de comparar texto que ya había mordido en
          `CashBalanceQuerySchema`.
        - ⚠️ **El inventario se amplió para que esto no se repita**: su patrón
          era `*date`/`*at`, así que **no miraba `from`, `to` ni `month`** y
          `RangoQuerySchema` podía nacer flojo con el inventario en verde.
          Ahora es `/^(from|to|month)$|(^|[a-z])(date|at)$/i`, anclado a nombre
          completo en los tres nuevos (con `[a-z]to$`, `photo` entraría como
          si fuera una fecha).
        - ⚠️ **No se valida `from <= to`.** Un rango al revés devuelve lista
          vacía, que es raro pero no miente: los dos extremos son días reales
          y el resultado es exactamente lo que se pidió.
        - Regresión: `schemas/fecha-calendario.spec.ts` (shared, 22 tests
          nuevos — los 8 días inventados por cada extremo, el 31 de febrero,
          el ISO con hora y los tres "sin rango") y
          `common/fecha-calendario.audit.spec.ts` (api, 20 — el pipe REAL más
          la metadata de Nest con el **paramtype 4 (QUERY)**, no el 3 del
          cuerpo, y la exigencia de que quede **un solo** `@Query` sin `data`:
          con el pipe al lado de un `@Query('to')` suelto, el otro extremo
          seguiría abierto).
    - ⚠️ Es una ruta **literal**, declarada ANTES de las paramétricas del
      controlador (la regla que avisan sus propios comentarios).
    - `previousDay` / `isCalendarDay` viven en `shared/calc/stock.ts`, con el
      resto de las conversiones de fecha, y van en **UTC**: con `new Date()`
      local, al oeste de UTC la cadena se corre un día entero.
    - `cashChain(antes, ahora)` (`shared/calc/cash.ts`) arma la cadena y
      **deriva el del medio** de los otros dos, así `Z = X + Y` al centavo. Con
      `antes = null` devuelve `null` (filtro en "Todo": no hay un "antes").
    - ⚠️ **`cashChainCuts(from, to, hoy)` decide QUÉ DOS CORTES pedir**
      (shared 0.37.0, 2026-10-10). Los dos extremos son el MISMO
      `businessCash` con otra fecha de corte: **no son dos definiciones de
      saldo**. Hasta ese día el extremo derecho era el saldo de HOY, siempre, y
      con un rango pasado el tramo del medio **se comía lo posterior**: elegías
      septiembre y ese tramo traía octubre entero adentro. La razón que se había
      dado para no arreglarlo —"tiene que dar el mismo número que la tarjeta
      Saldo en caja"— no se sostenía.
      - Un rango **ABIERTO** (termina hoy o después) corta en `end: null`, o sea
        en el saldo de hoy, **no en su `to`**: el 31 de octubre todavía no
        llegó. Así la pantalla normal no cambia ni paga una consulta de más, y
        su extremo derecho sigue siendo al centavo el de la tarjeta.
      - Un rango **CERRADO** (`to < hoy`) corta en su `to` y devuelve
        `closed: true`, para que **la palabra acompañe al número**: "cerró con"
        y no "te queda". La tarjeta "Saldo en caja" **no se toca**: sigue siendo
        el saldo de hoy, y son dos números distintos a propósito.
      - ⚠️ `hoy` lo calcula QUIEN LLAMA, en día **LOCAL** (`todayKey()` en el
        panel): el motor es puro y no decide husos. Con un "hoy" en UTC, desde
        las 20:00 de Caracas el mes en curso se leería como cerrado.
    - Tests: `cash.spec.ts` y `stock.spec.ts` (shared) — incluido el armado de
      punta a punta con un libro de agosto/septiembre/octubre donde septiembre
      tiene que dar +50 y no +10 —, `cash/cash.service.spec.ts` (saldo
      recortado, aislamiento con su hermano alcanzable y la fecha muriendo en el
      pipe real).
  - **ABM de contrapartes y cuentas (fase 2, 2026-10-05, shared 0.22.0)** —
    `cash/counterparties.service.ts` y `cash/cash-accounts.service.ts`, cada uno
    en su archivo. ⚠️ **`cash.service.ts` se partio el 2026-10-11**, cuando
    llego a 931 lineas: quedo en 464 (bajo las 480 que pedia su propia nota) y
    salieron `cash/helpers-de-caja.ts` (traducciones de Prisma al motor, sin
    estado), `cash/datos-de-caja.ts` (`cargarDatosDeCaja`, `obligacionesDe` y
    `etiquetasDe` — **que hay**) y `cash/conciliacion.ts` (`atribucionDe`,
    `repartoDeFaltante`, `planDe`, `planDeFaltante` — **quien se hace cargo de
    un faltante**). Son FUNCIONES y no providers de Nest a proposito: no hay
    estado que inyectar y asi el controller y los specs no se tocan. `confirm`,
    `saveReconciliation` y `voidReconciliation` se quedaron en el servicio
    porque los tres devuelven `summary()`, y moverlos seria una dependencia
    circular disfrazada de refactor.
    - ⚠️ **Segunda pasada (mismo día): las tres escrituras TAMBIEN salieron**,
      a `cash/escribir-conciliacion.ts`, y el archivo quedo en **321 lineas**.
      La razon por la que se habian quedado era falsa: no hacia falta pasarse
      el servicio, porque **escribir y devolver el resumen son dos cosas
      distintas**. Las funciones escriben y no devuelven nada; el servicio
      compone (`await guardarConciliacion(...); return this.summary(...)`), asi
      que cada endpoint responde exactamente lo mismo que antes. Si una
      excusa de "dependencia circular" aparece en un refactor, conviene mirar
      si lo circular es el codigo o el recorte que se eligio. Rutas: `/counterparties` y `/cash-accounts`,
    las dos con `GET`, `POST`, `PUT /:id`, `POST /:id/default` y `DELETE /:id`.
    Plan: `docs/superpowers/plans/2026-10-05-caja-fase-2.md`.
    - ⚠️ **Las guardas de borrado no son cosmeticas.** Una contraparte con
      movimientos, o que es con quien se comparte una cuenta, o la unica
      propietaria -> **409 con un mensaje que dice que hacer**; la salida es
      DESACTIVARLA, como una ficha de filamento descontinuada. Lo mismo con una
      cuenta que tiene conciliaciones o es la unica.
    - ⚠️ **La caja necesita SIEMPRE una contraparte propietaria activa**: es a
      quien le atribuye la deuda. `remove` lo protegia, pero desactivarla o
      cambiarle el tipo esquivaba la guarda, asi que `update` la exige tambien y
      `defaultCounterparty()` prefiere una activa sobre la marcada por defecto.
    - **Una sola por defecto / una sola principal**, con indices unicos
      PARCIALES en la base (`Counterparty_org_default_key`,
      `CashAccount_org_default_key`; Prisma no los declara, van a mano en la
      migracion). `setDefault` desmarca y marca **dentro de una transaccion**, y
      `remove` traspasa el titulo si borra la que lo tenia — borrando primero y
      promoviendo despues, o el indice rechaza el instante con dos.
    - ⚠️ **La contraparte de una cuenta compartida se valida contra la
      organizacion.** Es el IDOR menos obvio y el de peor consecuencia:
      `confirm()` le atribuiria un faltante de plata a la contraparte de otro
      negocio. Fijado en `common/multi-tenant.audit.spec.ts`.
    - `Settings` gana `reconciliationFrequency`, `reconciliationWeekday` y
      `debtApplicationOrder`. La frecuencia es un RECORDATORIO: no bloquea nada.
    - **La fase 4 está terminada** (aplicada en producción el 2026-10-09;
      ⚠️ la migración se llama `20261010100000_adios_paidby`, con fecha del día
      siguiente, para quedar DESPUÉS de las del 09 sin ambigüedad): `Expense` y `LoanPayment`
      llevan `counterpartyId`, `null` = la caja pagó, y el enum `paidBy`
      **ya no existe**. Ver "Préstamos" abajo para las dos migraciones.
    - Tests: `cash.spec.ts`, `obligations.spec.ts`, `reconcile.spec.ts` (shared),
      `cash/cash.service.spec.ts` (32) y `common/multi-tenant.audit.spec.ts`.
    - ⚠️ **Multicuenta sigue funcionando solo en estructura**: se registran
      cuentas, pero ninguna venta, gasto, abono ni cuota tiene `accountId`, asi
      que el saldo esperado es uno solo y **solo se concilia la principal**.
      Compararlo contra otra cuenta daria una diferencia inventada, y la
      pantalla lo dice en vez de esconderlo.
  - **Detalle por categoria y etiqueta "Importado" (fase 3, 2026-10-05, shared
    0.23.0)** — plan: `docs/superpowers/plans/2026-10-05-caja-fase-3.md`.
    - ⚠️ **`businessCash` ya NO clasifica: clasifica `cashEntries` y
      `businessCash` SUMA.** `cashEntries(ledger, until?)` devuelve cada asiento
      con su `CashCategory`, y `GET /cash/breakdown/:category` devuelve esos
      MISMOS asientos. **Es la unica clasificacion.** Si alguna vez aparece una
      segunda —en la API, en el front, en el reporte de Excel— el detalle va a
      sumar distinto que la linea de arriba el dia que una de las dos cambie, y
      la pantalla de dinero se contradice a si misma.
    - Los asientos llevan `id`, **no etiquetas**: `shared` no conoce los nombres
      de columna de Prisma. El join `id -> texto` lo hace la API.
    - **Un retiro emite DOS asientos** (`debtRepayments` por `min(amount,
      applied)` y `ownerDraws` por el resto), con el mismo id. Y **un gasto
      operativo de la contraparte tambien** (gasto Y aporte): asi suma
      `businessCash`, es la regla que evita la doble carga, y por eso el join
      por id tiene que tolerar ids repetidos.
    - ⚠️ **El test "suma(entries de X) === businessCash[X]" es TAUTOLOGICO**
      para el motor: los dos lados salen de `cashEntries`. Lo que de verdad
      protege la clasificacion son los **numeros clavados** de `cash.spec.ts` y
      los tests de `businessCash — los filtros que nadie estaba mirando`. En la
      API ese mismo test SI sirve, pero para otra cosa: que el `filter`, el
      `map` y el join no pierdan ni dupliquen asientos.
    - Verificacion por mutacion con dientes: sacarle el filtro de "lo puso la
      caja" a `equipment` rompe **2 tests viejos**; sacarle el del prestamista
      a `operativo` **no rompia ninguno** (el unico gasto del prestamista en la
      suite tenia `isInvestment: true`). Elegir la primera si hay que repetirla.
    - `Sale` y `Payment` ganaron `source` (migracion `20261008120000`, aditiva).
    - **`prisma/backfill-importado.mjs`** marca `EXCEL_IMPORT` **por la marca
      textual** `"del excel"`, NO por fecha. Dry-run por defecto, `--write`/
      `--commit` sinonimos, `--undo` reversa completa, `--incluir=Modelo:dia`
      para los grupos que el dueno confirme. Lo que no lleva marca **no se marca
      solo**: se lista para revisar.
      - ⚠️ **Cualquier corte por fecha es FALSO.** La importacion no fue un
        evento: fue un goteo hasta al menos el 01/10 (habia un
        `sincronizar-excel.mjs` periodico, hoy borrado). Hay **2 ventas creadas
        el 2026-10-01 con la marca del Excel**: con cualquier corte quedaban
        como cargadas a mano.
      - ⚠️ **La marca es `del excel` SIN el parentesis.** Existen dos
        redacciones: `"(del Excel, hoja …)"` y `"— historica del Excel, fecha
        real no registrada"` (48 gastos). Verificado que no hay una tercera.
        Agregarle el parentesis "para que sea mas preciso" lo vuelve a romper.
      - `OwnerMovement` queda excluido: el unico que hay es el cuadre manual del
        17/09, lo escribio la app y no salio del libro.
  - **Elegir la deuda destino del faltante (2026-10-06, shared 0.24.0)** — al
    confirmar una conciliación con faltante, el dueño puede decir contra qué
    deuda va en vez de dejar el FIFO. `applyPayment(obligations, amount, order,
    target?)`: la elegida cobra primero hasta su `outstanding` y el remanente
    sigue el orden normal. **Sin `target` el reparto es byte a byte el de
    antes.**
    - ⚠️ **Una destino que no está en `obligations` LANZA**
      (`UnknownObligationError`), no devuelve un plan vacío. Un plan vacío es
      indistinguible de "no había nada que aplicar" —un resultado legítimo—,
      así que el llamador no podría notar la diferencia y el faltante se
      repartiría por el orden normal: justo el que el dueño NO eligió.
    - ⚠️ **La pertenencia se cierra por CONSTRUCCIÓN.** La lista que
      `obligaciones(d, contraparteDeLaCuenta, hastaLaFecha)` deriva es la
      única puerta: ser miembro ES la autorización. **No se consulta la deuda
      por id contra la base** —ese camino no sabe de contraparte ni de fecha y
      reabre el IDOR—. El servicio solo traduce el error del motor a un 400.
    - DTO: `CashReconciliationConfirmSchema` gana `targetSource`
      (`EXPENSE|LOAN_PAYMENT|MOVEMENT`) + `targetSourceId`, **los dos o
      ninguno**, y exige `attributeShortfall: true` (elegir deuda y pedir que
      no se atribuya es contradictorio). `ObligationSourceSchema` se construye
      desde `OBLIGATION_SOURCES` del motor para que no puedan divergir.
    - **`GET /cash/reconciliations/:id/plan?targetSource&targetSourceId`** —
      previsualización de SOLO LECTURA. Devuelve el `plan` y, además, las
      `obligations` **elegibles** (mismo filtro que `confirm`), `willAttribute`
      y la diferencia. El front NO calcula el reparto: en la fase 1 lo deducía
      de `obligations` del resumen (sin filtro de fecha, contraparte por
      defecto) y, conciliando con retraso, el dueño aprobaba un reparto que no
      era el que ocurría.
    - ⚠️ **Una destino que no se va a usar se RECHAZA, no se ignora**: si la
      conciliación no va a atribuir (cuenta sin `autoAttributeShortfall`,
      diferencia a favor, ya confirmada), mandar destino es 400.
    - El reparto se calcula **antes** de abrir la transacción: el 400 sale sin
      haber escrito nada. Confirmar sigue siendo idempotente (409 + un solo
      `OwnerMovement`) y anular sigue revirtiendo movimiento y aplicaciones.
    - ⚠️ **`baseFalsa` de `cash.service.spec.ts` ahora también escribe** y
      resuelve los `include` de `account` y `adjustment`. Es el mock que se
      comporta como Postgres (un `where` sin `organizationId` devuelve de MÁS):
      cada test de aislamiento viene con su **hermano** que comprueba que la
      fila es alcanzable cuando se la pide legítimamente. Verificación por
      mutación: ignorar la destino desconocida pone en rojo los 6 tests de
      seguridad; sacarle el `organizationId` a `expense.findMany` pone en rojo
      el de otra organización (y deja verde a su hermano).
  - **Mantenimiento por hora DERIVADO (2026-09-26)**: `derivedMaintenance` en
    `printers.module.ts` = gastos `MAINTENANCE` ÷ horas de la última lectura de
    TODAS las máquinas (`maintenanceRatePerHour`, como la hoja Costeo). Es una
    tarifa global porque la mayoría de los repuestos no dicen a qué máquina
    fueron. `GET /printers`, `/printers/usage` y el recosteo la usan; el campo
    `maintPerHour` de la ficha queda solo como respaldo si no hay lecturas.
    `GET /printers/maintenance` la expone. Valor al 26/09: $122 ÷ 2770 h.
  - **Re-sincronización del 2026-09-26** (`prisma/sincronizar-hojas.mjs`, NO versionado: lleva nombres de clientes +
    `hojas-excel.json`, ignorado): el Excel volvió a editarse a mano y trajo
    Caja, "Pagado por" en Deuda, horas de las impresoras y compras nuevas.
    Este script cubre lo que `sincronizar-excel.mjs` no mira (filamento,
    insumos, gastos, campañas, equipos, deuda, caja, tasas) y además los
    encargos/mostrador nuevos; `sincronizar-excel.mjs` queda como VERIFICADOR
    (tiene que decir "Nada que cargar"). Ensayo por defecto, idempotente,
    verifica contra el Excel. Quién pagó cada compra y la campaña de cada
    encargo NO están en celdas: van escritos en `PAGADO_POR_VANAN` y
    `ATRIBUCION` dentro del script. ⚠️ La marca **Filavent se renombró a
    Filaven** (fichas y opción). ⚠️ El conteo del 21/09 da −$15,50 del negocio
    contra los $8 de la hoja: la diferencia es EXACTAMENTE el descuadre de
    $23,50 de la fila 11 de Ventas.
  - **El estado de la migración del Excel** vive en `docs/excel-vs-app.md` (mapa
    hoja por hoja) y `docs/backlog-migracion.md` (las 10 actividades que faltan,
    con las decisiones que bloquean cada una). Actualizarlos al avanzar.
  - **Registro dinámico de gastos** (`POST /expenses/with-definition`,
    `ExpensesService.createWithDefinition`): el modal (front) elige el tipo
    (Filamento/Impresora/Componente/Empaque/Mantenimiento/General) y, si mapea a
    catálogo, deja reusar un item existente o crearlo inline → crea catálogo +
    gasto enlazado en una acción. **Los PATCH de catálogo son PARCIALES**
    (`XSchema.partial()`), no exigen el objeto completo. El alta desde el
    catálogo NO genera gasto (para sembrar/importar).
    ⚠️ En modo "existing", `link.referenceField`/`referenceValue` ("usar como
    precio de referencia") viajan en el body: el servidor solo acepta el campo de
    PRECIO de ese tipo de ficha (`rollPrice`/`price`/`packagePrice`) y un valor
    ≥ 0 — cualquier otro campo u otro valor negativo es **400**. Antes escribía
    el campo tal cual llegaba (mass-assignment: podía pisar `rollGrams`,
    `lifetimeHours`, `unitsPerPackage` o incluso `status`/`organizationId` sin
    las reglas de su schema). Regresión: `expenses.service.spec.ts`.
    ⚠️ **El precio del rollo sigue a la ÚLTIMA COMPRA POR FECHA**, no a la que
    se acaba de tocar (`recalcularPrecioDelRollo`, 2026-10-09). Antes solo lo
    fijaba `create`, así que **corregir un monto mal tipeado dejaba la
    calculadora con el precio viejo** — la pérdida de margen silenciosa que la
    regla vino a evitar. Ahora corre también en `update` y en `remove`:
    corregir una compra vieja NO mueve el precio, corregir la última SÍ, y
    borrar la última lo devuelve al de la anterior en vez de dejarlo congelado
    en una compra que ya no existe. Si la compra cambia de ficha se recalculan
    **las dos** (la que la gana y la que la pierde). Sin ninguna compra con
    rollos se deja el precio que había: ponerlo en 0 haría cotizar gratis.
    Regresión: 5 casos; las tres mutaciones (recalcular una sola ficha, no
    recalcular al borrar, invertir el `orderBy`) tumban un test cada una.
    ⚠️ **Quién pagó un gasto es `counterpartyId` y nada más** (desde
    2026-10-10). Entre el 08 y el 10 convivió con el enum `paidBy`, y
    `quienPago()` los escribía SIEMPRE como par para que no pudieran
    contradecirse: un gasto desparejo se habría visto de una forma en la
    pantalla y contado de otra en Caja. Hoy `quienPago()` solo valida.
    `counterpartyId` viaja en el body: se filtra por organización o el id de
    otro negocio ataría el gasto —y su deuda— a alguien de afuera (**404**).
    Regresión en `expenses.service.spec.ts`; la mutación que saca el filtro por
    organización tumba un test. ⚠️ De los 12 casos originales quedan 7: los
    cinco que probaban la convivencia con el enum se fueron con él.
    ⚠️ **El proveedor de un gasto es un CONTACTO del directorio** desde la
    migración `20261009180000_proveedores_al_directorio`. Había dos formas de
    registrar un proveedor que no se hablaban: la tabla `Provider` (nombre y
    teléfono) a la que apuntaba el gasto, y el directorio con su tipo
    `SUPPLIER`, que además guarda RIF, dirección, ciudad y mapa. Ganó el
    directorio. **La migración copia la fila CONSERVANDO SU id**: por eso un
    `Expense.providerId` viejo sigue siendo válido apuntando al contacto; con
    ids nuevos el `ON DELETE SET NULL` los habría puesto en null en silencio.
    El `INSERT` y el `DROP TABLE` van juntos a propósito. Al desplegarlo había
    **0 gastos con proveedor** (de 87), así que no movió un solo dato.
    ⚠️ `providerId` viaja en el body y hasta ese día **se escribía crudo**: con
    el id de otro negocio, el nombre de SU contacto salía en Compras de
    filamento y en la hoja de Gastos del Excel. `resolverProveedor()` lo filtra
    por organización y exige `type = SUPPLIER`. `providerName` es el alta al
    vuelo (busca sin distinguir mayúsculas para no crear "StratoFill" y
    "stratofill"). Regresión: 7 casos; las tres mutaciones (sacar la
    organización, sacar el tipo, sacar el `insensitive`) tumban un test.
    ⚠️ **Caja ya lee A QUIÉN se le debe, no solo de qué tipo era quien pagó**
    (2026-10-08). `idPagador()` en `cash.service.ts` resuelve la contraparte de
    cada fila (`counterpartyId` manda; si está nulo, la regla del backfill) y
    `obligaciones()` filtra por ella. Antes filtraba por `paidBy === 'OWNER'`
    **sin mirar a quién se le pregunta**: con un socio, los gastos de los dos
    se mezclaban y cada uno veía como propia la deuda del otro. Con una sola
    contraparte el error es invisible — y la pantalla de Gastos ya deja elegir
    socio, así que pasó a ser alcanzable. El **tipo** para el motor
    (`tipoPagador`) sale de la contraparte directamente y NO pasa por
    `idPagador`: sin contraparte propietaria, deducir por id daría `null` y el
    motor contaría el gasto como pagado por la caja — eso MUEVE el saldo.
    ⚠️ Y `summary()` recorre **todos los bolsillos** (OWNER + PARTNER), no solo
    la contraparte por defecto: si no, el gasto atribuido a un socio
    **desaparecería de Caja** — ya no se le cuenta al propietario (correcto) y
    nadie más lo preguntaba. **El encabezado todavía nombra solo a la
    contraparte por defecto**: con un socio real falta mostrar la deuda de cada
    uno por separado. Hoy no hay ninguno, así que el total y las filas son los
    mismos. Las tres mutaciones (filtrar por el enum, ignorar `counterpartyId`,
    volver a preguntar solo por la contraparte por defecto) tumban 7, 4 y 1
    tests. **Verificado contra la base real: las 10 líneas del saldo,
    `owedToOwner` 1130.69, `owedToLender` 750 y las 18 obligaciones, idénticas.**
  - ⚠️ **`GET /catalog-options` devuelve la lista administrada UNIDA a lo que
    de verdad se usa** en las fichas (2026-10-09). Las dos divergían: el
    importador del Excel escribió marcas, tipos y colores directo en `Material`
    sin registrarlos, así que el desplegable **no ofrecía tipos que el dueño ya
    usa** (vivo: "PLA PURE" en dos rollos) — los volvía a tipear y aparecían
    variantes que rompen el agrupado del análisis. Lo que está en uso pero no
    registrado viaja con **`id: null`**: se elige, pero no se borra (no hay
    fila que borrar y el valor lo usa una ficha). Dedup sin distinguir
    mayúsculas. 8 regresiones, con el mock filtrando por organización y
    aplicando el `distinct`; las tres mutaciones (sacar la organización, sacar
    el `toLowerCase`, no agregar los en uso) tumban 4, 2 y 4 tests.
  - **Combobox creatable + listas administradas** (`catalog-options/`): la marca, el
    tipo y el color del **filamento** viven en una **lista administrada aparte**:
    tabla `CatalogOption` (por org, `kind` = MATERIAL_BRAND/MATERIAL_TYPE/
    MATERIAL_COLOR, `value`, única por org+kind+value; persiste aunque no haya
    material que la use). Endpoints CRUD `/catalog-options` (POST idempotente por
    upsert; borrar una opción NO afecta a los materiales que ya la usan). Al crear/
    importar orgs las opciones se **rellenan** desde los valores distintos de sus
    materiales + tipos comunes (PLA/PETG/ABS/TPU/ASA/Nylon/PC/PVA/HIPS); backfill
    manual con un script Prisma (`catalogOption.upsert`). Extensible a otros campos
    con nuevos `kind`.
  - ~~**Motor pro (Fase 2A)**~~ — **DEROGADO el 2026-09-06** (shared 0.7.0). Los
    recargos (`surcharges`: diseño, urgencia, mínimo) y el arranque por tanda
    (`batch.setupCost`) se **eliminaron** del contrato, junto con `shared/calc/
    select.ts` (existía para elegir entre varios precios y ahora hay uno solo).
    Lo que sobrevive: **multi-tanda**, ahora en `piecesPerBatch` a nivel raíz del
    `CalcInput`. Ver "Convenciones del motor de cálculo" y el spec
    `docs/superpowers/specs/2026-09-06-calculadora-una-pantalla-design.md`.
    ⚠️ **`/sales/from-quote` registraba `jobTotal`** (precio con extras): ese campo
    ya no existe y hay que reapuntarlo a `order.total` — pendiente de la fase 2.
  - **Deuda / préstamos (2026-09-07)** (`loans/loans.module.ts`): modelos `Loan`
    (nombre, capital, cuota mensual, `closedAt`, `printerId?`) + `LoanPayment`
    (fecha, monto, referencia). **El saldo se DERIVA** (capital − abonos) con
    los helpers puros de `shared/calc/loan.ts` (`loanPaid`/`loanBalance`/
    `loanProgress`/`monthlyLoanPayments`/`monthsToPayOff`), NUNCA se almacena.
    - ⚠️ **Un pago de préstamo NO es un `Expense`** y no toca el ledger: el
      equipo ya entró ahí como inversión, y contar además cada cuota sería
      contar la misma máquina dos veces. Devolver capital no es un costo.
    - **Varios préstamos** a propósito: el nivel 2 del equilibrio suma la cuota
      de todos los ABIERTOS (`closedAt` null).
    - Import: `prisma/import-deuda.mjs` (también fija los parámetros del
      equilibrio en `Settings`). ⚠️ Un script `.mjs` **no puede importar el
      build ESM de shared** (usa imports sin extensión, que el ESM nativo de
      Node no resuelve): se trae el CJS con `createRequire`.
  - **Préstamos: acreedor, anulación y las dos deudas (2026-10-08, shared
    0.26.0)** — plan: `docs/superpowers/plans/2026-10-07-prestamos-saas.md`.
    - ⚠️ **El motor de caja ya NO conoce `PaidBy`.** `CashLedger` lleva
      `payer: PayerKind | null` (`null` = la caja). El motor necesita el **tipo**
      y no el id: lo que decide si un gasto genera deuda es si quien pagó es
      dueño del negocio (se le devuelve) o un prestamista (esa deuda ya vive en
      el saldo del préstamo). **El enum `paidBy` ya no existe** (migración
      `20261010100000_adios_paidby`, 2026-10-10): el tipo sale de la
      contraparte y `tipoPagador()` es la única traducción.
    - ⚠️ **Fueron DOS migraciones que NO podían ir en el mismo despliegue**, y
      así se hizo: la 1 (`20261009120000`) puramente aditiva, después el
      backfill contra producción, y la 2 (`20261010100000_adios_paidby`) un día
      después. `migrate deploy` aplica todas las pendientes seguidas al
      arrancar el contenedor, así que commitear la 2 junto con la 1 habría
      borrado `paidBy` antes de que nadie lo tradujera.
      Antes de aplicar la 2 se verificó contra producción que **no quedara una
      sola fila incoherente** (`paidBy <> BUSINESS` y sin contraparte): 0.
      Esa cuenta es el único gate que hay; con una fila, el dato se pierde.
    - El backfill trae **su propio guard**: dentro de la transacción saca la
      foto de las nueve líneas del saldo y de la deuda leyendo por el ENUM,
      traduce, la vuelve a sacar leyendo por la CONTRAPARTE, y si algo se movió
      un centavo revierte y aborta con código 1. **Los dos backfills se
      borraron** al caer el enum (ya no compilan contra el esquema): ver
      `prisma/LEEME-backfills-de-pagadores.md`.
    - `installmentTarget` reemplaza a `monthlyPayment` en la respuesta: con
      frecuencias, llamarla "mensual" sería mentir. `monthlyLoanPayments`
      **normaliza a mensual antes de sumar** — una cuota semanal de $50 son $217.
    - `payOffEstimate` da **dos lecturas**, al ritmo objetivo y al real. Una sola
      miente con pagos irregulares, que es el caso. El ritmo real se mide contra
      el CALENDARIO, no por cantidad de pagos.
    - **Anular no borra** (`POST /loans/:id/payments/:pid/void`, con motivo). Es
      POST y no DELETE porque DELETE promete que la fila desaparece. Anular dos
      veces es 409. ⚠️ **Todo lector nuevo de `LoanPayment` o de
      `loan.payments` tiene que descontar las anuladas**: Caja y la hoja Deuda
      del Excel no lo hacían y decían que se debía menos de lo que se debe. Ver
      "Una cuota anulada no amortiza" en la sección de Caja.
    - Un pago **no puede amortizar más que el saldo**: `loanBalance` recorta en 0
      y sin la guarda el exceso quedaba invisible.
    - Que un pago personal **genere deuda se pregunta** (`generatesDebt`). El
      default de la base era `true` y toda cuota del propietario generaba
      obligación sin que nadie lo decidiera. Si pagó la caja no genera nada, por
      más que el campo venga en `true`.
    - `GET /loans/overview` devuelve **las tres deudas** (ver abajo) y pide las
      obligaciones al MISMO `CashService` que usa Caja. Si las recalculara, el
      día que un filtro cambie las dos pantallas dirían cosas distintas sobre la
      misma deuda.
    - **Verificado contra un dump de producción el 2026-10-08**: migración
      aplicada, backfill corrido, y las 4 cifras de Caja, las 9 líneas del saldo,
      el saldo del préstamo y las 19 obligaciones **idénticas** antes y después.
      Lo único que cambia es que el acreedor se completa.
    - **CERRAR Y REABRIR (2026-10-10)** — `PATCH /loans/:id` con
      `closedAt: 'AAAA-MM-DD'` cierra y con `closedAt: null` reabre. Lo usa el
      botón "Cerrar"/"Reabrir" de la pantalla Deuda (`useUpdateLoan`, que estaba
      exportado y sin usar: un préstamo saldado **no se podía cerrar**).
      - ⚠️ **Con saldo pendiente NO se cierra: 409** (`exigirSaldado` en
        `loans.module.ts`, aplicada en `create` Y en `update` — un préstamo que
        nace cerrado con capital nace debiendo todo, y esa es la gemela).
        Se IMPIDE en vez de avisar porque `closedAt` significa literalmente
        "cuándo se terminó de pagar" (de él sale el estado PAGADO) y porque
        cerrar debiendo **borra la deuda de dos pantallas de dinero**: la cuota
        sale del nivel 2 del equilibrio (`monthlyLoanPayments` filtra por
        `!closedAt`) y el saldo sale del `lenderBalance` de Caja
        (`cash.service.ts` pide los préstamos con `closedAt: null`). El caso
        real —se lo perdonaron, se pagó por fuera— ya tiene un camino que no
        miente: registrar el pago que falta, o corregir el capital.
      - ⚠️ **Y había una TERCERA lectura que no se movía**: el
        `totals.prestamista` de `overview` suma TODOS los préstamos, cerrados
        incluidos. Con un cierre debiendo, Caja diría $0 y Deuda $750 sobre la
        misma plata. Con la guarda un préstamo cerrado tiene siempre saldo 0,
        así que las dos coinciden — **el bloqueo es lo que hace que las dos
        definiciones no se contradigan**, no un trámite.
      - **Reabrir siempre se puede, incluso debiendo**: cerrar no es borrar.
      - ⚠️ **Un préstamo saldado pero SIN cerrar sigue exigiendo su cuota** en
        el nivel 2 todos los meses: es exactamente para eso que hacía falta el
        botón. Medido: con $200 fijos al 40 % de margen, cerrar un préstamo de
        cuota $100 baja el nivel 2 de $750 a $500 — y con un solo préstamo el
        Dashboard **esconde** la línea (`oculto: cuota <= 0`). Regresión:
        `loans.service.spec.ts` (6 tests, con sus hermanos alcanzables) y, en
        el panel, `features/loans/equilibrio-al-cerrar.spec.ts` (5) +
        `pages/Loans.cerrar.spec.tsx` (5, el cableado del botón).
    - ⚠️ **El prestamista nació con el nombre EQUIVOCADO.** El backfill de Caja
      lo creó con `loan.name` ("Deuda impresora P2S") porque no tenía de dónde
      sacar el nombre real: eso es el concepto de la deuda, no quién prestó la
      plata. El acreedor real es **Señor Edwin**, y el dueño lo renombró en
      producción el 2026-10-09 desde Configuración → Caja → Contrapartes — sin
      tocar la base. Si alguna vez se monta otra organización, el prestamista
      va a nacer igual de mal: el backfill no puede adivinarlo.
  - **LOS PROVEEDORES EN LA PANTALLA DEUDA (2026-10-10)** — tercer bloque de
    `GET /loans/overview`, junto al del prestamista y el del propietario. Hasta
    acá "cuánto debe el negocio" estaba partido: las facturas de compra sin
    pagar vivían solo en Compras y **no aparecían en ningún total**.
    - ⚠️ **Desde la fase B (2026-11-10) este bloque es SOLO lo RECIBIDO y no
      pagado** (`deuda` de `invoiceTotals`), no el `saldo` de la factura. Lo
      pedido que todavía no llegó **no se debe**: va aparte como
      **`comprometido`** (`totals.comprometido`, con su propio conteo
      `facturasComprometidas`), y **no entra en `totals.total`**. Una factura
      parcialmente recibida cuenta en las dos cuentas. Con las tres facturas
      abiertas de producción, «A proveedores» pasó de $334 a $0 y
      «Comprometido» nació en $334.
    - **Nada nuevo se guarda ni se recalcula.** `LoansService` pide las facturas
      a la MISMA `PurchaseInvoicesService` que usa Compras (que ya les pega
      `invoiceTotals`) y las agrupa con `deudaPorProveedor()`
      (`purchase-invoices/deuda-por-proveedor.ts`, puro, 12 tests con números a
      mano). ⚠️ **Recalcular el saldo de una factura ahí sería una SEGUNDA
      definición** y el día que una de las dos cambie, Deuda y Compras dirían
      cosas distintas sobre la misma factura. Es la misma razón por la que las
      obligaciones salen de `CashService`.
    - ⚠️ **`overview` devuelve `totals` y el total es la SUMA de sus tres
      partes** (`prestamista` + `propietario` + `proveedores`). Lo suma el
      SERVIDOR y el panel solo lo dibuja —con los tres sumandos a la vista—: con
      dos caminos al mismo número, un total que no cuadra con los bloques que
      tiene debajo se lee como la verdad, porque nadie suma a ojo. El bloque del
      prestamista también usa `totals.prestamista` en vez de rehacer el
      `reduce`. Mutación: un total que se olvida un bloque tumba 4 tests.
    - ⚠️ **Las dos formas de que el número mienta, y son OPUESTAS.** Una factura
      **anulada** no se debe (se saltea por `voidedAt`); un abono **anulado** sí
      vuelve a deberse (lo resuelve `invoiceTotals`, no se reimplementa). Cada
      una con su test y su mutación: contar las anuladas tumba 4 tests, contar
      los abonos anulados como pagados tumba 2.
    - ⚠️ **Lo pagado DE MÁS no es deuda negativa y NO se compensa SOLO**: no
      resta del grupo de ese proveedor ni del de otro. Viaja aparte (`aFavor`,
      `facturasAFavor`) y la pantalla lo dice con esas palabras. Mutación:
      restarlo tumba 4 tests. ⚠️ **Desde el saldo a favor (shared 0.45.0) ese
      `aFavor` es lo DISPONIBLE** —`FacturaParaDeuda` recibe
      `aFavorDisponible`—, y la forma de usarlo es abonar una factura del mismo
      proveedor tomándola del saldo: ahí bajan los dos números juntos.
    - Una factura **sin proveedor anotado** se debe igual, en su propio grupo
      ("Sin proveedor anotado"). Esconderla por no tener nombre dejaría al
      bloque diciendo menos de lo que el negocio debe.
    - La **gestión** (abonar, recibir, anular) **no se duplica**: sigue en
      Compras. Deuda responde "cuánto" y lleva allá.
    - ⚠️ `LoansModule` importa `PurchaseInvoicesModule`, así que
      `LoansService` toma **tres** dependencias; los dos `new LoansService(...)`
      a mano de `common/multi-tenant.audit.spec.ts` llevan el tercer argumento.
    - Aislamiento: el test de que las facturas de otra organización no entran va
      **con su hermano alcanzable** (la misma factura SÍ se ve desde su
      organización); sin él pasaría igual con el bloque devolviendo vacío
      siempre. Tests: `loans.service.spec.ts` (24) y
      `deuda-por-proveedor.spec.ts` (12).
    - ✅ **Cerrado:** `useInvoiceMutation` de
      `calc3d-web/apps/web/src/features/purchases/api.ts` ya invalida
      `['loans']`, así que abonar una factura refresca el bloque de proveedores
      aunque Deuda esté abierta en otra pestaña. (La nota quedó marcada como
      pendiente de más; verificado el 2026-10-10.)
  - **Facturas de compra (2026-10-09, shared 0.32.0)** (`purchase-invoices/`):
    lo pedido, lo abonado y lo recibido, para **filamento e impresoras**.
    ⚠️ **LA REGLA: los abonos son la PLATA; la recepción es la MERCADERÍA.** Un
    `Expense` nacido de una factura lleva `purchaseInvoiceLineId` y queda
    **fuera de las líneas de dinero** de Caja: su plata ya se contó al abonar.
    Sin eso, abonar $50 y recibir esa compra de $50 bajaría el saldo $100 — la
    doble carga que descuadraba la hoja del Excel. Test con número clavado en
    `cash.spec.ts`; las tres mutaciones lo tumban.
    - El abono se reparte entre las LÍNEAS DEL SALDO **a prorrata de su
      factura**, mirando el tipo REAL de cada línea. Es una CONVENCIÓN, no un
      hecho: un abono no fue a una línea concreta. Se hace así para que
      "Filamento comprado" siga queriendo decir *todo el filamento que
      compraste*. Con facturas de una sola cosa es exacto.
      - ⚠️ **Hasta la fase B el reparto era BINARIO** (`filamentShare`:
        `if (l.printerId == null) deFilamento += monto`, o sea impresora o
        filamento) y una línea podía ser un insumo desde el 2026-10-20: **la
        placa de impresión de $40 de C-0001 se contaba como filamento**. Hoy
        `CashLedger.purchasePayments[].reparto` es un **mapa categoría →
        fracción** (`RepartoDeCompra`) que arma `repartoDeAbono` en
        `cash/helpers-de-caja.ts` mirando `materialId`, `printerId`,
        `componentId` y `nuevoTipo`.
      - ⚠️ **El respaldo de `categoriaDeLinea` es `filament`** (una línea con el
        dato incompleto): es el comportamiento histórico y deja el abono en una
        línea con sentido en vez de en «equipos». **Y NO es «la factura sin
        líneas»**: ese escenario no llega al respaldo — una factura sin líneas
        con un abono tiene `anticipo = pagado`, así que `repartoDeAbono`
        devuelve `{ supplierAdvances: 1 }` y la plata sale por «Anticipos a
        proveedores», que es lo correcto (pagaste y no llegó nada). El
        requisito de la tarea 4 pedía lo contrario y **estaba mal**; lo fija
        `cash.service.spec.ts`, «una factura SIN LÍNEAS con abono va a
        anticipos». Hoy **ningún llamador del repo produce el mapa vacío**: el
        respaldo del motor se queda porque acepta cualquier mapa, y está dicho
        en su comentario para que no parezca cubrir un caso que no existe.
      - ⚠️ **`categoriaDeLinea` es un `switch` EXHAUSTIVO con `never`.** Con un
        respaldo que se tragara los valores nuevos de `PurchaseLineNuevoTipo`,
        un tipo agregado mañana caería en silencio en filamento — la forma
        exacta del bug que esto cerró cuando entró `COMPONENT`. Un comentario
        que avisa no es una guarda: el día que Compras gane SERVICIO o
        REPUESTO/MANTENIMIENTO, **no compila** hasta que alguien decida su fila.
      - ⚠️ **«Insumos comprados por factura» se llama así a propósito**: la fila
        cuenta SOLO los insumos que entraron por una factura. Un insumo cargado
        como gasto DIRECTO cae en «Gastos generales», porque el motor clasifica
        los gastos por `isFilament`/`isInvestment` y nada más. Eso contradice el
        motivo de la convención («que *Filamento comprado* siga queriendo decir
        todo el filamento, venga de factura o de compra directa») y es **deuda
        conocida de la fase (c)**, no diseño: reclasificar movería plata entre
        dos filas y la tabla de aceptación del dueño no lo autoriza. Lo que se
        arregló fue el NOMBRE.
      - ⚠️ **`CashCategory` ganó `consumables` y `supplierAdvances`** (11
        líneas, no nueve). **`advertising` y `services` NO entraron**: se
        agregan en la fase (c), **junto con lo que las llene**. La regla es
        «un valor de enum sin productor no se agrega», y `services` se agregó y
        se sacó el mismo día justamente por ella: una línea de factura no puede
        ser un servicio todavía (el contrato pide una de
        `materialId`/`printerId`/`componentId`/`nombreNuevo` y `nuevoTipo` solo
        tiene MATERIAL, PRINTER y COMPONENT).
      - ⚠️ **Lo que lo decidió no fue la coherencia, fue un TEST**: el barrido
        de `cash.service.spec.ts` («el total de cada desplegable es igual a la
        línea de `summary()`, en todas») exige que **ninguna** categoría venga
        vacía, y es el guardián que existe para cazar justo una categoría que
        nada produce. Con `services` había que **eximirla a mano**, o sea
        dejarlo cubriendo todas menos la única que vino a buscar — peor que no
        tener la categoría. **No eximir una categoría de ese barrido**: si se
        pone rojo, es un hallazgo.
      - ⚠️ **«Anticipos a proveedores» es UNA fila, no un reparto por
        categoría.** Lo pagado y no recibido (`anticipo` de `invoiceTotals`) no
        es filamento ni insumo: es plata en manos del proveedor. Se reparte
        entre los abonos de SU factura a prorrata de lo pagado
        (`anticipo / pagado`) y **la atribución por categoría se conserva en el
        detalle del asiento** (`GET /cash/breakdown/supplierAdvances` dice de
        qué factura es). Con C-0001, «Filamento comprado» pasó de −$1.803,91 a
        −$1.663,91 y nació «Anticipos a proveedores» en −$140,00.
      - ⚠️ **La etiqueta dice «pagado POR ENCIMA de lo recibido», no «sin
        recibir»**, porque son TRES puertas y no una: la mercadería que no
        llegó, la factura recibida entera y **pagada de más** (ahí
        `anticipo ≡ aFavor` siempre, no en un caso raro) y la recibida a un
        precio real **menor** al pedido, que deja `valorRecibido < pagado` sin
        que falte nada. Hoy no existe ninguna de las dos últimas en producción,
        así que no mueve números. **No se agrega una categoría para el
        excedente**: sería un valor de enum sin productor, lo mismo por lo que
        murió `services`.
      - ⚠️ **La hoja Caja del Excel ya NO escribe sus filas a mano**: las
        recorre desde `CASH_SIGN` con un `Record<CashCategory, string>` de
        etiquetas, así que una categoría nueva **no compila** sin su texto. Con
        la lista a mano, una olvidada dejaba la hoja sumando menos de lo que
        dice su propio SALDO.
    - Total, pagado, saldo, recibido y estado **se DERIVAN** (`invoiceTotals`,
      `invoiceStatus` en shared). Lo único guardado es `voidedAt`.
    - **El estado son DOS ejes.** Pagada y sin recibir es lo normal al encargar.
    - ⚠️ **Una factura con mercadería recibida no se corrige ni se anula.** Esa
      recepción ya creó un gasto; rehacer las líneas lo dejaría apuntando a una
      borrada, el `ON DELETE SET NULL` lo volvería un gasto normal, y ese SÍ
      mueve la caja. Doble carga por la puerta de atrás.
    - Al recibir, el monto **no viaja en el body**: sale de cantidad × precio
      unitario. Si lo mandara el cliente, dos recepciones podrían sumar algo
      distinto del total sin que nadie se entere. Todo en UNA transacción: un
      gasto sin subir `received` dejaría la línea pidiendo lo que ya llegó.
    - El precio del rollo lo recalcula **`ExpensesService`**, inyectado: la
      misma regla que una compra directa. Recalcularlo aparte daría dos
      verdades el día que cambie.
    - ⚠️ **El gasto que nace de una factura NO se toca desde Gastos**
      (2026-10-10). `ExpensesService.update`/`remove` miran
      `purchaseInvoiceLineId` y, si lo tiene, cortan con un **400** que manda a
      Compras (`noSeTocaDesdeGastos`, antes de cualquier escritura: resolver el
      proveedor da de alta un contacto al vuelo). Sin eso, corregir o borrar ese
      gasto desde Gastos —o desde "corregir compra" de filamento, que usa los
      MISMOS endpoints— dejaba a la factura mintiendo: `received` contando
      mercadería sin gasto y el precio de cotización recalculado contra una
      compra que ya no existe. En el front lo delata `fromInvoice` en
      `FilamentPurchase` (shared 0.33.0) y el `purchaseInvoiceLineId` crudo que
      ya viaja en `GET /expenses`. Regresión: `expenses.service.spec.ts`
      (3 rechazos + 2 hermanos alcanzables) y `filament.service.spec.ts`.
      Esa guarda dejó un **callejón sin salida** que se abrió el mismo día con
      "deshacer una recepción" (ver abajo).
    - ⚠️ **DESHACER UNA RECEPCIÓN** (2026-10-10,
      `POST /purchase-invoices/:id/lines/:lineId/unreceive`, **sin cuerpo**).
      Es la **salida** del callejón: con el gasto de factura intocable desde
      Gastos, una línea ya recibida no se podía corregir por **ninguna** puerta
      y los cuatro mensajes se mandaban unos a otros en círculo (Gastos → Compras
      → anular → "corregilas desde Compras de filamento", que es justo la puerta
      que se había cerrado). Un mensaje que manda a una puerta cerrada es peor
      que no tener mensaje: los tres de este módulo + el de `noSeTocaDesdeGastos`
      se reescribieron para mandar acá.
      - Es el **inverso exacto de `receive()`**, no un borrado libre: cada
        recepción creó UN `Expense` con su cantidad, así que esto borra **ese**
        gasto (el último por `date` y, a igualdad, por `createdAt`) y baja
        `received` en **esa misma** cantidad, todo en UNA transacción. Después,
        fuera de ella, `recalcularPrecioDelRollo`: el precio tiene que volver al
        de la compra anterior, y para eso la borrada ya no puede existir.
      - ⚠️ **NO mueve la caja.** Ese gasto nunca movió plata (la plata son los
        abonos; nació marcado para eso), así que borrarlo tampoco puede moverla.
        Test con número **clavado** en `purchase-invoices.service.spec.ts`: el
        saldo mide **$25,00** antes y después, sobre el estado que dejó el
        servicio, más el **contrafáctico** (sin la marca daría $0) para que el
        25 no sea un número vacío.
      - ⚠️ **La ficha que nació al recibir NO se borra**: puede estar ya en una
        cotización o en un pedido. Y la línea **conserva** su enlace a esa ficha,
        así que volver a recibirla la reusa en vez de crear una duplicada.
      - ⚠️ **Sin gasto que borrar, 400: no se baja `received` a ciegas.** Y
        tampoco si el gasto dice más cantidad que lo recibido (dejaría `received`
        en negativo). Cada guarda tiene su mutación.
      - ⚠️ **Lo que la verificación por mutación destapó, y vale para cualquier
        guarda nueva de este módulo:** (1) un `rejects.toBeInstanceOf(
        BadRequestException)` pelado **no distingue qué guarda saltó** — quitar
        la de `received === 0` dejaba los 61 verdes porque el caso caía en la
        siguiente y daba 400 por otro motivo; hay que afirmar el **mensaje**.
        (2) El filtro por `organizationId` del `expense.findFirst` **no lo
        sostenía ningún test** (llegar con una línea ajena ya es imposible, pero
        sin test es código que alguien saca "porque es redundante"). (3) Mutar
        con `gasto?.` o `if (false)` **no compila** y Jest reporta "0 tests",
        que parece verde: la mutación tiene que compilar — tragarse el error con
        un `return this.get(...)` sí lo hace.
      - El mock de Prisma del spec **ordena** por el `orderBy` y **escribe**
        (`expense.delete` saca la fila del array): sin eso "la última recepción"
        se probaría leyendo la forma del `orderBy`, que es la propiedad
        equivocada. Y `purchaseInvoice.findFirst` pasó a filtrar por el `where`,
        como el resto de las tablas del mock.
      - Pantalla: `Purchases.tsx`, botón **"Deshacer recepción"** por línea con
        algo recibido, con confirmación que dice qué pasa **y qué no** (la plata
        no se mueve, la ficha se queda). `useUnreceiveLine` comparte
        `useInvoiceMutation` con `useReceiveLine`: invalida las mismas claves.
    - ⚠️ **QUE LA FACTURA REFLEJE LO QUE TE COBRARON** (2026-10-10, shared
      0.44.0, **sin migración**). Pediste 10 rollos a $7 y el proveedor te
      factura $7,50: **la línea guarda lo que PEDISTE y cada recepción lo que
      COSTÓ**. Hasta acá había que corregir la línea **antes** de recibir, y con
      algo ya recibido no se podía por ninguna puerta.
      - ⚠️ **Una recepción no tiene tabla propia: su registro ES el `Expense`**
        que ya nacía al recibir. Ahí viven su cantidad y su monto, o sea el
        precio real; lo que faltaba era mirarlos (el `include` de las líneas trae
        ahora sus `expenses`). Guardar el precio otra vez al lado sería una
        segunda verdad sobre la misma entrega, y el día que una de las dos cambie
        la factura y el gasto dirían cosas distintas de la misma compra. Por eso
        **no hubo migración**.
      - `PurchaseReceiveSchema` gana **`unitPrice` opcional** (≥ 0). Sin él se
        usa el de la línea: el caso normal es que llegue a lo pactado, y
        exigirlo obligaría a retipear el mismo número en cada recepción. **El
        MONTO sigue sin viajar**: sale de cantidad × precio.
      - ⚠️ **`?? ` y no `||`** al resolver el precio: **0 es un dato verdadero**
        (un rollo regalado) y con `||` se habría leído como "no informó nada".
      - `invoiceTotals` recibe por línea sus `recepciones` y el total pasa a ser
        `Σ(entregas: unidades × su precio) + pendientes × precio pedido`. ⚠️ **Lo
        que una recepción no cubre vale lo PEDIDO**, y eso incluye lo recibido
        **sin recepción registrada** (toda la base anterior): una factura vieja
        sigue dando el mismo número que daba ayer. Número clavado: 6 a $7,50 + 4
        pendientes a $7 = **73**, no 70 ni 75.
      - ⚠️ **`received` sigue siendo la ÚNICA definición de cuántos llegaron**;
        las recepciones solo ponen PRECIO, y el motor las recorta contra él. Sin
        ese recorte, el precio real se aplicaría a mercadería que la línea
        considera pendiente.
      - El precio por unidad de una entrega se deriva con **`purchaseCostPerRoll`**,
        la MISMA función que fija el precio de cotización del rollo: dividir a
        mano sería una segunda cuenta para la misma pregunta. Un gasto **sin
        cantidad** no dice a cuánto salió la unidad, así que sus unidades valen
        lo pedido en vez de valer 0 (que haría desaparecer plata del total).
      - **El precio de cotización sigue al REAL sin tocar nada**:
        `recalcularPrecioDelRollo` lee el MONTO de la última compra, así que
        informar $7,50 deja $7,50 y no los $7 del pedido. Regresión con número
        clavado en `expenses.service.spec.ts` (45 ÷ 6 = 7,50).
      - La **ficha que nace al recibir** (filamento o impresora) nace con el
        precio **informado**. Y la **línea NO se reescribe**: es el pedido, y lo
        que falta llegar se sigue valuando a ese precio.
      - ⚠️ **El precio real tampoco mueve la caja.** El gasto nace marcado con su
        línea, así que su plata ya se contó al abonar: que el monto cambie no
        puede mover el saldo. Número **clavado** en
        `purchase-invoices.service.spec.ts` ($30,00 antes y después de deshacer),
        con su contrafáctico (sin la marca, −$15, o sea los **45 reales** y no
        los 42 del pedido).
      - **Deshacer** sigue revirtiendo **la que corresponde**: con dos entregas a
        precios distintos borra la última (4 a $8) y el total vuelve de 77 a
        **73**, medido sobre el estado que dejó el servicio.
      - Las líneas viajan al panel con `recepciones` (id, fecha, cantidad,
        precio) para que **la pantalla pueda avisar**: un total que se mueve sin
        decir por qué miente de la peor manera, la que no se nota.
      - Regresión: `purchase-invoice.spec.ts` (shared, 15 con números a mano),
        `schemas/purchase-invoice.spec.ts` (6), `purchase-invoices.service.spec.ts`
        (18) y 1 en `expenses.service.spec.ts`. Las mutaciones y cuántos tumba
        cada una: ignorar el precio informado **5**, el total valuando al pedido
        **11 en shared + 4 en api**, no mandarle las recepciones al motor **4**,
        el precio de la entrega sin dividir **5**, lo recibido sin recepción
        valiendo 0 **3 + 2**, recortar contra lo pedido en vez de lo recibido
        **1**, la ficha nueva naciendo con el pedido **1**, el schema aceptando
        negativo **1**.
      - ⚠️ **El `orderBy` de ese `include` lleva un `as` a mano**: el `as const`
        de `incluir` volvería `readonly` al arreglo y Prisma pide uno mutable.
      - ⚠️ **Dos mocks de otros specs hubo que completarlos** (`loans.service.spec.ts`
        y el `create` de `purchase-invoice`): sus líneas no traían `expenses` y el
        `include` ahora las trae. Un mock que no modela lo que trae la consulta
        rompe en cuanto la consulta crece.
    - ⚠️ **"Algo que todavía no tenés" dice QUÉ es** (`nuevoTipo`
      `MATERIAL|PRINTER`, shared 0.34.0, migración
      `20261011120000_que_nace_al_recibir`, aditiva). Hasta acá la recepción
      creaba **siempre** una ficha de filamento: encargar una impresora nueva
      dejaba un rollo llamado "Impresora A2". Y una impresora nueva es, por
      definición, la que **no** está en el catálogo: era el caso normal, no el
      raro. En producción había 0 líneas con `nombreNuevo`, así que el bug no
      alcanzó a hacer daño.
      - El contrato son **DOS mitades**: el `refine` lo **exige** con
        `nombreNuevo` y lo **prohíbe** sin él. Con solo la primera, una línea
        del catálogo podría declarar un tipo que contradice a su ficha; con
        solo la segunda vuelve la ambigüedad. Las dos tienen su mutación.
      - ⚠️ **Repuntar la línea a la ficha recién creada no es cosmético**: el
        `Expense` decide `EQUIPMENT`/`CONSUMABLE` e `isInvestment` por
        `printerId`. Una impresora que naciera sin repuntar entraría como
        consumible y quedaría fuera de la reposición de equipos. Esa mutación
        tumba 2 tests.
      - Una impresora nace **solo con el precio de la compra**; horas de vida y
        consumo quedan en el default y se corrigen desde el catálogo. Los
        `rollGrams` de la recepción se ignoran (una impresora no tiene rollo).
      - `receive()` igual rechaza con **400** una línea con `nombreNuevo` y sin
        tipo (fila vieja o script): adivinar "filamento" ES el bug.
      - Regresión: `shared/schemas/purchase-invoice.spec.ts` (9) y
        `purchase-invoices.service.spec.ts` — cada test de recepción afirma
        sobre **las DOS tablas** (`Printer` creada **y** `Material` no), que es
        justo lo que faltaba para que el bug se viera.
    - ⚠️ **LO QUE NO LLEGÓ** (2026-10-10, shared 0.39.0) —
      `facturasAtrasadas(facturas, hoy)` en `shared/calc/purchase-invoice.ts`.
      `expectedAt` se guardaba desde el día uno y **nadie lo miraba**:
      encargabas algo para el martes, no llegaba, y la app no decía nada.
      Pantallas: Compras (la factura se destaca y dice hace cuánto) y el aviso
      del Dashboard.
      - ⚠️ **`hoy` ENTRA COMO PARÁMETRO** (`'AAAA-MM-DD'`, día LOCAL de quien
        mira; `todayKey()` en el panel) y no se lee adentro, como
        `cashChainCuts` y `campaignLifecycle`. Un test contra el reloj pasa hoy
        y falla solo algún martes.
      - ⚠️ **Lo recibido NO se recalcula**: sale de `invoiceTotals` +
        `invoiceStatus`, la única definición de "llegó todo". Una segunda
        cuenta diría algo distinto de la insignia de al lado.
      - Las **cuatro formas de que el aviso mienta**, cada una con su test Y
        SU HERMANO ALCANZABLE (sin el hermano, una función que devolviera
        siempre vacío pasaría los cuatro): anulada, ya recibida entera, sin
        `expectedAt` (no se prometió nada) y **esperada HOY** (el día no
        terminó; avisar a las 9 de algo que llega a las 5 enseña a ignorar el
        aviso). La comparación es **estricta**: `dia >= hoy` no cuenta.
      - ⚠️ **Lo que destapó la verificación por mutación, y vale para
        cualquier guarda nueva:** la de "ya llegó todo" era **código muerto**.
        Estaba escrita junto a `porRecibir <= 0`, que es verdadera en ese caso
        también, así que borrar el chequeo de `RECIBIDA` **no tumbaba un solo
        test** —la mutación obligatoria daba 0—. La segunda pasó a ser
        `pedido <= 0`, que es lo que de verdad quiere decir (una factura sin
        líneas no está "sin recibir": no tiene nada que recibir), y ahora las
        dos hacen falta. Una guarda muerta de las que deciden si un aviso
        miente es peor que no tenerla: parece que la regla está puesta.
      - Las 7 mutaciones tumban 1 test cada una, salvo mover el `>=` a `>`
        (3). Tests: `purchase-invoice.spec.ts` (12 nuevos) y
        `stock.spec.ts` (`daysBetween`, 4).
      - **`daysBetween(desde, hasta)`** se suma a las conversiones de fecha de
        `stock.ts`: en **UTC** y **lanzando** con un día que no existe. Restar
        dos `new Date()` locales cruza mal el borde del día al oeste de UTC.
      - **No hay endpoint nuevo**: el panel ya recibe las facturas con sus
        líneas en `GET /purchase-invoices`.
    - ⚠️ **SALDO A FAVOR CON EL PROVEEDOR** (2026-10-10, shared 0.45.0,
      migración `20261012100000_saldo_a_favor_del_proveedor`, **aditiva**).
      Pagaste $100 de una factura de $85: esos $15 **no son un costo de esa
      compra**, son plata tuya que el proveedor te debe. Hasta acá la app los
      mostraba (`aFavor`) y **no se podían usar**.
      - **Cómo se usa:** un abono puede marcarse como **tomado del saldo a
        favor**, diciendo **de qué factura** sale
        (`PurchaseInvoicePayment.tomadoDeFacturaId`, el único dato nuevo). En la
        factura de destino cuenta como `pagado` normal —el proveedor lo
        reconoce— así que su saldo baja.
      - ⚠️ **UN ABONO TOMADO DEL SALDO NO MUEVE LA CAJA.** Esa plata ya salió el
        día que se pagó de más; contarla otra vez es la misma doble carga que el
        gasto nacido de una factura, por la otra puerta. El motor lo saltea por
        la marca **`fromCredit`** de `purchasePayments` (`calc/cash.ts`), y
        `cash.service.ts` la traduce desde `tomadoDeFacturaId`. **Sale ANTES del
        prorrateo**: no deja ni un asiento en el desglose, porque no es un
        movimiento partido en dos, es ninguno. Tampoco emite el aporte de la
        contraparte: si "lo puso" una persona, no puso nada, y el doble asiento
        gasto+aporte dejaría al negocio debiéndole plata que nunca salió de su
        bolsillo. Número **clavado** en `cash/cash.service.spec.ts`: **$75,00**
        con la marca, con su contrafáctico **$60,00** sin ella (175 cobrados −
        100 abonados, y los 15 del saldo que no vuelven a salir).
      - ⚠️ **EL SALDO SE DERIVA: Σ pagado de más − Σ aplicado.** Nada guardado
        que pueda contradecir a sus partes — la regla central del dominio, la
        misma del saldo de un préstamo, del saldo de un pedido y de la deuda con
        una contraparte. Y cada mitad vive en **UN** solo lugar:
        - "aplicado" → **`creditoTomadoPorFactura`** (`calc/supplier-credit.ts`),
          que agrupa los abonos por su factura de origen.
        - "disponible" → **`invoiceTotals(lines, payments, creditoTomado = 0)`**,
          que ya era la única definición de "pagado de más" y ahora devuelve
          además **`aFavorDisponible`** (`aFavor − aplicado`, nunca negativo).
          El default 0 deja a toda factura vieja dando el mismo número que daba
          ayer.
        - `saldoAFavorPorProveedor` **SUMA** lo que esa función devolvió; no lo
          recalcula. Con dos cuentas para el mismo número, el día que una cambie
          la pantalla del proveedor y la de la factura dirían distinto.
      - ⚠️ **`aFavor` y `aFavorDisponible` son dos cosas y las dos hacen falta.**
        `aFavor` es un HECHO del pasado (pagaste $15 de más) y no se mueve
        nunca; el otro es lo que queda. Mostrar solo el primero diría que el
        proveedor te debe plata que ya te devolvió en mercadería; solo el
        segundo borraría del historial que el sobrepago existió.
      - **Las guardas, en `evaluarUsoDeSaldo`** (puro, devuelve el motivo y **no
        lanza**; el mensaje lo escribe `validarSaldoAFavor` en el servicio,
        porque necesita la plata formateada y tiene que decir qué hacer):
        `SIN_SALDO` (no más de lo que hay; el límite es **inclusivo**),
        `OTRO_PROVEEDOR`, `SIN_PROVEEDOR`, `ORIGEN_ANULADO`, `MISMA_FACTURA` y
        `ORIGEN_DESCONOCIDO` (→ **404**).
      - ⚠️ **"Sin proveedor anotado" NO es un proveedor.** En Deuda es un grupo
        legítimo —la plata se debe igual—, pero acá juntar dos facturas sin
        nombre dejaría pagarle a uno con lo que te debe otro. Para usar ese
        saldo hay que anotar primero de quién es.
      - ⚠️ **La pertenencia se cierra por CONSTRUCCIÓN**: la lista que recibe el
        motor es `list(organizationId)`, y ser miembro de ella ES la
        autorización. Consultar la factura de origen por id contra la base
        reabriría el IDOR (ese camino no sabe de qué negocio es ni de qué
        proveedor) — el mismo cierre que `applyPayment` con su obligación
        destino. El test de aislamiento va **con su hermano alcanzable**.
      - ⚠️ **Un abono tomado del saldo no lleva contraparte ni cuenta**: el
        `refine` de `PurchaseInvoicePaymentSchema` las **prohíbe** con
        `tomadoDeFacturaId`. Con contraparte, Caja lo contaría como aporte; con
        cuenta, diría que salió de un banco del que no salió nada.
      - **Devolver el saldo tiene DOS puertas y las dos cuentan**: anular el
        abono, y anular la **factura de destino** (sus abonos dejan de contar en
        Caja y en Deuda, así que ese saldo no se gastó). La segunda es el filtro
        `invoice: { voidedAt: null }` del `where`; la primera la decide el motor.
        ⚠️ **Lo anulado NO se filtra en el `where`**: viaja con su `voidedAt` y
        lo resuelve `creditoTomadoPorFactura`, igual que `invoiceTotals` con
        `pagado`. Filtrándolo en los dos lados la guarda del motor quedaba **sin
        efecto** —la verificación por mutación lo destapó: borrarla no tumbaba un
        solo test— y eso es peor que no tenerla, porque parece puesta.
      - **Deuda sigue cuadrando**: `FacturaParaDeuda` ya no recibe `aFavor` sino
        **`aFavorDisponible`** (la interfaz declara solo lo que la función lee,
        para que nadie piense que mira el hecho). El bloque de proveedores
        responde "¿cuánto te debe?", que es con lo que el dueño decide si
        reclamar. Los dos números se mueven **juntos**: usar $6 baja la deuda de
        la otra factura a 34 y el saldo a favor a 9, y `totals.total` sigue
        siendo la suma de los tres bloques (test en `loans.service.spec.ts`).
        El **punto de equilibrio no cambia**: sale del mismo `totals.comprometido`
        y su test lo sigue fijando.
      - **No hay endpoint nuevo**: `GET /purchase-invoices` ya trae cada factura
        con su `aFavorDisponible`, y el rollup por proveedor lo hace el panel con
        la MISMA función pura (`saldoAFavorPorProveedor`). Una consulta aparte
        sería una segunda cuenta para el mismo número.
      - `ON DELETE RESTRICT` en `tomadoDeFacturaId`: borrar la factura que
        financió un abono dejaría ese abono sin respaldo y el saldo saldría de la
        nada.
      - Regresión: `calc/supplier-credit.spec.ts` (shared, 23 con números a
        mano), `calc/cash.spec.ts` (5), `schemas/purchase-invoice.spec.ts` (6),
        `purchase-invoices.service.spec.ts` (19), `cash.service.spec.ts` (3),
        `deuda-por-proveedor.spec.ts` (3) y `loans.service.spec.ts` (3). Las
        mutaciones y cuántos tumba cada una: que el abono del saldo SÍ mueva la
        caja **3 shared + 1 api**; aplicar más saldo del que hay **2 + 2**;
        aplicar saldo de otro proveedor **1 + 1**; contar el abono anulado
        **1 + 1**; no filtrar la factura de destino anulada **1 api**; el
        `creditosTomados` sin `organizationId` **2 api**; `invoiceTotals`
        ignorando lo aplicado **3 + 4**; el schema aceptando contraparte con el
        saldo **2 shared**; ignorar `SIN_PROVEEDOR` **1 + 1**; ignorar
        `ORIGEN_ANULADO` **2 + 1**; ignorar `MISMA_FACTURA` **1 + 1**; Deuda
        mostrando 0 a favor **8 api**.
    - ⚠️ **EL ABONO CONGELA SU MONEDA, SU TASA Y SU CUENTA** (2026-11-12, fase
      B tarea 5, shared 0.75.0, migración
      `20261112100000_moneda_y_tasa_del_abono`, **aditiva**). Antes el abono
      guardaba monto, fecha, quién y de qué cuenta, pero no **en qué moneda se
      pagó ni a qué tasa**.
      - **Las columnas llevan los nombres de `Payment`** (`rate`, `currencyCode`,
        `currencyLabel`, `amountForeign`), no `currency`/`amountOriginal`: la
        tabla hermana de los abonos de pedido ya congela exactamente lo mismo, y
        dos nombres para un hecho es la forma de que se desalineen. `amountForeign`
        **no es redundante con `amount × rate`**: el USD se recorta a 4 decimales
        y reconstruir los Bs devuelve 1.899,9999 donde se pagaron 1.900. Todo
        nullable: `null` = USD o anterior a esto, sin backfill (inventarle una
        tasa sería mentir). `refundable` lleva `default true`.
      - ⚠️ **Va `currencyLabel`**: la identidad de una tasa es su label, no su
        moneda (BCV y Binance coexisten). Sin él quedaría congelado un número que
        no se puede atribuir.
      - ⚠️ **LA TASA LA RESUELVE EL SERVIDOR POR LABEL y el USD también**. El
        cuerpo trae `{currencyLabel, amountForeign}`; la tasa **no viaja** (el
        schema la descarta) y el `amount` que llegue con el par foráneo se
        **DESCARTA**. `ExchangeRate` es un **historial**: la vigente es la fila
        más nueva de ese label, de ESTA organización. Una vez guardada, **no se
        recalcula nunca al leer**. Label sin tasa → 400 que manda a Configuración
        → Moneda.
      - ⚠️ **Un abono que convierte a $0 se RECHAZA** (400), en los DOS
        caminos (factura y pedido): `toMoney` redondea a 4 decimales y Bs 0,001 a
        tasa 250 daba 0, saltándose el `positive()` del abono en USD. La regla
        vive en **`usdDesdeMoneda`** (shared 0.76.0), que lanza
        `AbonoRedondeaACeroError` (con monto y tasa) y cada servicio lo traduce
        con `instanceof` a 400 con su redacción. Con la guarda copiada en cada
        servicio, un tercer llamador sin ella reabriría el agujero. Uno que
        escape sin traducir sale como 500.
      - ⚠️ **`tomadoDeFacturaId` PROHÍBE el par foráneo**: el saldo a favor es
        un saldo derivado en USD, no hubo pago en otra moneda que congelar.
      - ⚠️ **`refundable` solo se guarda como `false` con contraparte y sin
        saldo a favor**; en cualquier otro caso queda `true`. Lo consume la
        tarea 7; cerrarlo en el origen evita que herede un `false` huérfano.
      - `amount` es opcional en el tipo del DTO (en otra moneda no viaja); lo
        que impide que llegue `undefined` a Prisma es el `superRefine`, fijado
        contra el pipe real en `purchase-invoices/abono.audit.spec.ts`.
      - El modal Abonar ya manda `accountId` (el servidor ya lo validaba por
        organización; faltaba el test, que ahora existe).
      - ⚠️ **Deuda conocida: un abono en Bs hecho por API todavía no se dibuja
        como Bs en el panel.** El tipo `InvoicePayment` lo lleva; ninguna
        pantalla lo muestra ni hay formulario para pagar en otra moneda.
    - Plan: `docs/superpowers/plans/2026-10-09-facturas-de-compra.md` y
      `docs/superpowers/plans/2026-10-10-fases-4-y-5.md` (tarea 2).
  - **Reporte en Excel (2026-09-07)** (`reports/reports.module.ts`,
    `GET /reports/excel.xlsx`, dep **`exceljs`**): el libro completo del negocio
    con 12 hojas (Resumen, Ventas, Encargos, Gastos, Inventario, Stock mensual,
    Clientes, Publicidad, Deuda, Caja, Metas, Producción). Desde 2026-09-26
    Gastos y Deuda llevan "Pagado por" y la hoja Caja reusa `CashService`. **Decisión del dueño: el
    Excel deja de ser un lugar donde cargar datos y pasa a ser una SALIDA de la
    app**, así que no hay dos sistemas que puedan discrepar.
    ⚠️ Las hojas se arman **reusando los servicios de cada pantalla**
    (`FilamentService`, `GoalsService`, `LoansService`, `PrintersService`), NO
    repitiendo las consultas: si el reporte hiciera sus propias cuentas,
    terminaría diciendo algo distinto de lo que muestra la app, que es
    exactamente el problema que esto resuelve. Los montos se escriben
    redondeados al centavo (el formato de celda los mostraría bien igual, pero
    el ruido de coma flotante se arrastra al operar sobre ellos en Excel) y los
    totales van como fórmula `SUM()`, no como número muerto.
  - **Medición de la producción (2026-09-07)** — dos datos que se cargan en dos
    lugares distintos, y la distinción es del dueño:
    - **HORAS: lectura mensual del contador** (`PrinterReading`, único por
      impresora+mes, migración `lectura_mensual_de_horas`). `hours` es
      ACUMULADO —lo que marca la máquina—, y las horas del mes se derivan
      restando la lectura anterior (`hoursThisMonth`). ⚠️ **NO se suman las
      horas de los pedidos**: también se imprime fuera del negocio (pruebas,
      calibraciones, regalos, tandas falladas) y eso gasta vida útil igual.
      `Order.machineHours` existió unas horas y se eliminó por esto.
      `GET/PUT /printers/readings?month=AAAA-MM`.
    - **FALLOS: `Order.reprints`** (+ `printerId` para atribuirlos), que es lo
      único que tiene sentido por pedido: una tasa de fallos se mide contra
      piezas entregadas.
    `GET /printers/usage` junta las dos con `shared/calc/production.ts`
    (`lifeUsed`/`failureRate`/`productionStats`/`maintenanceBalance`/
    `latestReading`/`hoursThisMonth`).
    ⚠️ **Un trabajo sin medir NO es un trabajo perfecto**: los pedidos con
    `reprints` en null quedan FUERA del cálculo en vez de contar como cero
    fallos, y la respuesta expone `measuredJobs`/`unmeasuredJobs` para que la UI
    diga el tamaño de la muestra. `failureRate` es reimpresas ÷ piezas
    ENTREGADAS, para que sea comparable con `waste.pct` del motor (que es un
    recargo sobre lo que sí se entrega). Tests: `production.spec.ts`.
    - **El RECORDATORIO de la lectura (2026-10-10, shared 0.48.0)** —
      `lecturaDeHorasPendiente(maquinas, hoy)` en `production.ts`: avisa cuando
      hace mucho que no se lee ningún contador. Lo consume el Dashboard sobre el
      `printers[].lastReading` que ya devuelve `GET /printers/usage` (sin
      endpoint nuevo).
      - **Había DOS lecturas desde que existe la pantalla, y las dos del mismo
        mes** (2026-09, una por máquina, cargadas el 26/09): un solo acto de
        lectura. Decisión del dueño: no era una pantalla de más, era una
        pantalla sin aviso — va el recordatorio y la pantalla se queda.
      - ⚠️ **El umbral es `DIAS_SIN_LECTURA = 35`, una constante con su razón
        escrita y no un número suelto en un `if`**: la lectura es MENSUAL y se
        anota al cierre, así que durante TODO el mes siguiente la próxima
        todavía está a tiempo (31 días como máximo), y se le suman 4 de gracia
        porque los números del mes a veces se cierran en los primeros días del
        siguiente (el conteo de septiembre se cerró el 1/10). Cualquier umbral
        de 31 o menos avisaría sin que nada esté atrasado.
      - ⚠️ **Sin NINGUNA lectura devuelve `{ultimoMes: null, dias: null}`**, no
        un número: el aviso no puede decir "pasaron N días desde la última"
        cuando no hubo una última. Sin impresoras, `null`.
      - ⚠️ Los días se cuentan desde `monthCloseDay` del mes leído (no desde su
        día 1, que sumaría un mes) y `hoy` entra como PARÁMETRO. Los meses se
        validan antes de compararlos: `latestReading` compara TEXTO y un
        `'2026-13'` ganaría sin avisar. Tests: `lectura-pendiente.spec.ts` (11).
  - **Reposición de equipos (2026-09-07)** — `GET /printers/recovery` (⚠️ ruta
    literal declarada ANTES de `:id`) con `equipmentRecovery` de
    `shared/calc/equipment.ts`: reparte la ganancia acumulada entre las
    impresoras en **cascada por orden de compra** (la primera se cubre entera
    antes de tocar la segunda; ordena por la fecha del gasto de inversión, no
    por el alta de la ficha). **Ganancia acumulada = ingresos − gastos
    operativos**, sin la inversión en equipos (sería restar dos veces lo que se
    repone) ni los pagos del préstamo. Es **acumulado de toda la historia** y
    por eso se calcula en el servidor: la tarjeta vieja del Dashboard usaba el
    filtro de fechas y el mismo negocio se veía distinto según el rango.
    `freeCapital` **no se recorta en cero**: si la ganancia es negativa, ese
    número en rojo es el dato importante. Tests: `equipment.spec.ts`.
  - **Metas mensuales (2026-09-07)** (`goals/goals.module.ts`): modelo `Goal`
    (mes UTC único por org, metas de ventas/encargos/clientes nuevos). **Solo se
    guarda la meta**; lo cumplido se DERIVA, y las definiciones importan porque
    tienen que significar lo mismo que en el Excel:
    - **ventas** = `Sale` del mes + pedidos entregados en el mes (la misma
      cuenta que el Dashboard llama ingresos).
    - **encargos** = cantidad de pedidos del mes.
    - **clientes nuevos** = los de PRIMERA compra en el mes; no alcanza con
      contar clientes con actividad (un recurrente no vuelve a ser nuevo).
    Helpers puros en `shared/calc/goal.ts`; `goalProgress` **no se recorta**
    arriba de 1 (a diferencia de `breakEvenProgress`): pasarse de la meta es
    información. Import: `prisma/import-metas.mjs`, que **verifica la
    derivación** contra las columnas reales de la hoja y no escribe si difieren.
  - **Sugerir metas (2026-10-07, shared 0.25.0)** — `GET /goals/suggestion`:
    - ⚠️ **Es de SOLO LECTURA.** Rellena el formulario y no escribe nada; hay un
      test que recorre el mock exigiendo que en ese camino no exista ni un
      método de escritura.
    - `realesPorMes(org, desde, hasta)` calcula lo real **sin depender de que
      exista la meta**. Antes el rango salía de los meses que ya la tenían y con
      cero metas devolvía vacío. Marca además, **por métrica**, si el mes tenía
      con qué contar: un mes **sin actividad** entra como 0 y uno **sin datos**
      no entra. Acá los encargos arrancan en septiembre y las ventas en febrero,
      así que agosto no tiene 0 encargos — no tiene encargos.
    - ⚠️ **La base son los 3 últimos meses completos que existen HOY**, no los 3
      anteriores al mes elegido: el dueño carga con meses de anticipación y los
      previos a enero no terminaron. La respuesta dice **qué** meses usó y la
      pantalla los nombra.
    - **"Completo" se decide en hora de Venezuela** (`businessDateKey`). Hay
      test de borde: a las 02:00 UTC del 1/10 en Caracas son las 22:00 del 30/09.
    - ⚠️ **La fórmula es mediana → recorte → ponderada 3/2/1, y el recorte NO se
      aplica a una tendencia.** Una ponderada sola no reduce un mes excepcional
      —lo amplifica si es el más reciente— pero recortar una serie que viene
      creciendo sugiere **por debajo del último mes**: medido contra los datos
      reales (0, 1 y 14 clientes nuevos) proponía **1**. Un mes excepcional se
      reconoce porque **rompe** la serie, no porque sea el más alto.
    - Una métrica sin datos devuelve `null` **con motivo**, nunca 0: un 0 sería
      una recomendación.
    - `seasonalCheck` tiene **tres** estados. `SIN_HISTORIA` es "no se pudo
      medir", no "no hay riesgo": el primer mes medible es febrero 2027.
    - ⚠️ **`GET /goals/actuals` va aparte de `GET /goals?month=`** a propósito:
      esa devuelve `null` sin meta y **el Dashboard cuenta con eso** para no
      dibujar su tarjeta. Cambiarla haría aparecer una tarjeta de metas en cero.
    - **`Goal` NO lleva `source`.** El dueño decidió que sus 5 metas quedan como
      manuales (las transcribió él), así que ninguna estaría nunca en
      `EXCEL_IMPORT`: la columna tendría un solo valor posible y el badge no se
      dibujaría nunca.
  - **Punto de equilibrio en TRES niveles (2026-09-07)** —
    `breakEvenLevels()` en `shared/calc/breakeven.ts`: no perder / además la
    cuota / además la reserva. `Settings.equipmentReserve` guarda la reserva;
    **la cuota NO se guarda**, se deriva de los préstamos abiertos. El "costo
    variable" de la hoja y el `breakEvenMarginPct` de la app son el mismo dato
    al revés (0,25 ⇄ 0,75). Tests: `breakeven-levels.spec.ts`, `loan.spec.ts`.
    - ⚠️ **Lo COMPROMETIDO en facturas de compra NO entra en el equilibrio**
      (2026-10-10, shared 0.40.0). Una factura se paga **una vez**: sumarla a
      los costos fijos haría saltar el número mes a mes —arriba el mes de una
      compra grande, abajo el siguiente— y lo volvería inútil justo para lo que
      sirve, que es decidir precios. Los fijos son lo que se repite TODOS los
      meses; un compromiso puntual no es uno de ellos. Va **al lado** del
      número, con `equilibrioYCompromiso()` (`shared/calc/breakeven.ts`), que
      devuelve los niveles **calculados sin el compromiso** más el monto, la
      cantidad de facturas y un `mostrar`. El monto es `totals.comprometido` (desde la fase B; ya NO `totals.proveedores`, que es solo lo recibido y no pagado) de
      `GET /loans/overview` —la cuarta forma de contar lo mismo no existe— y lo
      pagado **de más** no se resta (no compensa; decisión de la Tarea 3).
      Regresión: `breakeven-compromiso.spec.ts` (el equilibrio con y sin
      facturas da **el mismo** objeto; mutación obligatoria = sumar `monto` a
      `fixedMonthly`, tumba 2 tests).
  - **Costos fijos + punto de equilibrio (Fase 2B)** — `Settings.fixedCosts`
    (JSON `[{concept, monthlyAmount}]`) y `Settings.breakEvenMarginPct` (fracción,
    default 0.4). NO entran en el precio por pieza. Helpers puros en
    `shared/calc/breakeven.ts` (`fixedCostsTotal`, `breakEvenRevenue` = fijos÷margen,
    `breakEvenProgress`).
  - ~~**Presupuestos / cotizaciones (Quotes)**~~ — **ELIMINADO el 2026-09-07**.
    Cotizar es el **primer estado de un pedido** (`QUOTED`), no una entidad
    aparte: ya tiene cliente, líneas, moneda y documento, y si el cliente acepta
    ese mismo registro sigue adelante. Se fueron el modelo, el módulo, las
    pantallas, `/sales/from-quote`, `Sale.quoteId` y `StoreProduct.quoteId`.
    ⚠️ **La GANANCIA por campaña quedó sin fuente**: el presupuesto era lo único
    que ataba una venta a su costo. El ROI se apaga y la campaña se juzga por
    ROAS. Spec: `docs/superpowers/specs/2026-09-07-catalogo-unico-design.md`.
  - **Cuenta del dueño** (`users/`): solo `GET /users/me` y `PATCH /users/me` (editar
    el propio perfil: nombre, correo, contraseña). **No hay gestión de equipo** ni
    invitaciones (se quitó al pasar a app de un solo dueño; el módulo `organizations/`
    se eliminó).
  - **Control de filamento (Fase 7)** (`filament/`): los dos controles que el dueño
    llevaba en su Excel. **Compras** = los `Expense` con `materialId`, con costo por
    rollo y por gramo DERIVADOS (`GET /filament/purchases`); el costo por gramo usa
    el `rollGrams` REAL, no el ÷1000 fijo de la hoja. **Conteo físico mensual** =
    tabla `StockCount` (una fila por material y mes; `sealed`/`inUse`/`running`, el
    total se DERIVA con `stockTotal`) — `GET /filament/stock?month=AAAA-MM` y
    `GET /filament/summary`. Se escribe SOLO cerrando el mes (ver "Cierre
    mensual"). El conteo es **manual a propósito**: no se descuenta lo
    que consumen los presupuestos porque no todo lo cotizado se imprime ni todo lo
    impreso sale bien. `Material.status` (ACTIVE/DISCONTINUED) saca a los colores
    descontinuados de la lista de reposición. El **consumo del mes** cuenta los
    rollos comprados (`anterior + comprados − actual`): la hoja solo resta los dos
    totales y por eso da negativo en un mes con compras. Si alguno de los dos
    meses no está CERRADO devuelve `null`, no un número inventado. Helpers puros en
    `shared/calc/stock.ts`. Spec:
    `docs/superpowers/specs/2026-09-07-control-de-filamento-design.md`.
  - **Analítica de filamento (2026-09-07, shared 0.7.3)**: `groupPurchases` en
    `shared/calc/filament-analytics.ts` agrupa las compras por **marca, tipo o
    color** (rollos, invertido, nº de compras y participación), ordenando por
    ROLLOS —la pregunta es "¿qué compro más?", y un rollo caro no se usa más—.
    Lo que no tiene el campo cargado cae en `UNSPECIFIED` ("Sin especificar"),
    que es un grupo real: hay 9 rollos así. **No hay endpoint nuevo**: la
    pantalla agrega sobre las mismas compras de `GET /filament/purchases`, que
    ahora devuelve `brand`/`type`/`color`. Dos fuentes para el mismo total
    terminan discrepando, y en un resumen no se nota. Tests:
    `filament-analytics.spec.ts`.
  - **EL PIE DEL KPI DE GASTOS: el mismo hecho, SUMADO (2026-10-11, shared
    0.50.0)** — `GET /expenses` devuelve también `invoice` (el mismo objeto que
    `GET /filament/purchases`, con `saldo`, `total` y `lineas`), y el Dashboard
    arma el pie con **`repartoDePagadores` + `textoDeReparto`**, en
    `shared/calc/pagador.ts` — el MISMO módulo que escribe la línea de cada
    compra. Dos lugares calculando "cuánto de esto pagó la caja" es el bug que
    produjo todo esto.
    - **Por qué.** El dueño leyó «GASTOS $202.00» y se creyó $202 más pobre de
      caja. Soltó $142: $50 los puso él y $10 no estaban pagados.
    - ⚠️ **`facturaDeLaCompra` vive en `common/factura-de-la-compra.ts`**
      porque la leen DOS servicios (`FilamentService` y `ExpensesService`).
    - ⚠️ **El prorrateo es una CONVENCIÓN declarada**, como `filamentShare` en
      `cash.ts`: a cada gasto nacido de una factura se le imputa
      `su monto × (saldo ÷ total de la factura)`. Un abono de $60 contra una
      factura de cuatro líneas no "fue" a una línea concreta. Con facturas de
      una sola cosa —lo normal acá— el reparto es exacto.
    - ⚠️ **`caja` es el RESIDUO** (`total − deBolsillo − sinPagar`), no una
      cuarta suma: parado al lado del KPI, un desglose que no cierra destruye
      la confianza en los dos números. Medido en la base real: $2.558,15 =
      $1.817,32 + $740,83.
    - ⚠️ **No hace falta agrupar por factura, y el intento de hacerlo era
      CÓDIGO MUERTO**: `Σ monto × (saldo ÷ total)` da lo mismo agrupado que
      suelto. Se escribió con un `Map` por id y la verificación por mutación lo
      destapó —desarmarlo no tumbaba un solo test—. Lo que sí hay que no hacer
      es sumar `invoice.saldo` fila por fila (daría $160 de una factura de
      $100): eso lo fija un test.
    - Tests: 20 nuevos en `pagador.spec.ts` (con el barrido de 7 escenarios que
      exige que las partes sumen el total) + 4 en `expenses.service.spec.ts`.
  - **AVISOS DE ENCARGOS (2026-10-12, shared 0.52.0)** — `shared/calc/encargos.ts`,
    función pura `avisosDeEncargos(encargos, hoy)` con cuatro listas:
    **vencidos** (la fecha pasó y sigue abierto), **sinCobrar** (entregado con
    saldo), **proximos** (se entregan dentro de `DIAS_ENTREGA_PROXIMA`) y
    **cotizacionesFrias** (`QUOTED` hace más de `DIAS_COTIZACION_FRIA`). **No
    hay endpoint nuevo**: el Dashboard agrega sobre `GET /orders`, que ya
    devuelve `status`, `deliveryDate` y el `balance` derivado.
    - ⚠️ **Los dos umbrales salen de los datos, no del gusto de nadie.**
      `DIAS_ENTREGA_PROXIMA = 3` sale de medir el plazo real entre cargar y
      entregar: **4-5 días** en los únicos tres encargos cargados al tomarlos
      (el resto da NEGATIVO porque son la migración del Excel, cargados
      después de entregar — por eso la mediana no sirve). Avisar a 7 sería
      avisar el día que se toma el encargo. `DIAS_COTIZACION_FRIA = 14`
      **no tiene datos detrás y está dicho en el código**: nunca hubo un
      `QUOTED` en producción, así que está anclado a 3× el plazo medido y se
      revisa cuando haya cotizaciones de verdad.
    - ⚠️ **Un encargo avisa UNA sola vez.** Una cotización vieja que además se
      pasó de fecha es las dos cosas; gana lo más urgente (vencida). Contarla
      dos veces infla el renglón y manda al dueño a la misma fila por dos
      caminos. Lo fija un test, y sacar ese `continue` tumba 2.
    - ⚠️ **El saldo llega derivado** (`orderBalance` vía el backend): no se
      recalcula ni acá ni en el panel.
    - ⚠️ Una fecha imposible (`2026-02-30`) **se ignora en vez de romper**:
      `daysBetween` lanza, y un aviso no puede tumbar el Dashboard.
    - ⚠️ **Cero casos reales**: 24 encargos, 23 entregados y cobrados. Los
      tests son la única evidencia. 21 en `encargos.spec.ts`, y las 7
      mutaciones probadas tumban entre 1 y 2 cada una.
  - **DE DÓNDE SALIÓ LA PLATA DE LOS ABONOS (2026-10-11, shared 0.51.0)** —
    hasta la 0.50.0, **todo lo abonado a una factura se contaba como "de la
    caja"**. El diálogo de Abonar deja elegir otra cosa desde que existe, así
    que bastaba un abono de bolsillo para que el pie del KPI dijera que esa
    plata la había puesto el negocio. No es un número que se vea mal: es un
    número que **miente sin avisar**.
    - `FilamentPurchaseInvoice` lleva ahora `abonado: { total, bolsillo,
      saldoAFavor, prestamista }` y `bolsillos: string[]`, y `FilamentPurchase`
      lleva `counterpartyKind`. La clasificación vive en `origenDelAbono`
      (`common/factura-de-la-compra.ts`); el reparto y los textos, en
      `shared/calc/pagador.ts`.
    - ⚠️ **LA PRECEDENCIA NO SE ELIGE AHÍ: es la de `cashEntries`**
      (`shared/calc/cash.ts`). Primero `fromCredit`, después el prestamista,
      después la contraparte. Un abono tomado del saldo a favor que ADEMÁS
      tenga contraparte es **saldo a favor**: esa plata ya había salido y quien
      figure como pagador no puso nada esta vez. Invertirla hace que Caja y el
      Dashboard cuenten el mismo abono de dos maneras, y no se nota hasta que
      la diferencia es grande. Lo fija un test con ese nombre.
    - ⚠️ **El prestamista NO es bolsillo**, ni en un abono ni en un gasto
      directo: su deuda ya vive en el saldo del préstamo y sumarla como aporte
      la contaría dos veces. Mismo criterio que `generaObligacion`.
    - ⚠️ **El denominador del prorrateo es `abonado.total`, NO el total de la
      factura**: con una factura pagada de más, el excedente es `aFavor` y no
      corresponde a esta factura, pero los orígenes siguen en la misma
      proporción entre sí. Hay un test de "pagada de más" que lo fija.
    - ⚠️ **Los anulados quedan fuera con el MISMO criterio que `invoiceTotals`.**
      Si uno de los dos los contara, `abonado.total` y `total − saldo` dejarían
      de ser el mismo número y el pie repartiría plata que nadie puso.
    - ⚠️ **ESTOS TESTS SON LA ÚNICA EVIDENCIA.** Medido en producción ese día:
      **1 factura y 1 abono**, pagado por la caja. Cero de bolsillo, cero con
      saldo a favor, cero del prestamista, cero facturas de varias líneas. No
      hay pantalla donde ir a mirarlo, así que si se tocan estas funciones hay
      que confiar en los tests o volver a crear datos a mano.
    - Tests: `common/factura-de-la-compra.spec.ts` (11, la precedencia) + 20 en
      `pagador.spec.ts` + 2 en `filament.service.spec.ts`. Por mutación:
      invertir la precedencia tumba 2, contar al prestamista como bolsillo
      tumba 1, contar los anulados tumba 1, y del lado de shared las seis
      mutaciones probadas tumban entre 1 y 6 cada una.
  - **LA FICHA QUE NACE DE UNA FACTURA, CON SU TIPO (2026-10-20, shared
    0.61.0, migración `20261020190000_ficha_nueva_con_su_tipo`, aditiva)** —
    `PurchaseInvoiceLine` gana `nuevaMarca`, `nuevoTipoFilamento` y
    `nuevoColor`, y `receive()` se los pone a la ficha.
    - ⚠️ **LA FICHA NACÍA MUDA, y eso la dejaba FUERA del precio de
      cotización.** `receive()` la creaba solo con `name` y `rollPrice`;
      `preciosPorTipo` hace **`if (!type) continue`**, así que la calculadora
      cotizaba sin contar lo que costó ese rollo — **sin avisar**. Además salía
      como "Sin especificar" en Análisis y no agrupaba en la reposición por
      color: el mismo desorden que se había limpiado a mano en las 23 fichas de
      Bambu dos días antes, entrando por la puerta de atrás.
    - ⚠️ **`nuevoTipoFilamento` NO es `nuevoTipo`.** Aquel dice qué CLASE de
      ficha nace (filamento / impresora / insumo); este es el tipo del material
      ("PLA Basic", "PETG"). Los nombres se parecen y significan cosas
      distintas; confundirlos deja la ficha otra vez sin tipo.
    - ⚠️ **El tipo es OBLIGATORIO para un filamento nuevo** (`refine` del
      schema **y** botón apagado en el panel), la marca y el color no. Dejarlo
      opcional lo habría dejado vacío por omisión, que es exactamente el bug
      que esto cierra; la marca y el color vacíos no rompen ninguna cuenta. El
      panel lo apaga antes de mandar porque un 400 después de llenar nueve
      líneas es la peor forma de enterarse de una regla.
    - ⚠️ **Y la otra mitad: en una línea del CATÁLOGO los tres se PROHÍBEN.**
      Ahí contradecirían a la ficha que ya existe y nadie sabría cuál manda.
    - En el panel son tres `Combobox` (la misma lista administrada que usa
      Gastos), **cada uno con su propio `placeholder`**: es su nombre accesible,
      y con el default los tres se llamarían "Elegir o escribir…".
    - ⚠️ **Al medir, ojo con el `Combobox`**: guarda cada opción nueva con su
      propio `POST /catalog-options` apenas la creás (es optimista), así que en
      un test `mocks.post.mock.calls[0]` **no es la factura**. Hay que buscar la
      llamada por su ruta.
    - ⚠️ **UNA MUTACIÓN NO TUMBÓ NADA, y ahí estaba el hueco**: borrar
      `nuevoTipoFilamento` de **`datosDeLinea`** —lo que se guarda al CARGAR la
      factura— dejaba los 125 tests en verde. Todos arrancaban de una factura
      ya guardada en el mock, así que probaban `receive()` y `serializar()` y
      **nadie miraba el camino de guardado**. Un campo que se pierde ahí llega a
      la base en `null` y el sistema se comporta como si el dueño nunca lo
      hubiera puesto. Lo cubre ahora el bloque "lo que se guarda al cargar la
      factura" (5 tests), y la mutación tumba 1.
    - Regresión: 8 en `purchase-invoices.service.spec.ts`, 8 en
      `schemas/purchase-invoice.spec.ts` y 5 en `Purchases.factura-nueva.spec.tsx`.
      Mutaciones: ficha sin tipo **2**, sin marca ni color **1**, no llega al
      panel **1**, no se guarda al cargar **1**, el formulario sin mandarlo
      **1**, dejar guardar sin tipo **1**, pedirlos siempre **2**.

  - **LA RECARGA EN LA LÍNEA + UNA LÍNEA PUEDE SER UN INSUMO (2026-10-20,
    shared 0.60.0, migraciones `20261020170000_linea_puede_ser_insumo` y
    `20261020170100_linea_insumo_y_recarga`, aditivas)** — las dos salieron de
    **una factura real** (STRATO A-001, 9 líneas): ocho decían `refill` o
    `con spool`, y una era una placa de impresión de $40.
    - ⚠️ **ERA UN CALLEJÓN SIN SALIDA, y lo destapó la factura, no un test.**
      `Expense.isRefill` (shared 0.59.0) vive en el gasto, y el gasto de una
      línea de factura lo crea `receive()`. Como ese gasto **no se puede
      corregir después** —`noSeTocaDesdeGastos` lo rechaza con 400 y
      `EditarCompra` muestra su cartel—, un rollo que entraba por factura
      **no se podía marcar NUNCA**. El campo servía solo para las compras
      cargadas a mano, que es media app.
    - **El arreglo: `PurchaseInvoiceLine.isRefill`**, que es donde la factura lo
      dice, y `receive()` lo copia al gasto. Mismas reglas: `?? null` y no
      `|| null` (`false` es "con carrete", un dato tan verdadero como `true`) y
      `null` = "el proveedor no lo dijo".
    - ⚠️ **`nuevoTipo` ganó `COMPONENT`.** Una línea solo sabía nacer como
      filamento o como impresora, y las dos salidas para la placa eran malas:
      dejarla fuera dejaba **la deuda con el proveedor $40 corta** (Deuda
      mentiría), y cargarla como filamento metía un "rollo" de $40 en
      `preciosPorTipo`, con el que la calculadora cotizaría.
    - ⚠️ **El insumo nace con `scope: 'PER_ORDER'`, no con el default
      `PER_PIECE`.** Lo que entra por acá suele ser una herramienta —una placa
      no se gasta en cada pieza— y con `PER_PIECE` la calculadora le sumaría
      **los $40 enteros a cada unidad** del pedido si alguien la eligiera.
      Ninguno de los dos es exacto para algo durable; este es el menos dañino y
      se cambia con un click desde su catálogo. Su mutación tumba 1 test.
    - ⚠️ **La línea también gana `componentId`** (un insumo que YA existe). Sin
      él, volver a comprar la misma placa obligaba a cargarla como "nueva" y
      nacía una ficha duplicada — una asimetría que el filamento y la impresora
      no tienen. Se filtra por organización, como las otras dos: con el id de
      otro negocio, el nombre de SU insumo saldría en la pantalla de Compras.
    - ⚠️ **DOS migraciones separadas a propósito**: Postgres no deja **usar** un
      valor de enum en la misma transacción en que se agrega, y Prisma envuelve
      cada archivo en una. `migrate deploy` las aplica seguidas, así que no hay
      ningún paso manual entre medias (la regla de "una migración no puede
      depender de que alguien corra un script" sigue intacta).
    - ⚠️ **`serializar()` arma la línea CAMPO POR CAMPO**, igual que
      `serialize()` en campañas: un campo nuevo que no se agregue ahí existe en
      la base, pasa los tipos y **nunca llega al cliente**. Hay un test que lo
      fija.
    - **En el panel**: el selector "Qué es" gana *Insumo del catálogo*, el de
      ficha nueva pasa a *"¿Filamento, impresora o insumo?"* (se llamaba
      "¿Qué es?" y chocaba con el de al lado) y cada línea de filamento lleva su
      desplegable de recarga, en **"No lo dice"** y diciendo que es la única
      oportunidad. ⚠️ Los cuatro desplegables llevan `aria-label`: `Field` no
      asocia su `<label>` con el control.
    - ⚠️ **El control NO se ofrece para una impresora**: un dato sin sentido
      guardado porque el formulario lo ofrecía es ruido que después alguien lee
      como información. Su mutación tumba 1 test.
    - Regresión: 11 en `purchase-invoices.service.spec.ts`, 12 en
      `schemas/purchase-invoice.spec.ts` (shared) y 7 en
      `Purchases.factura-nueva.spec.tsx` (panel). Doce mutaciones probadas, cada
      una tumba entre 1 y 3 tests. ⚠️ Una de ellas **no compiló** (122 → 15
      tests, el verde falso): borrar `isRefill` de `serializar` rompe el tipo
      del test. Se rehizo con `(false as boolean) ? … : null`, que compila y sí
      cambia el comportamiento.

  - **RECARGA O CON CARRETE, por COMPRA (2026-10-20, shared 0.59.0, migración
    `20261020120000_recarga_o_con_carrete`, aditiva)** — `Expense.isRefill`,
    que viaja en `ExpenseCreateSchema`/`ExpenseWithDefinitionSchema` y sale en
    `GET /filament/purchases` y en `GET /expenses`.
    - **Por qué.** Al normalizar las fichas de Bambu apareció que el mismo color
      puede costar distinto según venga con carrete o sin él, y el dato solo
      existía escrito a mano en la nota de algunas compras ("PLA Basico AZUL -
      RECARGA SIN CARRETE"). Un texto libre no agrupa ni compara.
    - ⚠️ **NULLABLE Y SIN DEFAULT, a propósito, y `null` NO es "con carrete":
      es *no se registró*.** Las 95 compras anteriores valen `null` y así se
      quedan. Es la lección del 2026-10-19: `paidBy` nació con
      `ADD COLUMN ... NOT NULL DEFAULT 'BUSINESS'` y **71 gastos quedaron
      afirmando que los pagó el negocio sin que nadie lo decidiera**. Un default
      se lee después como un dato.
    - ⚠️ **VA EN LA COMPRA Y NO EN LA FICHA, y está MEDIDO**: la ficha
      `PLA Basic Bambu Lab Blanco` tiene dos compras, una normal (31/08) y una
      recarga (09/10). En la ficha, el campo tendría que mentir sobre una de las
      dos. El primer diseño lo ponía en `Material`; los datos lo tumbaron.
    - ⚠️ **`?? null` y no `|| null` en los tres lugares que lo escriben**
      (`create`, `update`, `createWithDefinition`) y en el que lo lee
      (`FilamentService.purchases`): **`false` es un dato tan verdadero como
      `true`**. Con `||`, marcar "con carrete" se guardaba como "no se
      registró". Su mutación tumba 1 test en cada punta.
    - ⚠️ **En `update` es `!== undefined`, no un truthy check**: mandar `false`
      es DECIR "con carrete" y mandar `null` es **borrar** el dato. Las dos
      correcciones tienen que poder hacerse — una marca equivocada que no se
      puede desandar obliga al dueño a sostener algo que ya sabe falso. La
      mutación a `dto.isRefill &&` tumba 2.
    - **El texto lo escribe `shared/calc/recarga.ts`** (`etiquetaDeRecarga`,
      `valorDeRecarga`, `recargaDesdeValor`, `OPCIONES_DE_RECARGA`), no las
      pantallas: lo leen TRES lugares (la tabla de Compras, su tarjeta de móvil
      y los dos formularios). Con el texto repetido, el día que uno cambie van a
      decir cosas distintas del mismo rollo.
    - **Sin dato, la fila NO dice nada**: `etiquetaDeRecarga(null)` es `null`.
      Etiquetar las compras viejas sería ponerles una afirmación que nadie hizo.
    - **En el panel**: el desplegable está en el modal de registrar
      (`ExpenseModal`, en sus DOS ramas — ficha nueva y del catálogo) y en el de
      corregir (`EditarCompra`), y arranca SIEMPRE en **"No lo anoté"**.
      ⚠️ Los tres llevan **`aria-label` explícito**: `Field` no asocia su
      `<label>` con el control (no hay `htmlFor`/`id`), así que sin él el lector
      de pantalla lee solo el valor. Es una carencia del primitivo, anterior a
      este cambio y compartida con los demás desplegables del formulario.
    - Regresión: `calc/recarga.spec.ts` (shared, 8), `schemas/recarga.spec.ts`
      (shared, 7), `expenses.service.spec.ts` (8), `filament.service.spec.ts`
      (1) y, en el panel, `PurchasesTab.recarga.spec.tsx` (4) +
      `recarga-formularios.spec.tsx` (9). Mutaciones y cuántos tumba cada una:
      `|| null` en `create` **1**, truthy check en `update` **2**,
      `createWithDefinition` sin el campo **2**, `|| null` al leerlo **1**,
      borrar la etiqueta de la tabla **3**, borrarla de la tarjeta **1**, el
      formulario de corregir sin mandarlo **4**, el de alta sin mandarlo **3**,
      y preseleccionar "con carrete" **2 y 2**.
    - ⚠️ **Cero casos en producción al escribirlo** (las 95 compras valen
      `null`): los tests son la única evidencia de que funciona. Lo que SÍ hay
      son compras cuya **nota** ya lo dice a mano — ésas se pueden marcar sin
      adivinar; el resto no.
  - **QUIÉN PUSO LA PLATA de cada compra (2026-10-11, shared 0.49.0)** —
    `GET /filament/purchases` devuelve además `counterpartyName` y, en lugar del
    booleano `fromInvoice`, un objeto **`invoice: { id, saldo, lineas } | null`**.
    La pantalla lo escribe con `notaDePagador` (`shared/calc/pagador.ts`).
    - **Por qué.** En octubre de 2026 la pantalla listaba **$202** en compras y
      la caja había soltado **$142**: dos rollos los puso el dueño de su
      bolsillo (gastos con `counterpartyId`) y un tercero entró por una factura
      abonada a medias ($15 de $25). Los tres hechos estaban en la base y
      ninguno en la tabla, así que la caja parecía mentir.
    - ⚠️ **Un rollo que entró por factura NO tiene pagador propio.** Lo que se
      paga es la FACTURA, y una factura puede tener varias líneas. El saldo
      **no se reparte entre las líneas**: eso sería una convención escrita como
      si fuera un hecho del rollo. Por eso viaja `lineas` y el texto cambia:
      `"Faltan $10.00 de esta factura"` con una línea y
      `"Faltan $40.00 de la factura entera (4 líneas)"` con varias.
    - ⚠️ **El saldo sale de `invoiceTotals`** (`calc/purchase-invoice.ts`), no
      de una cuenta propia: cobra lo recibido al precio REAL de cada entrega e
      ignora los abonos anulados. Recalcularlo acá daba otro número que el de
      la pantalla de Compras (medido: $4 contra $5 con una entrega más cara).
    - ⚠️ **`supplierName` NO viaja**, a propósito: el gasto que nace al recibir
      guarda como proveedor al de la factura, así que `providerName` de la
      compra ya ES ese nombre.
    - ⚠️ **`fromInvoice` se REEMPLAZÓ, no se dejó al lado**: dos definiciones de
      "esta compra vino de una factura" en el mismo objeto es justo el bug que
      este proyecto viene cazando. Cambia la FORMA de la respuesta → **API
      primero, panel después**.
    - ⚠️ **Las facturas viajan en el `include` del `findMany`**, no en una
      consulta por fila: con 40 compras en pantalla serían 40 viajes a la base
      para dibujar una línea de texto. Lo fija un test.
    - Tests: `pagador.spec.ts` (shared, 9) y 6 nuevos en
      `filament/filament.service.spec.ts`. Por mutación: ignorar `lineas` tumba
      1, el saldo a mano tumba 2 (el abono anulado y la entrega más cara) y no
      devolver ni factura ni nombre tumba 6.
  - **La calculadora cotiza por TIPO, no por color (2026-10-10, shared 0.43.0)** —
    `GET /filament/type-prices` (`FilamentService.typePrices`) devuelve el
    precio de cada tipo, DERIVADO de las compras. El motor puro es
    `preciosPorTipo` en `shared/calc/filament-type-price.ts`.
    - **Por qué.** Medido en producción ese día: el PLA tiene **47 fichas entre
      $0,00 y $25,94 y casi todas valen 20**, así que elegir el COLOR no
      compraba precisión. Entre TIPOS sí: PLA PURE $13 contra PLA SILK $22,84
      es 75 % de diferencia, y cotizar los dos a 20 deja el primero 54 % caro
      (se pierde el trabajo) y el segundo 12 % barato (se pierde el margen).
    - ⚠️ **El rollo REGALADO no entra.** `PLA Creality Azul oscuro` costó $0
      porque se lo regalaron: el gasto en $0 es verdadero y **se queda en el
      ledger**, pero no es una señal de precio. La regla es exactamente
      `amount <= 0` ("no hay precio"), **nunca** "es sospechosamente barato":
      el PLA PURE a $13 es un dato real y es justo el que hace que cotizar por
      tipo valga la pena. Cualquier regla de atípicos lo borraría con el regalo.
    - **Se pondera por ROLLOS comprados, no por ficha.** Hoy casi todas las
      fichas tienen una sola compra (entraron con el import del 31/08) y los
      dos números coinciden; está fijado con test **ahora**, mientras no se
      nota.
    - ⚠️ **Los GRAMOS se promedian igual, ponderados por rollos**, así
      `rollPrice / rollGrams` da el costo por gramo REAL del tipo
      (Σdinero / Σgramos). Fijarlos en 1000 haría mentir al par que la
      calculadora copia en cuanto haya un rollo que no sea de 1 kg.
    - Un tipo **sin ninguna compra con precio** (o sin gramos, o sin rollos) no
      tiene promedio: **no se ofrece**, en vez de ofrecerse en $0.
    - ⚠️ **No lee `Material.rollPrice`**, que es el precio de la ÚLTIMA compra
      de UNA ficha: es la regla central del dominio (los precios se DERIVAN).
      Sale de los MISMOS gastos que `GET /filament/purchases`, así que la
      calculadora y Compras no pueden contradecirse.
    - Las fichas **descontinuadas SÍ entran** en el promedio del tipo:
      descontinuar es una decisión sobre la VARIEDAD, y lo que se pagó por ese
      color sigue siendo evidencia de lo que cuesta el tipo.
    - ⚠️ **El promedio mira los ÚLTIMOS 6 MESES (2026-10-10, shared 0.46.0)**,
      no toda la historia: con toda la historia una compra vieja y barata pesa
      para siempre y, el día que el filamento suba, la calculadora cotiza con
      el precio de antes **sin avisar**. La ventana es
      `MESES_DE_LA_VENTANA = 6` y arranca en `monthsBefore(hoy, 6)`
      (`shared/calc/stock.ts`, con el resto de las conversiones de fecha).
      - ⚠️ **Un tipo SIN compras en la ventana NO desaparece**: se apoya en su
        **última compra** y sale con `stale: true` + `lastPurchase`.
        Desaparecer es peor que estar un poco viejo — el dueño no podría
        cotizar ese tipo en absoluto. Y los `stale` van **al final** del orden,
        porque el primero de la lista es el que la calculadora elige al
        abrirse.
      - ⚠️ **"Hoy" entra como PARÁMETRO** (`preciosPorTipo(compras, hoy)`), como
        en `cashChainCuts`, `facturasAtrasadas` y `campaignLifecycle`: leerlo
        del reloj adentro da un test que pasa hoy y falla solo algún día.
        `typePrices(organizationId, now = new Date())` lo resuelve con
        **`businessDateKey(now)`** — "hoy" es un INSTANTE y se decide en hora de
        Venezuela; con `toISOString` la ventana arranca un día tarde desde las
        20:00 de Caracas. La otra mitad de la regla de las dos clases de fecha:
        **`Expense.date` es una fecha de NEGOCIO** y se lee con
        `toISOString().slice(0, 10)`; pasarla por `businessDateKey` la corre un
        día atrás y una compra del borde cae afuera.
      - Una compra **sin fecha** (o con un día que no existe, `'2026-02-30'`)
        cuenta como la **más vieja**: no puede afirmar que es reciente, pero
        sigue sirviendo de respaldo. El regalo (`amount <= 0`) queda afuera
        también como "última compra", o el tipo se ofrecería en $0.
      - ⚠️ **Con los datos del dueño esto NO cambia ningún número** (casi todo
        el catálogo entró con el import del 31/08, dentro de la ventana): los
        tests con fechas a mano son la ÚNICA prueba de que la ventana hace
        algo. Verificado por mutación: ampliar la ventana a un siglo tumba 7
        tests de shared y 2 de api; hacer desaparecer el tipo sin compras
        recientes, los mismos 9.
    - Tests: `filament-type-price.spec.ts` (shared, 24 con números y fechas a
      mano), `stock.spec.ts` (`monthsBefore`, con el recorte de fin de mes),
      `filament.service.spec.ts` y `filament.controller.spec.ts` (la ruta y que
      la organización sale de la SESIÓN).
  - **Importación del Excel** (`prisma/import-filamento.mjs` + `filamento-excel.json`):
    trae el control de filamento desde las hojas "Inventario" y "Stock mensual".
    Se corre a mano (`node --env-file=.env prisma/import-filamento.mjs`), **sin
    `--commit` es un ENSAYO** que calcula e imprime sin escribir. BORRA los
    materiales y las compras de filamento que haya y los recrea; todo en una
    transacción, y **verifica contra el Excel antes y después** (rollos, invertido
    y rollos contados): si no cuadra, no escribe. El JSON se regenera del `.xlsx`
    con openpyxl. Resultado del 2026-09-07: 57 fichas, 48 compras (66 rollos,
    $1290), 28 rollos contados de agosto y 9 pendientes de identificar.
    **Estado al 2026-09-13: 48 fichas, una por compra, idénticas a la hoja
    "Inventario"** (material + color + marca y rollos, verificado uno a uno).
    ⚠️ Hasta el 2026-09-13 el script **no parseaba**: `SyntaxError` por saltos de
    línea reales dentro de comillas simples en el mensaje de "Falta
    filamento-excel.json" (desde el commit que lo creó); se arregló. Desde el
    cierre mensual del stock (shared 0.13.0) además **aborta si hay meses de
    stock cerrados**, incluso en ensayo (ver "Cierre mensual del stock").
  - **Reposición POR TIPO + COLOR** (2026-09-13, shared 0.11.0):
    `restockByColor` en `shared/calc/stock.ts` agrupa las fichas sin importar la
    marca y devuelve `OUT` / `LOW` / `SUGGEST`. `SUGGEST` = colores comprados MÁS
    que el promedio de rollos por color (compras hasta el cierre del mes,
    `purchasedUpTo` en el servicio) y con 1 rollo o menos. **Casillas vacías = no
    hay** (decisión del dueño, como el Excel): en un mes cerrado, toda ficha sin
    marcar vale 0; un mes abierto es "sin dato" (`counted` en
    `GET /filament/stock` es "el mes está cerrado"). Un color con todas sus fichas
    descontinuadas no cuenta. Tests: `restock-by-color.spec.ts` y el servicio.
    ⚠️ Las compras importadas del Excel tienen TODAS fecha 2026-08-31 (la hoja no
    la registraba): hasta que haya compras con fecha real, "lo más comprado" es
    el histórico completo y no se puede calcular un ritmo por mes.
  - **Armar el pedido con lo que falta (2026-10-10, shared 0.38.0)** —
    `suggestRestockLines` en `shared/calc/restock-order.ts`: función PURA que
    recibe los grupos que ya devolvió `restockByColor` + las fichas y devuelve
    las líneas sugeridas para la factura nueva. El eslabón que faltaba entre
    Stock del mes y Compras. 18 tests; pantalla: `StockTab.tsx` → `/compras`.
    - ⚠️ **Entran los grupos tal como vienen**: esa es la lista que el dueño
      está mirando. Volver a clasificar acá sería una segunda opinión sobre lo
      mismo, y el día que una cambie la propuesta diría algo distinto de la
      lista de arriba. Solo `OUT` y `LOW`; `SUGGEST` no es un faltante.
    - ⚠️ **Una línea por COLOR, no por ficha** (la regla del 2026-09-13). La
      línea apunta a una ficha ACTIVA del grupo —gana la que ya se compró
      alguna vez, desempate por nombre para que sea reproducible—. Medido
      contra la base local: 10 de 34 colores tienen más de una ficha activa y
      el PLA Negro tiene CUATRO marcas.
    - ⚠️ **Cantidad: un rollo por color.** Es la unidad con la que se compra y
      el riesgo es asimétrico (subir la cantidad es un click; comprar un rollo
      de más es plata quieta). Un consumo por color solo se puede derivar con
      dos meses cerrados seguidos, así que una cantidad "inteligente" sería
      adivinada.
    - ⚠️ **El precio sale de `Material.rollPrice`**, la MISMA fuente que la
      calculadora (`recalcularPrecioDelRollo` la mantiene con la última compra
      por fecha). `GET /filament/stock` lo expone como **`lastRollPrice`**, que
      es `null` si la ficha no tiene NINGUNA compra con rollos (`rollPrice` es
      obligatorio en la base, así que el número que trae no lo pagó nadie) —
      mismo filtro `quantity > 0` que `recalcularPrecioDelRollo`, para que las
      dos preguntas no contesten distinto. Un precio nulo, 0 o imposible entra
      **en blanco** y el formulario lo pide: hay una ficha real
      (`PLA Creality Azul oscuro`) con una compra importada en $0, y sin esta
      regla la propuesta habría pedido ese rollo gratis.
    - Mutaciones que tumban tests: incluir las descontinuadas (2), tratar
      `SUGGEST` como faltante (1), proponer $0 sin compra previa (5), ignorar
      el precio en el desempate (1), devolver `rollPrice` sin mirar si hubo
      compra (1), sacarle el filtro por organización a esa consulta (1).
    - Plan: `docs/superpowers/plans/2026-10-10-fases-4-y-5.md` (tarea 1).
  - **Cierre mensual del stock (2026-09-13, shared 0.13.0)** — tabla `StockMonth`
    (org + mes, `closedAt`, `reopenedAt`; un mes sin fila está abierto).
    `POST /filament/stock/close` escribe una fila por CADA ficha (lo que no vino,
    en 0) y cierra, todo en una transacción; `POST /filament/stock/reopen` reabre
    sin tocar los conteos; `GET /filament/stock/status` dice si está cerrado y
    desde cuándo se puede cerrar. `PUT /filament/stock` responde **410**.
    ⚠️ Se cierra desde el último día del mes en **hora de Venezuela**
    (`canCloseMonth`/`BUSINESS_TIME_ZONE` en shared): el servidor corre en UTC.
    Resumen, consumo y reposición solo usan meses CERRADOS (`complete` = cerrado);
    el reporte en Excel muestra el último cerrado (`lastClosedMonth`), o "Todavía
    no hay meses cerrados" si no hay ninguno. `GET /filament/stock`, `/summary` y
    `/stock/status` validan `month` con `MonthSchema`: un mes mal formado o
    ausente da 400, no 500. Guardas en las otras puertas: borrar una ficha con
    conteos en un mes CERRADO → 409 (`"Esta ficha tiene conteos en meses cerrados
    (agosto de 2026). Descontinuala en vez de borrarla."`); un mes
    REABIERTO sí deja borrar fichas que solo tengan conteos en él (la guarda mira
    meses con `closedAt` — "un mes reabierto no es dato final").
    Carrera borrar-ficha vs cerrar-mes aceptada sin candado (un solo dueño).
    - **`GET /filament/stock/last-closed`** (2026-10-10, shared 0.48.0) —
      `{ month: 'AAAA-MM' | null }`, el último mes cerrado. Lo pide el aviso del
      Dashboard que recuerda contar (`conteoDeStockPendiente` en shared, Fase 6).
      ⚠️ **No se puede reemplazar por `/stock/status?month=`**: ese dice si
      septiembre está cerrado, pero no distingue "no lo cerró" de "este negocio
      todavía no cerró ningún mes" — y es justo ese caso el que apaga el aviso.
      ⚠️ Devuelve `null` y **no un 404**: "no hay ningún cierre" es un dato, y
      con un error el panel tendría que tratar un fallo de red como "no hay".
      Reusa el `lastClosedMonth` que ya existía para el reporte en Excel: no hay
      una segunda cuenta del mismo número. Regresión:
      `filament.controller.spec.ts` (ruta, verbo y que la organización salga de
      la sesión).
    `import-filamento.mjs` aborta si hay meses cerrados, incluso en ensayo (ver
    "Importación del Excel" más arriba). Regresión de seguridad: `filament.service.spec.ts`,
    `filament.controller.spec.ts` (fija por metadata de Nest el guard JWT de
    clase y la lista EXACTA de rutas de escritura — `POST stock/close`,
    `POST stock/reopen`, `PUT stock` en 410 —: agregar otra ruta de escritura ahí
    rompe el test a propósito), `materials.service.spec.ts`. Spec:
    `docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`.
  - **La recepción SUGIERE el conteo (2026-10-10, shared 0.48.0)** —
    `GET /filament/stock` trae **`received`**: los rollos que ENTRARON en el mes
    por ficha, para que el conteo los ofrezca como punto de partida.
    ⚠️ **`null` cuando no hubo ninguna recepción, NUNCA 0**: "no sé" y "cero" no
    son lo mismo, y 0 es un conteo válido — con un 0 la pantalla ofrecería una
    respuesta en vez de una referencia. El reparto por ficha lo hace
    `rollosRecibidosPorFicha` (shared), donde está escrita la **decisión del
    dueño**: se sugiere SOLO lo recibido en el mes y NO "el cierre anterior más
    lo recibido", porque con el conteo completado se termina confirmando un
    número en vez de mirando el estante.
    ⚠️ Entran las recepciones de factura **y** las compras cargadas a mano:
    recibir una línea crea un `Expense` con `materialId` y la fecha en que
    llegó, y un rollo comprado a mano está en el estante igual; dejarlas afuera
    haría que la sugerencia contradiga el `purchased` del mismo `/summary`.
    ⚠️ **Una sola consulta para DOS preguntas** (`rollsReceivedIn`, que
    reemplazó a `materialsBoughtIn`): cuánto entró y si la ficha se compró en el
    mes (`exhausted`). Eran dos viajes con el MISMO filtro, y con dos el día que
    una cambie el conteo diría que entraron 2 rollos de una ficha que la otra da
    por agotada. Regresión: `filament.service.spec.ts` (5, con el hermano
    alcanzable y el "una sola vez").
  - **Activo / Descontinuado** (2026-09-13, shared 0.14.0) —
    `PATCH /materials/:id/status` con `MaterialStatusUpdateSchema`. Va APARTE del
    `PATCH /materials/:id`: `MaterialSchema` no tiene `status`, así que guardar el
    formulario nunca cambia el estado (fijado en `materials.controller.spec.ts`).
    Una ficha descontinuada no se ofrece al cotizar ni entra en la reposición, y
    conserva compras y conteos: es la salida para una ficha con compras o conteos,
    que no se puede borrar. **Se reactiva con CUALQUIER gasto que enlace
    la ficha con `quantity > 0`** (hoy la web solo lo dispara desde Gastos → tipo
    Filamento): en `ExpensesService` (`refreshRollPrice` y `createWithDefinition`)
    el mismo paso que fija `rollPrice` escribe `status: 'ACTIVE'`. ⚠️
    `refreshRollPrice` usa `updateMany` con `organizationId`: antes hacía `update`
    por id y un gasto con el `materialId` de otra organización le cambiaba el
    precio a esa ficha.
    Regresión de seguridad: `materials.controller.spec.ts` (guard, ruta y pipes
    reales), `materials.service.spec.ts` (`setStatus` con ficha ajena),
    `expenses.service.spec.ts` (`updateMany` con organización y `referenceField`).
    Spec: `docs/superpowers/specs/2026-09-13-estado-material-design.md`.
  - **Sin página Materiales** (2026-09-14, shared 0.15.0) — la ficha se maneja
    desde Stock del mes. **No hay `POST /materials`**: una ficha nace de una compra
    en Gastos. `PATCH /materials/:id` valida con `MaterialCorrectionSchema`:
    `name`, `color`, **`brand` y `type`**. ⚠️ Marca y tipo entraron el
    2026-10-09 **revirtiendo** la decisión del dueño del 2026-09-14 de dejarlos
    como nacieron: sin eso, un rollo cargado como "PLA mate" que resultó ser
    otra cosa no tenía arreglo. Corregirlos **reagrupa el análisis**, que es
    para lo que sirve. **Los gramos y el precio siguen afuera**: los gramos
    reescriben el costo por gramo de todas las compras pasadas de esa ficha, y
    el precio sale SIEMPRE de la última compra. El servicio pasa el DTO entero
    a Prisma, así que **el schema es lo único que los detiene** — hay test. ⚠️ **El precio del filamento sale SOLO de la compra**: en
    `createWithDefinition`, `kind: 'material'` exige `quantity ≥ 1` (400 "Indicá
    cuántos rollos compraste"), ignora `referenceField` (sin 400: un panel viejo lo
    manda) y pisa `data.rollPrice` con `purchaseCostPerRoll`. `DELETE /materials/:id`
    da 409 si la ficha tiene CUALQUIER compra o conteo. `GET /materials` trae
    `outAtLastClose` (`AAAA-MM` si tiene fila de conteo en 0 en el último mes
    cerrado y no se compró después; NO usa `createdAt`: las fichas se importaron
    después de sus compras del 31/08) y `GET /filament/stock` trae `canDelete`.
    Regresión de seguridad: `materials.controller.spec.ts` (pipe real del PATCH,
    ninguna ruta POST), `materials.service.spec.ts`, `expenses.service.spec.ts`.
    Spec: `docs/superpowers/specs/2026-09-14-quitar-pagina-materiales-design.md`.
  - Las fichas **"Sin especificar"** (las que creó la importación para los rollos
    sin marca) nacen `DISCONTINUED`: son un marcador temporal, y sin eso, al
    identificar el rollo quedaban en cero y pedían reposición de un color que no
    existe. **Ya no queda ninguna** (2026-09-13): el dueño identificó los 9
    rollos, sus conteos pasaron a las fichas reales y las 9 se borraron (sin
    compras y con conteos en cero; respaldo con `pg_dump` antes). ⚠️ `Material`
    borra sus `StockCount` en CASCADA: antes de borrar una ficha, comprobar que
    sus conteos estén en cero o se pierden rollos contados.
  - **El precio del rollo lo fija el SERVIDOR**: una compra de filamento con
    cantidad actualiza `Material.rollPrice = monto ÷ rollos` (`refreshRollPrice` en
    `expenses.service.ts`). Antes dependía de una casilla del formulario; si se
    olvidaba, se seguía cotizando con un precio viejo.
  - **Catálogos** (`materials/`, `printers/`, `components/`, `providers/`, `settings/`,
    `catalog-options/`): un módulo CRUD por catálogo. El **empaque ya no es un catálogo
    aparte**: se fusionó en `Component` con un campo `scope` (PER_PIECE = por pieza /
    PER_ORDER = por pedido); la migración `merge_insumos` eliminó la tabla `Packaging`
    (por eso `Expense` ya no tiene `packagingId`). Los `PATCH` de catálogo son PARCIALES
    (`XSchema.partial()`).

## Comandos (desde la raíz de este repo)
- `pnpm install`
- `pnpm test:shared` — tests del motor (lo más importante).
- `pnpm -r build` / `pnpm -r lint` / `pnpm -r test`
  ⚠️ **`pnpm -r build` con la API corriendo en watch la TUMBA**: `nest build`
  reescribe `dist/` bajo los pies del `nest start --watch` y el proceso muere sin
  dejar nada escuchando en 3001. Si hay que compilar con el server arriba, usar
  `pnpm --filter @calc3d/shared build` (que no toca `apps/api/dist`) o parar el
  watch antes.
- `pnpm --filter @calc3d/api exec prisma generate`
- `pnpm --filter @calc3d/api exec prisma migrate dev`
- `pnpm dev` — levanta la API (antes `pnpm dev:api` en el monorepo).
- `pnpm --filter @calc3d/api seed` — asegura (idempotente) la cuenta del **dueño**
  (org + usuario OWNER + settings + tasas de protección Bs) desde `OWNER_EMAIL` /
  `OWNER_PASSWORD` (defaults de desarrollo: `dueno@calc3d.local` / `calc3d1234`).
  Como no hay registro público, **el seed es la única vía de crear la cuenta**. Con
  `SEED_DEMO=1` además siembra un catálogo de ejemplo (caso del llavero) en su org.

## Producción (desde 2026-11-05): TODO en Railway, panel en Cloudflare

| Pieza | Dónde | URL |
|---|---|---|
| API (este repo) | **Railway**, proyecto `remarkable-tenderness`, Docker | `https://calc3d-api-production.up.railway.app/api` |
| Base de datos | **Railway**, PostgreSQL **18**, mismo proyecto que la API | URL en `apps/api/.env.production.local` (⚠️ **este repo es PÚBLICO**: ni host ni puerto se escriben acá) |
| Panel (`calc3d-web`) | **Cloudflare Pages** | `https://calc3d-web.pages.dev` |

### La mudanza de Render a Railway (2026-11-05)

Hasta ese día la API vivía en **Render** (plan free, se dormía a los 15 min) y la
base en otro proyecto de Railway (Postgres 17).
El dueño movió las dos cosas a un proyecto Railway nuevo. **Lo viejo quedó sin
uso**; se conservó unos días como red de seguridad y después se borra.

Cómo se hizo la base: `pg_dump -Fc` de la vieja → `pg_restore --single-transaction`
en la nueva (vacía). De 17 a 18 va sin problema. **No alcanza con contar filas
para decir que quedaron iguales**: un `COUNT(*)` no ve una fila EDITADA. Se
comparó un **md5 del contenido de cada tabla**, ordenado, y además se leyeron los
números del negocio con los servicios reales contra las dos bases. Las 39 tablas
dieron idénticas. El script quedó documentado abajo, en «Respaldar, migrar».

⚠️ **Los dos tropiezos de la mudanza fueron de COPIAR Y PEGAR, y los dos
costaron un rato de bucle de reinicios:**
1. `DATABASE_URL` quedó como `ppostgresql://…` (una `p` de más) y entre comillas.
   Prisma decía *"the URL must start with the protocol `postgresql://`"*. Ese
   mensaje **prueba que la variable existe**: si faltara, diría *"Environment
   variable not found"*. Se ve en Variables → **Raw Editor**. Mejor todavía:
   dentro del mismo proyecto, poner `${{Postgres.DATABASE_URL}}` y elegir el
   servicio del autocompletado — usa la red interna y no hay nada que tipear.
2. `VITE_API_URL` quedó **sin el `/api` final**, y el panel pidió `/auth/login`
   → 404 `Cannot POST /auth/login`. La API monta todo bajo `setGlobalPrefix('api')`.
   El CORS y el resto ya estaban bien: la respuesta traía `railway-hikari` y el
   `Access-Control-Allow-Origin` correcto. **Un 404 ahí es la ruta, no el CORS.**

⚠️ **Cómo saber a qué base le habla la app, sin suponerlo:** contar las
conexiones de aplicación de cada base (`pg_stat_activity`, descartando las de
`psql`). Después del corte: vieja **0**, nueva **37**. Y para el panel, leer el
bundle PUBLICADO y buscar la URL embebida — `VITE_API_URL` se escribe dentro del
bundle en tiempo de build, así que **guardar la variable no basta: hay que
redesplegar**.

- **Railway** construye con el `Dockerfile` de este repo y redespliega solo en
  cada push a `main`. Variables del servicio: `DATABASE_URL`, `JWT_SECRET`,
  `JWT_EXPIRES_IN`, `TRUST_PROXY=1`, y `WEB_ORIGIN` / `APP_URL` =
  `https://calc3d-web.pages.dev` **exacto, sin barra final**: si no coincide, el
  navegador bloquea el login por CORS sin decir por qué. No hacen falta `STORE_*`
  ni `R2_*` mientras se use solo el panel.
  - El `CMD` del Dockerfile corre `prisma migrate deploy` antes de arrancar, así
    que **un push con migraciones se auto-aplica**, igual que en Render.
  - ⚠️ **Poner el Healthcheck Path en `/api/health`** (Settings → Deploy). Vacío,
    un deploy roto reemplaza igual al que funcionaba — que es lo que pasó con la
    `p` de más: el servicio quedó en bucle de reinicios y no había a qué volver.
- `render.yaml` sigue en el repo pero **ya no describe la producción**: quedó de
  la etapa en Render. Si no se piensa volver, conviene borrarlo para que no
  confunda al siguiente que lo lea.
- ✅ Railway **no duerme el servicio** como hacía el plan free de Render (~50 s
  para despertar). Eso era el tope para publicar la tienda; ya no lo es.
- ✅ **`GET /api/health` DICE QUÉ VERSIÓN ESTÁ SIRVIENDO** (2026-10-10). Devuelve
  `{ ok: true, ts, version }` y, **solo si el entorno expone
  `RENDER_GIT_COMMIT`** (en Railway NO existe, así que el campo `commit` no viene;
  para verificar un despliegue se usa `version`, que sí está), un `commit` de 7 caracteres (si no lo expone, el campo
  **no está**: no se inventa un `'unknown'` ni se agrega configuración nueva).
  `version` es `SHARED_VERSION`, **importado**, nunca un literal.
  - **Así se verifica un despliegue**: comparar ese `version` con el
    `packages/shared/package.json` del commit que se empujó. Antes devolvía
    `{ ok, ts }` y no había forma de saberlo: el despliegue de esa tarde se
    "verificó" **esperando ocho minutos por reloj**, que es suponer con cara de
    comprobar. `ts` no sirve — cambia en cada request, con la versión vieja o
    con la nueva. **Por eso subir `SHARED_VERSION` en cada cambio de shared no
    es burocracia: es lo que hace verificable el despliegue.**
  - ⚠️ **Sigue público, sin JWT, sin tocar la base y sin nada sensible.** Render
    lo pega como `healthCheckPath` cada pocos minutos: una consulta acá
    despertaría el cómputo sola. El controlador no recibe colaboradores a
    propósito. Nada de variables de entorno, rutas, nombres de base ni
    `DATABASE_URL` — su spec mete secretos en `process.env` y exige que no
    aparezcan en la respuesta.
  - ⚠️ **NO importar el `package.json` de shared desde `apps/api/src`.** Un
    `import` de un archivo fuera de `src` le corre el `rootDir` a `tsc` y el
    build pasa de `dist/src/main.js` a `dist/apps/api/src/main.js`; **el
    Dockerfile arranca el primero**, así que el contenedor no levanta. Medido al
    compilar el 2026-10-10. Si hace falta leerlo en un test, `readFileSync` en
    ejecución. Regresión: `health.controller.spec.ts`.
- **El `Dockerfile` (arreglado el 2026-10-01, verificado en un clon limpio):**
  - **Node 22**: pnpm 11 (`packageManager`) exige Node ≥ 22.13. Con `node:20`
    moría en `pnpm install` con *"No such built-in module: node:sqlite"*.
  - **`COPY . .` ANTES de `pnpm install`**: el `postinstall` de la raíz compila
    `packages/shared`; con solo los `package.json` fallaba ("tsconfig.json no existe").
  - `pnpm-lock.yaml` + `--frozen-lockfile` (antes no copiaba el lockfile y cada
    build resolvía versiones nuevas) y `openssl` (Prisma lo necesita en Alpine).
  - ⚠️ Probar el build en Windows dentro de una ruta LARGA (p. ej. el scratchpad
    de `AppData\Local\Temp`) da un falso error de Prisma al arrancar
    (`ERR_PACKAGE_IMPORT_NOT_DEFINED: #main-entry-point`): es el límite de 260
    caracteres de Windows, no un bug. En una ruta corta (`C:\algo`) arranca bien,
    y en el contenedor Linux no existe.
- **La base de Railway estaba VACÍA hasta el 2026-10-01** (0 tablas): nunca se
  había migrado. Se cargó con `pg_dump -Fc --no-owner --no-privileges` de la base
  local + `pg_restore --single-transaction --exit-on-error` (local 18 → Railway 17,
  compatible). Llevó también `_prisma_migrations`, así que el primer
  `migrate deploy` de Render no hizo nada.
- **Usuarios de producción**: queda UNA sola cuenta, `dueno@calc3d.local` (el
  2026-10-01 se borró la otra cuenta, a pedido del dueño). ⚠️ Venía con
  la contraseña del seed, que está escrita más abajo en este archivo PÚBLICO: el
  dueño tiene que haberla cambiado (y conviene pasarle el correo a uno real, o el
  reset de contraseña no le llega a nadie). Sin `RESEND_API_KEY` en el entorno de
  producción (Railway), el correo de reset no se envía.
- ⚠️ **Desde el 2026-10-01 la base que manda es la de PRODUCCIÓN**: el dueño
  carga datos en el panel publicado. La local quedó como copia de ese día. Los
  scripts `sincronizar-*.mjs` leen `DATABASE_URL` del `.env` (la LOCAL): correrlos
  contra prod es tocar producción (backup + OK explícito antes).

## Cómo se prueba acá (método, no lista de deseos)

Escrito el 2026-10-19 a partir de lo que de verdad encontró y de verdad falló en
este proyecto. **Cada regla de abajo tiene un caso real detrás**; no están por
prolijidad.

### Las tres capas, y por qué ninguna sobra

| Capa | Dónde | Qué protege |
|---|---|---|
| **Función pura** | `packages/shared/src/calc/*.spec.ts` | la regla: los bordes, los ceros, las fechas imposibles |
| **Cableado** | `apps/web/src/**/*.spec.tsx` (jsdom) | que la pantalla la LLAME y DIBUJE lo que devuelve |
| **Servicio** | `apps/api/src/**/*.spec.ts` | que el endpoint traiga los datos y aplique las guardas |

⚠️ **La capa pura NO alcanza, y está medido.** Borrar del JSX la línea que
dibuja el pie del KPI de Gastos tumba **8 tests de pantalla y CERO de función
pura**; borrar la nota de la fila de Compras tumba **9 y cero**. Con las nueve
ramas de la función cubiertas, nadie se enteraba. Si un cambio se ve en una
pantalla, tiene un `.spec.tsx` o no está probado.

### La prueba de que un test sirve: romperlo a propósito

Un test que no falla cuando rompés lo que dice probar **no prueba nada**, y en
este repo eso pasó muchas veces. Después de escribir un test:

1. Rompé la lógica a propósito (invertí una condición, borrá una guarda, sacá
   la línea del JSX).
2. Mirá **cuántos** tests caen.
3. Restaurá **desde una copia hecha con `cp`**. ⚠️ **Nunca con
   `git checkout --`**: borra todo el trabajo sin commitear.

⚠️ **La mutación tiene que COMPILAR.** Si al romper algo el resultado es
«0 tests» o «NO COMPILA», no mediste nada: eso es un verde falso. Pasó el
2026-10-11 al mutar `QUEDA_PLATA` —la constante quedaba sin usar, TypeScript se
quejaba y la suite ni arrancaba—. La forma segura es `(false as boolean) && …`
o `X - X`, que compilan y sí cambian el comportamiento.

⚠️ **Si una mutación tumba MENOS de lo que esperabas, sospechá del código antes
que del test.** Así se encontraron ~8 guardas muertas y un `Map` de agrupación
que no hacía nada (`Σ monto × (saldo ÷ total)` da lo mismo agrupado que suelto).
**Código muerto donde se decide plata es peor que no tenerlo: parece una
guarda.**

⚠️ **Y la mutación en sí puede estar mal hecha.** El 2026-10-12, una mutación
insertó `if (false) continue;` *antes* del `continue` de verdad: no mutaba nada
y el resultado («nadie la caza») era mentira. Si una mutación da 0, revisá
primero que de verdad cambie el comportamiento.

⚠️ **MUTAR `packages/shared/src` Y CORRER UN TEST DE `apps/api` NO PRUEBA NADA
SIN RECOMPILAR** (2026-11-12). La API no consume la fuente de `shared`: consume
su **build** (`dist/cjs`). Así que la mutación se escribe, el test corre, pasa
**verde**, y la conclusión que uno saca —«el test no tiene dientes»— es falsa:
la mutación nunca llegó al código que se ejecutó. Medido ese día sobre
`abono.audit.spec.ts`: sin recompilar daba 3/3 en verde con la guarda apagada;
recompilando (`npx tsc -p tsconfig.json` en `packages/shared`) **tumba 1**.
- Es el **espejo del verde falso**: ahí la mutación no compila y parece que el
  test aguanta; acá compila, no se aplica, y parece que el test no sirve. Los
  dos terminan en una afirmación inventada sobre la calidad de un test.
- La regla práctica: **mutá en la capa donde corre el test**. Un test de
  `shared` se muta en `shared/src` y se corre con el jest de `shared` (lee la
  fuente, no hace falta build). Un test de `apps/api` que ejercita un contrato
  de `shared` exige **recompilar entre mutar y correr, y otra vez al restaurar**.
- Verificá que la mutación llegó: `grep` el texto mutado **en `dist/cjs`**, no
  en el `.ts`. Si no está ahí, lo que medís es el build viejo.

### Medir, no suponer — y creerle a la foto

Tres veces en dos días la medición por código dijo lo contrario de la realidad:

- **`getComputedStyle` durante una transición devuelve el valor viejo.** Decía
  que la casilla seguía en colores claros estando en tema oscuro; la captura
  mostraba el anillo dorado perfecto. **Le creímos a la captura.**
- **`.focus()` entra igual en un elemento con `tabIndex={-1}`**, al que nadie
  llega con Tab. Un test que solo hace `.focus()` no prueba "se llega por
  teclado": hay que comprobar `tabIndex >= 0`.
- **`NumberTicker` sin compositar congela la animación** y los cuatro KPIs se
  leen bajos en la misma proporción (mostró $43.93 donde había $217.00). Al
  medir números renderizados, **traer la pestaña al frente**.

Y al revés: antes de "mejorar" algo, medilo. El anillo de foco del Checkbox
parecía flojo; medido contra su color adyacente real daba **7.78** sobre un
mínimo de 3.0, y las dos alternativas lo **empeoraban** a 4.72 y 4.20. **No se
tocó, y los números quedaron escritos** para que nadie repita la medición.

Lo mismo con los umbrales: `DIAS_ENTREGA_PROXIMA = 3` salió de medir el plazo
real entre cargar y entregar un encargo (4-5 días). **Un número en un `if` sin
de dónde salió es una opinión disfrazada de regla.**

### Que una AUSENCIA signifique algo

Un `queryByText(...)` corrido antes de que llegue la respuesta no encuentra el
aviso **porque todavía no hay datos**, no porque la regla lo apague: el test
pasa sin probar nada. Lo destapó una mutación (borrar la guarda de "ningún mes
cerrado todavía" no tumbaba un solo test de pantalla).

El patrón que lo arregla es la **"puerta"** de `Dashboard.avisos.spec.tsx`: las
respuestas quedan bloqueadas hasta que el test las suelta, y recién entonces se
mide. Si tu test afirma que algo **no** está, necesita la puerta.

### Los dos topes anidados de los tests de pantalla (2026-10-19)

⚠️ **Hay DOS límites de tiempo y hay que mover los dos, con interior < exterior:**

| | Dónde | Hoy |
|---|---|---|
| interior: cuánto espera un `findBy*` | `asyncUtilTimeout` en `apps/web/src/test/setup-dom.ts` | 5 s |
| exterior: cuánto dura el test | `testTimeout` del proyecto `dom` en `vitest.config.ts` | 20 s |

Romper la regla deja la suite rota de dos maneras distintas, y **las dos se
vieron**: con el interior en 1 s (el default) los tests fallaban **al azar** con
"no encuentro el elemento"; subiendo solo el interior a 5 s —con el exterior
también en 5— pasaron a fallar **siempre tres** con "Test timed out". El primer
arreglo que se intentó fue subir solo el exterior y **no movió la aguja**.

> **La lección general: cuando un arreglo "obvio" no cambia nada, el problema es
> el diagnóstico.** El mensaje lo decía desde el principio — no era "se agotó el
> tiempo del test" sino *"Unable to find an element with the display value"*, o
> sea que la página había dibujado el cascarón y los datos no habían llegado.

⚠️ **Una suite inestable es PEOR que una roja.** Una roja se arregla; una
inestable enseña a volver a correrla hasta que pase, y el día que el rojo sea de
verdad nadie le va a creer. Al arreglar una, no alcanza con una corrida verde:
**correr la suite entera 5 veces seguidas**.

### Los hooks de git (desde el 2026-10-19)

Están **versionados** en `.githooks/` de cada repo activo, así que viajan con el
código. ⚠️ **Hay que activarlos UNA vez por clon** (git no lo hace solo):

```bash
git config core.hooksPath .githooks
```

| Hook | Qué hace | Cuánto tarda |
|---|---|---|
| `pre-commit` | bloquea un `.env` entrando al índice y credenciales pegadas | instantáneo |
| `pre-push` | corre la suite completa del repo | api ~23 s · panel ~37 s · tienda ~2 s |

El reparto es **por velocidad**, y es lo que decide si un hook se usa o se
saltea: un push tolera 30-60 s, un commit no. Correr los tests en cada commit es
exactamente lo que entrena el `--no-verify`.

⚠️ **Corre la suite COMPLETA y no solo la de seguridad.** La regla general dice
"solo la de seguridad" porque una suite completa suele tener specs de andamiaje
rojos que bloquearían todo; acá está verde y entra en el presupuesto. Si algún
día se pone crónicamente roja, lo que hay que arreglar es **la suite**.

⚠️ **El `pre-commit` deja pasar los BORRADOS a propósito** (`--diff-filter=ACM`).
Sacar un `.env` del índice con `git rm --cached` produce una `D`, y es justo la
operación que hay que poder hacer para limpiar un secreto: si el hook la
bloqueara, habría que usar `--no-verify` para arreglarlo.

> ⚠️ **El guard de secretos nació ROTO, y lo destapó PROBARLO, no leerlo.** Usaba
> `grep -v '^\+\+\+'` para saltear la cabecera del diff; en expresiones
> **básicas** `\+` significa "uno o más", así que filtraba **todas** las líneas
> agregadas. El guard miraba un conjunto vacío y dejó pasar una URL de Postgres
> con usuario y contraseña. **Un hook que nunca se vio fallar no protege nada**:
> al montar uno, probá las cuatro rutas (lo que debe bloquear, lo que debe dejar
> pasar, y las dos de cada clase).

### Antes de dar algo por terminado

```
pnpm -r test          # LEYENDO la salida: si el total BAJA sin que falle nada,
pnpm -r lint          # una suite no compiló. Es un verde falso.
pnpm exec tsc --noEmit
pnpm -r build
```

Más la pasada manual: API en **3001** y panel en **5180** (único origen que la
API acepta por CORS), levantados con `preview_start`, **nunca** con Bash.

⚠️ Si el cambio tocó **dinero, auth, DTOs de entrada o endpoints públicos**, la
suite de seguridad tiene que quedar verde antes de terminar.

⚠️ **Si el caso no existe en los datos reales, decilo.** Tres de las cuatro
procedencias de un abono y las cuatro categorías de avisos de encargos tienen
**cero casos en producción**: no hay pantalla donde ir a mirarlos, así que los
tests son la única evidencia de que funcionan. Eso va escrito en el spec, para
que quien los toque sepa que no tiene red.

---

## Respaldar, migrar y revisar producción

⚠️ **Un `git push` a `main` ES un despliegue.** El `Dockerfile` corre
`prisma migrate deploy` al arrancar el contenedor: el push aplica solo todas las
migraciones pendientes contra Railway. **Por eso el respaldo va antes del push**,
no antes de un `migrate deploy` manual — para cuando alguien fuera a correrlo a
mano, el deploy ya lo disparó.

### 1. Respaldo, antes del push

`pg_dump` está en `C:\Program Files\PostgreSQL\18\bin\` (fuera del PATH). La URL
de producción vive como `DATABASE_URL_PROD` en `apps/api/.env.production.local`,
que **no se versiona y no se carga solo**.

```bash
"/c/Program Files/PostgreSQL/18/bin/pg_dump.exe" -Fc --no-owner --no-privileges \
  "$DATABASE_URL_PROD" -f "respaldo-$(date +%Y%m%d-%H%M).dump"
```

Se restaura con `pg_restore --single-transaction --exit-on-error`. Así se cargó
Railway el 01/10 desde la local (18 → 17, compatible).

### 2. Migrar

- **Siempre contra la local primero.** Nada de apuntar a producción "para probar
  rápido".
- No-interactivo: `prisma migrate diff ... --script` + `prisma migrate deploy`.
  Usar `pnpm exec prisma`, nunca `npx`.
- ⚠️ **Prohibido contra producción**: `migrate dev`, `migrate reset`,
  `db push --accept-data-loss` y `SEED_DEMO=1 pnpm seed`.
- ⚠️ **Una migración no puede depender de que alguien corra un script entre
  medias.** `migrate deploy` aplica TODAS las pendientes seguidas: una que
  agrega una columna nullable y otra posterior que la endurece con `SET NOT NULL`
  corren juntas, la segunda falla con *"la columna contiene valores null"*, el
  contenedor no arranca y la API queda caída.
- **Avisar al dueño y esperar OK explícito** antes de tocar la base de
  producción, aunque parezca trivial.

### 3. Orden del despliegue

⚠️ **Si cambia la FORMA de la respuesta de la API, se despliega la API PRIMERO**
y se espera a que Railway la levante antes de pushear el panel. Cloudflare
publica en ~1 minuto y Railway tarda más (construye la imagen del `Dockerfile` y
corre `migrate deploy` al arrancar): soltando los dos a la vez, el panel nuevo le
pregunta a la API vieja por un campo que todavía no existe. Al revés es
inofensivo.

Si el cambio no toca el contrato (un refactor interno, algo solo del panel), el
orden da igual — pero decilo, no lo asumas.

### 4. Revisar producción al final

**Verificar por CONTENIDO, no por nombre de archivo.** Dos veces se dio por no
desplegado algo que sí estaba:

```bash
# API: ¿sirve el commit que acabo de pushear?
# ⚠️ Railway desde el 2026-11-05. La URL vieja de Render (`calc3d-api.onrender.com`)
# ya NO existe: ese servicio se borró. Si la ves en algún lado, está vieja.
curl -s https://calc3d-api-production.up.railway.app/api/health
# → {"ok":true,"version":"0.58.0","commit":"4f83ff1"}
#
# ⚠️ **Si NO viene `commit`, esta verificación no sirve** — y el endpoint no
# se queja, porque el campo es opcional. Pasó del 2026-11-05 al 07: el
# controlador leía `RENDER_GIT_COMMIT`, Railway no la inyecta, y `/health`
# devolvió `{ok, ts, version}` a secas durante dos días sin que fallara nada.
# Verificar un despliegue volvió a ser esperar por reloj. Arreglado mirando
# `RAILWAY_GIT_COMMIT_SHA` primero (`health.controller.ts`), con su regresión.
# Si el servicio vuelve a mudarse, el síntoma es este mismo silencio: sumar el
# nombre que inyecte la plataforma nueva a `COMMIT_ENVS`.
#
# ⚠️ **La `version` sola NO distingue un deploy** cuando el cambio no sube
# `SHARED_VERSION` (un fix, un refactor, docs): los dos commits dicen lo mismo.
# Para esos, el `commit` es la ÚNICA señal.

# Panel: el bundle se compila en Cloudflare, así que su HASH NO tiene por qué
# coincidir con el del build local. Comparar hashes da falsos negativos.
IDX=$(curl -s https://calc3d-web.pages.dev/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
# ⚠️ Y el Dashboard va en su PROPIO chunk: buscar el texto nuevo en el index
# principal no lo encuentra aunque esté desplegado.
DASH=$(curl -s "https://calc3d-web.pages.dev/$IDX" | grep -oE 'Dashboard-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://calc3d-web.pages.dev/assets/$DASH" | grep -c "un texto nuevo del cambio"
```

**Y las migraciones aplicadas**, que es lo que el `/health` no dice:

```sql
SELECT migration_name, finished_at, rolled_back_at
  FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;
```

`finished_at` nulo = **migración a medias**: el contenedor no arrancó.
Verificado el 2026-10-19: 60 aplicadas, 0 con problema.

⚠️ **El servicio puede tardar o no tomar el commit, y eso NO se ve desde la
consola.** Si `/health` sigue devolviendo el commit anterior con el nuevo ya en
GitHub, **no es un fallo del cambio**: es el despliegue que no corrió. Lo que
hay que hacer es mirar el log del servicio en el panel (build encolado o
fallido) y, si solo estaba encolado, redesplegar desde ahí. **Eso necesita al
dueño**: nadie lo resuelve con `curl`.

Pasó con Render el 2026-10-12 — 30 minutos sirviendo el anterior, el servicio
respondía bien y no se había perdido nada. Desde el 2026-11-05 el servicio es
**Railway**, donde el equivalente es «Deployments → el último → Redeploy».
Railway construye el `Dockerfile` y recién entonces corre `migrate deploy`: un
build fallido deja la versión ANTERIOR en pie, así que la API sigue respondiendo
—con el código viejo— y el `/health` es la única forma de notarlo.

⚠️ **Los datos de prueba que se crearon para verificar se borran al terminar**,
contando antes y después para dejarlo demostrado.

## Base de datos: local para desarrollar, Railway en producción

**1. Desarrollar y probar SIEMPRE contra la base local.**
- Nada de apuntar a producción "para probar rápido". El `.env` de desarrollo se
  queda con la `DATABASE_URL` local (Postgres 18 en `localhost:5432`, base `calc3d`).
- **Cuenta de pruebas (SOLO local)**: la del `seed` — `dueno@calc3d.local` /
  `calc3d1234` (defaults de `OWNER_EMAIL`/`OWNER_PASSWORD`). Como no hay registro
  público, el seed es la única vía de crear cuentas: si hace falta otra para
  probar algo, créala en la local con el seed o un script. Nunca usar una cuenta
  real de prod, ni probar esta contraseña contra producción.
- Antes de dar una feature por buena: `pnpm test:shared` + prueba manual real
  (API en 3001 + web-preview de `calc3d-web` en 5180).

**2. Solo cuando lo local está probado, subir y migrar a producción.**
- La URL de la base de producción (Railway) **NO se escribe en este archivo ni en
  nada versionado**: vive como `DATABASE_URL_PROD` en
  `apps/api/.env.production.local` (lo cubre el `.gitignore` con `.env.*`; ese
  archivo NO se carga solo).
- ⚠️ **El `Dockerfile` corre `prisma migrate deploy` al arrancar el contenedor**:
  cada push a `main` despliega en Railway y **aplica solo** las migraciones
  pendientes contra Railway. Por eso el backup (`pg_dump`) y el OK explícito del
  dueño van **ANTES del push**, no antes de un `migrate deploy` manual: para
  cuando alguien fuera a correrlo a mano, el deploy ya lo disparó solo.
- ⚠️ **Una migración NO puede depender de que alguien corra un script entre
  medias.** `migrate deploy` aplica **todas** las pendientes seguidas al
  arrancar el contenedor, así que una que agregue una columna nullable y otra
  posterior que la endurezca con `SET NOT NULL` corren juntas: la segunda falla
  con *"la columna contiene valores null"*, el contenedor no arranca y la API
  queda caída. Si hay que rellenar antes de endurecer, el relleno va **en SQL,
  dentro de la misma migración** (ver `20261006130000_caja_not_null`). Lo que
  necesita el motor de cálculo va en un script aparte que escriba solo columnas
  que sigan siendo nullable. Medido contra un clon de la base el 2026-10-05.
- Para probar una migración sin arriesgar la base local:
  `CREATE DATABASE x TEMPLATE calc3d`, aplicarla ahí con
  `psql --single-transaction -v ON_ERROR_STOP=1 -f`, verificar, y borrar el clon.
  ⚠️ Postgres **18** (local) materializa los `NOT NULL` como entradas de
  `pg_constraint` con nombre; **17** (Railway, producción) no. Un
  `RENAME CONSTRAINT` sobre esos nombres anda en local y **revienta en prod**.
- Las migraciones se **generan y commitean en local** (`prisma migrate dev` contra
  la base local). El comando manual de abajo es para los casos **fuera** de un
  deploy normal — verificar `migrate status` contra prod, o aplicar una
  migración sin publicar una imagen nueva — cargando la URL a mano en la sesión
  de PowerShell:
  ```powershell
  $env:DATABASE_URL = ((Get-Content .\apps\api\.env.production.local `
    | Where-Object { $_ -match '^DATABASE_URL_PROD=' }) -replace '^DATABASE_URL_PROD=','').Trim('"')
  pnpm --filter @calc3d/api exec prisma migrate status
  ```
  Esa variable vive solo en esa sesión: cerrá la terminal (o reasigná la URL local)
  al terminar, para no dejarla apuntando a prod sin querer.
- ⚠️ **PowerShell 5.1 se come las comillas dobles** al pasarle SQL a `psql`
  (`"Order"` llega como `Order` y falla). Pasar el SQL por archivo con `-f`.
- **Prohibido contra producción**: `prisma migrate dev`, `migrate reset`,
  `db push --accept-data-loss` y `SEED_DEMO=1 pnpm seed` (el catálogo demo no va a
  prod). El seed normal (dueño + tasas de protección, idempotente) sí, con
  `OWNER_EMAIL`/`OWNER_PASSWORD` reales.
- **Backup antes de cualquier migración que borre o transforme datos**
  (`"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"` contra la URL de Railway).
- Nunca editar una migración ya aplicada en prod: se crea una nueva encima.
- Después de migrar: `prisma migrate status` contra prod limpio y la API de
  producción arrancando (`/api/health`). Verificarlo, no asumirlo.
- Recordar el flujo de migraciones no-interactivo: Prisma no permite `migrate dev`
  con drops sin TTY → generar el SQL con `migrate diff --from-url ... --script`,
  guardarlo como migración y aplicarlo con `migrate deploy`.

**3. Avisar antes de tocar producción.** Migrar, correr scripts o modificar datos
en la base de producción se consulta y se espera OK explícito, aunque parezca trivial.

## Convenciones del motor de cálculo

> Reescrito el **2026-09-06** (shared **0.7.0**) para seguir la hoja "Costeo" del
> Excel de Banano Lab: una pantalla, un filamento, un margen, un precio.
> Es un cambio **ROMPEDOR**; el detalle está en
> `docs/superpowers/specs/2026-09-06-calculadora-una-pantalla-design.md`.

- Porcentajes como **fracción** (0.08 = 8 %, 0.3 = 30 %).
- Costos **"por tanda"** (filamento, desgaste, luz: dependen de los gramos y horas
  de UNA impresión) vs **"por pieza"** (insumos, postprocesado, empaque). NO
  dividir ciegamente entre la cantidad.
- Los datos que aporta el **laminador** (gramos y horas **de la tanda**, piezas por
  tanda) son inputs del `CalcInput`, **no viven en catálogos**.
- `piecesPerBatch` está en la **raíz** del `CalcInput` (default 1). Los costos por
  tanda escalan `× cantidad/piecesPerBatch`; las tandas = `ceil(cantidad/piecesPerBatch)`.
  **Las horas-máquina y la entrega usan placas ENTERAS** (`horas × tandas`, como
  F35/F36 de la hoja desde 2026-10-01, shared 0.18.0): la última impresión corre
  aunque vaya a medias. **El costo NO**: sigue `× cantidad/piecesPerBatch`, igual
  que la hoja (costo de la tanda ÷ piezas); cobrar la placa vacía sería sobrecotizar.
- **Un solo filamento** (`filament`) y **una sola tabla de insumos** (`supplies`,
  con `qty` POR PIEZA y `unitCost` ya resuelto). **No hay prorrateo por paquete.**
- **Postprocesado** (`labor`): minutos POR PIEZA × valor de la hora.
- **`extras`**: `packagingPerPiece` (por pieza) y `otherPerOrder` (una vez por
  pedido, se reparte entre las unidades). Reemplazan a los recargos eliminados.
- **Merma** (`waste.pct`, default 8 %): SIEMPRE sobre filamento + desgaste + luz,
  sin selector. Una impresión fallida gasta material, máquina y luz; no gasta tu
  postprocesado ni el empaque, que todavía no invertiste.
- El desglose (`breakdown`) muestra cada categoría EN CRUDO y la merma como
  línea aparte (`wasteAmount`), de modo que las líneas sumen el costo del lote.
- **Un solo margen objetivo** (`margins.markup`) → `price.suggested` →
  `price.rounded` → `price.final`. `manualPrice` pisa al redondeado.
- **`price.status`** es el semáforo (`LOSS`/`LOW`/`BELOW_TARGET`/`OK`) con el piso
  `LOW_MARGIN_THRESHOLD = 0.6` exportado de shared. No re-implementarlo en la UI.
- **Mayoreo por DESCUENTO** sobre el precio final (`discountPct`), no por markup:
  el descuento se aplica y **después** se redondea. (Deroga la regla anterior.)
- **Sugerir y leer tramos** (`calc/wholesale.ts`, shared 0.10.0): `tierRanges`
  ordena los tramos, deriva `maxQty` (null = "o más") y marca `FROM_ONE` /
  `DUPLICATE_QTY` / `NO_BETTER`. `suggestTiers(input)` busca el mayor descuento
  entero que el piso de margen permite y lo reparte en tres escalones (una,
  dos y cinco tandas; con una pieza por tanda, desde 5 u).
  ⚠️ **No tiene fórmula de margen propia: le pregunta a `calculateQuote`**
  (búsqueda binaria + confirmación final). `price.final` y `costPerUnit` salen
  redondeados a 4 dp y el motor calcula a precisión completa: una cuenta
  paralela con esos valores podía proponer, justo en el límite, un tramo que la
  misma pantalla pinta de rojo. Tests: `wholesale.spec.ts`, incluido pasar lo
  sugerido por el motor con tres redondeos.
- **`parallelPrinters`** solo divide `production.deliveryHours`. NUNCA el costo:
  dos impresoras 5 h gastan 10 horas-máquina de desgaste igual.
- **`order` es la fuente ÚNICA del precio que se COBRA**: si el pedido alcanza un
  tramo de mayoreo, `order.unitPrice` es el del tramo (y `listUnitPrice` guarda
  el de lista, `discountPct` el descuento). El panel, la cotización del cliente y
  `/sales/from-quote` leen ESE campo — si cada uno lo dedujera por su cuenta,
  dirían cifras distintas. `price` sigue siendo el precio de lista.
  ⚠️ **`wholesale.orderTotal`/`orderProfit` los PISA `calculateQuote`** con los
  del pedido (2026-10-02, shared 0.19.0). Se calculaban aparte y divergían: con
  precio manual $7,30 y redondeo "arriba a 0,50", el panel decía **$73** y la
  tarjeta de mayoreo **$75** en la misma pantalla, porque `buildWholesale`
  re-redondeaba el precio **aunque el descuento fuera 0 %**. Ahora un tramo de
  0 % ES el precio de lista y no se vuelve a redondear.
  ⚠️ **Un tramo que la cantidad NO alcanza no se aplica.** `buildWholesale` caía
  a `?? sorted[0]`, así que un pedido de 1 pieza se cobraba con el descuento del
  tramo de 12: regalaba margen sin que nadie lo pidiera. Sin tramo alcanzado,
  `appliedTier` es **null**.
- **RECARGO ≠ MARGEN** (2026-10-02, shared 0.19.0). `markup`, `marginReal` y
  `minMarginPct` son los tres **recargo sobre el COSTO**, no margen sobre venta:
  un recargo del 100 % es un margen del 50 %, y el piso de 60 % protege en
  realidad un 37,5 % sobre venta. Los nombres internos se conservan (viajan en
  el contrato y los leen panel y PDF), pero el motor expone además
  **`marginOnSale`** = (precio − costo) ÷ precio en `price`, `order`, cada tramo
  de mayoreo y cada opción del comparador. La UI nombra "recargo" a lo que es
  recargo y muestra el margen aparte.
- **El piso de margen es configurable**: `margins.minMarginPct` (default
  `LOW_MARGIN_THRESHOLD` = 0.6) ⇄ `Settings.minMarginPct`. Bajo ese margen el
  estado es `LOW`; la UI lo marca en ROJO y avisa, pero **no bloquea la venta**.
  El piso es INCLUSIVO: quedar justo en él es `BELOW_TARGET`, no `LOW`.
- **`Settings` acompañó el cambio** (migraciones `settings_margen_unico` y
  `settings_piso_margen`):
  `defaultMargins Float[]` → **`defaultMarkup Float`** (default 1.0), y se
  eliminaron `marginMode`, `wasteAppliesTo` y `componentProrationMode`.
- Al re-resolver un insumo contra el catálogo (`products`), el costo por unidad
  es `packagePrice / unitsPerPackage`: el catálogo guarda el PAQUETE y el motor
  usa la unidad. Copiar el precio del paquete pondría cada argolla a $50.
- Dinero con decimal.js; salidas redondeadas a 4 dp (sub-centavo). El redondeo de
  presentación vive en `price.rounded` y en `roundingOptions` (las 5 opciones del
  comparador; `DOWN` queda fuera a propósito: regala margen).

## Decisiones de diseño
- Los **presupuestos** guardan un **snapshot JSON** del `CalcInput` + `totals`
  (integridad histórica de precios), en vez de tablas-línea normalizadas.
- Default moneda/locale USD/en-US (configurable por organización en Settings).
- IVA/impuestos: campo `taxPercent` reservado en DB, **sin UI** (fase 2).

### Venta atribuida a una campaña: `Campaign.attributedSales` (2026-10-04, shared 0.20.0)

La hoja `Publicidad` del Excel tiene una columna **"Venta atribuida ($)"**: de lo
que YA se vendió, cuánto se le rastrea a esa campaña. **No es facturación** — el
Excel nunca la suma a `Resumen!B3`, que es solo `SUM(Ventas!B11:BA11)`.

- Vive en **`Campaign.attributedSales`** (Decimal, default 0), NO como `Sale` ni
  como `Order`. Lo vendido de una campaña sale de `campaignRevenue()`:
  `salesTotal + ordersTotal + attributedSales`.
- ⚠️ **No la registres como pedido.** Entre el 2026-10-02 y el 2026-10-04 se la
  guardó como 5 pedidos de un cliente ficticio ("Varios (historico sin
  detalle)") porque `Campaign` no tenía dónde ponerla. El ingreso de
  `printers.recovery()` es `Sale + Order`, así que esos pedidos entraron como
  facturación: la **Reposición de los equipos** decía $431,08 de $1.532 cuando
  el Excel decía $0 (acumulado real: −$57,42). Los 5 pedidos se borraron y los
  montos pasaron al campo nuevo.
- `campaignHealth` / `campaignRecommendation` miran **`revenue`**, no solo
  `sales`/`orders`: una campaña vieja con atribución declarada no tiene filas de
  venta y aun así vendió. Sin eso se pintaba "Sin datos" al lado de "ROAS 10,04×".
- Al comparar la app con el Excel, ojo con **cómo** está armada cada hoja: en
  `Ventas`, hasta agosto la fila 11 son números escritos a mano, y **desde
  septiembre es una fórmula** que suma las filas auxiliares más los encargos de
  esa semana. Los montos diarios de mostrador viven como **texto**
  (`"Sábado 3: 6.25$"`) en las filas 3-9 y las auxiliares los parsean. El libro
  **no trae valores cacheados**, así que `data_only=True` devuelve vacío y sumar
  las auxiliares da 0: hay que parsear el texto. Por no hacerlo, el acumulado del
  Excel se calculó mal dos veces el 2026-10-04.

### El Excel es RESPALDO; la app manda (decisión del 2026-10-04)

El dueño decidió que la fuente de verdad es la app y `bananolab.xlsx` queda solo
como respaldo. **Ya no se sincroniza Excel → app.**

- `prisma/sincronizar-hojas.mjs` y `prisma/sincronizar-excel.mjs` **se borraron**
  ese día. Eran de la etapa de migración; correrlos ahora pisaría datos que solo
  existen en la app. Lo que la doc de `docs/excel-vs-app.md` y
  `docs/backlog-migracion.md` cuenta sobre ellos es **historia**, no instrucciones.
- El respaldo se genera **desde la app**: Configuración → Datos → "Descargar
  reporte en Excel". El libro es la SALIDA, no la entrada.
- Desfase conocido y aceptado al cerrar la decisión: Excel 2.530,48 vendido vs
  app 2.506,98 — **23,50, íntegro en febrero–agosto** (residuo de la migración).
  De septiembre en adelante los dos coinciden al centavo.
- Si aparece un `.xlsx` editado a mano, **no sincronizarlo: preguntar primero.**

### Cuánto vale el filamento que queda (2026-11-01, shared 0.62.0)

El dueño quería ver, al cerrar el inventario del mes, **cuánto es eso en
dinero**. La cuenta vive en `packages/shared/src/calc/valor-inventario.ts` y
`FilamentService.summary()` la cablea; se muestra en `/filament` (pestaña
Stock del mes), debajo de las métricas del mes cerrado.

**La convención, elegida por el dueño sobre números medidos:** sellado 100 %,
en uso 50 %, por acabarse 12.5 % (`FRACCIONES_DE_ROLLO`). El 12.5 no es a ojo:
`running` es "menos de un cuarto", y 0.125 es el punto medio de 0–0.25.

⚠️ **La convención NO es un detalle: decide el número entero.** Medido sobre
el inventario real de septiembre (28 rollos: 4 sellados, 16 en uso, 8 por
acabarse): solo sellados $90.91 · 100/50/12.5 **$266.35** · todo completo
$565.91. Un factor de 6×, porque el 86 % de los rollos está abierto. Por eso
la tarjeta muestra **el desglose y el rango (piso–techo)** y no un número
pelado: sin eso, una estimación se lee como una medición.

**Dos límites honestos, escritos en la propia pantalla:**
- El precio es el de la **última compra** (`Material.rollPrice`), o sea **costo
  de reposición**, no lo que se pagó. No es valuación contable histórica.
- El conteo **no sabe gramos**. Ningún porcentaje lo convierte en medición.

**Reglas que el cableado tiene que respetar (las tres tienen test):**
1. **Un mes ABIERTO no da plata.** `summary()` ya vacía `actual` si no está
   cerrado, así que el valor sale 0 sin ningún caso aparte. Mostrar plata de un
   conteo a medio hacer es justo lo que el cierre mensual existe para evitar.
2. **Una ficha que nunca se compró no se valora.** `rollPrice` existe aunque la
   ficha se haya dado de alta a mano: usarlo inventaría plata. Esos rollos se
   cuentan aparte en `valor.sinPrecio` ("un default no es un dato").
3. El dinero se suma con **decimal.js** (`D`/`sum`/`toMoney`), no con floats.

⚠️ **Al verificar contra la pantalla local, ojo con qué base se está mirando.**
La medición con `prod.mjs` dio $266.35 y el panel local mostraba $264.47: NO
era un bug de dos caminos que no cuadran, era que la copia local es del 01/10 y
tiene otros precios de última compra. Confirmado corriendo `summary()` contra
cada base: local $264.4707 (= la pantalla), producción $266.3457 (= el script).
Antes de cazar un bug de cálculo, comprobar que los dos lados leen la MISMA base.

⚠️ **Un test que depende del calendario se rompe solo.**
`StockTab.sugerencia.spec.tsx` se puso rojo el 2026-11-01 sin que nadie lo
tocara: esperaba la palabra "octubre" y el mes sale de `currentMonthKey()`, o
sea del reloj. Se arregló fijando la fecha (`vi.setSystemTime`). Lo nuevo que
dependa de "hoy" tiene que fijar la fecha o no dice nada del código.

### El código es NUESTRO; el número es del PROVEEDOR (2026-11-01, shared 0.62.0)

Hasta acá la única identidad de una compra era `reference`, que es **el número
que le pone el proveedor**. El dueño lo señaló: *"el CIAM puede ser 003, pero
si el proveedor le vendió a otra persona, de pronto no es igual"*. Tenía razón
y ya dolía: la compra del Cyan figuraba **"(sin número)"** —sin nombre, no se
podía ni nombrar— y `A-001` (apartados) y `0003` (recibos) son dos
numeraciones distintas **del mismo** proveedor.

- **`PurchaseInvoice.code`**: correlativo por organización, lo asigna el
  servidor, no cambia. Se muestra con `codigoDeCompra` → `C-0001`. Mismo patrón
  que `Order.code`, que ya existía: los pedidos tenían número propio y las
  compras no, una asimetría sin razón.
- **`reference` queda como lo que siempre fue**: el número del proveedor, para
  cruzar su estado de cuenta. En pantalla dice "N.º del proveedor". **No se
  renombró la columna a propósito** (13 archivos + el contrato + el front):
  el comentario del schema y la etiqueta de la UI alcanzan.
- **`code` NO viaja en el DTO de alta**, y hay test de contrato que lo fija: es
  identidad, y desde el body se podría pisar el correlativo de otra compra.

**Dos UNIQUE, y el segundo tiene una sutileza:**
`@@unique([organizationId, code])` y `@@unique([organizationId, supplierId, reference])`.
El segundo bloquea cargar dos veces la misma factura del mismo proveedor — el
error que el 2026-11-01 hubo que cazar a mano contra el estado de cuenta.
⚠️ **Postgres trata los NULL como distintos**, así que varias compras SIN
número del proveedor conviven sin chocar: es lo que se quiere, porque "sin
papel" no es "número repetido". Comprobado con SQL sobre una copia de
producción: repetir `A-001` falla, dos `NULL` entran, repetir el `code` falla.

**Sin proveedor no hay bloqueo**, y es correcto: el número "0003" no identifica
nada si no se sabe de quién es la factura.

⚠️ **La migración rellena datos, así que se ENSAYÓ contra una copia de
producción** y no solo contra la base local — que no tenía ni una factura, o
sea que el `UPDATE ... ROW_NUMBER()` no se habría ejercitado. El ensayo:
restaurar el último `pg_dump` en una base `calc3d_ensayo`, correr
`prisma migrate deploy` ahí, comprobar los códigos y **borrar la base**.
Resultado: 5 facturas, C-0001 a C-0005 en orden de compra, sin huecos ni nulos.
El `ORDER BY "date", "createdAt", "id"` es un orden TOTAL a propósito: sin el
desempate, dos facturas del mismo día podrían intercambiarse los códigos.

⚠️ **Dos verdes falsos que encontraron las mutaciones, los dos en el MOCK:**
1. `purchaseInvoice.findFirst` ignoraba el `orderBy`, así que el test del
   correlativo habría pasado aunque el servicio pidiera el orden al revés.
2. `coincide` comparaba `{ not: x }` con `===`, que no casa nunca: un `where`
   con `not` no encontraba NADA y el test de "no se rechaza contra sí misma"
   pasaba **sin probar nada**. El mock tiene que MODELAR la base, operadores
   incluidos.

⚠️ **`vitest` no chequea tipos; `tsc` sí.** Agregar `code` al contrato dejó
`Purchases.abonar.spec.tsx` roto y los 258 tests siguieron en verde: lo cantó
`pnpm -r build`. Un cambio de contrato no está verificado hasta correr el build.

## R2 y la tienda, configurados en producción (2026-11-07)

Hasta este día `GET /api/public/store/info` respondía **503 "La tienda no está
configurada"**: faltaban sus variables en Railway. Comprar el dominio no
alcanzaba. Verificado al terminar: `storageReady: true` y el catálogo en 200.

⚠️ **Los valores NO se escriben acá: este repo es PÚBLICO.** Van en Railway y
se leen desde ahí. Lo que sigue es **de dónde sale cada uno**:

| Variable | De dónde sale |
|---|---|
| `STORE_ORGANIZATION_ID` | el `id` de la única `Organization` de la base |
| `STORE_ORIGIN` | el dominio de la tienda, **exacto y sin barra final** |
| `R2_ACCOUNT_ID` | del "S3 API" del bucket: `https://<ESTO>.r2.cloudflarestorage.com/...` |
| `R2_BUCKET` | el nombre del bucket (`banano-lab`) |
| `R2_PUBLIC_URL` | el dominio público del bucket, sin barra final |
| `R2_ACCESS_KEY_ID` | del token de R2 |
| `R2_SECRET_ACCESS_KEY` | ídem (se muestra **una sola vez**) |

### ⚠️ LA POLÍTICA CORS DEL BUCKET ES OBLIGATORIA, y no es evidente

**El navegador sube el archivo DIRECTO al bucket**, con un `PUT` a la URL
firmada (así la foto no pasa por la API). Eso es cross-origin, así que **el
bucket necesita su propia política CORS** — que no tiene nada que ver con el
CORS de la API. Sin ella **no se puede subir ni una foto**, y el error del
navegador **no menciona CORS ni el bucket**.

Los orígenes que hacen falta son **dos reales**, y olvidar uno rompe la mitad:
- el **panel** (sube las fotos de los productos),
- la **tienda** (sube la foto que el cliente adjunta a su pedido).

Más `localhost:5180` y `localhost:5182` para poder probar en local. Método
`PUT` solamente: todo lo demás pasa por la API. **`GET` no hace falta**, las
fotos se muestran con `<img src>` y eso no pasa por CORS.

### El token de R2: tres credenciales y solo DOS van

⚠️ Cloudflare muestra **tres** cosas al crear el token y es fácil pegar la
equivocada: el **"Valor del token" (`cfat_...`) NO se usa** — es para la API de
administración de Cloudflare. Las que van son el **Access Key ID** y el
**Secret Access Key**, las credenciales S3.

- **Token de cuenta, no de usuario.** El de usuario se desactiva si esa cuenta
  se desvincula de la organización: la tienda se quedaría sin fotos sin que
  nada lo explique.
- **Permiso "Lectura y escritura de objetos"**, NO administrador. La app nunca
  crea ni borra buckets; con el permiso de administrador, un token filtrado se
  lleva el bucket entero y no solo las fotos.
- **Limitado a ESE bucket**, no "todos los de la cuenta": si no, cualquier
  bucket futuro queda alcanzable con una credencial que vive en una variable
  de entorno.

### ⚠️ `r2.dev` NO es para producción (lo dice Cloudflare en su propia pantalla)

*"Esta URL tiene una tasa limitada y no se recomienda para producción. Las
funciones como Access y Caching no están disponibles."* Sin caché, cada
visitante va al origen, y con límite de tasa las fotos empiezan a fallar **justo
cuando hay visitas**. Sirve para probar; antes de difundir la tienda va un
**dominio personalizado** (`fotos.<dominio>`), conectado desde R2.

✅ **Cambiar de dominio es cambiar UNA variable**: `StoreImage` guarda **la
clave del objeto, no la URL** (decisión vieja, ver "Fotos en Cloudflare R2").
Las fotos subidas con `r2.dev` siguen funcionando con el dominio nuevo.

### ⚠️ El orden importa: la API ANTES que el build de la tienda

El build de `calc3d-landing` prerenderiza **pegándole a la API**. Si corre antes
de que la API tenga `STORE_ORGANIZATION_ID`, **falla con 503** — a propósito,
para no publicar un catálogo vacío. Primero las variables de Railway, después
el build.

### Cómo se verificó (y qué verificar si alguna vez se rehace)

No alcanza con que el panel pueda subir: hay que comprobar que **un origen
ajeno NO pueda**. Un preflight `OPTIONS` al bucket con un `Origin` inventado
tiene que devolver **403**; con el del panel y el de la tienda, **204** con su
`Access-Control-Allow-Origin`. Lo demás: `storageReady: true` en
`/public/store/info`, el catálogo en 200 y el dominio público devolviendo
**404** para un archivo inexistente (404 = el dominio vive).

### Cambiar una foto: se AGREGA y se BORRA, no se actualiza

Pregunta del dueño, respondida leyendo el código: **no hay endpoint de
reemplazo**. La clave lleva un `randomUUID()`
(`{org}/store/{productId}/{uuid}.{ext}`), así que **ninguna subida pisa a otra
nunca**. Para cambiar una foto se sube la nueva y se borra la vieja; el borrado
sí elimina el objeto del bucket (mejor esfuerzo). La **primera foto es la
portada**, así que borrar esa promueve a la siguiente. El **logo del negocio**
es el único que sí se reemplaza: vive en la base, no en R2.

## Auditoría de seguridad del 2026-11-05 (antes de abrir el dominio)

Pasada adversarial completa antes de publicar la tienda con dominio propio: el
Nivel 2 que pide el CLAUDE.md global cuando un cambio abre superficie.

### ⚠️ EL HALLAZGO: el tope por IP vale el DOBLE (y lo primero que se dijo era falso)

**Se diagnosticó mal dos veces antes de acertar, y las dos correcciones valen
más que el hallazgo**, porque las dos salieron de volver a medir:

1. Primero se reportó que **el login no cortaba nunca** y que eso lo dejaba "a
   fuerza bruta sin freno". **Falso, y exagerado.** La medición era real (13
   seguidos y 15 en paralelo sin un solo 429) pero el volumen era corto:
   **50 en paralelo bloquean 44**. El limitador funciona.
2. Después se culpó a **`TRUST_PROXY`**. También falso: su valor es `1`, que es
   el correcto, y repetir la prueba tras parchear `proxy-addr` dio **lo mismo**.

**Lo que de verdad pasa, medido:** 26 intentos seguidos cortan recién en el
**17**, y consistentemente desde el 21. Con UNA instancia habrían cortado en el
11; con TRES, en ninguno. O sea **dos instancias**, cada una con su contador
**en memoria**: el tope real es `limit × instancias`. Las 24 consultas al health
devolvieron la MISMA versión, así que no es un despliegue viejo conviviendo.

- **Severidad real: MEDIA, no alta.** 20 intentos por minuto contra una
  contraseña decente son 28.800 al día: irrelevante. El informe que decía
  "fuerza bruta sin freno" exageraba.
- **Arreglo aplicado**: `TIGHT` bajó de 10 a **5**, así el efectivo vuelve a ser
  el que el código pretende. La medición quedó escrita al lado de la constante.
- **No lo arregla ninguna variable de entorno.** Mientras el contador sea en
  memoria, el tope se multiplica por las instancias. El arreglo de fondo es un
  almacén compartido (Redis), que hoy no se justifica. ⚠️ **Si Railway escala a
  más instancias, este número se queda corto otra vez.**

⚠️ **La lección de método, que es lo que hay que recordar:** las tres
mediciones eran correctas y las tres conclusiones distintas. Un limitador no se
prueba con el volumen justo — con 13 intentos contra un tope de 10 no se
distingue "no funciona" de "funciona y está repartido" —. **Hay que barrer el
volumen hasta que corte y mirar DÓNDE corta**: ese número es el que dice
cuántos contadores hay, y es el único que distingue las hipótesis.

### Lo que se arregló ese día

- **`overrides` de dependencias** en `pnpm-workspace.yaml` (NO en `package.json`:
  desde pnpm 11 ese campo **se ignora en silencio**, solo lo delata un WARN).
  De **34 vulnerabilidades (1 crítica, 19 altas) a 6**, todas las restantes
  con parche solo en la **major siguiente**.
  - La crítica era **`proxy-addr`** (falsear la IP de origen): justo la pieza de
    la que depende el limitador del hallazgo de arriba.
  - ⚠️ **Todos se quedan DENTRO de su major, a propósito**: un salto de major
    en una dependencia indirecta rompe en ejecución **sin que los tests lo
    noten**. Quedan fuera `uuid` (8→11, lo pide `exceljs` y rompería el reporte
    en Excel), `file-type` (20→21) y `deepmerge-ts` (7→8).
  - ⚠️ Los tests **no ejercitan el stack HTTP**, así que después de mover
    `multer`, `qs` y `body-parser` hay que **arrancar la API de verdad**: login
    correcto (201) y el limitador cortando en el 10.º
- **`helmet` en `main.ts`** + `disable('x-powered-by')`. Antes la API no mandaba
  **ninguna** cabecera de seguridad y anunciaba su stack.
  - ⚠️ **`crossOriginResourcePolicy` va en `cross-origin`**: el default de
    helmet (`same-origin`) **rompe las descargas** del panel (Excel, CSV, PDF),
    que vive en otro origen. Verificado con una descarga real de 1,2 MB.
- **`common/guard-de-controllers.audit.spec.ts`**: falla si un controller nuevo
  nace sin `JwtAuthGuard`, y exige que **todo público tenga rate limiting**. La
  autenticación acá es *opt-in* (no hay guard global), así que lo nuevo nace
  abierto y nada avisa.
  - ⚠️ **El primer intento reportó 7 falsos positivos** y el número delató al
    instrumento: la expresión regular iba del `@Controller` al `export class`,
    y **el `@UseGuards` suele ir ARRIBA**. Se recorre línea por línea.
  - ⚠️ Se analiza **por controller y no por archivo**: hay archivos con dos
    (uno público y uno de panel), y mirar el archivo entero da por protegido al
    público porque su vecino tiene guard.

### Lo que se midió y estaba BIEN (no romperlo)

Secreto de firma sin respaldo en código (con su test), aislamiento multi-tenant
auditado, **el precio no viaja en el pedido**, subidas acotadas (PNG/JPEG/WebP,
5 MB, con confirmación contra el almacenamiento), **topes en todos los campos
públicos** + body de 2 MB (que es lo que mitiga el DoS de Zod en la práctica),
y `ProxyThrottlerGuard`, que se niega a confiar en cabeceras falsificables sin
proxy configurado.

### Parches del cierre (mismo día)

- **Tope de opciones por renglón** (shared 0.63.0, `STORE_MAX_OPTION_GROUPS`).
  Cada opción ya estaba acotada en LARGO pero no en CANTIDAD: con el cuerpo de
  2 MB entraban miles de pares, y validarlos es trabajo que un visitante sin
  cuenta le podía pedir al servidor.
  - ⚠️ **El tope NO se eligió a ojo**: es el mismo que ya limitaba los grupos de
    una ficha (10, que estaba inline en `store.ts` y ahora es constante). No
    puede haber más opciones elegidas que grupos donde elegirlas. Medido en
    producción ese día: la ficha con más grupos tiene **2**.
  - ⚠️ La constante va al **PRINCIPIO de `store.ts`**: declarada más abajo,
    `optionGroups` no podía usarla (TDZ al cargar el módulo) y el build fallaba.
    Es la misma trampa que obligó a subir `FECHA` en `api.ts`.

### Lo que la auditoría destapó de paso: la tienda NO está configurada

`GET /api/public/store/info` en producción responde **503 "La tienda no está
configurada"** y `/products` devuelve 0. Faltan sus variables en Railway
(`STORE_ORGANIZATION_ID`, `STORE_ORIGIN` y las `R2_*`). **Comprar el dominio no
alcanza**: sin eso la tienda no sirve nada y las fotos no tienen dónde vivir.

### Pendiente, con su motivo

- **`TRUST_PROXY` en Railway**: el hallazgo de arriba.
- **Content-Security-Policy** en el panel y la tienda: hay que inventariar
  orígenes (fuentes de Google, la API, R2) y mal puesto **no avisa**, solo deja
  la pantalla en blanco o las fotos vacías. Tiene su propio trabajo.
- **Zod 3→4 y Nest 10→11**: migraciones con cambios incompatibles, y Zod es el
  contrato entre el panel y la API. No es algo para la víspera de publicar.
- **`STORE_ORIGIN`** con el dominio nuevo, exacto y sin barra final.


## La tanda del 2026-11-07 (shared 0.64.0)

Diez cambios pedidos por el dueño en una sola pasada; acá queda lo del backend
y lo del motor. El resto vive en el CLAUDE.md de `calc3d-web`.

### UN ABONO COBRADO EN OTRA MONEDA (migración `20261107120000_abono_en_su_moneda`)

El cliente paga en bolívares y el dueño anota los bolívares y **la tasa a la
que cobró**; el servidor deriva el USD, que sigue siendo la base de todo.

- ⚠️ **EL USD NO SE ACEPTA DEL CLIENTE.** `PaymentCreateSchema` tiene dos
  caminos y el refine los mantiene separados: en USD viaja `amount` y ninguno
  de los tres campos de moneda; en otra moneda viajan `currencyLabel` + `rate`
  + `amountForeign` y **`amount` está PROHIBIDO**. Prohibirlo —en vez de
  ignorarlo— es lo que convierte un intento en un 400 visible y no en un dato
  descartado en silencio. Es la misma regla que `costAtPublish` en la tienda y
  el monto de una recepción.
- ⚠️ **LA TASA ES «MONEDA DESTINO POR 1 USD»: se DIVIDE.** Bs 1.900 a 250 son
  $7,60; multiplicando darían 475.000. La cuenta vive en
  `usdDesdeMoneda` (`shared/calc/abono-en-moneda.ts`), con decimal.js, y lanza
  con tasa ≤ 0 en vez de devolver infinito.
- ⚠️ **La tasa que se guarda es LA DEL ABONO, no la vigente.** Antes
  `addPayment` le pegaba al abono la tasa vigente de la moneda del pedido al
  momento de guardar: un cobro a otra tasa quedaba registrado con una que
  nunca se usó. La moneda SÍ se valida contra las tasas cargadas (de ahí sale
  el `currencyCode`); si ya no existe, corta **antes de escribir**.
- **`Payment.amountForeign`** guarda los bolívares EXACTOS que se escribieron.
  No es redundante con `amount × rate`: el USD se deriva dividiendo y se
  recorta a 4 decimales, así que reconstruir los bolívares devuelve 1.899,9999
  donde el cliente pagó 1.900. Uno es el número del recibo, el otro el del
  negocio.
- ⚠️ La columna es **NULLABLE y sin DEFAULT**: los abonos que ya existen se
  cobraron en USD o con la tasa congelada del pedido y ninguno tiene este dato.
  Un default los haría afirmar un monto que nadie registró — la lección de
  `paidBy`.
- **Pasarse del saldo NO se bloquea**: con diferencia cambiaria pasarse unos
  centavos es el caso real, y trabar ahí sería trabar justo lo que esto vino a
  resolver. El saldo queda negativo (ya podía) y el panel avisa antes de
  guardar. `saldoAFavorDelAbono` compara **al centavo**, no al cuarto decimal:
  sin eso, el residuo de dividir bolívares sacaba el aviso en un abono exacto.
- Regresión: `calc/abono-en-moneda.spec.ts` (11),
  `schemas/abono-en-moneda.spec.ts` (10, con el test de seguridad del
  mass-assignment) y 8 en `orders.service.spec.ts`. Por mutación, tomar el
  `amount` del cuerpo tumba 1 en la API y el `.div` por `.mul` tumba 4 en
  shared.

### ⚠️ EL INVENTARIO DE FECHAS NO MIRABA DENTRO DE LOS `superRefine`

Al volver `PaymentCreateSchema` un `ZodEffects`, **dejó de estar en la red del
inventario** de `fecha-calendario.spec.ts` —que solo recorría `ZodObject`— y su
`date` quedó sin vigilar de un commit al otro, **sin que nada fallara**.
`StoreProductCreateSchema` llevaba así desde que existe.

El inventario ahora **desenvuelve** los `ZodEffects` hasta el objeto de abajo.
Comprobado por mutación: aflojar `PaymentCreateSchema.date` a
`z.string().min(1)` pone 5 tests en rojo nombrando el campo; antes del arreglo
no habría puesto ninguno. **Un schema que gana un `.superRefine()` se sale de
toda red que filtre por `typeName`** — si aparece otra, hay que desenvolverla
igual.

### EL CANDADO BLANDO PARA ANULAR EN COMPRAS

Pasados **3 días desde que se CARGÓ**, anular una factura o un abono exige
`confirmoFueraDePlazo: true`; sin él es un 400 que dice cuántos días pasaron.

- ⚠️ **Desde `createdAt`, no desde la fecha del documento.** Son las dos clases
  de fecha de este proyecto y la diferencia es visible en los datos: hay una
  compra del 05/10 con un abono fechado el 02/11. Contando por el documento, un
  abono cargado hoy con fecha vieja **nacería fuera de plazo**.
- **Blando a propósito**: el error que se descubre al cuarto día es un caso
  real, y un candado duro en un negocio de una sola persona significa tocar la
  base a mano. Lo que evita es el click distraído.
- ⚠️ **La regla vive en el motor** (`anulacionNecesitaConfirmacion` +
  `DIAS_PARA_ANULAR_SIN_CONFIRMAR`, en `calc/purchase-invoice.ts`), no en el
  servicio: el panel la necesita para saber cuándo cambiar el texto de la
  confirmación, y escrita en dos lados se separarían el día que el plazo
  cambie. `ahora` entra como parámetro, como `facturasAtrasadas`.
- ⚠️ **Una fecha ilegible PIDE confirmación.** Lo contrario convertiría un dato
  roto en un permiso para anular sin preguntar.
- ⚠️ **La regla DURA gana**: una factura con mercadería recibida no se anula ni
  confirmando, y el candado corre DESPUÉS de esa comprobación. Al revés,
  mandaba a confirmar un camino cerrado — el error de mensaje que este módulo
  ya cometió una vez. Tiene su test.
- `serializar()` expone ahora `createdAt` en la factura y en cada abono: arma la
  respuesta CAMPO POR CAMPO, así que lo que no se agregue ahí existe en la
  base, pasa los tipos y **nunca llega al cliente**.
- **No hubo migración**: las dos tablas ya tenían `createdAt`.
- Regresión: 6 en `calc/purchase-invoice.spec.ts` y 5 en
  `purchase-invoices.service.spec.ts`. Por mutación, sacar el candado de la
  factura tumba 1.

### Los tramos de mayoreo van de la calculadora a la ficha

`tramosParaLaTienda` (`calc/store-pricing.ts`) traduce los
`wholesale.tiers` del `CalcInput` a los `priceTiers` de la ficha. **No es un
cast**: los dos contratos no aceptan lo mismo y pasar la lista cruda hacía
**rebotar el guardado entero** del producto.

- Se caen los tramos que no superan el mínimo del producto («desde 1 unidad» no
  es un tramo, es el precio base), los que no descuentan nada, y de las
  cantidades repetidas queda **el de mayor descuento** —cobrar de menos por una
  ambigüedad del formulario es preferible a cobrar de más sin que el dueño lo
  haya decidido—. Pasados 8, sobran los de cantidad más alta.
- ⚠️ **Silencioso a propósito**: devuelve lo que sirve en vez de lanzar. Quien
  llama está guardando un producto, y volarle el guardado por un tramo de más
  sería perder el costeo entero por un dato accesorio.
- ⚠️ El chequeo `minQty < 2` que tenía era **código muerto** (un tramo tiene que
  superar `minQtyProducto`, que nunca baja de 1). Lo destapó una mutación que
  **no compiló**: 21 tests dejaron de correr en vez de fallar, que es el verde
  falso del que avisa este archivo.
- Tests: 9 en `calc/store-pricing.spec.ts`, incluido el que exige que lo que
  devuelve **atraviese `StoreProductCreateSchema`** y que el crudo NO.

### El presupuesto estimado salió de los reportes

`Campaign.budget` ya no sale en el Excel (`presupuesto_usd`) ni en el PDF.
**No entraba en ninguna cuenta**: el ROI siempre usó `invested`, que son los
gastos reales. El DTO lo sigue aceptando y la columna se queda con lo ya
cargado; simplemente nadie la lee.

### `PATCH /sales/:id` existía y el panel no lo usaba

No hubo cambio de backend. Queda anotado porque buscar «¿se puede editar una
venta?» **solo en `apps/web`** hizo concluir lo contrario: el endpoint y el
servicio estaban completos desde siempre. Antes de afirmar que falta una
capacidad, buscarla en los dos repos.


## Entorno
- Windows / PowerShell: usar su sintaxis (`$env:VAR` no `$VAR`, `$null` no
  `/dev/null`, backtick para continuar línea). Rutas con backslash de Windows.
- pnpm vía `npm install -g pnpm` (corepack no tiene permisos para escribir en
  Program Files).
- En `pnpm-workspace.yaml`, `allowBuilds` autoriza los postinstall de Prisma/Nest.
- `.env` reales NO se versionan ni se editan; usar los `.env.example`.

## Seguridad y secretos
- NUNCA modificar archivos `.env` (ni `.env.*`) salvo que se pida explícitamente
  en ese mismo mensaje. Leerlos para entender qué variables existen está bien;
  editarlos por iniciativa propia no.
- Nunca exponer valores reales de secretos/credenciales en código, logs ni docs.

## Git
- No hacer commit ni push salvo que se pida.
- No usar flags interactivos (`-i`) ni `--no-verify`.
- Cuando sí se pida commit, usar mensajes limpios y consistentes.

## Lo del 2026-11-08: banners, «Nuevo» y USDT

Tres cosas que tocaron modelo y contrato. Specs:
`docs/superpowers/specs/2026-11-08-tres-tipos-de-banner-design.md`.

### Los TRES tipos de banner (shared 0.67.0, migración `20261108180000_tipos_de_banner`)

`StoreBanner` gana `kind` (HERO / TEXTO / CATEGORIA) y `categoryId`, e `imageKey` pasa a
opcional. ⚠️ **`kind` es DÓNDE se muestra; `linkType` es adónde LLEVA**: son cosas
distintas y conviven (un banner de categoría puede enlazar a un producto). Cada tipo
**exige lo suyo y prohíbe lo ajeno** — un campo que el tipo no usa, guardado porque el
formulario lo ofrecía, después se lee como información.

⚠️ Un `CATEGORIA` cuya categoría se borró **no se devuelve** por `/public/store/banners`:
no hay página donde mostrarlo. Degradar el destino no alcanza, como sí alcanza con un
enlace colgado.

⚠️ La categoría se filtra por ORGANIZACIÓN al guardar: sin eso, el id de otro negocio
ataría el banner a su categoría y el slug ajeno saldría por el endpoint público.

### La insignia «Nuevo» (shared 0.68.0, migración `20261108200000_publicado_el`)

`StoreProduct.publishedAt` marca la PRIMERA publicación, y de ahí sale `nuevo` (15 días,
`esNuevo` en `shared/calc/novedad.ts`), derivado y nunca guardado.

⚠️ **Cuenta desde que se PUBLICA, no desde que se crea**, y lo decidieron los datos: las
fichas nacen ocultas y al medir producción el «llavero con QR» llevaba **78 días creado y
seguía sin publicarse**. Con `createdAt`, publicarlo nunca lo habría mostrado como nuevo.

⚠️ **Se escribe UNA sola vez**: ocultar y volver a publicar NO renueva la insignia. Si lo
hiciera, cualquiera volvería «Nuevo» un producto viejo con dos clics.

⚠️ `publishedAt` es un INSTANTE, así que se lee con `businessDateKey` (no con
`toISOString`, que lo correría un día desde las 20:00 de Caracas), y el «hoy» se calcula
en hora de Venezuela.

⚠️ El contrato **rechaza** `badge: "Nuevo"` escrito a mano, sin importar mayúsculas: con
la automática puesta habría dos insignias iguales, y la escrita seguiría ahí cuando el
producto deje de ser nuevo.

### Cuánto entra en USDT (shared 0.69.0, sin migración)

`enUsdt` y `brechaUsdt` (`shared/calc/usdt.ts`): los precios de la tienda están en
dólares **BCV** y en USDT entra menos. La cuenta es ir a bolívares y volver. Con BCV 900 y
Binance 1026, un producto de $24 son **21,05 USDT** — 12,3 % menos.

⚠️ Es una lectura del PANEL. No cambia lo que se cobra, ni lo que se guarda, ni lo que ve
el cliente.

⚠️ **Con una tasa cargada mal NO protege, y hay un test que lo fija**: la de USDT estuvo
en 1,026 en vez de 1026 y la cuenta habría dado 21.052 USDT. Un `null` ahí dejaría al
dueño sin pista de que la tasa está mal; el disparate tiene que verse.

⚠️ Dato suelto encontrado ese día y NO corregido (decisión del dueño): `defaultRateLabel`
vale `'Bolívar (BCV)'` y **ninguna tasa se llama así**, así que `/public/store/info`
devuelve `rate: null` y la tienda no muestra bolívares en ningún precio.

### Respaldos

⚠️ `*.dump` y `*.sql.gz` están en el `.gitignore` desde el 2026-11-08. El método de
respaldo de este archivo escribe el dump **dentro del repo**, y el repo es PÚBLICO: sin
esa línea, un `git add .` distraído publica la base entera del negocio.

## La lista de formas del voseo vive en `shared` (2026-11-10, shared 0.73.2)

Los dos guardianes de idioma —`apps/api/src/common/idioma.spec.ts` y
`calc3d-web/apps/web/src/idioma.spec.ts`— declaraban cada uno que su lista de
imperativos **«es IDÉNTICA en los dos repos (copiada, no importada)»**, y
**nada lo comprobaba**. Coincidían de casualidad (74 formas medidas ese día);
el día que una sumara una forma y la otra no, el repo que se quedó corto perdía
cobertura **con todo en verde** — que es literalmente el incidente que creó
estos guardianes (una lista fija dejó 19 formas sin corregir).

- La lista es del **IDIOMA**, no del corpus: una forma que es voseo en la API lo
  es en el panel. Así que vive en **`packages/shared/src/idioma.ts`**
  (`IMPERATIVOS_DE_VOSEO`), el único artefacto que `pnpm sync:shared` ya
  mantiene idéntico entre los dos repos, y los dos guardianes la importan de
  `@calc3d/shared`. En el panel se re-exporta con su nombre viejo
  (`FORMAS_DE_VOSEO`) para no tocar a quien ya la importaba.
- ⚠️ **`PALABRAS_PERMITIDAS` NO se movió, y la distinción es el punto.** Esa
  depende del CORPUS de cada repo (qué palabras legítimas usa su código), es
  distinta en cada uno y cada entrada tiene que seguir apareciendo en ESE
  código. Tratar las dos como «del idioma» —o las dos como «del corpus»— es lo
  que dejó al panel con la lista corta.
- ⚠️ **El archivo de la lista está EXENTO del barrido de los dos guardianes**, o
  se denunciaría a sí mismo. Es el único exento además del propio spec, y los
  dos tienen un test que lo fija (`expect(EXENTOS).toHaveLength(2)`): una
  exención que crece es la forma lenta de apagar un guardián.
- ⚠️ **Se edita en `calc3d-api` y se sincroniza**, como todo `shared`. Con
  `SHARED_VERSION` al día en los dos repos (0.73.2).
- ⚠️ **Y una trampa al verificarlo por mutación**: los specs importan de
  `@calc3d/shared`, o sea del **build**, no del `src`. Vaciar la lista en el
  fuente y correr los tests da **verde** si no se recompila: el parche está en
  disco y el artefacto bajo prueba es el viejo. La primera medición de esto fue
  inválida por eso. Hay que `pnpm --filter @calc3d/shared build` entre el
  parche y la corrida — y la mutación tiene que **compilar**, porque si el build
  falla el `dist` se queda con la versión buena y pasa lo mismo.
- Medido con la lista vacía (compilando y recompilando): tumba **2** tests en la
  API y **3** en el panel.
