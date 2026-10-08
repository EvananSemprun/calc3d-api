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

      Los dos backfill de `apps/api/prisma/` son el ejemplo vivo:
      `backfill-caja.mjs` usa `toISOString` (toca `date`) y
      `backfill-importado.mjs` usa `businessDateKey` (toca `createdAt`).
      **Los dos están bien. "Unificar el helper" rompe uno de los dos.**
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
      (login / forgot-password / reset-password) a **10/min** por **IP real**; el resto
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
    - ⚠️ **Quién pagó = `paidBy` (BUSINESS/OWNER/LOAN) en `Expense` y
      `LoanPayment`.** Una compra que paga la contraparte se anota UNA vez, como
      gasto con `paidBy: OWNER`; el aporte sale solo. La hoja la anotaba dos
      veces y eso descuadraba. `OwnerMovement` es SOLO plata pura.
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
  - **ABM de contrapartes y cuentas (fase 2, 2026-10-05, shared 0.22.0)** —
    `cash/counterparties.service.ts` y `cash/cash-accounts.service.ts`, cada uno
    en su archivo (`cash.service.ts` ya tiene 480 lineas con el resumen, las
    obligaciones y la conciliacion). Rutas: `/counterparties` y `/cash-accounts`,
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
    - **La fase 4 ya NO está pendiente** (2026-10-08): `Expense` y `LoanPayment`
      llevan `counterpartyId`, `null` = la caja pagó. El enum `paidBy` convive
      **solo hasta que el backfill corra en producción**; lo borra la migración
      2, que a propósito **no está commiteada todavía**. Ver "Préstamos" abajo.
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
    - Verificacion por mutacion con dientes: sacarle `paidBy === 'BUSINESS'` a
      `equipment` rompe **2 tests viejos**; sacarle `paidBy !== 'LOAN'` a
      `operativo` **no rompia ninguno** (el unico gasto LOAN de la suite tenia
      `isInvestment: true`). Elegir la primera si hay que repetirla.
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
      el saldo del préstamo). Mientras el enum siga en la base, `cash.service.ts`
      y `backfill-caja.mjs` traducen en el BORDE con `pagador()`, marcada como
      puente temporal.
    - ⚠️ **DOS migraciones, y NO pueden ir en el mismo despliegue.** La 1
      (`20261009120000`) es puramente aditiva. Entre las dos corre
      `prisma/backfill-pagadores.mjs`. `migrate deploy` aplica todas las
      pendientes seguidas al arrancar el contenedor: commitear la 2 junto con la
      1 borraría `paidBy` antes de que nadie lo tradujera.
    - El backfill trae **su propio guard**: dentro de la transacción saca la
      foto de las nueve líneas del saldo y de la deuda leyendo por el ENUM,
      traduce, la vuelve a sacar leyendo por la CONTRAPARTE, y si algo se movió
      un centavo revierte y aborta con código 1.
    - `installmentTarget` reemplaza a `monthlyPayment` en la respuesta: con
      frecuencias, llamarla "mensual" sería mentir. `monthlyLoanPayments`
      **normaliza a mensual antes de sumar** — una cuota semanal de $50 son $217.
    - `payOffEstimate` da **dos lecturas**, al ritmo objetivo y al real. Una sola
      miente con pagos irregulares, que es el caso. El ritmo real se mide contra
      el CALENDARIO, no por cantidad de pagos.
    - **Anular no borra** (`POST /loans/:id/payments/:pid/void`, con motivo). Es
      POST y no DELETE porque DELETE promete que la fila desaparece. Anular dos
      veces es 409.
    - Un pago **no puede amortizar más que el saldo**: `loanBalance` recorta en 0
      y sin la guarda el exceso quedaba invisible.
    - Que un pago personal **genere deuda se pregunta** (`generatesDebt`). El
      default de la base era `true` y toda cuota del propietario generaba
      obligación sin que nadie lo decidiera. Si pagó la caja no genera nada, por
      más que el campo venga en `true`.
    - `GET /loans/overview` devuelve **las dos deudas** y pide las obligaciones
      al MISMO `CashService` que usa Caja. Si las recalculara, el día que un
      filtro cambie las dos pantallas dirían cosas distintas sobre la misma
      deuda.
    - **Verificado contra un dump de producción el 2026-10-08**: migración
      aplicada, backfill corrido, y las 4 cifras de Caja, las 9 líneas del saldo,
      el saldo del préstamo y las 19 obligaciones **idénticas** antes y después.
      Lo único que cambia es que el acreedor se completa.
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
    `import-filamento.mjs` aborta si hay meses cerrados, incluso en ensayo (ver
    "Importación del Excel" más arriba). Regresión de seguridad: `filament.service.spec.ts`,
    `filament.controller.spec.ts` (fija por metadata de Nest el guard JWT de
    clase y la lista EXACTA de rutas de escritura — `POST stock/close`,
    `POST stock/reopen`, `PUT stock` en 410 —: agregar otra ruta de escritura ahí
    rompe el test a propósito), `materials.service.spec.ts`. Spec:
    `docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`.
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
    en Gastos. `PATCH /materials/:id` valida con `MaterialCorrectionSchema` (SOLO
    `name` y `color`, decisión del dueño; marca, tipo, gramos y precio quedan como
    nacieron). ⚠️ **El precio del filamento sale SOLO de la compra**: en
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

## Producción (desde 2026-10-01): API en Render, base en Railway, panel en Cloudflare

| Pieza | Dónde | URL |
|---|---|---|
| API (este repo) | **Render**, plan free, Docker | `https://calc3d-api.onrender.com/api` |
| Base de datos | **Railway**, PostgreSQL **17** | host `crossover.proxy.rlwy.net`, puerto `48405`, base `railway` |
| Panel (`calc3d-web`) | **Cloudflare Pages** | `https://calc3d-web.pages.dev` |

- **Render** se configura con `render.yaml` (Blueprint) y redespliega solo en
  cada push a `main` (`autoDeploy`). Variables: `DATABASE_URL` (la URL **pública**
  de Railway, `DATABASE_PUBLIC_URL`; la interna `*.railway.internal` no se alcanza
  desde Render), `JWT_SECRET` (la genera Render), `JWT_EXPIRES_IN`, `TRUST_PROXY=1`,
  y `WEB_ORIGIN` / `APP_URL` = `https://calc3d-web.pages.dev` **exacto, sin barra
  final**: si no coincide, el navegador bloquea el login por CORS sin decir por
  qué. No hacen falta `STORE_*` ni `R2_*` mientras se use solo el panel.
- ⚠️ **Plan free: la API se duerme a los 15 min sin tráfico** y la primera request
  tarda ~50 s en despertarla (aceptado por el dueño: solo usa el panel). Si algún
  día se publica la tienda, eso no sirve para un cliente: ping a `/api/health`
  cada 10 min (no toca la base) o pasar a un plan pago.
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
  reset de contraseña no le llega a nadie). Sin `RESEND_API_KEY` en Render, el
  correo de reset no se envía.
- ⚠️ **Desde el 2026-10-01 la base que manda es la de PRODUCCIÓN**: el dueño
  carga datos en el panel publicado. La local quedó como copia de ese día. Los
  scripts `sincronizar-*.mjs` leen `DATABASE_URL` del `.env` (la LOCAL): correrlos
  contra prod es tocar producción (backup + OK explícito antes).

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
  cada push a `main` despliega en Render y **aplica solo** las migraciones
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
