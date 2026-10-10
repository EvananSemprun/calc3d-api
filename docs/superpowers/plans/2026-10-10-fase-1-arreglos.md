# Fase 1 — Arreglar lo que está roto (y lo que miente)

**Spec:** `docs/superpowers/specs/2026-10-09-compras-y-visibilidad.md`, Fase 1.

**Objetivo:** cinco arreglos que no agregan features: tapan un agujero, matan
un bug y corrigen tres pantallas que dicen algo que no es.

**Stack:** TypeScript, Zod, NestJS, Prisma + PostgreSQL, Jest, React + React
Query + Tailwind. Dos repos hermanos: `calc3d-api` y `calc3d-web`.

> ⚠️ **Un `git push` ES un despliegue.** Commit por tarea; el push lo pide el
> dueño **al final de la fase**, no antes.
> ⚠️ **Nada contra la base de producción.** Todo se prueba en local.
> ⚠️ Al restaurar una mutación, **copia de respaldo, nunca `git checkout --`**:
> así se perdió un día entero de trabajo sin commitear el 2026-10-09.

---

## Tarea 1 — El gasto nacido de una factura no se toca desde Gastos

**Por qué.** `Expense.update` y `Expense.remove` no miran
`purchaseInvoiceLineId`. El gasto del Cyan (producción, cargado el 2026-10-10)
se puede editar o borrar desde Gastos y la factura queda mintiendo: `received`
en 1 con el rollo fuera del inventario, el monto del gasto contra el de la
línea, y el precio de cotización recalculado contra una compra que ya no
existe. Nada avisa.

**API** (`apps/api/src/expenses/expenses.service.ts`)
- [ ] Primero los tests en `expenses.service.spec.ts`, y verlos **en rojo**:
      `update` y `remove` de un gasto con `purchaseInvoiceLineId` → 400
      (`BadRequestException`) con un mensaje que manda a Compras.
- [ ] Cada test de rechazo necesita su **hermano alcanzable**: el mismo
      `update`/`remove` sobre un gasto SIN `purchaseInvoiceLineId` tiene que
      seguir pasando. Sin eso, una guarda que rechace todo pasaría el test.
- [ ] La guarda vive en `ensureOwned` o justo después, antes de escribir nada.
- [ ] Mutación: quitar la guarda tiene que tumbar los dos tests. Restaurar
      desde `cp`, no desde git.

**Web** (`apps/web/src/pages/Expenses.tsx`, `features/finance/api.ts`)
- [ ] `ExpenseRow` gana `purchaseInvoiceLineId?: string | null`. **No hace
      falta tocar la API**: `list()` devuelve las filas crudas de Prisma, así
      que el campo ya viaja. Verificarlo en la respuesta antes de asumirlo.
- [ ] La fila muestra una marca discreta "de factura" al lado de la
      descripción (tooltip: "se corrige en Compras").
- [ ] Esa fila **no** ofrece borrar, y el `Select` de "quién pagó" va
      `disabled`. ⚠️ Ese select llama a `update`: si queda vivo, con la guarda
      puesta tira 400 al tocarlo. Un control que solo sabe fallar es peor que
      no tenerlo.
- [ ] Lo mismo donde se edite una compra de filamento
      (`features/filament/EditarCompra.tsx`): si la compra nació de una
      factura, no se edita.
- [ ] Verificar en pantalla con el panel local: la fila del Cyan sin botones,
      las demás iguales que siempre.
- [ ] `git commit` en los dos repos.

---

## Tarea 2 — Encargar una impresora que todavía no tenés

**Por qué.** Hoy "algo que todavía no tenés" **siempre crea una ficha de
filamento**: encargar una impresora nueva te crea un rollo llamado "Impresora
A2". Y una impresora nueva es, por definición, la que no está en el catálogo.
Verificado el 2026-10-09: en producción hay **0 líneas con `nombreNuevo`**, así
que el bug no alcanzó a hacer daño.

- [ ] `PurchaseInvoiceLine.nuevoTipo` (`MATERIAL` | `PRINTER`), nulable.
      **Migración aditiva**, con `migrate diff --from-migrations` (no
      interactivo).
- [ ] El `refine` del schema en `packages/shared` exige `nuevoTipo` cuando
      viene `nombreNuevo` y lo prohíbe cuando no. Sin eso vuelve la ambigüedad
      por otra puerta. Subir `SHARED_VERSION` y el `version` del `package.json`
      a la par; en la web, `pnpm sync:shared`.
- [ ] `receive()` crea `Material` **o** `Printer` según `nuevoTipo`. Una
      impresora nace con el precio de la compra; horas de vida y consumo quedan
      en el default y se corrigen desde el catálogo.
- [ ] Regresión: línea con `nombreNuevo` y sin `nuevoTipo` → 400; recibir una
      `PRINTER` crea una impresora y **no** un filamento (afirmarlo sobre las
      dos tablas, no solo sobre la que esperás).
- [ ] El formulario pregunta "¿filamento o impresora?" al elegir "algo nuevo".
- [ ] `git commit`.

---

## Tarea 3 — El proveedor en Gastos

**Por qué.** Ya hay 7 gastos con proveedor cargado y la tabla no lo muestra.

- [ ] Columna "Proveedor" en la tabla de escritorio; en las tarjetas del
      teléfono, debajo de la descripción.
- [ ] Filtro por proveedor con las mismas opciones del formulario (contactos
      tipo Proveedor). Si el `Select` llega a 8 opciones, el buscador ya sale
      solo: no hay que hacer nada.
- [ ] ⚠️ Verificar el ancho a **375 px**: la tabla ya está justa. Si no entra,
      la columna se cae a la tarjeta y en escritorio se queda.
- [ ] `git commit`.

---

## Tarea 4 — La cadena de caja del Dashboard

**Por qué.** Con el filtro en "Este mes", la tarjeta "Resultado de caja" decía
**−61.20** mientras "Saldo en caja" decía **102.83**. El dueño leyó la primera
como un saldo — y no lo es: ignora los $50 que puso de su bolsillo, ignora los
$29.19 que se le devolvieron y cuenta el Cyan por los $25 que cuesta en vez de
los $15 que salieron. La caja de verdad: **venías con 133.22, octubre −30.39,
quedan 102.83**.

- [ ] API: el resumen de caja acepta una fecha y devuelve el saldo **hasta**
      ella. `businessCash(ledger, hasta)` ya lo calcula; falta exponerlo
      (parámetro de consulta, validado; una fecha inválida no puede devolver
      el saldo entero como si nada).
- [ ] Dashboard: la cadena "venías con $X · {periodo} $Y · te queda $Z", con
      **una sola definición**, la de Caja. Los tres números tienen que cerrar
      entre sí: Z = X + Y. Test de ese armado con números a mano.
- [ ] "Resultado de caja" → **"Resultado de la operación"**, y el pie dice qué
      NO incluye (aportes, devoluciones, cuotas).
- [ ] ⚠️ El color de alarma pasa al **saldo**. Un mes en rojo con $102.83 en la
      cuenta no es una emergencia; un saldo en rojo sí.
- [ ] ⚠️ Con el filtro en "Todo" la cadena no significa nada (no hay "antes"):
      en ese caso se muestra solo el saldo.
- [ ] `git commit`.

---

## Tarea 5 — "Mostrador vs encargo" no muestra los encargos

**Por qué.** Con el filtro en octubre la dona dice **100 % mostrador**. En
producción: mostrador $26.75, encargos $114.05 en 4 abonos. **Falta el 81 % de
lo que entró**, y el gráfico afirma lo contrario de la verdad.

La dona se arma solo con `Sale.kind`. Las 25 ventas `ENCARGO` son totales
semanales del Excel y se cortan el 2026-08-24: desde que la app tomó el
control, un encargo genera **abonos** (`Payment`), no ventas. El resto de la
pantalla ya lo sabe (`byDay`, `byWeekday`, "Cobrado de encargos"); la dona
quedó afuera.

- [ ] Encargos = ventas `ENCARGO` **+ abonos del periodo**; mostrador = ventas
      `COUNTER`. El total de la dona pasa a ser exactamente
      "Ventas + Cobrado de encargos".
- [ ] ⚠️ **No** convertir los abonos en `Sale`: ahí está el doble conteo que la
      app evita a propósito.
- [ ] Test del armado con números a mano: un mes solo con abonos no puede dar
      100 % mostrador.
- [ ] ⚠️ Revisar el selector "Canal: todos / mostrador / encargos": si filtra
      solo las ventas y no los abonos, elegir "encargos" muestra una pantalla
      vacía. Arreglarlo o decir por qué no hacía falta.
- [ ] `git commit`.

---

## Tarea 6 — Deshacer una recepción (la salida del callejón)

**Por qué.** La Tarea 1 cerró bien el agujero, pero dejó una pared: con la
guarda puesta, una línea YA RECIBIDA no se puede corregir **por ninguna
puerta**, y los mensajes de error se mandan unos a otros en círculo.

```
Gastos          → "se corrige desde Compras"
Factura/editar  → "anulá la factura y cargala de nuevo"
Factura/anular  → "corregilas desde Compras de filamento"  ← lo que cerró la Tarea 1
Factura/borrar  → "tiene mercadería recibida: no se borra"
```

El gasto del Cyan, que está en producción, hoy queda congelado para siempre. La
guarda sin esta salida no es protección: es una pared.

**Qué se construye:** revertir UNA recepción. Cada recepción creó un `Expense`
con su cantidad; deshacerla borra **ese** gasto y baja `received` en esa misma
cantidad. Es el inverso exacto de `receive()`, no un borrado libre.

- [ ] `POST /purchase-invoices/:id/lines/:lineId/unreceive`: en **una sola
      transacción**, borra el gasto de la última recepción de esa línea y baja
      `received` en su cantidad. Después, fuera de la transacción,
      `recalcularPrecioDelRollo` — el precio tiene que volver al de la compra
      anterior, no quedarse en el de una que ya no existe.
- [ ] Guardas: nada que deshacer si `received === 0`; factura anulada, no; la
      organización se filtra como en el resto del módulo.
- [ ] ⚠️ **No mueve la caja, y eso necesita su test con número clavado.** Ese
      gasto nació de una factura, así que nunca movió plata: borrarlo tampoco
      puede moverla. El saldo tiene que quedar **idéntico** antes y después. Si
      cambia, se rompió la invariante de no contar dos veces.
- [ ] ⚠️ **La ficha que nació al recibir NO se borra.** Puede estar ya en uso en
      una cotización o en un pedido. Se queda; lo que vuelve atrás es la compra.
- [ ] Romper el círculo de mensajes: el de anular la factura tiene que decir
      "primero deshacé las recepciones", que ahora sí existe. Un mensaje que
      manda a una puerta cerrada es peor que no tener mensaje.
- [ ] Pantalla: en Compras, por línea recibida, "Deshacer recepción" con
      confirmación que diga qué va a pasar (el rollo sale del inventario).
- [ ] Mutación: que `unreceive` no baje `received`, o que borre el gasto sin
      bajarlo, tiene que tumbar un test. Restaurar desde `cp`.
- [ ] `git commit`.

---

## Tarea 7 — En Gastos, los totales de lo que se ve

**Por qué.** Apareció al terminar la Tarea 3, el 2026-10-10. La tabla muestra
las filas filtradas (`visibleRows`) y los tres KPIs suman **todas**
(`rows`):

```
línea 70:  visibleRows = rows.filter(...)    ← la tabla
línea 95:  total       = rows.reduce(...)    ← el KPI
línea 96:  inversion   = rows.filter(...)
```

Es preexistente, pero el filtro de proveedor que acaba de entrar lo vuelve fácil
de encontrar: elegís un proveedor, ves 2 gastos y un "Total del periodo" de los
87. El `CLAUDE.md` del repo web fija lo contrario para Ventas, con estas
palabras: *"Los tres KPIs se calculan sobre LO QUE SE VE"*.

- [ ] `total`, `inversion` y `operativo` se calculan sobre `visibleRows`.
- [ ] ⚠️ **La etiqueta tiene que decir la verdad nueva.** "Total del periodo"
      con un filtro puesto ya no es el total del periodo: o la etiqueta cambia,
      o se dice qué filtros están activos. Cambiar el número y dejar el cartel
      viejo es cambiar una mentira por otra.
- [ ] Las opciones del filtro de proveedor salen de **las filas cargadas**, no
      del directorio entero (el patrón ya está escrito en
      `features/filament/PurchasesTab.tsx`, con `uniqueSorted`). Así no se
      puede elegir un proveedor que deje la tabla vacía.
- [ ] El texto del vacío distingue "no hay gastos en este periodo" de "ningún
      gasto pasa el filtro". Hoy dice lo primero en los dos casos, y con un
      filtro puesto eso es falso.
- [ ] ⚠️ `apps/web` **no tiene runner de tests** (no hay script `test` ni
      specs; `vitest` está instalado pero sin cablear). Esto no lleva test:
      decilo, no simules cobertura. Si la lógica se puede extraer a una función
      pura testeable en otro lado, mejor.
- [ ] `git commit`.

---

## Tarea 8 — Dos números que todavía mienten

Las dos salieron del cierre de la Tarea 4, el 2026-10-10.

### 8.1 Con un rango pasado, el del medio se come lo que vino después

La cadena usa **X** = saldo al día anterior al inicio del rango, **Z** = saldo de
**HOY**, y **Y = Z − X**. Con el mes en curso está bien. Con un rango pasado no:
elegís septiembre y la cadena dice "venías con X al 31/8, en el rango Y", pero
ese Y **incluye octubre entero**.

La razón que se dio para no hacerlo —"Z tiene que ser el mismo número que la
tarjeta Saldo en caja"— no se sostiene: pedir el saldo **al final del rango** no
son dos definiciones, es la MISMA función (`businessCash`) con otra fecha de
corte. El endpoint ya acepta cualquier fecha.

- [ ] Z = saldo al `to` del rango. Con el rango en curso da el mismo número que
      hoy, así que la pantalla normal no cambia.
- [ ] ⚠️ **Y la palabra acompaña**: con un rango terminado, "te queda" es falso
      — quedó con eso al cierre de ese periodo, y hoy tiene otra cosa. El texto
      lo tiene que decir.
- [ ] La tarjeta "Saldo en caja" **no se toca**: sigue siendo el saldo de hoy.
      Son dos números distintos a propósito y cada uno dice cuál es.
- [ ] Test en shared con números a mano: un rango pasado no puede absorber lo
      posterior.

### 8.2 El 30 de febrero entra por la puerta de escritura

`FECHA`, el regex de fechas de `schemas/api.ts`, valida la FORMA
(`AAAA-MM-DD`) y no el calendario: `'2026-02-30'` pasa, y Prisma lo guarda
**corrido al 2 de marzo**. Entra por los movimientos de caja y por el upsert de
conciliaciones. Es una entrada del usuario y es dinero.

- [ ] `FECHA.refine(isCalendarDay)` — el helper **ya existe** (lo dejó la
      Tarea 4 en `shared/calc/stock.ts`).
- [ ] ⚠️ Es una **superficie sensible** (DTO de entrada + dinero): su test de
      regresión va CON el arreglo y la suite de seguridad tiene que quedar
      verde. Primero el test que mete el 30 de febrero y lo ve pasar.
- [ ] ⚠️ Barrer **todos** los usos de `FECHA`, no solo los dos conocidos. Una
      puerta cerrada con su gemela abierta al lado no cierra nada.
- [ ] `git commit`.

**Lo que falta (encontrado al cerrar 8.2, el 2026-10-10 — NO arreglado).**
`FECHA` tenía **3** usos y los 3 quedaron cerrados, pero `schemas/api.ts` tiene
**8 campos de fecha más que NO usan `FECHA`**: son `z.string().min(1)` y
aceptan cualquier texto, el 30 de febrero incluido. Todos mueven plata:
`SaleCreateSchema`, `ExpenseCreateSchema`, `ExpenseWithDefinitionSchema`,
`PaymentCreateSchema` (abono de encargo), `LoanPaymentCreateSchema`,
`PurchaseInvoiceUpsertSchema`, `PurchaseInvoicePaymentSchema` y
`PurchaseReceiveSchema` (+ los `endDate`/`expectedAt` opcionales).

Es el **mismo agujero por otra puerta**, y más ancho. Se dejó afuera a
propósito, no por descuido: esos campos hoy admiten también un ISO con hora, así
que apretarlos a `FECHA` es un cambio de contrato de 8 DTOs con su propio riesgo
de regresión (hay que revisar qué manda el panel y los scripts de importación en
cada uno). Va como tarea propia, con su test de ataque por puerta.

---

## Cierre de la fase — hecho el 2026-10-10

| | |
|---|---|
| `calc3d-api` · shared | **472** tests / 31 suites ✅ (empezó en 423/28) |
| `calc3d-api` · apps/api | **502** / 28 suites ✅ (empezó en 448/28) |
| lint api | 0 errores · 119 warnings de `any` en specs, la misma línea base |
| lint + build web | limpios ✅ |
| `shared` | **0.37.0**, idéntico en los dos repos (`diff -r` vacío) |

Ninguna suite perdió tests ni dejó de compilar en ninguna de las ocho tareas.

### La pasada visual (panel local, datos de prueba creados y borrados)

Recorrido completo contra la base LOCAL: factura nueva pidiendo **una impresora
que no existía** → recibirla → deshacer la recepción → borrar todo.

- El formulario pregunta **"¿Filamento o impresora?"** y el aviso cambia con la
  respuesta. Al recibir una impresora **no pide gramos de rollo**.
- Al recibir: nace la **impresora** con el precio de la compra (`$300`, 5000 h
  por defecto) y **0 fichas de filamento** — el bug de la Tarea 2, muerto.
  El gasto sale `EQUIPMENT` + inversión, enlazado a la impresora.
- En Gastos, esa fila: marca **"de factura"**, **sin tacho** y el selector de
  "quién pagó" `disabled` (medido: `aria-disabled`), con 7 columnas y la de
  Proveedor en su lugar.
- **Deshacer recepción**: el gasto desaparece, `received` vuelve a 0, **la
  impresora se queda en el catálogo** y el saldo de caja queda **idéntico:
  $133.22 antes y después**.
- Dashboard: la cadena dice *"venías con $133.22 · este mes $0.00 · te queda
  $133.22"*; con el filtro en **ayer** dice *"cerró con $133.22 al 9/10/2026 ·
  hoy en caja $133.22"*; con **Todo** la cadena no se dibuja. El rojo quedó en
  el saldo: "Resultado de la operación" en −$132.47 **no** se pinta de alarma.
- La dona muestra **dos tramos** y su total es exactamente "Ventas + Cobrado de
  encargos" ($2.071,25 + $354,43 = $2.425,68), con los colores alineados a los
  otros gráficos.
- A **375 px**: la página **no** scrollea de lado (medido: `scrollWidth` =
  `clientWidth` = 375). La tabla de Gastos mide **884 px dentro de un
  contenedor de 341** y se recorre con su scroll propio, igual que antes de
  sumarle la columna. ⚠️ **Confirma el pendiente**: esa pantalla es la única
  lista de finanzas sin vista de tarjetas, y se nota.

Los datos de prueba se borraron: 0 facturas, 0 líneas, 0 gastos de factura, 0
impresoras de prueba, y el saldo de la base local sigue en $133.22.

### Lo que queda anotado para después

- **8 campos de fecha más** (`SaleCreateSchema`, `ExpenseCreateSchema`,
  `PaymentCreateSchema`, `LoanPaymentCreateSchema`, los tres de facturas de
  compra…) usan `z.string().min(1)` y aceptan el 30 de febrero igual que las
  tres que cerró la Tarea 8. **Es el mismo agujero por otra puerta y más
  ancho**; quedó afuera porque apretarlos cambia el contrato de 8 DTOs que hoy
  también admiten ISO con hora. Tarea propia, con su test de ataque por puerta.
- `apps/web` **sigue sin runner de tests**: `vitest` instalado y sin cablear.
  Por eso toda la lógica nueva vive en funciones puras de `shared`.
- Gastos necesita **vista de tarjetas** en el teléfono.
- Los dos filtros de Gastos no se persisten, a diferencia del resto del panel.

> **Estado: terminada el 2026-10-10.** Ocho tareas, 22 commits en `main` entre
> los dos repos. **Sin push: el despliegue lo decide el dueño.**
