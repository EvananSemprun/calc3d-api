# Fase (b) — El pago, los anticipos y el origen en Caja · Plan de implementación

> **Para quien ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`. Los pasos van con `- [ ]` para marcarlos.

**Objetivo:** que lo pagado y no recibido exista como concepto y cuadre, que cada peso que
sale tenga origen legible, y que un pago registre con qué se pagó — **sin tocar un solo
formulario de compra**.

**Arquitectura:** el pago sigue viviendo en las tres tablas que ya existen; lo que se
comparte es un **componente de formulario** y un **contrato de servicio**. Los cálculos
nuevos (`deuda`, `anticipo`, `comprometido`) son funciones **puras** en `packages/shared`,
hermanas de `invoiceTotals`. Caja gana categorías y etiquetas; no cambia su forma de sumar.

**Stack:** NestJS + Prisma (`calc3d-api/apps/api`, **tests Jest**), motor puro con decimal.js
(`calc3d-api/packages/shared`, **tests Jest**), panel React (`calc3d-web/apps/web`,
**vitest**: `.spec.ts` → node, `.spec.tsx` → jsdom).

⚠️ **El runner NO es el mismo en los dos repos, y esta línea no lo decía.** Al despachar las
tareas 2 y 3 afirmé que la API usaba vitest; usa **Jest** (`apps/api/package.json` →
`jest --passWithNoTests`, y no tiene vitest instalado). No rompió nada porque los
implementadores corren los scripts del proyecto, pero un dato de ambiente mal dicho en un
despacho es exactamente lo que hace perder una tarde.

**Spec:** [`../specs/2026-11-10-compras-y-pagos-design.md`](../specs/2026-11-10-compras-y-pagos-design.md)

## Global Constraints

- **`packages/shared` se edita SOLO en `calc3d-api`**; después `pnpm sync:shared` en web.
- **Dinero con decimal.js**, porcentajes como fracción, **la base es siempre USD**.
- **El monto se calcula en el SERVIDOR**, nunca se acepta del cliente. Facturas, proveedores
  y cuentas se validan **por organización** (IDOR). Sin mass-assignment de montos ni de
  estado de pago. **Los tests anti-exploit van en la misma entrega.**
- **La tasa se congela en el pago y no se recalcula nunca.** Se guardan monto original,
  moneda, tasa y monto en USD.
- **Un commit por tarea. NUNCA `git push`.** Sin `--no-verify` ni flags interactivos.
- **No se toca `.env`.** Antes de cualquier migración contra producción: `pg_dump` y OK del
  dueño.
- **Nada de cron**: la infraestructura no corre procesos solos.

## Review Focus

Cinco modos de falla que el spec implica y que ninguna tarea prueba sola:

1. **`saldo` cambiado de significado rompe cuatro pantallas en silencio.** Lo leen seis
   lugares; solo uno pasa a `deuda`. Si `saldo` se redefine, abonar C-0001 arranca
   precargado en **$0** y el aviso de «pagás de más» salta en un abono legítimo. → Tarea 1,
   paso 1.
2. **`MAINTENANCE` entra en el precio de cada cotización.** `derivedMaintenance` no tiene
   ventana de fechas: una línea de servicio recurrente ahí encarece la hora-máquina de todo
   el catálogo. → Tarea 4, paso 5.
3. **El invariante de cierre escrito sin `− Deuda` se pone rojo el día de la primera compra
   a crédito.** → Tarea 9, paso 1.
4. **Un abono tomado del saldo a favor NO mueve la caja**, y un pago de bolsillo SÍ genera
   obligación: las dos reglas viven en la misma función y la precedencia importa
   (`fromCredit` gana sobre el pagador). → Tarea 7, paso 3.
5. **La conciliación filtrada por cuenta con movimientos sin cuenta inventa un faltante** —
   y con `autoAttributeShortfall` lo convierte en deuda saldada. → Tarea 8, paso 4.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `packages/shared/src/calc/purchase-invoice.ts` | `valorRecibido`, `deuda`, `anticipo`, `comprometido`, hermanos de `invoiceTotals`. **`saldo` y `aFavor` no se tocan** |
| `packages/shared/src/calc/cash.ts` | `CashCategory` gana las categorías nuevas; `CASH_SIGN` las acompaña |
| `apps/api/src/cash/helpers-de-caja.ts` | El prorrateo deja de ser binario |
| `apps/api/src/cash/datos-de-caja.ts` | `etiquetasDe` suma los abonos de compra (mata «Sin detalle») |
| `apps/api/src/purchase-invoices/deuda-por-proveedor.ts` | Pasa a `deuda` + expone `comprometido` |
| `apps/api/src/common/conciliacion-guard.ts` | **Crear.** El aviso de fecha, en el servicio |
| `calc3d-web/apps/web/src/features/pagos/FormularioDePago.tsx` | **Crear.** El componente compartido |

---

## Task 1: `valorRecibido`, `deuda`, `anticipo` y `comprometido`

**Files:**
- Modify: `packages/shared/src/calc/purchase-invoice.ts`
- Modify: `packages/shared/src/calc/purchase-invoice.spec.ts`

**Interfaces:**
- Produces: `InvoiceTotals` gana `valorRecibido`, `deuda`, `anticipo` y `comprometido`.
  `total`, `pagado`, `saldo`, `aFavor`, `aFavorDisponible`, `pedido`, `recibido` y
  `porRecibir` **no cambian de valor ni de significado**.

- [ ] **Paso 1: Escribir los tests, con los números REALES de producción**

```ts
// C-0001: total 260, pagado 140, recibido 0
it('C-0001: anticipo 140, deuda 0, comprometido 120', …);
// C-0004 y C-0006: nada pagado, nada recibido
it('C-0004: comprometido 134, sin anticipo ni deuda', …);
// el caso inverso, que es la razón de ser de la fórmula
it('pagaste la mitad y llegó todo: produce DEUDA, no anticipo', …);
it('`saldo` NO cambia de valor en ninguno de los casos anteriores', …);
```

⚠️ **El último es el que protege las otras cinco pantallas.** `saldo` lo leen el prorrateo
del pie del KPI de Gastos, el «Faltan $X de esta factura», el KPI «pendiente de pagar», **el
monto que el diálogo de Abonar trae precargado** y `invoiceStatus().pago`. Es un campo
distinto de `deuda` y responde otra pregunta.

- [ ] **Paso 2: Correr para verificar que fallan** → FAIL, los campos no existen.

- [ ] **Paso 3: Implementar**

`valorRecibido(l)` es el hermano de `dineroDeLinea` que corta en `recibido` en vez de en
`pedido`: las recepciones a su precio real, y lo recibido **sin** recepción registrada al
precio pedido. Después:

```
deuda        = máx(0, valorRecibido − pagado)
anticipo     = máx(0, pagado − valorRecibido)
comprometido = total − máx(pagado, valorRecibido)
```

⚠️ **`comprometido` se recorta en 0.** Con una factura pagada de más da negativo, y un
compromiso negativo no significa nada: ese excedente ya lo cuenta `aFavor`.

- [ ] **Paso 4: Correr** → PASS. Validar con la mutación que se teme: **devolver `saldo` en
  lugar de `deuda`**. Tiene que ponerse rojo; si no, el test no distingue los dos campos.

- [ ] **Paso 5: Commit**

---

## Task 2: Deuda a proveedores pasa a `deuda`, y aparece «Comprometido»

**Files:**
- Modify: `apps/api/src/purchase-invoices/deuda-por-proveedor.ts` y su spec
- Modify: `apps/api/src/loans/loans.module.ts` (`overview`)
- Modify: **`calc3d-web/apps/web/src/pages/Dashboard.tsx:400`** (quien PASA el compromiso)

**Interfaces:**
- Consumes: `InvoiceTotals.deuda` y `.comprometido` de la Tarea 1.
- Produces: `overview.totals` gana `comprometido`; `totals.proveedores` pasa a valer la
  **deuda** nueva.

- [ ] **Paso 1: Escribir los tests con los números de aceptación**

```ts
it('con las 6 facturas de producción, «A proveedores» da 0', …);
it('«Comprometido» da 334, repartido 120 + 134 + 80', …);
it('el total sigue siendo la suma de sus TRES bloques', …);
```

- [ ] **Paso 2: Correr** → FAIL (hoy «A proveedores» da **334**).

- [ ] **Paso 3: Implementar.** `deudaPorProveedor` suma `deuda` en vez de `saldo`, y devuelve
  además `comprometido` por proveedor. `aFavor` **no se toca**.

- [ ] **Paso 4: Repuntar el punto de equilibrio.** ⚠️ **No se toca la función pura.**
  `equilibrioYCompromiso` recibe `compromiso` como **parámetro** (verificado:
  `packages/shared/src/calc/breakeven.ts:89` solo lo documenta). Quien lo lee es
  **`Dashboard.tsx:400`**, que hoy pasa `deuda.data?.totals.proveedores ?? 0` y pasa a pasar
  `totals.comprometido`.

  ⚠️ **El número en pantalla no cambia** (sigue siendo $334), pero el campo del que sale,
  sí. Sin este paso esa línea **desaparece del Dashboard** el día que «A proveedores» valga
  $0, y nadie lo va a leer como un bug: va a parecer que ya no hay compromisos.

- [ ] **Paso 5: Correr** → PASS, y comprobar que el test de `equilibrioYCompromiso` cuya
  mutación obligatoria es *sumar el compromiso a `fixedMonthly`* **sigue rojo con esa
  mutación**.

- [ ] **Paso 6: Commit**

---

## Task 3: Los abonos dejan de decir «Sin detalle»

**Files:**
- Modify: `apps/api/src/cash/datos-de-caja.ts` (`etiquetasDe`)
- Modify: `apps/api/src/cash/cash.service.spec.ts`

- [ ] **Paso 1: Escribir el test**

```ts
it('un abono a C-0006 se muestra como «Factura C-0006 · <proveedor>»', …);
it('ningún asiento con id cae en «Sin detalle»', …);
```

El segundo es el que impide que vuelva: hoy **todos** los abonos caen ahí, no algunos.

- [ ] **Paso 2: Correr** → FAIL.

- [ ] **Paso 3: Implementar.** `etiquetasDe` arma el mapa desde cinco orígenes y
  `d.abonosDeCompra` **no está**; el id del abono sí llega al asiento, así que el `get()`
  devuelve `undefined` y cae al respaldo. Se agrega el bucle que falta.

- [ ] **Paso 4: Correr** → PASS. **`SIN_DETALLE` no se borra**: sigue siendo el respaldo
  correcto para un asiento **sin id**.

- [ ] **Paso 5: Commit**

---

## Task 4: El prorrateo por tipo real, y las categorías nuevas de Caja

**Files:**
- Modify: `packages/shared/src/calc/cash.ts` (`CashCategory`, `CASH_SIGN`, `cashEntries`)
- Modify: `apps/api/src/cash/helpers-de-caja.ts` (`proporcionDeFilamento`)
- Modify: `apps/api/src/cash/cash.service.ts`, el panel de Caja y la hoja Caja del Excel

**Interfaces:**
- Produces: `CashCategory` gana `consumables`, `services`, `advertising` y
  `supplierAdvances`, cada una con su `CASH_SIGN`.

- [ ] **Paso 1: Escribir los tests**

```ts
it('un abono a una factura con filamento e insumo se reparte entre las DOS', …);
it('la placa de C-0001 (insumo, $40 de $260) NO cuenta como filamento', …);
it('una factura sin líneas sigue contando como filamento', …);  // el caso de hoy
it('la suma de las categorías sigue dando el mismo saldo', …);
```

- [ ] **Paso 2: Correr** → FAIL.

- [ ] **Paso 3: Implementar el reparto.** `proporcionDeFilamento` devuelve hoy **una**
  fracción con `if (l.printerId == null) deFilamento += monto` — binario: impresora o
  filamento. Pasa a devolver un **mapa categoría → fracción**, mirando `materialId`,
  `printerId`, `componentId` y el tipo de línea.

⚠️ **El prorrateo es una convención declarada, no un descuido**: un abono no fue a una línea
concreta, y se reparte para que «Filamento comprado» siga queriendo decir todo el filamento.
Lo que estaba viejo era que el reparto conociera **dos** clases cuando hay cinco.

- [ ] **Paso 4: La fila «Anticipos a proveedores».** Es `supplierAdvances`, alimentada por
  `anticipo` de la Tarea 1, con el mismo reparto por categoría.

- [ ] **Paso 5: ⚠️ Comprobar que nada aterriza en `MAINTENANCE` por accidente.**

```ts
it('una línea de Servicio NO produce un gasto MAINTENANCE', …);
it('derivedMaintenance da el mismo número antes y después', …);
```

`derivedMaintenance` es `Σ gastos MAINTENANCE ÷ horas`, **sin ventana de fechas**, y de ahí
sale el `maintPerHour` de `calculateQuote` y del recosteo de la tienda. Una categoría mal
mapeada encarece **todo lo que se cotiza**, para siempre y sin aviso.

- [ ] **Paso 6: Correr** → PASS. Mutación: **devolver el mapa binario de antes** tiene que
  poner rojo el test de la placa.

- [ ] **Paso 7: Commit**

---

## Task 5: Moneda, tasa, cuenta y «¿se te devuelve?» en el abono

**Files:**
- Modify: `apps/api/prisma/schema.prisma` + migración **aditiva**
- Modify: `packages/shared/src/schemas/api.ts` (`PurchaseInvoicePaymentSchema`)
- Modify: `apps/api/src/purchase-invoices/purchase-invoices.module.ts`
- Modify: `calc3d-web/apps/web/src/pages/Purchases.tsx` (el `guardar()` del modal Abonar)

- [ ] **Paso 1: Escribir los tests**

```ts
it('un abono en Bs guarda monto original, moneda, tasa y monto en USD', …);
it('la tasa guardada NO se recalcula al leer', …);
it('el abono guarda la cuenta que mandó el modal', …);
it('una cuenta de otra organización se rechaza', …);     // IDOR
it('el monto en USD lo calcula el SERVIDOR, no se acepta del cliente', …);
```

- [ ] **Paso 2: Correr** → FAIL.

- [ ] **Paso 3: Migración aditiva.** `PurchaseInvoicePayment` gana `currency`, `rate`,
  `amountOriginal` y `refundable`. **`accountId` YA EXISTE** y el schema Zod ya lo acepta.

- [ ] **Paso 4: Cablear `accountId` en el modal.** Son **tres líneas**: `guardar()` manda
  hoy `{id, date, amount, counterpartyId, note, tomadoDeFacturaId}` y la cuenta no está. El
  dueño ya la escribe a mano en la nota («Binance», «Binance del estado de cuenta del
  23/10»).

- [ ] **Paso 5: Correr** → PASS.

- [ ] **Paso 6: Commit**

---

## Task 6: El formulario de pago compartido

**Files:**
- Create: `calc3d-web/apps/web/src/features/pagos/FormularioDePago.tsx` + su spec
- Modify: el modal Abonar de `pages/Purchases.tsx` para que lo use

**Interfaces:**
- Produces: `<FormularioDePago valor onChange />` con fecha, monto, quién pagó, cuenta,
  moneda (+ tasa si es Bs), referencia, nota y «¿se te devuelve?».

⚠️ **Es un COMPONENTE, no una entidad.** Las tres tablas de pago que existen
(`PurchaseInvoicePayment`, `LoanPayment`, `OwnerMovement`) **no se fusionan**: cada una tiene
semántica propia y entre las tres hay del orden de 300 tests.

- [ ] **Paso 1: Escribir el test** — que con moneda Bs pida tasa y calcule el USD, que sin
  Bs no muestre tasa, y que el monto en USD sea **derivado y no editable**.

- [ ] **Paso 2: Correr** → FAIL. **Paso 3:** implementar. **Paso 4:** correr → PASS.

- [ ] **Paso 5: Usarlo en el modal Abonar** y comprobar que los tests de la Tarea 5 siguen
  verdes: el formulario cambia, el contrato no.

- [ ] **Paso 6: Commit**

---

## Task 7: El abono de bolsillo genera obligación

**Files:**
- Modify: `packages/shared/src/calc/obligations.ts` (`OBLIGATION_SOURCES`)
- Modify: `apps/api/src/cash/datos-de-caja.ts` (`obligacionesDe`)

- [ ] **Paso 1: Escribir los tests**

```ts
it('un abono que puso el propietario entra en lo que el negocio le debe', …);
it('con los datos de HOY, la deuda con el propietario sigue dando 967,77', …);
it('un abono tomado del saldo a favor NO genera obligación ni mueve la caja', …);
```

⚠️ **El segundo es el invariante.** Medido: los 8 abonos que existen los puso la caja del
negocio, **ninguno el propietario**, así que arreglar este bug **no mueve el número**. Si se
mueve, algo más cambió.

⚠️ **El tercero fija la precedencia**, que es la misma de `cashEntries`: primero
`fromCredit`, después el prestamista, después la contraparte. Un abono tomado del saldo a
favor **que además tenga contraparte** es saldo a favor: esa plata ya salió.

- [ ] **Paso 2: Correr** → FAIL (el segundo pasa, los otros dos no).

- [ ] **Paso 3: Implementar.** `OBLIGATION_SOURCES` es hoy
  `['EXPENSE','LOAN_PAYMENT','MOVEMENT']` y `obligacionesDe` no recorre `abonosDeCompra`,
  **aunque el dato está a mano**. Categoría: `PURCHASE`. `refundable` sale del campo nuevo
  de la Tarea 5.

- [ ] **Paso 4: Correr** → PASS. **Paso 5: Commit**

---

## Task 8: El aviso de conciliación, en el servicio

**Files:**
- Create: `apps/api/src/common/conciliacion-guard.ts` + su spec
- Modify: los servicios de escritura de dinero y sus DTOs

- [ ] **Paso 1: Escribir los tests**

```ts
it('guardar con fecha ≤ a una conciliación CONFIRMADA exige confirmación', …);
it('con el flag de confirmación, guarda y ofrece anular la conciliación', …);
it('una conciliación en DRAFT también avisa', …);
it('una fecha posterior no pide nada', …);
```

- [ ] **Paso 2: Correr** → FAIL: hoy **no existe ninguna validación de fecha contra
  conciliaciones** (verificado: fuera de `cash/`, el único resultado es un comentario).

- [ ] **Paso 3: Implementar en el servicio, no en cada formulario.** Un flag de confirmación
  en el DTO, con el precedente de `confirmoFueraDePlazo`.

⚠️ **El caso DRAFT es el que motivó el pedido**: una confirmada congela sus importes y ya
tiene el aviso `stale` — que solo se ve **expandiendo la fila**. Una DRAFT no congela nada y
cambia en silencio.

⚠️ **«Recalcular» una CONFIRMADA es anular y crear una nueva** (decisión del dueño): no se
re-congela en sitio, o deja de ser un documento.

- [ ] **Paso 4: ⚠️ El esperado sigue siendo GLOBAL.** Mientras exista **un solo** movimiento
  sin cuenta, la conciliación no se filtra por cuenta. Con los ~100 pagos históricos sin
  cuenta, filtrar inventa un faltante — y con `autoAttributeShortfall` encendido lo convierte
  en deuda saldada.

```ts
it('con movimientos sin cuenta, el esperado NO se filtra por cuenta', …);
```

- [ ] **Paso 5: Correr** → PASS. **Paso 6: Commit**

---

## Task 9: El invariante de cierre y los tests anti-exploit

**Files:**
- Create: `apps/api/src/cash/invariante-de-compras.spec.ts`
- Create: `apps/api/src/purchase-invoices/seguridad.spec.ts`

- [ ] **Paso 1: El invariante, escrito COMPLETO**

```ts
it('Gastos recibidos + Anticipos − Deuda = lo que salió de Caja por compras', …);
it('se sostiene con una factura recibida y SIN pagar', …);
```

⚠️ **El `− Deuda` no es opcional.** Sin él la regla es `máx(pagado, recibido) = pagado`, que
**se rompe el día de la primera compra a crédito** — justo el caso que la fórmula existe
para cubrir. El segundo test es el que lo demuestra.

- [ ] **Paso 2: Los anti-exploit**

```ts
it('el monto del pago no se acepta del cliente: se calcula en el servidor', …);
it('una factura de otra organización da 404', …);          // IDOR
it('un proveedor de otra organización da 404', …);         // IDOR
it('una cuenta de otra organización da 404', …);           // IDOR
it('no se puede mandar el estado de pago en el body', …);  // mass-assignment
```

⚠️ **Cada test de aislamiento va con su HERMANO ALCANZABLE** (la misma fila SÍ se ve desde
su organización): sin él, una función que devuelva vacío siempre pasa los cuatro.

- [ ] **Paso 3: Correr, implementar lo que falte, volver a correr** → PASS

- [ ] **Paso 4: Commit**

---

## Task 10: Verificar contra los números de aceptación

**Files:**
- Modify: `../specs/2026-11-10-compras-y-pagos-design.md` (§6, con el resultado)

- [ ] **Paso 1: Todo en verde** — `pnpm test` y `pnpm check` en los dos repos, más
  `pnpm test:shared`.

- [ ] **Paso 2: Respaldo y ensayo.** `pg_dump` de producción **antes de nada**, y correr la
  verificación contra una copia, nunca contra producción.

- [ ] **Paso 3: Contrastar la tabla del §6, fila por fila**

| Tiene que dar | |
|---|---|
| Saldo del negocio | **$49,00** (igual) |
| Deuda con el propietario | **$967,77** (igual) |
| Deuda con el prestamista | **$650,00** (igual) |
| Caja «Filamento comprado» | **−$1.663,91** (de −$1.803,91) |
| «Anticipos a proveedores» | **−$140,00** (nueva) |
| «A proveedores» | **$0,00** (de $334,00) |
| «Comprometido» | **$334,00** (nueva) |
| Deuda total | **$1.617,77** (de $1.951,77) |

⚠️ **Si un número de PARTIDA no coincide: parar y avisar.** No acomodar. (Instrucción
explícita del dueño.)

⚠️ **El efectivo que salió/entró se verifica por FECHA Y MONTO, no por cuenta**: lo
histórico no tiene cuenta y no se le pone un default (§12.3).

- [ ] **Paso 4: Escribir el resultado en el §6 del spec** y commit. **Acá termina la fase.
  NO se hace `push`.**
