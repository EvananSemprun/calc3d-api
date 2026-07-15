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
  - **Nota de entrega + calendario (Fase 3B)**: `orders/delivery-note.service.ts`
    genera el PDF calcado del formato real (N.° = `code` correlativo + año, emisor
    desde `Organization.name` + `Settings.business*`, receptor del `Client`, tabla
    Ítem/Descripción/Cantidad/Unidad SIN precios, doble firma) vía
    `GET /orders/:id/delivery-note.pdf`. `Settings` gana `businessRif/Phone/Address/Signer`
    (sección "Negocio"). Calendario mensual UTC por `deliveryDate`, coloreado por estado.
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
      enlace en el log, NO lo expone en la respuesta HTTP). Vars: `RESEND_API_KEY`,
      `MAIL_FROM`, `APP_URL`.
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
  - **Motor pro (Fase 2A)** — el `CalcInput` tiene dos objetos OPCIONALES con
    defaults (retrocompatibles): `batch` (`piecesPerBatch?`, `setupCost`) y
    `surcharges` (`designFee`, `rushPct` fracción, `minOrderPrice`). **Multi-tanda**:
    los gramos/horas son los de UNA cama (tanda); los costos por lote
    (material/desgaste/luz) escalan `× cantidad/tanda` y el arranque `× ceil(tandas)`.
    Sin `piecesPerBatch` el multiplicador es 1 = comportamiento clásico. El
    `CalcResult` gana `batches: BatchSummary|null`, `breakdown.setup`, y por precio
    `designPerUnit/rushAmount/finalPerUnit/jobTotal/hitMinimum`. **Orden de precio**:
    `redondear(costo×(1+margen)) + diseño/unidad → ×(1+urgencia) → total = max(×qty, mínimo)`.
    Helpers en `shared/calc/select.ts` (`pickSuggestedPrice`, `priceFinalPerUnit`,
    `priceJobTotal`, `priceHasSurcharges`); **`/sales/from-quote` registra `jobTotal`**
    (con extras), no el precio base. Los snapshots guardados antes de 2A no traen los
    campos nuevos: leerlos SIEMPRE con `?.`/`??`.
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
- `pnpm --filter @calc3d/api exec prisma generate`
- `pnpm --filter @calc3d/api exec prisma migrate dev`
- `pnpm dev` — levanta la API (antes `pnpm dev:api` en el monorepo).
- `pnpm --filter @calc3d/api seed` — asegura (idempotente) la cuenta del **dueño**
  (org + usuario OWNER + settings + tasas de protección Bs) desde `OWNER_EMAIL` /
  `OWNER_PASSWORD` (defaults de desarrollo: `dueno@calc3d.local` / `calc3d1234`).
  Como no hay registro público, **el seed es la única vía de crear la cuenta**. Con
  `SEED_DEMO=1` además siembra un catálogo de ejemplo (caso del llavero) en su org.

## Convenciones del motor de cálculo
- Porcentajes como **fracción** (0.08 = 8 %, 0.3 = 30 %).
- Costos "por lote" (material, desgaste, luz) vs "por pieza" (componentes,
  empaque, mano de obra). NO dividir ciegamente entre la cantidad.
- Los 3 datos que aporta el **slicer** (cantidad de piezas, gramos totales del
  lote, horas de impresión) son inputs del `CalcInput`, **no viven en catálogos**:
  se pasan en cada cálculo.
- Material: `grams` es el **total del lote/trabajo** (como las horas de la
  tanda, tal como lo reporta el slicer); el costo por pieza = total / cantidad.
- El desglose (`breakdown`) muestra cada categoría EN CRUDO y la merma como
  línea aparte (`wasteAmount`), de modo que las líneas sumen el costo del lote.
- Componentes/empaque por paquete: default de prorrateo **FULL_PACKAGE**;
  se exponen ambas cifras (usadas vs paquete completo).
- Merma default 8 % sobre material+desgaste+luz (configurable).
- Mayoreo: los tramos se interpretan siempre como **markup**.
- Dinero con decimal.js; salidas redondeadas a 4 dp (sub-centavo). Redondeo de
  presentación aparte (campos `*Rounded`).

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
