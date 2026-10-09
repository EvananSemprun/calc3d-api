# Facturas de compra: abonos, recepción parcial e inventario

**Objetivo:** poder cargar una factura o un encargo de filamento o impresoras
**antes** de que llegue, abonarla parcial o totalmente, y al recibirla pasar la
mercadería al inventario — sin que la caja cuente la misma plata dos veces.

**Stack:** TypeScript, Zod, NestJS, Prisma + PostgreSQL, Jest, React + React
Query + Tailwind.

> ⚠️ Un `git push` ES un despliegue. Commit por tarea; push solo cuando el
> dueño lo pida.

---

## El problema de fondo, en una línea

**La plata se va cuando abonás; la mercadería entra cuando llega.** Son dos
momentos distintos y la app tiene que separarlos. Juntarlos es exactamente el
error que descuadraba la hoja del Excel: anotar una compra dos veces.

## Decisiones del dueño (2026-10-09)

| Pregunta | Respuesta |
|---|---|
| Caja al abonar algo que no llegó | **La plata ya salió.** El saldo baja hoy. |
| Una factura | **Varias líneas**, de filamentos y/o impresoras distintos. |
| Llegan 6 de 10 | **Recepción parcial**: entran 6, quedan 4 esperando. |
| Editar la ficha | Nombre, color, **marca y tipo**. Los gramos NO. |

## La regla que no se puede romper

> **Los abonos son la PLATA. La recepción es la MERCADERÍA.**
> Un `Expense` nacido de una factura **no mueve la caja**: su plata ya se contó
> al abonar. La caja lo cuenta UNA vez, por el lado del abono.

Sin esto, abonar $50 y después recibir la compra de $50 haría bajar el saldo
$100. Es la invariante que tiene que tener test con número clavado, no derivado.

**Por qué el `Expense` igual existe:** todo lo que ya funciona lee las compras
de ahí — Compras de filamento, el análisis por marca, el precio del rollo, la
hoja Gastos del Excel. Si la recepción no creara el gasto, habría que reescribir
las cinco cosas. El gasto es la mercadería; lo que cambia es de dónde sale su
plata.

## Qué NO entra

- Monedas distintas del USD en la factura (el Bs congelado ya existe para
  publicidad; si hace falta se suma después).
- Facturas de cosas que no sean filamento o impresoras — el dueño lo acotó.
- Devoluciones al proveedor.

---

## Modelo

```prisma
model PurchaseInvoice {
  id             String   @id @default(cuid())
  organizationId String
  /// A quién le comprás: un contacto del directorio con tipo SUPPLIER.
  supplierId     String?
  date           DateTime          // fecha de la factura o del encargo
  expectedAt     DateTime?         // cuándo se espera que llegue
  reference      String?           // número de factura
  notes          String?
  status         PurchaseInvoiceStatus @default(PENDIENTE)
  lines          PurchaseInvoiceLine[]
  payments       PurchaseInvoicePayment[]
}

model PurchaseInvoiceLine {
  id          String  @id @default(cuid())
  invoiceId   String
  /// Qué se compra: UNA de las dos, nunca las dos ni ninguna.
  materialId  String?
  printerId   String?
  /// Si la ficha todavía no existe, el nombre con el que se va a crear.
  nombreNuevo String?
  quantity    Int
  unitPrice   Decimal
  /// Lo ya recibido de esta línea. Nunca mayor que `quantity`.
  received    Int     @default(0)
  expenses    Expense[]   // los gastos que generó cada recepción
}

model PurchaseInvoicePayment {
  id             String   @id @default(cuid())
  invoiceId      String
  organizationId String
  date           DateTime
  amount         Decimal
  /// QUIÉN puso la plata. `null` = la caja del negocio.
  counterpartyId String?
  accountId      String?
  note           String?
  voidedAt       DateTime?   // anular, no borrar: igual que las cuotas
  voidReason     String?
}
```

`Expense` gana `purchaseInvoiceLineId String?`. **Ese campo es el que dice "mi
plata ya se contó".**

### Lo que se DERIVA (nunca se guarda)

- `total` de la factura = Σ `quantity × unitPrice`.
- `pagado` = Σ abonos no anulados.
- `saldo` = `total − pagado`.
- `status` = PENDIENTE / RECIBIDA (todas las líneas completas) / ANULADA.

Mismo criterio que el resto del repo: un total guardado se desincroniza de sus
partes el día que alguien corrige una línea.

---

## Tareas

### 1. La ficha editable: marca y tipo

- [ ] `MaterialCorrectionSchema` suma `brand` y `type` (nulables, se recortan).
      Los **gramos siguen afuera**: reescriben el costo por gramo de todas las
      compras pasadas de esa ficha.
- [ ] `FichaDialog` dibuja los dos como `Combobox` creables (las mismas listas
      administradas que usa el alta: `MATERIAL_BRAND`, `MATERIAL_TYPE`).
- [ ] Test: corregir el tipo reagrupa el análisis; el `rollGrams` del body se
      descarta aunque venga.
- [ ] Actualizar en `calc3d-api/CLAUDE.md` la línea que dice "marca, tipo y
      gramos quedan como nacieron": era una decisión del dueño y cambió.
- [ ] `git commit`

### 2. El modelo y la migración

- [ ] Los tres modelos + `Expense.purchaseInvoiceLineId` + el enum de estado.
- [ ] Migración **puramente aditiva**: ninguna columna existente se toca.
- [ ] `git commit`

### 3. El motor: la factura y su saldo

- [ ] En `shared`: `invoiceTotals(lines, payments)` → `{ total, pagado, saldo,
      recibidoTotal, pendienteTotal }`, puro y con decimal.js.
- [ ] Tests con números clavados, **no derivados del propio motor**.
- [ ] `git commit`

### 4. Caja: la plata del abono, UNA sola vez

- [ ] `CashLedger` suma `purchasePayments`: salen de la caja cuando
      `counterpartyId` es null, y generan deuda con la contraparte cuando no.
- [ ] `cashEntries` **excluye los `Expense` con `purchaseInvoiceLineId`**.
- [ ] ⚠️ Test de la invariante: abonar $50 y recibir la compra de $50 baja el
      saldo **$50, no $100**. Con número clavado.
- [ ] Verificación por mutación: quitar la exclusión tiene que tumbarlo.
- [ ] `git commit`

### 5. La API

- [ ] CRUD de facturas con sus líneas; `POST /purchase-invoices/:id/payments`
      y su anulación (POST con motivo, no DELETE — igual que las cuotas).
- [ ] `POST /purchase-invoices/:id/lines/:lineId/receive` con la cantidad
      recibida: crea el `Expense` (con su `purchaseInvoiceLineId`), sube
      `received` y dispara `recalcularPrecioDelRollo`.
- [ ] Guardas: no recibir más de lo pedido; `supplierId` y `counterpartyId`
      filtrados por organización (viajan en el body); una línea apunta a
      material **o** impresora, nunca a las dos.
- [ ] Regresiones de las tres guardas, cada una con su hermano alcanzable.
- [ ] `git commit`

### 6. La pantalla

- [ ] `/filament/facturas` (o Compras → pestaña): lista con lo que falta pagar
      y lo que falta recibir, tarjetas en móvil.
- [ ] Alta con líneas; abonar; recibir indicando cuántos llegaron.
- [ ] Verificar EN PANTALLA: abonar baja el saldo de Caja; recibir mete el
      rollo al inventario y mueve el precio.
- [ ] `git commit`

### 7. Verificación contra un dump de producción

- [ ] Restaurar, aplicar la migración, comprobar que las cifras de Caja quedan
      **idénticas** (la migración es aditiva: no puede mover nada).
- [ ] Documentar en los dos `CLAUDE.md`.
- [ ] `git commit`

---

## Orden de entrega

Cada bloque sirve solo y se puede desplegar aparte:

1. **Tarea 1** — la ficha editable. Chica, sale primero.
2. **Tareas 2-5** — facturas y abonos, sin recibir todavía. Ya podés cargar lo
   que debés y la caja queda bien.
3. **Tareas 5-7** — recibir e inventario.
