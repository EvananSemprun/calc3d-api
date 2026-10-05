# Caja: obligaciones fechadas, conciliación de cuenta compartida y SaaS

Fecha: 2026-10-05 · shared 0.20.0 → **0.21.0** · Reemplaza las partes de
[2026-09-26-caja-y-financiamiento-design.md](2026-09-26-caja-y-financiamiento-design.md)
que describen la cascada de retiros y el conteo de los lunes.

Pedido del dueño: separar bien saldo disponible, ventas, aportes, deudas y
conciliación; manejar la cuenta compartida negocio/propietario; y dejar el
módulo listo para venderse como SaaS (sin nombres propios en el código).

---

## 1. Qué está mal hoy

Cuatro problemas concretos del módulo actual (`packages/shared/src/calc/cash.ts`,
`apps/api/src/cash/cash.module.ts`, `calc3d-web/apps/web/src/pages/Cash.tsx`):

1. **No existen deudas individuales.** `ownerFinancing()` devuelve cuatro filas
   agregadas (diseñador, compras, cuotas, equipo) y descuenta los retiros en
   **cascada por categoría**, con un orden fijo que no tiene relación con la
   fecha. No hay una sola obligación fechada en la base, así que "aplicar de la
   más antigua a la más reciente" es hoy imposible.
2. **Todo lo que pone el propietario es reembolsable.** No hay forma de marcar
   un aporte de capital, y como el aporte se *deriva* del gasto con
   `paidBy = OWNER`, el flag no puede vivir en un movimiento: tiene que estar en
   el gasto.
3. **La conciliación compara peras con manzanas.** `cashCountCheck()` hace
   `personal = total − esperado`: lo personal es el **residuo**, no un dato. Por
   construcción nunca hay faltante salvo que el residuo dé negativo. Lo que se
   necesita es lo inverso: declarar lo personal y derivar lo del negocio.
4. **Nombres propios incrustados.** "Vanan", "Conteo del lunes", "Pagado por
   Vanan" están escritos en la UI y en los comentarios del modelo.

## 2. Decisiones (del dueño, 2026-10-05)

1. **Ledger de obligaciones + aplicaciones** para la deuda con el propietario.
   FIFO real por fecha, trazabilidad por deuda y reversión. Muere la cascada.
2. **Tabla `Counterparty`**: propietario, socio y prestamista externo son
   entidades con nombre, no un enum con un nombre propio adentro.
3. **Entrega en tres fases**, cada una con su migración probada en local antes
   de producción (la base que manda es la de Railway, con datos reales).
4. **Etiqueta "Importado"** vía campo `source` y backfill por fecha de corte.
5. **El componente personal se declara a mano** en cada conciliación, con el
   valor de la conciliación anterior como sugerencia. No se puede derivar: la
   plata personal del dueño entra y sale por fuera del negocio.
6. **La cuenta define su moneda.** Si no es USD, la conciliación pide la tasa y
   guarda importe original + tasa + equivalente USD. La base de comparación
   sigue siendo USD, como todo el motor.
7. **El flag `refundable` va en los tres orígenes** (`Expense`, `LoanPayment`,
   `OwnerMovement`), con default `true` para no alterar el histórico.

## 3. La idea central: derivar las obligaciones, guardar las aplicaciones

Este repo deriva los saldos y no los almacena (`loanBalance`, saldo de pedido).
Crear una tabla de deudas rompería esa regla y la haría divergir de los gastos
que la originan.

**Cada obligación es un origen que ya existe:**

| Origen | Cuándo es obligación |
|---|---|
| `Expense` | `paidBy = OWNER` y `refundable = true` |
| `LoanPayment` | `paidBy = OWNER` y `refundable = true` |
| `OwnerMovement` | `kind = CONTRIBUTION` y `refundable = true` |

Su identidad es la del origen; su saldo es `monto − Σ aplicaciones`. Lo único
nuevo que se persiste es el vínculo:

```prisma
/// Qué parte de un pago al propietario cancela qué obligación concreta.
/// Es lo ÚNICO que se guarda del reparto: el saldo de cada obligación se deriva
/// restándole sus aplicaciones, igual que el saldo de un préstamo.
model DebtApplication {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String

  /// El pago que cancela. Siempre un movimiento de salida hacia la contraparte.
  /// ⚠️ Hay DOS relaciones a `OwnerMovement` desde este modelo, así que las dos
  /// llevan nombre o Prisma no compila.
  payment   OwnerMovement @relation("PaymentApplied", fields: [paymentId], references: [id], onDelete: Cascade)
  paymentId String

  /// La obligación cancelada: EXACTAMENTE UNA de las tres (CHECK en la migración).
  expense               Expense?       @relation(fields: [expenseId], references: [id], onDelete: Cascade)
  expenseId             String?
  loanPayment           LoanPayment?   @relation(fields: [loanPaymentId], references: [id], onDelete: Cascade)
  loanPaymentId         String?
  obligationMovement    OwnerMovement? @relation("ObligationApplied", fields: [obligationMovementId], references: [id], onDelete: Cascade)
  obligationMovementId  String?

  amount Decimal @db.Decimal(12, 4)

  createdAt DateTime @default(now())

  @@index([organizationId])
  @@index([paymentId])
}
```

**Consecuencia aceptada:** el **total** `owedToOwner` no cambia, pero el reparto
por fila de "Quién puso la plata" **va a dar distinto de hoy**, porque pasa de
ordenarse por categoría a ordenarse por fecha. La migración corre el FIFO una
vez sobre los retiros históricos para generar sus aplicaciones
(`source = MIGRATION`).

## 4. Modelo nuevo

### 4.1 `Counterparty`

```prisma
enum CounterpartyKind {
  OWNER            /// El dueño del negocio.
  PARTNER          /// Socio: pone plata y se le debe, igual que al dueño.
  EXTERNAL_LENDER  /// Prestamista de afuera: no participa del negocio.
}

model Counterparty {
  id             String           @id @default(cuid())
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String
  name           String
  kind           CounterpartyKind
  /// La contraparte a la que apuntan los movimientos que no dicen otra cosa.
  /// Una sola por organización (índice único parcial).
  isDefault      Boolean          @default(false)
  active         Boolean          @default(true)
  notes          String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
}
```

### 4.2 `CashAccount`

El modo cuenta compartida y la regla automática son **por cuenta**, no globales:
una caja de efectivo del negocio no se concilia igual que un Binance mezclado.

```prisma
enum CashAccountKind { EXCHANGE  BANK  CASH  WALLET  OTHER }

model CashAccount {
  id             String          @id @default(cuid())
  organization   Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String
  name           String
  kind           CashAccountKind @default(EXCHANGE)
  /// ISO 4217. Si no es USD, la conciliación exige tasa.
  currency       String          @default("USD")
  /// La cuenta mezcla plata del negocio con la personal de una contraparte.
  shared         Boolean         @default(false)
  /// Con quién se mezcla. Obligatoria si `shared`.
  sharedWith     Counterparty?   @relation(fields: [sharedWithId], references: [id], onDelete: SetNull)
  sharedWithId   String?
  /// Al confirmar, un faltante se registra como salida hacia `sharedWith`.
  /// APAGADA por defecto: convierte un desconocido en una deuda saldada.
  autoAttributeShortfall Boolean @default(false)
  active         Boolean         @default(true)
  isDefault      Boolean         @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
}
```

### 4.3 `CashCount` → `CashReconciliation`

Se **renombra la tabla conservando las filas** (`ALTER TABLE ... RENAME`), no se
recrea.

```prisma
enum ReconciliationStatus { DRAFT  CONFIRMED  VOID }

model CashReconciliation {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String
  account        CashAccount  @relation(fields: [accountId], references: [id], onDelete: Restrict)
  accountId      String
  date           DateTime
  status         ReconciliationStatus @default(DRAFT)

  /// LO CONTADO, en la moneda de la cuenta.
  totalAmount    Decimal  @db.Decimal(12, 4)
  /// Componente personal DECLARADO por quien concilia. No se deriva.
  personalAmount Decimal  @default(0) @db.Decimal(12, 4)
  currency       String
  /// Tasa a USD. Obligatoria si `currency != "USD"`, null si es USD.
  /// Mismo patrón que `Expense.rate` + `Expense.currencyCode`, que ya congela la
  /// tasa de un gasto pagado en bolívares.
  rate           Decimal? @db.Decimal(18, 8)

  /// Congelados al confirmar. Una conciliación es un documento, no una vista:
  /// una venta cargada tarde con fecha vieja NO debe mover el histórico.
  totalUsd       Decimal? @db.Decimal(12, 4)
  personalUsd    Decimal? @db.Decimal(12, 4)
  expectedUsd    Decimal? @db.Decimal(12, 4)
  /// businessActualUsd − expectedUsd. Negativo = falta plata del negocio.
  differenceUsd  Decimal? @db.Decimal(12, 4)

  /// Otra explicación del descuadre, cuando no se atribuye a la contraparte.
  explanation    String?
  note           String?

  confirmedAt      DateTime?
  confirmedByUser  User?     @relation(fields: [confirmedByUserId], references: [id], onDelete: SetNull)
  confirmedByUserId String?
  voidedAt         DateTime?

  /// El ajuste que generó, si generó alguno.
  adjustment OwnerMovement?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId, date])
}
```

⚠️ El `@@unique([organizationId, date])` actual **se elimina**: con estados, una
conciliación anulada bloquearía rehacer la del mismo día. Lo reemplaza un
**índice único parcial** en SQL crudo dentro de la migración (Prisma no lo
declara):

```sql
CREATE UNIQUE INDEX "CashReconciliation_org_account_date_live_key"
  ON "CashReconciliation" ("organizationId", "accountId", "date")
  WHERE "status" <> 'VOID';
```

### 4.4 Campos agregados a modelos existentes

| Modelo | Campo | Para qué |
|---|---|---|
| `Expense` | `refundable Boolean @default(true)` | Distinguir compra reembolsable de aporte de capital. Solo se lee si `paidBy = OWNER`. |
| `Expense` | `source RecordSource @default(MANUAL)` | Etiqueta "Importado". |
| `LoanPayment` | `refundable`, `source` | Ídem. |
| `OwnerMovement` | `counterpartyId` | A quién. Obligatorio tras el backfill. |
| `OwnerMovement` | `refundable Boolean @default(true)` | `CONTRIBUTION` + `refundable = false` = aporte de capital. |
| `OwnerMovement` | `source RecordSource @default(MANUAL)` | `RECONCILIATION` marca los ajustes automáticos. |
| `OwnerMovement` | `cashReconciliationId String? @unique` | **La idempotencia**: una conciliación, un solo ajuste. |
| `Settings` | `reconciliationFrequency` | `NONE \| WEEKLY \| BIWEEKLY \| MONTHLY` + `reconciliationWeekday Int?` (1 = lunes, el default). Solo etiqueta y recordatorio: **no bloquea conciliar cualquier día**. |
| `Settings` | `debtApplicationOrder` | `OLDEST_FIRST` (default) \| `NEWEST_FIRST`. Visible en pantalla. |

```prisma
enum RecordSource {
  MANUAL          /// Cargado por una persona en la app.
  EXCEL_IMPORT    /// Vino de bananolab.xlsx (etiqueta "Importado").
  RECONCILIATION  /// Lo generó el ajuste automático de una conciliación.
  MIGRATION       /// Lo generó una migración de datos (FIFO retroactivo).
}
```

## 5. Motor puro (`packages/shared/src/calc/cash.ts`, shared 0.21.0)

Sin base de datos, con decimal.js para el dinero y tests propios. Las cuatro
piezas nuevas:

```ts
export interface Obligation {
  /** Identidad natural: de qué origen salió. */
  source: 'EXPENSE' | 'LOAN_PAYMENT' | 'MOVEMENT';
  sourceId: string;
  date: Fecha;
  /** Para agrupar en "Quién puso la plata". */
  category: 'DESIGN' | 'PURCHASE' | 'LOAN_PAYMENT' | 'EQUIPMENT' | 'CONTRIBUTION';
  amount: number;
  applied: number;
  /** amount − applied. Nunca negativo. */
  outstanding: number;
}

/** Arma el ledger de obligaciones de UNA contraparte, ordenado por fecha. */
export function obligationLedger(input: ObligationLedgerInput): Obligation[];

export interface PaymentPlan {
  applications: { sourceId: string; source: Obligation['source']; amount: number }[];
  /** Lo que sobró después de cancelar todo. Se registra como retiro. */
  leftover: number;
}

/**
 * Reparte `amount` entre las obligaciones abiertas. El excedente sale por
 * `leftover` y NUNCA genera deuda negativa.
 */
export function applyPayment(
  obligations: Obligation[],
  amount: number,
  order: 'OLDEST_FIRST' | 'NEWEST_FIRST',
): PaymentPlan;

export interface ReconcileResult {
  /** total − personal. Lo que de verdad hay para el negocio. */
  businessActualUsd: number;
  /** businessActualUsd − expectedUsd. */
  differenceUsd: number;
  kind: 'SQUARE' | 'FAVOR' | 'SHORT';
}

/**
 * NUNCA compara el total de la cuenta contra el esperado del negocio: en una
 * cuenta compartida ese número no significa nada.
 */
export function reconcile(input: {
  expectedUsd: number;
  totalUsd: number;
  personalUsd: number;
  /** Tolerancia para dar por cuadrado. Default 0.01. */
  tolerance?: number;
}): ReconcileResult;
```

`businessCash()` se abre para que la pantalla pueda explicar el saldo sin
mentir:

| Antes | Ahora |
|---|---|
| `contributions` | `contributionsRefundable` + `contributionsCapital` |
| `withdrawals` | `debtRepayments` + `ownerDraws` |

Así queda visible que una **devolución** baja caja **y** deuda sin ser gasto
operativo, y que un **aporte de capital** sube caja sin ser venta ni ganancia.
`balance` no cambia de valor.

`ownerFinancing()` se reescribe sobre `obligationLedger`: las cuatro filas pasan
a ser una **agrupación por `category`** de las obligaciones y sus aplicaciones.
`overWithdrawn` sale de la suma de `leftover`. `cashCountCheck()` se **elimina**
(lo reemplaza `reconcile`).

## 6. Confirmar y anular

**Confirmar** es una sola transacción de Prisma:

1. Precondición `status = DRAFT`. Si ya está `CONFIRMED`, **409** — no duplica.
2. Congela `totalUsd`, `personalUsd` (aplicando `rate` si hace falta) y
   `expectedUsd = businessCash(ledger, date).balance`.
3. `reconcile(...)` → `differenceUsd`.
4. Si `kind = SHORT` **y** `account.shared` **y** `account.autoAttributeShortfall`:
   crea **un** `OwnerMovement` de salida por `|differenceUsd|`, fechado el día de
   la conciliación, con `counterpartyId = account.sharedWithId`,
   `source = RECONCILIATION` y `cashReconciliationId` apuntando a ella.
5. `applyPayment(obligationLedger(contraparte, hasta la fecha), monto, orden)` y
   persiste las `DebtApplication`. El `leftover` queda como retiro puro: no hay
   fila de deuda negativa ni gasto operativo.
6. `status = CONFIRMED`, `confirmedAt`, `confirmedByUserId`.

El ajuste, al estar fechado ese día, **baja el saldo esperado a esa fecha**: la
conciliación queda cuadrada y las posteriores ya lo arrastran.

`kind = FAVOR`: se muestra y se puede explicar. **No crea nada.** Nunca se
convierte en venta, ganancia ni aporte.

**Anular** (`POST /cash/reconciliations/:id/void`): `status = VOID`, `voidedAt`,
y borra el `OwnerMovement` del ajuste — sus `DebtApplication` caen por cascada.
La fila queda en el historial. **Corregir = anular + crear una nueva**; no se
edita una confirmada.

### Antes de confirmar, la pantalla muestra

```
Saldo esperado del negocio      $150,00
Saldo total de la cuenta        $220,00
Componente personal declarado  −$120,00
Saldo real del negocio          $100,00
                               ─────────
Diferencia en contra            −$50,00

Se registrará una salida de $50,00 a favor de <contraparte>:
  · $30,00 → Filamento PLA negro (gasto del 12/08/2026)
  · $20,00 → Cuota préstamo A1 (02/09/2026)
  Excedente como retiro:  $0,00
Orden de aplicación: de la más antigua a la más reciente.

⚠️ Esto es una regla del negocio para la cuenta compartida, no una causa
   comprobada del faltante.
[ Registrar otra explicación ]   [ Cancelar ]   [ Confirmar ]
```

## 7. Migración de datos

En este orden, dentro de una sola migración:

1. Crear `Counterparty` **OWNER** por organización, `isDefault = true`, nombre =
   el de la `Organization` (el dueño lo renombra después).
2. Crear `Counterparty` **EXTERNAL_LENDER** por cada `Loan` con nombre.
3. Crear `CashAccount` "Binance", `kind = EXCHANGE`, `currency = USD`,
   `shared = true`, `sharedWith` = el propietario, `isDefault = true`,
   `autoAttributeShortfall = false`.
4. Renombrar `CashCount` → `CashReconciliation`; para cada fila:
   `accountId` = esa cuenta, `status = CONFIRMED`, `currency = "USD"`,
   `totalUsd = total`, `expectedUsd = businessCash(ledger, date).balance`,
   `personalAmount = personalUsd = total − expectedUsd` (**preserva exactamente
   lo que la pantalla mostraba hasta hoy**), `differenceUsd = 0`.
5. `refundable = true` en todo lo existente; `counterpartyId` del propietario en
   todos los `OwnerMovement`.
6. **FIFO retroactivo**: correr `applyPayment` sobre los retiros históricos
   ordenados por fecha y persistir sus `DebtApplication` con
   `source = MIGRATION`. Sin esto, `owedToOwner` se dispararía (las obligaciones
   suman y nada las baja).
7. `source = EXCEL_IMPORT` en los registros creados antes de la fecha de corte
   de la importación (`Expense`, `LoanPayment`, `OwnerMovement`, `Sale`,
   `Payment`). **Falta confirmar la fecha de corte con el dueño** antes de
   correr este paso; se saca del `createdAt` de los `import-*.mjs` si no la
   recuerda.

**Verificación obligatoria antes de producción:** `owedToOwner`,
`owedToLender`, `totalOwed` y `balance` tienen que dar **idénticos** antes y
después de la migración, contra un dump de producción restaurado en local. El
reparto por fila de "Quién puso la plata" **sí** va a cambiar; el total no.

## 8. Fases

### Fase 1 — prioridad alta
Modelo, migración, motor 0.21.0 (`sync:shared` al web), API de conciliaciones y
obligaciones, confirmar/anular, y la pantalla adaptada: cuatro líneas de la
conciliación, diálogo de confirmación con el reparto, y "De dónde sale el saldo"
con capital y devoluciones separados.

### Fase 2 — prioridad media (SaaS)
- Migrar el enum `PaidBy` a `counterpartyId` en `Expense` y `LoanPayment`.
  Backfill: `BUSINESS` → `null`, `OWNER` → el propietario, `LOAN` → el
  prestamista del `Loan` asociado. ⚠️ **Un `Expense` con `paidBy = LOAN` no
  tiene `loanId`**: hay que resolver a qué prestamista apunta (probablemente el
  único préstamo abierto de la organización) antes de escribir la migración.
- Textos dinámicos: "Le debe a <nombre>", "Pagos a <nombre>", "Pagado por
  <nombre>". Cero nombres propios en el código.
- "Conteo del lunes" → **"Conciliación de caja"**, cualquier día, con
  `reconciliationFrequency` como recordatorio.
- ABM de cuentas y de contrapartes en Configuración, con los interruptores de
  cuenta compartida y atribución automática.

### Fase 3 — prioridad baja (presentación)
- "Quién puso la plata": **tarjetas** bajo 640 px (una por fuente, con Puesto /
  Recuperado / Falta), tabla desde `sm`. No scroll horizontal: en el móvil del
  dueño una tabla de 4 columnas no se lee.
- "De dónde sale el saldo": cada categoría **desplegable** con sus movimientos
  (`GET /cash/breakdown/:category`).
- Badge discreto **"Importado"** donde `source = EXCEL_IMPORT`.
- Historial de conciliaciones con estado **Cuadrado / Diferencia a favor /
  Diferencia en contra**, si fue ajustada y con qué movimiento (enlace al
  `OwnerMovement`), más el estado `VOID` tachado.

## 9. Consumidores que se rompen, y el orden de despliegue

`GET /cash` cambia de forma, y **no lo lee solo la pantalla de Caja**:

| Consumidor | Qué lee hoy | Qué se rompe |
|---|---|---|
| `calc3d-web` `pages/Cash.tsx` | `balance.*`, `financing.rows`, `counts[].business/personal/short`, `movements` | Todo el bloque de conteos y las líneas del saldo. |
| `calc3d-web` `pages/Dashboard.tsx` | tarjetas de caja | Revisar qué campos toma. |
| **`apps/api/src/reports/reports.module.ts`** | hoja **Caja** del Excel: `b.*` línea por línea, `c.business`, `c.personal`, `financing.rows` | La hoja se cae o escribe `undefined`. **El reporte reusa `CashService` a propósito** (para no tener dos cuentas que discrepen), así que hay que tocarlo en la misma fase. |

⚠️ **La respuesta se arma campo por campo** en `CashService.summary()`, igual que
el `serialize()` de campañas: un campo nuevo que no se agregue ahí existe en la
base, compila, y **nunca llega al cliente**. Ya pasó con `stats.quotes` — un tipo
del front no es un contrato.

**Orden de despliegue, obligatorio:** primero la API, después el panel. Se
despliegan por separado y un panel nuevo leyendo la respuesta vieja se cae al
dibujar (pasó el 2026-09-13 con `RestockCard`). Además, React Query conserva el
resumen viejo en caché: en producción no se arregla recargando.

⚠️ **Un push a `main` ES un despliegue a producción.** El `Dockerfile` corre
`prisma migrate deploy` al arrancar el contenedor en Render, así que la
migración se aplica sola contra Railway. El `pg_dump` de respaldo y el **OK
explícito del dueño** van **antes del push**, no antes de un `migrate deploy`
manual que nadie va a llegar a correr.

Al cerrar cada fase, actualizar `docs/excel-vs-app.md` y este `CLAUDE.md`
(sección "Caja y financiamiento", que hoy describe la cascada y el conteo de los
lunes).

## 10. Lo que NO entra, y por qué

**Multicuenta queda preparada en estructura pero no funciona de verdad.**
Ninguna `Sale`, `Expense`, `Payment` ni `LoanPayment` tiene `accountId`, así que
el saldo esperado es **uno solo para todo el negocio**: una segunda cuenta no
tendría contra qué conciliarse. Crear un banco y una caja de efectivo con este
diseño permite conciliar **una sola**. Ponerle cuenta a cada movimiento (y
transferencias entre cuentas) es una migración grande y una **fase 4** aparte.

Tampoco entra: conciliación parcial por rango de fechas, adjuntar comprobantes,
ni multi-usuario con aprobación de conciliaciones.

## 11. Tests

### `shared` (los que mandan)
- `applyPayment`: exacto, parcial, excedente sin deuda, deuda en cero,
  `NEWEST_FIRST`, y que nunca produzca `outstanding` negativo.
- `reconcile`: `SQUARE` dentro de la tolerancia, `FAVOR`, `SHORT`, y que el
  total de la cuenta no influya salvo vía `total − personal`.
- `businessCash`: capital vs reembolsable; que una devolución no cuente como
  gasto; que `balance` dé igual que en 0.20.0 con los mismos datos.
- `obligationLedger`: orden por fecha, exclusión de los no reembolsables.

### API
- Confirmar dos veces → **409** y **un solo** `OwnerMovement` de ajuste.
- Anular revierte el movimiento y sus aplicaciones; la fila queda con `VOID`.
- Cuenta compartida: con `autoAttributeShortfall = false` no se crea nada.
- Moneda no USD sin `rate` → **400**.

### Seguridad (obligatorio: toca dinero — ver "Pruebas anti-exploit")
Primero rojos contra el código actual, después el fix:
- **IDOR**: `GET`/`POST`/`void` de una conciliación u obligación de **otra
  organización** → 403/404.
- **Mass-assignment**: mandar `expectedUsd`, `differenceUsd`, `totalUsd`,
  `status`, `confirmedAt` u `organizationId` en el body → el `ValidationPipe`
  los descarta **y** el registro queda con el valor calculado en el servidor.
- **Límite solo-UX**: la regla automática no se dispara aunque el front mande
  una señal de ajuste, si `autoAttributeShortfall = false` en la cuenta.
- **Reuso**: la misma conciliación no puede generar dos ajustes
  (`cashReconciliationId @unique` + precondición de estado).

**Dónde van:** los de aislamiento se suman a
`apps/api/src/common/multi-tenant.audit.spec.ts`, que ya fija ese contrato para
`OrdersService`, `StoreService` y `ClientsService`. Los demás van en
`apps/api/src/cash/cash.service.spec.ts`. Este repo **no tiene `.githooks/`**:
la suite corre con `pnpm -r test` y `pnpm test:shared`, y tiene que quedar
verde antes de dar por terminada cada fase.

## 12. Abierto: dos cosas que necesitan respuesta del dueño

1. **Fecha de corte de la importación del Excel** (paso 7 de la migración).
   Sin ella no se puede marcar `source = EXCEL_IMPORT`. Si no la recuerda, se
   saca del `createdAt` más alto de las filas que crearon los `import-*.mjs`,
   contra el dump de producción. **Bloquea la fase 3, no la 1.**
2. **A qué prestamista apunta un `Expense` con `paidBy = LOAN`.** Verificado:
   `Expense` **no tiene `loanId`** — el vínculo no existe en el modelo. Si en
   producción hay un solo préstamo abierto, el backfill lo resuelve solo; si hay
   más de uno, hay que decidir a mano. **Bloquea la fase 2, no la 1.**

Ninguna de las dos frena el arranque de la fase 1.
