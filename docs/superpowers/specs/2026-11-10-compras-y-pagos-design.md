# Compras y pagos — diseño

**Fecha:** 2026-11-10 · **Repos:** `calc3d-api`, `calc3d-web`

---

## 1. El problema

Hoy **seis formularios** registran salidas de dinero: `/compras` (facturas),
`/filament/compras`, `/catalogs/components`, `/catalogs/printers`, `/expenses` y
`/campaigns`. Cada uno escribe por su cuenta y **ninguno comparte el concepto de «pago»**.

La consecuencia visible, medida contra producción el 2026-11-10:

| | |
|---|---|
| Caja → «Filamento comprado» | **−$1.803,91** |
| Filamento → Compras | **$1.663,91** |
| Diferencia | **$140,00** |

Los $140 son los abonos de la factura **C-0001**, que está **pagada en parte y no recibida**.
**Lo pagado y no recibido no existe en el modelo de datos**, así que no tiene dónde vivir: la
plata ya salió de la caja pero no hay gasto que la represente, y la diferencia queda sin
explicación en la pantalla.

Ése es el problema de fondo. Todo lo demás de este documento se deriva de él o lo acompaña.

### La causa raíz, en una frase

**`Expense` ES el pago.** Su `amount` es a la vez el costo y la plata que salió; no hay fila
de pago, ni cuenta de origen, ni pagos parciales. Un gasto de $50 significa «salieron $50
ese día», punto. Solo tres lugares tienen pago separado —`PurchaseInvoice`, `Loan` y
`Order`— y ninguno de ellos es el gasto.

Eso deja **dos modelos de compra incompatibles conviviendo**:

- el de `Expense` — «compré y pagué, mismo acto»;
- el de `PurchaseInvoice` — «pedí, abono, recibo»: tres momentos distintos.

El puente entre los dos es `Expense.purchaseInvoiceLineId`, cuyo único trabajo es decirle a
Caja «esta plata ya la contaron mis abonos, no la cuentes otra vez».

---

## 2. Lo que hay hoy, verificado

Todo lo de esta sección se comprobó leyendo el código y consultando producción en solo
lectura. **No es lo que se recuerda de la app: es lo que hace el repo.**

### 2.1 Las seis puertas

| Ruta | Qué escribe |
|---|---|
| `/compras` | `PurchaseInvoice` + líneas; abonar crea `PurchaseInvoicePayment`; recibir crea la ficha de catálogo **y** el `Expense` con `purchaseInvoiceLineId` |
| `/filament/compras` | `Client` proveedor al vuelo + `Material` + `Expense`, en una transacción |
| `/catalogs/printers` | `Printer` + `Expense` `EQUIPMENT` con `isInvestment` |
| `/catalogs/components` | `Component` + `Expense` `CONSUMABLE` |
| `/expenses` | `Expense` suelto, el tipo lo elige quien carga |
| `/campaigns` | `Campaign` + **un** `Expense` `ADVERTISING` gestionado |

⚠️ **`Expense` tiene cuatro puertas y ni un solo `@@unique` en la base.** Lo único que
impide que una pise a otra es una guarda de servicio, `noSeTocaDesdeGastos`, que rechaza
editar o borrar desde Gastos un gasto nacido de factura.

### 2.2 Lo que el pedido original decía y el código desmiente

| Lo que se creía | Lo que el código dice |
|---|---|
| «No se registra la cuenta en los pagos» | La columna **existe** (`PurchaseInvoicePayment.accountId`) y el contrato Zod la acepta. **Faltan tres líneas en el modal**: `guardar()` no la manda. Moneda y tasa sí faltan de verdad |
| «Cargar con fecha vieja altera la conciliación sin aviso» | Una conciliación **CONFIRMADA no se altera**: congela sus importes. **Y sí hay aviso** (`stale`), pero **solo se ve expandiendo la fila**, nunca al guardar. Lo que sí cambia en silencio es una conciliación en **DRAFT** |
| «Desde Gastos se pueden borrar compras de filamento» | **Solo las cargadas directo.** Las nacidas de factura están protegidas. El agujero real es que hay **dos clases de compra de filamento con reglas de borrado opuestas** y la pantalla no lo explica |
| «Pedido y no recibido: $334» | **Ese cálculo no existe en ninguna parte del código.** Lo que hay son **unidades** y un **conteo de facturas**. El número es correcto, pero está hecho a mano |

### 2.3 El bug de la placa: dónde está de verdad

`cash/helpers-de-caja.ts` reparte un abono entre categorías con una condición **binaria**:

```ts
if (l.printerId == null) deFilamento += monto;   // impresora, o filamento
```

Una línea de insumo tiene `printerId == null`, así que **el 100 % de su plata entra a
«Filamento comprado»**. El valor `COMPONENT` se agregó al enum de líneas el 2026-10-20 y
**el prorrateo nunca se actualizó**.

⚠️ **Pero la placa NO causa la diferencia de $140.** C-0001 tiene 9 líneas —8 de filamento
($220) y la Effect Plate ($40)— y **no se recibió nada**, así que la placa aporta **$0** a
esa resta. El bug de la placa vive en **la categoría**: de los $140, unos **$21,54**
corresponden a un insumo y están contados como filamento. Se ve en el desglose de Caja, no
en la resta contra Compras.

### 2.4 Dos descuadres que el pedido no mencionaba

1. **Un abono puesto del bolsillo del propietario sube la Caja pero no su deuda.**
   `OBLIGATION_SOURCES` no incluye los abonos de factura. Hoy **no mueve ningún número**
   (los 8 abonos los puso la caja del negocio), pero diverge en cuanto se pague una factura
   de un bolsillo. Es la quinta vez que aparece «dos pantallas contando el mismo dinero por
   caminos distintos» en este proyecto, y la única abierta.
2. **La pauta se puede contar dos veces.** `advertising` sigue ofreciéndose en `/expenses` y
   permite atar una campaña; el «gastado real» suma el gasto gestionado **y** el manual, sin
   dedup ni aviso. Encima el gestionado se fecha en `startDate` de la campaña, no el día del
   pago, así que cae en el periodo equivocado de Caja y del Dashboard.

---

## 3. Objetivos, no-objetivos y anti-objetivos

### Objetivos

1. Que **lo pagado y no recibido exista** como concepto, se vea y cuadre.
2. Que **cada peso que sale tenga un origen legible** en Caja — nunca «Sin detalle».
3. Que **haya una sola forma de registrar una compra a proveedor**, y que las demás
   pantallas sean **vistas** de eso.
4. Que **un pago registre con qué se pagó**: cuenta, moneda y tasa congelada.
5. Que la plata quede **clasificada por lo que es** (filamento, insumo, equipo, servicio,
   publicidad), no todo como filamento.

### No-objetivos

- Contabilidad formal, asientos de partida doble, plan de cuentas.
- Multi-moneda en el motor de cálculo: **la base sigue siendo USD**; la moneda del pago es
  un hecho histórico que se guarda, no una capa que convierte hacia atrás.
- Reemplazar el Excel: el libro se genera desde la app y eso no cambia.

### Anti-objetivos — esto sería un fracaso aunque funcione

- **Que la migración mueva un número que debía quedarse quieto.** El efectivo que salió y
  las deudas con personas son hechos; si cambian, el rediseño rompió la historia.
- **Un módulo «universal» de compras** que se trague publicidad y pagos de deuda. Un pago a
  Meta no es una compra a un proveedor y no se recibe.
- **Que queden dos caminos para lo mismo.** Si al terminar sigue habiendo dos formas de
  registrar una compra de filamento, no se arregló nada: se agregó una séptima puerta.
- **Que un guardián dé verde sin mirar.** Los invariantes de esta entrega son plata del
  dueño; un test que no se pone rojo cuando el número se mueve es peor que no tenerlo.

---

## 4. Restricciones

- **La base de producción manda** (desde el 2026-10-01 el dueño carga ahí). Un `push` a
  `main` **despliega**, así que el respaldo (`pg_dump`) y el OK del dueño van **antes**.
- **Texto de cara al usuario en «tú», no voseo** — hoy se incumple en 60 archivos.
- **Dinero con decimal.js**, porcentajes como fracción, la base de costeo en USD.
- **`packages/shared` es la copia canónica en `calc3d-api`**; `calc3d-web` la sincroniza con
  `pnpm sync:shared`. Editar el motor en `calc3d-web` lo pisa la próxima sincronización.
- **Tests anti-exploit en la misma entrega** (decisión del dueño): el monto se calcula en el
  servidor desde las líneas, nunca se acepta del cliente; facturas, proveedores y cuentas se
  validan por organización; sin mass-assignment de montos ni de estado de pago.
- **Nada de cron**: la infraestructura no tiene un proceso que corra solo.

---

## 5. Las decisiones

### 5.1 El pago, como entidad reutilizable

Un pago registra: **fecha, monto, quién pagó** (caja del negocio o una persona), **cuenta de
origen**, **moneda** (USD, USDT, Bs), **referencia** y **nota**.

Si la moneda es Bs: se cargan **monto en Bs + tasa del día**, y se guardan **los cuatro
datos** — monto original, moneda, tasa y monto en USD.

⚠️ **La tasa se congela en el momento del pago y no se recalcula nunca.** Un pago en Bs a
una tasa es un hecho histórico. Si se recalcula, los números de meses cerrados cambian solos
cuando se mueve la tasa.

Se usa en: abonos de compras, pagos de campañas, cuotas de préstamo, pagos a proveedores
desde Deuda, y devoluciones al propietario.

**En Caja, cada pago muestra su origen** — «Factura C-0006 · StratoFill», «Publicidad ·
Harry Potter», «Cuota · Deuda impresora P2S», «Pago a StratoFill · saldo». Nunca «Sin
detalle».

### 5.2 Compras: la única entrada de lo que se le compra a un proveedor

**No incluye publicidad ni pagos de deuda.**

- **Encabezado:** fecha, proveedor, **N.º de factura opcional** (si no hay: «Sin
  comprobante»), cuándo llega, adjunto opcional, notas.
- **Tipo de línea:** Filamento · Insumo · Impresora/equipo · Repuesto/Mantenimiento ·
  Servicio. Cada tipo puede ser «del catálogo» o «nuevo», con los campos de su catálogo.
- **Por línea:** cantidad, precio de lista, descuento → precio real; código del fabricante;
  recarga/carrete (solo filamento, corregible después con registro del cambio).
- **Dos interruptores:** «¿Ya lo pagaste?» (abre el pago) y «¿Ya llegó?». Con los dos en sí,
  una compra de contado se registra **en un paso**.
- **«Recibir todo»** a nivel factura, además de recibir línea por línea.

### 5.3 Anticipos, deuda y comprometido — la fórmula

**Por factura, en dinero.** No por proporción de líneas.

```
valor recibido = Σ (cantidad recibida × precio real de cada línea)

anticipo     = máx(0, pagado − valor recibido)
deuda        = máx(0, valor recibido − pagado)
comprometido = valor total de la factura − máx(pagado, valor recibido)
```

Para pagos **al saldo del proveedor** (sin factura elegida), se aplica lo mismo sumando
todas sus facturas, y el pago se imputa **de la más antigua a la más reciente**.

**Por qué esta y no la proporcional:** cubre el caso inverso —pagaste la mitad y llegó
todo—, que produce **deuda**, no anticipo.

**Verificada contra las tres facturas abiertas, sin un solo ajuste:**

| Factura | Total | Pagado | Recibido | Anticipo | Deuda | Comprometido |
|---|---|---|---|---|---|---|
| C-0001 | $260,00 | $140,00 | $0,00 | **$140,00** | $0 | **$120,00** |
| C-0004 | $134,00 | $0,00 | $0,00 | $0 | $0 | **$134,00** |
| C-0006 | $80,00 | $0,00 | $0,00 | $0 | $0 | **$80,00** |

**Dónde se muestra cada uno:**
- **Anticipos a proveedores** → en Caja (desglose del saldo) y en Deuda, **separado** de lo
  que se les debe.
- **Comprometido con proveedores** → en Deuda, **sin sumar a la deuda**.
- **Regla que tiene que cerrar:**

  ```
  Gastos recibidos + Anticipos − Deuda = lo que salió de Caja por compras
  ```

  ⚠️ **El `− Deuda` no es decorativo, y la versión sin él estaba MAL.** Con
  `anticipo = máx(pagado − recibido, 0)`, la suma de los dos primeros da `máx(pagado,
  recibido)`, y lo que salió de la caja es `pagado`. O sea que sin el tercer término la
  regla **se rompe en cuanto una factura se reciba sin pagar** — justo el caso que la
  fórmula del §5.3 existe para cubrir. Esto **es** el test de regresión de la entrega: mal
  escrito, se pone rojo el día que llegue la primera compra a crédito.

### 5.4 Las demás pantallas pasan a ser vistas

`/filament/compras`, `/catalogs/components`, `/catalogs/printers` y `/expenses` muestran
**las líneas de Compras de su tipo** (con enlace a la compra), más los gastos de Publicidad
que vienen de campañas.

Sus botones «Registrar compra» / «Registrar gasto» **abren Compras** con el tipo de línea
preseleccionado. **Editar o borrar, solo desde Compras**; en las vistas, el borrado se
reemplaza por «Ver compra».

### 5.5 Publicidad — se sigue registrando en `/campaigns`

- El campo «Lo que pagué» se reemplaza por una **lista de pagos de la campaña**, con el
  formulario de pago. Se agrega **plataforma/proveedor** como referencia (Meta, TikTok…).
- **«Invertido» = suma de los pagos.** Cada pago genera un gasto de Publicidad ligado a la
  campaña, **con la fecha del pago**, no la de inicio de la campaña.
- Si pagó una persona, Caja lo cuenta como **aporte que el negocio le debe**.
- **Migración:** el «Lo que pagué» de cada campaña pasa a un pago con fecha de inicio,
  pagado por la caja, **marcado «Importado»** para revisarlo.
- ⚠️ **Y se cierra la puerta doble:** `advertising` deja de ofrecerse en `/expenses`, o deja
  de poder atarse a una campaña. Hoy las dos cosas suman sin aviso.

### 5.6 Deuda — los pagos se registran en `/loans`, sin factura

- **Préstamo:** «Registrar pago» usa el formulario de pago.
- **Propietario:** las devoluciones se registran acá.
- **Proveedores:** el bloque lista por proveedor las compras pendientes y el saldo, con
  botón «Pagar» ahí mismo. Si se elige una factura, el pago **es el mismo abono** que en
  Compras y se ve en los dos lados; si no, se imputa al saldo, de la más antigua a la más
  reciente.
- Se muestran **«Anticipos a proveedores»** separado de lo que se les debe.

### 5.7 Conciliaciones

Si se crea, edita o borra un movimiento con fecha **≤ a una conciliación cerrada**, hay que
avisar **antes de guardar** («Esto cambia la conciliación del DD/MM») y ofrecer **recalcular
o anular su ajuste**.

⚠️ **El aviso vive en el servicio, no en cada formulario.** Toca todos los caminos de
escritura; si se implementa formulario por formulario, el que se agregue el año que viene no
lo va a tener.

⚠️ **Y tiene que cubrir el caso DRAFT**, que es el que hoy cambia en silencio.

### 5.8 Costos fijos → compras recurrentes

Cada costo fijo (concepto, monto, proveedor, día del mes) genera una **compra pendiente de
tipo Servicio**. Solo hay que pagarla.

**Sin cron.** La generación es **perezosa**: al abrir la app, o al consultar Compras o
Deuda. **Una por concepto y mes, con clave única `(concepto, año-mes)`** para no duplicar.
Si pasan meses sin entrar, crea todas las que falten.

### 5.9 Cuentas

Varias cuentas (Binance, banco en Bs / pago móvil, efectivo), elegibles en cada pago.

⚠️ **La columna ya existe y el contrato la acepta: faltan tres líneas en el modal.** Y el
dueño **ya está escribiendo la cuenta a mano en la nota** del abono («Binance», «Binance del
estado de cuenta del 23/10»). Es de lo más barato y más útil de toda la entrega.

### 5.10 Calidad de los formularios

- **Comboboxes Tipo/Marca/Color:** confirmar antes de crear un valor nuevo; detectar
  duplicados por mayúsculas y espacios; pantalla en Configuración para **editar, unir y
  borrar**. Limpieza concreta: el tipo «Bambu Lab» (es marca), «PLA MattePLA Matte», unir
  «PLA TOUGH+» con «PLA Tough+».
- **Escape** dentro de un combobox cierra solo el popover, no el diálogo.
- **Borrador local** y confirmación al cerrar con datos cargados.
- **Nombre de filamento nuevo autogenerado** «{Tipo} {Marca} {Color}», editable.
- **Selector de catálogo** con búsqueda, agrupado por marca y tipo, los más comprados
  arriba.
- **`aria-label` en todos los combobox.**
- **Voseo → «tú»** en toda la app.

---

## 6. La prueba de aceptación

**Los ocho números de partida fueron verificados contra producción el 2026-11-10 y dan
exacto.** Esta tabla es el criterio de correcto de la migración.

### Invariantes — tienen que dar idéntico

| Qué | Valor |
|---|---|
| El efectivo que salió/entró, **por fecha y monto** | cada pago conserva fecha, monto y quién pagó. ⚠️ **«Por cuenta» NO** — ver §12.3: lo histórico no la tiene |
| Saldo del negocio en Caja | **$49,00** |
| Deuda con el propietario | **$967,77** |
| Deuda con el prestamista (Señor Edwin) | **$650,00** |
| Ventas, encargos, stock y **costo por gramo** de cada filamento recibido | sin cambios |

### Cambios esperados — con su número

| Qué | De | A |
|---|---|---|
| Caja «Filamento comprado» | **−$1.803,91** | **−$1.663,91** |
| Caja, línea nueva «Anticipos a proveedores» | — | **−$140,00** |
| Placa Effect Plate de C-0001 | cuenta como filamento | **insumo**, al recibirse |
| Abonos en Caja | «Sin detalle» | su factura / origen |
| Deuda «A proveedores» | **$334,00** | **$0,00** (solo lo recibido y no pagado) |
| «Comprometido con proveedores» (no suma a la deuda) | — | **$334,00** |
| **Deuda total** | — | **$1.617,77** |

Desglose del comprometido: C-0001 $120 + C-0004 $134 + C-0006 $80.

**Aritmética:** `967,77 + 650,00 + 0 = 1.617,77` · `1.803,91 − 140,00 = 1.663,91` ·
`120 + 134 + 80 = 334`.

⚠️ **La deuda total de HOY es $1.951,77**, no $1.617,77: `967,77 + 650 + 334`. Los $334 **no
desaparecen**, se mudan de «deuda» a «comprometido». Si alguien compara el total de antes
con el de después sin mirar el bloque nuevo, va a leer que la deuda bajó $334 — y no bajó
nada.

---

## 6b. ⚠️ Lo que este cambio REDEFINE (y ya tiene tests)

Esto no agrega un cálculo: **cambia la definición de uno que existe, está testeado y lo leen
tres pantallas.** Es el riesgo más alto de la entrega y no estaba en el pedido original.

**Hoy**, en `shared/calc/purchase-invoice.ts`:

```
saldo  = máx(total − pagado, 0)      ← «deuda con el proveedor»
aFavor = máx(pagado − total, 0)      ← pagaste de más
```

**Después**, según §5.3:

```
deuda    = máx(valor recibido − pagado, 0)
anticipo = máx(pagado − valor recibido, 0)
```

**Las consecuencias, una por una:**

1. **`deudaPorProveedor` cambia de número** (12 tests con cifras a mano). Hoy suma
   `máx(saldo, 0)` = $334; después suma la deuda nueva = $0.
2. **El punto de equilibrio lee `totals.proveedores`** para mostrar el compromiso **al
   lado** del número (nunca dentro). Si ese campo pasa a valer $0, esa línea desaparece.
   ➡️ **Tiene que pasar a leer «comprometido»**, que vale exactamente los mismos $334 — o
   sea que el número de esa pantalla **no cambia**, pero el campo del que sale, sí.
3. **`aFavor` y `anticipo` NO son lo mismo y los dos tienen que seguir existiendo.**
   - `aFavor` = pagaste **más que el total de la factura**. Es un hecho del pasado, ya tiene
     su mecánica completa (`aFavorDisponible`, abonar tomándolo de otra factura,
     `tomadoDeFacturaId`, `ON DELETE RESTRICT`) y **no se toca**.
   - `anticipo` = pagaste **más de lo que recibiste**. Es temporal: se consume al recibir.

   Con C-0001 (total $260, pagado $140, recibido $0): `aFavor = $0` y `anticipo = $140`.
   **Confundirlos haría aparecer $140 de saldo a favor que el proveedor no debe**, y la
   factura dejaría abonar con plata que no existe.
4. **`invoiceStatus` ya tiene dos ejes** (plata y mercadería) y la distinción nueva encaja
   en los mismos: el anticipo es «pagada y sin recibir» visto en dinero.

⚠️ **Si al migrar un número de partida no coincide: parar y avisar.** No acomodar.

---

## 7. Las fases

| | Qué | Por qué en ese lugar |
|---|---|---|
| **a** | Voseo → «tú», `aria-label`, bug de Escape | Defectos reales, independientes de todo, sin riesgo. No esperan ninguna decisión |
| **b** | **Entidad de pago + anticipos + origen en Caja + aviso de conciliación en el servicio** | Arregla **los dos bugs concretos** —los $140 y «Sin detalle»— **sin tocar un solo formulario**. Es la base de todo lo demás y se entrega y verifica sola |
| **c** | Compras como entrada única + las demás pantallas como vistas + **la migración** | Necesita (b) terminado |
| **d** | Campañas, deuda y proveedores sobre el formulario de pago | Necesita (b) y se beneficia de (c) |

---

## 8. Fuera de alcance

- **«Cargar desde foto»** (prellenar un recibo desde una imagen): es un proyecto de OCR, no
  una feature de un formulario.
- **Conciliar por cuenta**: depende de que **todos** los movimientos indiquen cuenta, o sea
  de que la migración haya terminado.
- **El estado de cuenta por proveedor** queda para después de (d), cuando los datos que
  necesita ya existan.

---

## 9. Las decisiones que tomé yo

Están acá para que el dueño las pueda revisar mientras lee, no mezcladas con las suyas.

1. **El anticipo se separa por categoría.** El criterio dice «separar por categoría, no todo
   como filamento», así que los $140 de C-0001 no van como una línea sola: se reparten entre
   las líneas **pendientes** a prorrata de su valor → **$118,46 filamento + $21,54 insumo**.
   Si se prefiere una línea sola de «Anticipos», es más simple pero el desglose de Caja
   queda a medias.
2. **$967,77 sigue siendo invariante.** El dueño aceptó que dejara de serlo por el bug de
   los abonos pagados de su bolsillo; medido, **ninguno de los 8 abonos es suyo**, así que
   arreglar el bug no mueve el número. Se arregla igual —evita que diverja— y el invariante
   se mantiene.
3. **El prorrateo pasa a ser por tipo real de línea**, no binario. Es la opción que menos
   cambia lo que ya está escrito y argumentado en el código: el prorrateo existe a propósito
   para que «Filamento comprado» quiera decir todo el filamento comprado. Lo que estaba
   viejo era que el reparto solo conociera dos clases.
4. **El guardián de `aria-label` ataca la causa raíz.** El `<label>` de `Field` no tiene
   `htmlFor` y los `Select` son `<button>`, así que **ningún `Select` del repo recibe nombre
   de su `Field`**. Arreglar nueve controles a mano deja el próximo roto igual.

---

## 10. Lo que queda a criterio de quien construya

- La forma exacta de las tablas nuevas y de la migración de Prisma.
- Cómo se presenta el formulario de pago (diálogo, panel, en línea) y cómo se reusa entre
  las cinco pantallas que lo necesitan.
- Si «Anticipos» y «Comprometido» son columnas derivadas al vuelo o materializadas.
- El orden de las tareas dentro de cada fase, y dónde conviene cortar los commits.
- ⚠️ **Dos cosas que NO quedan a criterio:** el aviso de conciliación va **en el servicio**,
  y el monto de una compra se calcula **en el servidor desde las líneas**.

---

## 11. Respuestas al chequeo de constructor

Un ingeniero ajeno leyó este documento con los dos repos a mano y trajo **once preguntas**,
todas verificadas contra el código. Diez las resuelvo acá; las que quedan abiertas están al
final y son del dueño.

### 11.1 `saldo` NO se va: convive con `deuda`

El §6b nombraba dos lectores de `invoiceTotals().saldo` y son **seis**. Los cuatro que
faltaban: el prorrateo del pie del KPI de Gastos (`repartoDePagadores`), el «Faltan $X de
esta factura» (`notaDePagador`), el KPI «pendiente de pagar» de Compras **con el monto que
el diálogo de Abonar trae precargado**, y `invoiceStatus().pago`.

**Decisión: `saldo` se queda tal cual, y `deuda` es un campo NUEVO.** Son dos preguntas
distintas, exactamente como `aFavor` y `anticipo`:

| Campo | Pregunta que responde |
|---|---|
| `saldo` = máx(total − pagado, 0) | ¿cuánto falta pagar **de esta factura**? |
| `deuda` = máx(recibido − pagado, 0) | ¿cuánto le debo **por mercadería que ya tengo**? |

**Solo `deudaPorProveedor` pasa a usar `deuda`.** Los otros cinco lectores no se tocan — y
sin esto, abonar C-0001 arrancaría en **$0** y el aviso de «tomás más de lo que esta factura
debe» saltaría en un abono legítimo.

### 11.2 El pago es un FORMULARIO compartido, no una tabla única

**No se fusionan `PurchaseInvoicePayment`, `LoanPayment` y `OwnerMovement`.** Cada una tiene
semántica ganada a golpes (`tomadoDeFacturaId`, `generatesDebt`/`interestAmount`,
`cashReconciliationId` ÚNICO que es la idempotencia del ajuste), más el CHECK de
`DebtApplication` y del orden de **300 tests**.

El pedido del dueño dice textualmente **«FORMULARIO DE PAGO ÚNICO (componente
reutilizable)»** — un componente, no una entidad. Este documento lo había traducido a «el
pago como entidad», que es más de lo que se pidió. Lo compartido es:

1. **un componente de UI** con los mismos campos en las cinco pantallas, y
2. **un contrato de servicio** que valida y registra igual en todas.

Cada tabla **gana los campos que le faltan** (moneda, tasa, cuenta), y nada más.

### 11.3 La obligación sigue anclada al `Expense`

Se sigue de 11.2: `obligacionesDe()` no cambia de fuente, los **2 `DebtApplication` que
existen en producción** (los $504,33 de «Devoluciones a Evanan») siguen válidos y **no hay
que repuntar nada**. Si la obligación se mudara al pago, ese `applied` se perdería y la
deuda con el propietario **subiría $504,33**.

Para el abono de bolsillo del §2.4.1: categoría **`PURCHASE`** (un abono a factura es una
compra), y **`refundable` pasa a ser un campo del formulario de pago**, con el mismo default
que hoy fija a mano `datos-de-caja.ts` (`true`). Hoy `PurchaseInvoicePayment` no lo tiene y
se asume; que se pregunte es lo mismo que ya se hace con un gasto.

### 11.4 Qué `ExpenseCategory` produce cada tipo de línea

| Tipo de línea | Categoría |
|---|---|
| Filamento | la que ya produce recibir (`CONSUMABLE` con `materialId`) |
| Insumo | `CONSUMABLE` |
| Impresora/equipo | `EQUIPMENT` + `isInvestment` |
| Repuesto/Mantenimiento | **`MAINTENANCE`** |
| Servicio → Diseño | **`DESIGN`** |
| Servicio → General | `OTHER` |

⚠️⚠️ **`MAINTENANCE` ENTRA EN EL PRECIO DE CADA COTIZACIÓN.** `derivedMaintenance()` es
`Σ gastos MAINTENANCE ÷ horas de la última lectura`, **sin ventana de fechas**, y de ahí
sale el `maintPerHour` que usan `calculateQuote` y el recosteo de la tienda. **Es el segundo
cálculo que este diseño redefinía sin decirlo.** Consecuencia dura: **una compra recurrente
del §5.8 no puede aterrizar NUNCA en `MAINTENANCE`** — cada alquiler mensual encarecería la
hora-máquina de todo lo que se cotice.

⚠️ **`DESIGN` tiene fila propia en «Quién puso la plata».** Si «Servicio» aplanara el
diseño a `OTHER`, esa fila se vacía y el reparto de las cuatro filas cambia (el total no).
Por eso Servicio tiene subtipo.

**Y Caja gana las filas que el dueño pidió:** hoy `cashEntries` solo manda los abonos a
`filament` o `equipment`. El criterio dice «separar por categoría (filamento, insumo,
equipo, servicio, publicidad)», así que son **categorías nuevas en `CashCategory`**, con lo
que arrastran: `BusinessCash`, `GET /cash/breakdown/:category`, la hoja Caja del Excel y el
panel.

### 11.5 Costos fijos: desde el mes que se publica, y NO son «comprometido»

- **Nunca hacia atrás.** `Settings.fixedCosts` no tiene fecha de vigencia, así que generar
  los meses faltantes desde el origen crearía compras pendientes de servicios **que ya se
  pagaron fuera de la app**, y eso sube Deuda con plata que nadie debe. Se generan **desde
  el mes en que la función se publica**, y punto.
- **Una compra recurrente pendiente NO entra en «Comprometido con proveedores».** Esa plata
  ya está dentro de `fixedMonthly` (nivel 1 del equilibrio): mostrarla también al lado como
  compromiso la cuenta dos veces **en la misma tarjeta**. `equilibrioYCompromiso()` tiene un
  test cuya mutación obligatoria es justamente esa suma.
- ⚠️ **Dato medido: los dos costos fijos de hoy no tienen proveedor ni día del mes.** Son
  `Diseñador $80` y `Otros gastos fijos $38`. El primero mapea limpio a una compra recurrente
  de Servicio → Diseño; **el segundo es un bolsón, no un proveedor**, y convertirlo en una
  compra mensual con un proveedor inventado sería ruido. La función no puede generar nada
  hasta que el dueño complete proveedor y día, y «Otros gastos fijos» probablemente deba
  quedarse como está.

### 11.6 Los gastos históricos sí se convierten, y hay que abrirles la corrección

El §12 del pedido lo dice: cada compra existente pasa a ser una compra «de contado». Pero
eso las **congela**: una factura con mercadería recibida **no se corrige ni se anula** (regla
dura, con tests), y hoy una compra directa **sí** se corrige desde Gastos — que es lo que
mantiene `Material.rollPrice` al día.

**Decisión:** el camino ya existe (deshacer recepción → corregir línea → recibir) y mantiene
el precio correcto; lo que falta es que no sean tres pasos. Compras gana **un botón
«Corregir precio»** que hace los tres **en una transacción**. No se levanta la regla de «una
factura recibida no se corrige»: se le da una puerta explícita y atómica.

### 11.7 El aviso de conciliación bloquea

El pedido dice «avisar **antes de guardar**» y «**ofrecer** recalcular o anular»: eso es una
confirmación, no un cartel. Se implementa con un **flag de confirmación en el DTO**, que ya
tiene precedente en el repo (`confirmoFueraDePlazo`).

- **CONFIRMADA:** se ofrece **anular y crear una nueva**, no re-congelar en sitio. Congelar
  los importes es deliberado («es un documento, no una vista») y `confirm()` exige `DRAFT`.
  Re-congelar en sitio convertiría el documento en una vista; anular deja las dos en el
  historial, que es lo que un documento hace.
- **DRAFT:** se avisa y nada más. No hay ajuste que anular ni importes congelados — y es el
  caso que hoy cambia en silencio, o sea el que motivó el pedido.

### 11.8 El pago al saldo del proveedor se PERSISTE, no se deriva

«De la más antigua a la más reciente» calculado en cada lectura hace que cargar una factura
con fecha vieja —o anular una— **re-impute pagos del pasado** y mueva anticipos, deuda y
estados de meses ya conciliados, en silencio. Es exactamente la razón por la que
`DebtApplication` existe como tabla. La imputación pago↔factura **se guarda**, igual que
ahí.

### 11.9 Publicidad: se cierra la puerta de `/expenses`, y se migran los NUEVE

**Medido en producción:** de los 9 gastos de Publicidad ligados a una campaña, **8 son
importados/manuales ($118,97)** y **1 es el gestionado ($15,00)**.

Entonces, «Invertido = suma de los pagos» migrando solo `paidUsd` **le borraría la inversión
a 8 campañas**, y con ella su ROAS, su ROI, su salud y su recomendación. El §6 no lista
ninguno de esos números.

**Decisión: se migran los nueve a pagos**, los 8 importados marcados «Importado» con su
fecha y monto actuales, pagados por la caja (mismo criterio que el §5.5 ya fija para
`paidUsd`). Así «Invertido = suma de los pagos» es cierto **sin que se mueva un número**.

Y la puerta que se cierra es la de `/expenses`: un gasto de Publicidad **ligado a una
campaña** solo se crea desde `/campaigns`. La categoría sigue existiendo para pauta sin
campaña.

### 11.10 La conciliación no filtra por cuenta hasta tener cobertura completa

Hoy el esperado es `businessCash(ledger, fecha).balance` — el saldo **entero**, sin filtrar
por cuenta — y eso es correcto **solo porque ningún movimiento tiene cuenta**. En cuanto se
registre un pago desde efectivo o desde el banco en Bs, la conciliación de la principal
mostraría un **faltante inventado**; y con `autoAttributeShortfall` encendido en esa cuenta,
lo convertiría en una deuda saldada.

**Regla:** mientras exista **un solo** movimiento sin cuenta, el esperado sigue siendo
global y la conciliación **no se filtra por cuenta**. La pantalla lo dice, como ya dice hoy
que solo se concilia la principal.

---

## 12. Las tres que decidió el dueño (2026-11-10)

El chequeo de constructor dejó tres preguntas que no podía decidir yo. Contestadas:

1. **Los 9 gastos de publicidad se migran a pagos** (§11.9), los 8 importados marcados como
   tales, con su fecha y monto, pagados por la caja. Así «Invertido = suma de los pagos» es
   cierto **y no se mueve ningún número** de las 8 campañas.
2. **Una conciliación confirmada se ANULA y se crea una nueva** (§11.7); no se recalcula en
   sitio. Conserva la propiedad de documento que el repo ya había decidido, y el historial
   muestra las dos.
3. **La cuenta de origen solo se registra de ahora en adelante.** Los ~100 pagos históricos
   quedan **sin cuenta** — por la lección de `paidBy`, lo que no se sabe no se completa con
   un default.

   ⚠️ **Consecuencia directa sobre el §6:** el invariante baja de «el efectivo que salió/
   entró **por cuenta** y por fecha» a **«por fecha y monto»**. Y «conciliar por cuenta»
   (§8, ya fuera de alcance) recién es alcanzable cuando lo histórico quede atrás — no es
   una fase pendiente, es una que depende del paso del tiempo.

---

## Apéndice — trampas conocidas, pagadas en otro trabajo de este mismo proyecto

- **Un test que no se valida rompiéndolo no cuida nada**, y hay que romperlo con la mutación
  que uno **teme**, no con la que basta para verlo en rojo. Si una regla gana por posición,
  la mutación es **moverla**, no borrarla.
- **Una medición tiene que poder dar que NO.** Conviene verificarlo con un control positivo:
  introducir uno mismo la perturbación que se busca y comprobar que el arnés la ve.
- **Un comentario equivocado no da error, no rompe ningún test, y el próximo lo lee como
  medido.** Si un número aparece en dos lugares, ya divergió. Todo número que se escribe
  tiene que salir de un comando que se corrió — incluidos los que vienen de arriba y los que
  describen el trabajo propio.
- **Verificar las referencias contra el código antes de planificar**, no después.
