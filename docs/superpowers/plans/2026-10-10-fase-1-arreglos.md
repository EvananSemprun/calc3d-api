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

## Cierre de la fase

- [ ] `pnpm -r lint` y `pnpm -r test` en los dos repos, **leyendo la salida**
      (un commit del 2026-10-09 se fue con 2 errores de lint porque nadie leyó
      la línea que los decía).
- [ ] ⚠️ Si el total de tests **baja** sin que falle nada, una suite no
      compiló. Pasó el 2026-10-09: 400 → 393 y el resumen seguía diciendo
      "passed".
- [ ] La suite de seguridad en verde: la fase toca dinero.
- [ ] Verificación en el navegador contra el panel local (5180) de las tres
      pantallas tocadas.
- [ ] Avisar al dueño. **El push lo decide él.**
