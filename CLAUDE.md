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
    - `documents/quote-note.service.ts` → `GET /quotes/:id/cotizacion.pdf`. **Es lo
      que se le manda al CLIENTE**: descripción, cantidad, precio unitario y total,
      más los extras del motor (diseño/urgencia/ajuste por mínimo) como renglones
      propios para que las cuentas cuadren. **NUNCA costos, márgenes ni mayoreo** —
      para eso está `GET /quotes/:id/pdf` (`ExportService`), que es **interno** y se
      descarga como `desglose-interno-*.pdf`. Fijado por
      `documents/quote-note.service.spec.ts`.
    - **Fechas en UTC** (`documents/document-format.ts`): `deliveryDate` se guarda a
      medianoche UTC; formatear en la zona local imprimía el día ANTERIOR. Validez
      de la cotización: `QUOTE_VALIDITY_DAYS = 15` (constante, sin UI todavía).
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
  - **Catálogo de productos (Fase 4)** (`products/products.module.ts`,
    `features/products/api.ts`): modelo `Product` (nombre, `imageUrl?` SOLO url
    http/https — sin subida de archivos; snapshot `input` del `CalcInput`;
    `priceSet` = precio que fija el dueño; `costAtSave` = costo unitario
    **calculado por el motor** al guardar —el cliente NO manda el costo—; snapshot
    `exchangeRates`). El **recosteo** re-resuelve cada línea del `CalcInput` contra
    el catálogo de HOY **por nombre** (el `CalcInput` embebe precios, NO IDs) y
    corre `calculateQuote`; lo que no matchea (item renombrado/borrado) conserva el
    precio congelado y se reporta en `unmatched`. Helpers puros en
    `shared/calc/product.ts` (`productMarkup`, `costDeltaPct`, `productStatus`);
    "margen" = **markup sobre costo** (coherente con el motor). Endpoints: CRUD
    `/products` (list y get traen `recost` derivado) + `POST /products/:id/reprice`
    (el dueño acepta el costo nuevo: re-fija `priceSet` y **re-ancla** `costAtSave`
    al costo de hoy → apaga la alerta). **Alerta de rentabilidad por devaluación**:
    `productStatus` marca `belowMin` cuando el markup de hoy cae bajo
    `Settings.productAlertMinMarginPct` (fracción, default 0.15, editable en
    Configuración → Productos). Nunca recostea silenciosamente.
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
    - **`StoreProduct` NO es `Product`.** `Product` responde "¿cuánto me cuesta y a
      cuánto lo vendo?" (snapshot del `CalcInput`, recosteo, alerta de margen);
      `StoreProduct` responde "¿qué ve y compra el cliente?" (fotos, descripción,
      opciones, visibilidad, slug). Fusionarlos haría que editar una foto tocara el
      costeo — y un **servicio** no tiene `CalcInput`, así que ni entraría en
      `Product`, que exige `input` y `costAtSave`. `StoreProduct` apunta
      OPCIONALMENTE a un `Product` o un `Quote` como origen de costeo.
    - **El costo lo pone el SERVIDOR**: `costAtPublish` no está en el DTO; se lee del
      origen enlazado (`POST /store/products/from-source` con `productId` o `quoteId`
      arma el borrador con nombre, precio sugerido y costo del snapshot).
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
      Son la ÚNICA medida de una campaña que todavía no generó venta atribuida:
      sin ellas el ROAS es 0× y no dice nada. ⚠️ **`serialize()` en
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
      por fecha perdía $46. Resultado: 87 ventas COUNTER ($720) + 25 ENCARGO
      semanales ($1.323) + $136,50 en pedidos = **$2.179,50**, contra los $2.203
      de la fila 11. Esos $23,50 son el descuadre de la hoja y NO se inventaron.
  - **El estado de la migración del Excel** vive en `docs/excel-vs-app.md` (mapa
    hoja por hoja) y `docs/backlog-migracion.md` (las 10 actividades que faltan,
    con las decisiones que bloquean cada una). Actualizarlos al avanzar.
  - **Registro dinámico de gastos**: el modal (front) elige el tipo (Filamento/
    Impresora/Componente/Empaque/Mantenimiento/General) y, si mapea a catálogo,
    deja reusar un item existente o crearlo inline → crea catálogo + gasto enlazado
    en una acción. **Los PATCH de catálogo son PARCIALES** (`XSchema.partial()`), no
    exigen el objeto completo. El alta desde el catálogo NO genera gasto (para
    sembrar/importar).
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
  - **Reporte en Excel (2026-09-07)** (`reports/reports.module.ts`,
    `GET /reports/excel.xlsx`, dep **`exceljs`**): el libro completo del negocio
    con 11 hojas (Resumen, Ventas, Encargos, Gastos, Inventario, Stock mensual,
    Clientes, Publicidad, Deuda, Metas, Producción). **Decisión del dueño: el
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
  - **Presupuestos / cotizaciones (Quotes)** (`quotes/quotes.controller.ts`): CRUD
    `/quotes`; cada presupuesto guarda un **snapshot JSON** del `CalcInput` + `totals`
    (integridad histórica de precios, NO tablas-línea normalizadas). **Versionado**:
    `Quote.version` + `Quote.originalQuoteId` (todas las versiones comparten el mismo
    `originalQuoteId`; la v1 usa su propio id). Endpoints extra: `GET /quotes/:id/versions`
    (historial), `POST /quotes/:id/duplicate` (crea versión nueva), `PATCH /quotes/:id/status`
    (ciclo DRAFT/SENT/ACCEPTED/…). El front deriva conversión / "por seguir" (SENT) /
    "vencido" (>7 días) desde estos datos.
  - **Cuenta del dueño** (`users/`): solo `GET /users/me` y `PATCH /users/me` (editar
    el propio perfil: nombre, correo, contraseña). **No hay gestión de equipo** ni
    invitaciones (se quitó al pasar a app de un solo dueño; el módulo `organizations/`
    se eliminó).
  - **Control de filamento (Fase 7)** (`filament/`): los dos controles que el dueño
    llevaba en su Excel. **Compras** = los `Expense` con `materialId`, con costo por
    rollo y por gramo DERIVADOS (`GET /filament/purchases`); el costo por gramo usa
    el `rollGrams` REAL, no el ÷1000 fijo de la hoja. **Conteo físico mensual** =
    tabla `StockCount` (una fila por material y mes; `sealed`/`inUse`/`running`, el
    total se DERIVA con `stockTotal`) — `GET/PUT /filament/stock?month=AAAA-MM` y
    `GET /filament/summary`. El conteo es **manual a propósito**: no se descuenta lo
    que consumen los presupuestos porque no todo lo cotizado se imprime ni todo lo
    impreso sale bien. `Material.status` (ACTIVE/DISCONTINUED) saca a los colores
    descontinuados de la lista de reposición. El **consumo del mes** cuenta los
    rollos comprados (`anterior + comprados − actual`): la hoja solo resta los dos
    totales y por eso da negativo en un mes con compras. Sin el conteo de alguno de
    los dos meses devuelve `null`, no un número inventado. Helpers puros en
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
  - ⚠️ **Un conteo PARCIAL no es el stock del mes.** El resumen devuelve
    `countedMaterials`/`totalMaterials`/`complete`: con 3 fichas contadas de 57,
    el total del mes es la suma de esas 3 y el consumo sale disparatado
    ("consumiste 28 rollos" sin haber contado). La hoja del Excel tiene el mismo
    defecto; acá la pantalla lo avisa en vez de dejarlo pasar como dato firme.
  - Las fichas **"Sin especificar"** (las que creó la importación para los rollos
    sin marca) nacen `DISCONTINUED`: son un marcador temporal, y sin eso, al
    identificar el rollo quedaban en cero y pedían reposición de un color que no
    existe.
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

## Base de datos: local para desarrollar, Railway en producción

**1. Desarrollar y probar SIEMPRE contra la base local.**
- Nada de apuntar a producción "para probar rápido". El `.env` de desarrollo se
  queda con la `DATABASE_URL` local (Postgres 18 en `localhost:5432`, base `calc3d`).
- **Cuenta de pruebas**: la del `seed` — `dueno@calc3d.local` / `calc3d1234`
  (defaults de `OWNER_EMAIL`/`OWNER_PASSWORD`). Como no hay registro público, el
  seed es la única vía de crear cuentas: si hace falta otra para probar algo,
  créala en la local con el seed o un script. Nunca usar una cuenta real de prod.
- Antes de dar una feature por buena: `pnpm test:shared` + prueba manual real
  (API en 3001 + web-preview de `calc3d-web` en 5180).

**2. Solo cuando lo local está probado, subir y migrar a producción.**
- Producción = **PostgreSQL en Railway**: host `crossover.proxy.rlwy.net`, puerto
  `48405`, base `railway`, usuario `postgres`.
- **La contraseña NO se escribe en este archivo ni en nada versionado.** La URL
  completa vive como `DATABASE_URL_PROD` en `apps/api/.env.production.local`
  (lo cubre el `.gitignore` con `.env.*`; ese archivo NO se carga solo).
- Las migraciones se **generan y commitean en local** (`prisma migrate dev` contra
  la base local); en producción solo se **aplican** las ya versionadas — desde la
  raíz de este repo, cargando la URL a mano en la sesión de PowerShell:
  ```powershell
  $env:DATABASE_URL = ((Get-Content .\apps\api\.env.production.local `
    | Where-Object { $_ -match '^DATABASE_URL_PROD=' }) -replace '^DATABASE_URL_PROD=','').Trim('"')
  pnpm --filter @calc3d/api exec prisma migrate deploy
  ```
  Esa variable vive solo en esa sesión: cerrá la terminal (o reasigná la URL local)
  al terminar, para no dejarla apuntando a prod sin querer.
- **Prohibido contra producción**: `prisma migrate dev`, `migrate reset`,
  `db push --accept-data-loss` y `SEED_DEMO=1 pnpm seed` (el catálogo demo no va a
  prod). El seed normal (dueño + tasas de protección, idempotente) sí, con
  `OWNER_EMAIL`/`OWNER_PASSWORD` reales.
- **Backup antes de cualquier migración que borre o transforme datos**
  (`"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"` contra la URL de Railway).
- Nunca editar una migración ya aplicada en prod: se crea una nueva encima.
- Después de migrar: `prisma migrate status` contra prod limpio y la API de
  producción arrancando. Verificarlo, no asumirlo.
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
- **`parallelPrinters`** solo divide `production.deliveryHours`. NUNCA el costo:
  dos impresoras 5 h gastan 10 horas-máquina de desgaste igual.
- **`order` es la fuente ÚNICA del precio que se COBRA**: si el pedido alcanza un
  tramo de mayoreo, `order.unitPrice` es el del tramo (y `listUnitPrice` guarda
  el de lista, `discountPct` el descuento). El panel, la cotización del cliente y
  `/sales/from-quote` leen ESE campo — si cada uno lo dedujera por su cuenta,
  dirían cifras distintas. `price` sigue siendo el precio de lista.
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
