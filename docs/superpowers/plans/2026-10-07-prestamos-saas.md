# Préstamos: acreedor dinámico, trazabilidad y las dos deudas

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development`,
> tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el módulo maneje varias deudas con personas o entidades con
nombre, que cada pago se pueda rastrear y revertir, y que la pantalla muestre
las **dos** deudas del negocio sin confundirlas.

**Stack:** TypeScript, Zod, NestJS, Prisma + PostgreSQL, Jest, React + React
Query + Tailwind.

**Orden:** va **DESPUÉS** de [Metas](2026-10-07-metas-sugerencias.md), con su
propio despliegue. Arrastra una migración sobre 86 gastos y 4 cuotas ya
cargados: no comparte push con otra cosa.

> ⚠️ Los pasos de `git commit` se ejecutan, **uno por tarea**. `git push` sigue
> prohibido salvo pedido explícito.

---

## Decisiones tomadas antes de este plan

### 1. Esto ES la fase 4, que ya estaba diseñada

`Expense.paidBy` y `LoanPayment.paidBy` dejan de ser el enum
`BUSINESS/OWNER/LOAN` y pasan a `counterpartyId` nulable. El diseño estaba
decidido y documentado en `calc3d-api/CLAUDE.md` desde la fase 2 de Caja:

- **`null`** = la caja pagó;
- **contraparte `OWNER` o `PARTNER`** = genera obligación del negocio con ella;
- **contraparte `EXTERNAL_LENDER`** = no genera obligación (la deuda es el saldo
  del préstamo, no el gasto).

Conservar los dos campos se descartó: dos que significan lo mismo terminan
divergiendo.

### 2. La pregunta que el spec de Caja dejó abierta: resuelta por los datos

El spec decía que un `Expense` con `paidBy = LOAN` **no tiene `loanId`** y que
había que decidir a qué prestamista apunta. Medido en producción el 2026-10-07:

```
gastos: BUSINESS 71 · OWNER 14 · LOAN 1
cuotas: OWNER 4
préstamos abiertos: 1
el único gasto LOAN: 2026-07-27 · $917 · "Impresora P2S + Envio — inversión"
```

**Un solo gasto `LOAN` y un solo préstamo abierto**: el backfill lo resuelve sin
ambigüedad. ⚠️ Aun así, el script tiene que **abortar** si encuentra más de un
gasto `LOAN` o más de un préstamo abierto: la base de producción puede haber
cambiado para cuando esto se corra, y adivinar el acreedor de un gasto de $917
no es algo que un script deba hacer solo.

### 3. Esta migración toca el MOTOR DE CAJA, no solo Préstamos

Es el riesgo principal y hay que decirlo fuerte. Hoy el motor decide con el enum:

| En `packages/shared/src/calc/cash.ts` | Hoy | Después |
|---|---|---|
| `operativo` | `!isInvestment && paidBy !== 'LOAN'` | la contraparte no es `EXTERNAL_LENDER` |
| `deLaContraparte` | `paidBy === 'OWNER'` | la contraparte es `OWNER` o `PARTNER` |
| `equipment` | `isInvestment && paidBy === 'BUSINESS'` | `isInvestment` y sin contraparte |
| `loanPayments` | `paidBy === 'BUSINESS'` | sin contraparte |

El ledger pasa a llevar **la contraparte y su tipo**, no un enum. El tipo hace
falta: el motor necesita saber si quien pagó genera obligación, y eso no se
deduce de un id.

**Criterio de aceptación, no negociable:** `balance`, `owedToOwner`,
`owedToLender`, `totalOwed` y **las nueve líneas de `businessCash`** tienen que
dar **idénticos** antes y después, contra un dump de producción restaurado en
local. Igual que en Caja fase 1. Si algo se mueve un centavo, la migración está
mal.

### 4. El pago de la deuda de la contraparte, de regalo

`obligaciones()` en `cash.service.ts` recibe `counterpartyId` pero **solo lo usa
para los movimientos**: los gastos y las cuotas filtran por `paidBy === 'OWNER'`
a secas. Con una sola contraparte es inocuo; con un socio, su cuenta compartida
derivaría como deudas suyas **todos los gastos que pagó el propietario**.

Esta migración lo arregla por construcción: el filtro pasa a ser por contraparte
de verdad. **Agregar el test que hoy no se puede escribir** (una obligación de
otra contraparte, del tipo `EXPENSE`, se excluye) es parte del trabajo.

### 5. La página muestra DOS deudas, separadas

Son cosas distintas que hoy comparten la palabra "préstamo":

- **Deuda con el prestamista** — el préstamo externo. Se paga con cuotas y su
  saldo es capital menos pagos.
- **Deuda con el propietario** — lo que el negocio le debe por lo que puso
  (equipos, diseñador, aportes). Son obligaciones derivadas, y es **acá** donde
  caen los pagos por conciliación.

Van en bloques separados y rotulados.

**Caja NO pierde nada.** El dueño decidió (2026-10-07) que las obligaciones se
vean en los dos lugares, con enfoques distintos:

- **Caja** sigue con "Quién puso la plata": el **resumen por fuente** — cuánto
  pusiste, cuánto recuperaste, cuánto falta. Es la lectura de un vistazo.
- **Préstamos** muestra **cada obligación una por una, con sus pagos**. Eso hoy
  no se puede ver en ningún lado: el agregado esconde qué gasto concreto sigue
  sin devolverse.

⚠️ **Los dos salen del MISMO servicio.** Si Préstamos recalcula las
obligaciones por su cuenta, el día que un filtro cambie las dos pantallas van a
decir cosas distintas sobre la misma deuda. El reporte de Excel ya reusa
`CashService` por exactamente este motivo.

⚠️ **La regla no cambia:** el faltante de una conciliación **solo** puede
aplicarse a deudas del propietario. Que el préstamo externo aparezca en la misma
pantalla no lo vuelve un destino válido: el faltante es plata que salió de la
caja sin anotarse, y decir que fue a pagarle al banco es una afirmación más
fuerte que decir que se la llevó el dueño.

### 6. La cuota es un OBJETIVO, y los pagos son irregulares

Los datos del préstamo real:

```
Deuda impresora P2S · capital $1.000 · cuota declarada $100/mes · desde 14/07
pagos: 14/07 $50 · 08/08 $50 · 18/08 $100 · 31/08 $50 · (+1 el 02/10)
```

Montos distintos, nada en septiembre. El dueño confirmó que **los $100 son su
objetivo mensual**, no un compromiso con el acreedor ni un promedio observado.

- El **punto de equilibrio sigue usándolos** (nivel 2): es correcto que te exija
  cubrir lo que te propusiste.
- La pantalla los rotula **"cuota objetivo"**, no "cuota".
- **"Faltan X meses" muestra las dos lecturas**: al ritmo objetivo y al ritmo
  real de los pagos. Hoy dice 8 meses (750 ÷ 100) y eso es una sola verdad de
  dos posibles.
- **No hay calendario de vencimientos.** `nextDueDate` es un campo **opcional
  que el dueño escribe**: si está vacío, no se muestra nada. No se inventa una
  fecha a partir de la frecuencia.

### 7. Que un pago personal genere deuda se PREGUNTA, no se asume

Hoy `LoanPayment.refundable` tiene `@default(true)`: todo pago del propietario
genera obligación sin que nadie lo decida. El pedido es explícito — *"permite
indicar si ese pago genera una nueva obligación; no lo asumas automáticamente"*.
Pasa a ser una elección del formulario. El default de la base **se conserva**
para no alterar los 4 pagos históricos.

### 8. Lo demás que se decidió

- **Dos roles por pago**: quién aporta y quién recibe. "Quién registra" es
  auditoría de usuarios y hoy hay uno solo: sería una columna repitiendo el
  mismo nombre.
- **USD directo.** `currency` y `rate` entran al modelo **sin UI**: el dueño
  paga en dólares y agregar los campos a la pantalla sería fricción para nada.
- **Sin estado `Cancelado`.** Solo Activo y Pagado, derivados del saldo. Un
  cancelado sin regla para el saldo restante es una deuda que desaparece sin que
  nadie diga qué pasó con la plata.
- **Anular un pago no lo borra**: queda con su estado y el saldo se recalcula.
  Mismo patrón que `CashReconciliation`.

### 9. Lo que NO entra

- **Intereses.** El modelo se prepara para separar principal e intereses
  (un campo para la parte que no amortiza), pero **sin UI ni cálculo**: el
  préstamo real no tiene intereses y una amortización a medias es peor que
  ninguna.
- **Calendario de vencimientos** con cuotas imputables.
- **Refinanciación** o traspaso de saldo entre préstamos.
- **Multi-moneda en la pantalla** (ver decisión 8).

---

## Estructura de archivos

### `calc3d-api`

```
packages/shared/
  package.json · src/version.ts        MOD  0.25.0 → 0.26.0
  src/calc/cash.ts                     MOD  el ledger lleva contraparte, no enum
  src/calc/loan.ts                     MOD  frecuencia, ritmo real, estado
  src/calc/obligations.ts              MOD  filtro por contraparte
  src/schemas/api.ts                   MOD  DTOs de préstamo y pago

apps/api/
  prisma/schema.prisma                 MOD  Loan y LoanPayment; muere PaidBy
  prisma/migrations/                   NEW  dos: columnas, y luego el enum
  prisma/backfill-pagadores.mjs        NEW  dry-run + reversa
  src/cash/cash.service.ts             MOD  ledger y obligaciones
  src/loans/loans.module.ts            MOD  acreedor, anulación, dos bloques
  src/reports/reports.module.ts        MOD  hoja Caja y cuotas normalizadas
```

### `calc3d-web`

```
apps/web/
  src/features/loans/api.ts            MOD
  src/features/finance/api.ts          MOD  paidByLabels deja de existir
  src/pages/Loans.tsx                  MOD  dos bloques, tarjetas en móvil
  src/pages/Expenses.tsx               MOD  "¿Quién lo pagó?" pasa a contrapartes
```

---

## Tarea 1: el motor deja de conocer el enum

**Archivos:** `packages/shared/src/calc/cash.ts`, `obligations.ts`, sus specs

- [ ] 1.1 — En `CashLedger`, los asientos de `expenses` y `loanPayments` cambian
  `paidBy: PaidBy` por la contraparte **y su tipo**. El motor necesita el tipo:
  si genera obligación o no, no se deduce de un id.

- [ ] 1.2 — Traducir los cuatro filtros de la tabla de la decisión 3.
  ⚠️ **`cashEntries` es la ÚNICA clasificación** desde la fase 3 de Caja: se
  tocan ahí los filtros y `businessCash` sigue siendo un `reduce`. Si aparece
  una segunda clasificación, el detalle de cada línea va a sumar distinto que la
  línea.

- [ ] 1.3 — `obligationLedger` / las entradas de obligación llevan contraparte,
  para que el filtro de la decisión 4 se pueda escribir.

- [ ] 1.4 — **Ningún test existente de `cash.spec.ts` se adapta "para que pase".**
  Van a tener que cambiar porque el tipo del ledger cambió, pero **los valores
  esperados no se tocan**: si un número esperado cambia, el refactor está mal.
  Los **números clavados** de la fase 3 son la red real — el invariante
  `suma(entries) === businessCash[x]` es tautológico y no protege nada.

- [ ] 1.5 — Tests nuevos: un gasto de contraparte `EXTERNAL_LENDER` no toca la
  caja; uno de `PARTNER` genera obligación igual que uno de `OWNER`; una
  obligación de otra contraparte **se excluye** (el test de la decisión 4, que
  hoy no se puede escribir).

- [ ] 1.6 — **Verificación por mutación:** sacarle `paidBy === 'BUSINESS'` al
  equivalente de `equipment` y confirmar que rompe **tests viejos**. Es la
  mutación con dientes verificada en la fase 3; la de `LOAN` en `operativo` no
  rompía ninguno.

- [ ] 1.7 — Subir a `0.26.0` (`SHARED_VERSION` y `package.json` a la par).

- [ ] 1.8 — `git commit`

---

## Tarea 2: el schema y las dos migraciones

**Archivos:** `prisma/schema.prisma`, dos migraciones

- [ ] 2.1 — `Loan` gana: **acreedor** (`counterpartyId`, obligatorio al crear),
  concepto/descripción, frecuencia del objetivo (default mensual), `nextDueDate`
  opcional. `monthlyPayment` se renombra a algo que diga **objetivo**.

- [ ] 2.2 — `LoanPayment` gana: **quién aporta** (`counterpartyId` nulable, null
  = la caja), estado de anulación (anulado con fecha y motivo, no borrado),
  `currency` + `rate` **sin UI**, cuenta de origen opcional, y un campo para la
  parte que **no** amortiza capital (intereses), hoy siempre 0.

- [ ] 2.3 — `Expense.paidBy` → `counterpartyId` nulable.

- [ ] 2.4 — **DOS migraciones, en este orden**:
  1. agregar las columnas nulables y los índices;
  2. **recién después** de que el backfill corra, quitar `paidBy` y el enum.

  ⚠️ **Y las dos NO pueden ir en el mismo despliegue.** `migrate deploy` aplica
  todas las pendientes seguidas al arrancar el contenedor: si la segunda entra
  junto con la primera, borra `paidBy` antes de que nadie lo haya traducido.
  Es exactamente lo que casi tumba la API en la fase 1 de Caja. **Lo que el
  motor necesita va en un script aparte que escriba solo columnas nulables.**

- [ ] 2.5 — Generar las migraciones **sin conectarse a ninguna base**
  (`prisma migrate diff` entre dos datamodel). Revisar el SQL a mano: si aparece
  un `DROP TABLE` o un `SET NOT NULL` inesperado, **parar y avisar**.

- [ ] 2.6 — `git commit`

---

## Tarea 3: el backfill de pagadores

**Archivo:** `apps/api/prisma/backfill-pagadores.mjs`

Modelado sobre `backfill-caja.mjs` y `backfill-importado.mjs`, que ya fijan el
patrón.

- [ ] 3.1 — Traduce: `BUSINESS` → `null`; `OWNER` → la contraparte propietaria;
  `LOAN` → el acreedor del único préstamo abierto.

- [ ] 3.2 — **Dry-run por defecto**; escribe con `--write` **o** `--commit`
  (los dos scripts aceptan los dos: que éste no invente una tercera bandera).
  `--undo` que revierte.

- [ ] 3.3 — **Aborta** si hay más de un gasto `LOAN`, o más de un préstamo
  abierto, o ninguna contraparte propietaria activa.

- [ ] 3.4 — ⚠️ **El guard que de verdad importa:** antes de escribir, calcular
  `balance`, `owedToOwner`, `owedToLender`, `totalOwed` y las nueve líneas de
  `businessCash`; después de escribir, recalcular. **Si alguno cambia, revertir
  la transacción y abortar.** Es el mismo guard que `backfill-caja.mjs` ya tiene
  para la deuda, extendido a todo lo que esta migración puede romper.

- [ ] 3.5 — ⚠️ **Timeout de transacción a 120 s.** Los 5 s por defecto de Prisma
  alcanzan en local y **no** contra Railway; el ensayo se corta con *"Transaction
  already closed"*. Los dos backfill que ya existen lo llevan.

- [ ] 3.6 — Correrlo en seco contra la base local y pegar la salida.
  **No correrlo contra producción**: eso es el despliegue.

- [ ] 3.7 — `git commit`

---

## Tarea 4: la API

**Archivos:** `src/loans/loans.module.ts`, `src/cash/cash.service.ts`,
`src/reports/reports.module.ts`, sus specs

- [ ] 4.1 — `datos()` y `obligaciones()` arman el ledger con contraparte. El
  filtro de obligaciones pasa a ser **por contraparte de verdad** en los tres
  orígenes.

- [ ] 4.2 — `GET /loans` devuelve, además de los préstamos con su acreedor: el
  bloque de **obligaciones con el propietario**, con el mismo criterio que usa
  Caja. ⚠️ **Reusar `CashService`**, no reimplementar: el reporte de Excel ya lo
  reusa a propósito para no tener dos cuentas que discrepen.

- [ ] 4.3 — Pagos: crear **no sobrescribe** nada; **no se puede aplicar al
  principal más que el saldo pendiente**; anular **conserva** el pago y
  recalcula.

- [ ] 4.4 — Los pagos que vinieron de una conciliación se identifican como
  **"Pago por conciliación"**, con enlace a su conciliación y a su movimiento de
  Caja, y **cuánto se aplicó a cada obligación** (ya está en `DebtApplication`).

- [ ] 4.5 — `reports.module.ts`: la hoja Caja usa los mismos filtros nuevos.
  ⚠️ Si no se toca en la misma tanda, la hoja se cae o escribe `undefined`.

- [ ] 4.6 — **Tests de seguridad primero, en rojo:**
  - [ ] un `counterpartyId` de **otra organización** en un pago o un préstamo →
    rechazo;
  - [ ] anular un pago de otra organización → rechazo;
  - [ ] un pago que excede el saldo → **400**, y no escribe nada;
  - [ ] anular dos veces → el saldo no se mueve dos veces;
  - [ ] mass-assignment: mandar el saldo, el estado o el `organizationId` en el
    body → el `ZodValidationPipe` **real** los descarta.

  ⚠️ El mock tiene que **modelar la base**: devolver las filas ajenas si el
  `where` no las filtra, con su test hermano de alcanzabilidad. Un mock que
  devuelve `null` ante cualquier `where` inesperado hace pasar el test con y sin
  la protección — pasó en la fase 2 de Caja.

- [ ] 4.7 — **Verificación por mutación** del scope, y reportarla.

- [ ] 4.8 — Sumar las rutas a `multi-tenant.audit.spec.ts`.

- [ ] 4.9 — `git commit`

---

## Tarea 5: estimación y punto de equilibrio

**Archivos:** `packages/shared/src/calc/loan.ts`, `breakeven.ts` (si hace falta)

- [ ] 5.1 — `monthlyLoanPayments` **normaliza la frecuencia a mensual** antes de
  sumar. Hoy suma `monthlyPayment` crudo: con una cuota semanal de $50, el punto
  de equilibrio contaría $50 al mes en vez de $217.

- [ ] 5.2 — `monthsToPayOff` pasa a devolver **dos lecturas**: al ritmo objetivo
  y al **ritmo real** (promedio de pagos por período sobre la historia del
  préstamo). Si no hay cuota objetivo válida **ni** pagos suficientes, devuelve
  que **no se puede estimar** — no un 0, que se leería como "ya está".

- [ ] 5.3 — La unidad se adapta a la frecuencia (meses, quincenas, semanas).

- [ ] 5.4 — Tests: pagos irregulares como los reales (50, 50, 100, 50) dan un
  ritmo real distinto al objetivo; sin pagos, el ritmo real no se puede estimar;
  un préstamo saldado da 0 en las dos lecturas.

- [ ] 5.5 — `git commit`

---

## Tarea 6: la pantalla

**Archivos:** `calc3d-web` — `pages/Loans.tsx`, `features/loans/api.ts`,
`features/finance/api.ts`, `pages/Expenses.tsx`

- [ ] 6.1 — `pnpm sync:shared` a 0.26.0. La dependencia es `workspace:*`: la
  versión la escribe **solo** `sync:shared`.

- [ ] 6.2 — **Dos bloques rotulados**: "Lo que le debés al prestamista" y "Lo
  que el negocio te debe". Que no se puedan confundir de un vistazo.

- [ ] 6.3 — "Nuevo préstamo" gana: **acreedor** (selector de contrapartes, con
  acceso a crear una nueva), concepto, frecuencia del objetivo, próxima fecha
  **opcional**, notas.

- [ ] 6.4 — El formulario de pago gana: **quién aporta** (la caja o una
  contraparte) y, cuando aporta una persona, **si eso genera deuda del negocio
  con ella** — explícito, no asumido (decisión 7).

- [ ] 6.5 — "Faltan X meses" muestra **las dos lecturas** y dice que son
  estimaciones. Si no hay cuota válida, lo dice en vez de callarse.

- [ ] 6.6 — Historial de pagos: **tarjetas bajo `sm`, tabla desde `sm`**, con
  fecha, monto, referencia, quién aportó y origen del dinero.
  ⚠️ Lo que no se puede duplicar es la **lógica**, no el markup: las filas se
  resuelven una vez —`money()` ya llamado, handlers ya cerrados— y se mapean dos
  veces con JSX tonto. Nada de `hidden sm:block` con dos árboles a mano.

- [ ] 6.7 — Estados **Activo** y **Pagado**, derivados del saldo. Un préstamo
  saldado **se conserva** con sus pagos. Nada de `Cancelado`.

- [ ] 6.8 — Badge **"Importado"** donde `source === 'EXCEL_IMPORT'`.

- [ ] 6.9 — `paidByLabels` desaparece: los nombres salen de las contrapartes.
  `grep -rn "Vanan" apps/web/src` tiene que seguir vacío. Y **Gastos** cambia
  "¿Quién lo pagó?" de enum a selector de contrapartes.

- [ ] 6.10 — `FieldGrid` es para campos **lado a lado**; uno solo va como
  `<Field>` pelado. Sin dependencias nuevas.

- [ ] 6.11 — `git commit`

---

## Tarea 7: verificación contra el dump y documentación

- [ ] 7.1 — ⚠️ **La verificación que manda.** Restaurar un dump de producción en
  una base local aparte, calcular los cinco números y las nueve líneas con el
  código **actual**, aplicar las dos migraciones y el backfill, recalcular con
  el código **nuevo**, y comprobar que dan **idénticos**. Es el procedimiento
  que usamos en Caja y el único que prueba que esta migración no mueve plata.

- [ ] 7.2 — Verificar también que las **dos migraciones son seguras en PG 17**
  (Railway) y no solo en PG 18 (local): confirmar contra el dump que todo
  `RENAME CONSTRAINT` apunta a un nombre que existe allá. PG 18 materializa los
  `NOT NULL` como constraints con nombre y PG 17 no.

- [ ] 7.3 — Navegador, midiendo el DOM: los dos bloques se distinguen; el
  historial a **375×812** sin desborde; un pago con deuda generada aparece en el
  bloque correcto.
  ⚠️ Forzar `behavior: 'instant'` para medir scroll, y usar un Chrome real: el
  panel del escritorio no scrollea y sus capturas salen negras en móvil.

- [ ] 7.4 — Actualizar los dos `CLAUDE.md`. En el del API, **la sección de la
  fase 4 pendiente deja de ser pendiente**: reescribirla con lo que quedó, no
  borrarla.

- [ ] 7.5 — `git commit`

---

## Verificación final

- [ ] `pnpm test:shared` y `pnpm -r test` verdes
- [ ] `pnpm -r lint` **sale en 0** en los dos repos
- [ ] Los cinco números y las nueve líneas, **idénticos** contra el dump
- [ ] `grep -rn "Vanan"` vacío en el código de los dos repos
- [ ] Nada pusheado

## Despliegue — tres pasos, no uno

1. **Respaldo** (`pg_dump`) y el **OK explícito del dueño**. Antes del push, no
   antes de un `migrate deploy` que nadie va a llegar a correr a mano.
2. **Push de la API con la PRIMERA migración solamente.** Agrega columnas
   nulables; el código nuevo todavía no depende de ellas.
3. **Correr el backfill** contra producción, con su dry-run primero.
4. **Segunda migración** (quitar `paidBy` y el enum) en un push posterior,
   recién con el backfill verificado.
5. **Panel al final.**

⚠️ Saltarse el paso 3 entre las dos migraciones deja la base traducida a medias
y el motor leyendo contrapartes que no existen. Es el mismo error que en la fase
1 de Caja dejó `DebtApplication` en cero y mostró la deuda inflada en $475,14
durante media hora.

## Pendiente de dato

- [ ] **El nombre del acreedor.** La contraparte prestamista se llama hoy
  "Deuda impresora P2S", que es el nombre de la deuda, no de quien prestó la
  plata. Renombrarla es un `UPDATE` de una fila en producción y necesita que el
  dueño diga el nombre. **No bloquea nada del desarrollo**: se hace en el
  despliegue.
