# Compras, visibilidad y detalles — spec por fases

**Qué es esto:** el resultado de revisar el estado real de la app el 2026-10-09,
después de la reestructuración de contrapartes, proveedores y facturas de
compra. Cada fase se despliega sola.

> ⚠️ **La tienda NO se toca.** Es una feature futura para conectar con una
> landing de venta (decisión del dueño, 2026-10-09). Tiene 3 productos y 0
> pedidos; no se desarrolla ni se quita hasta que él lo pida.

> ⚠️ **Comparar proveedores queda para más adelante** (B4). Con un proveedor
> cargado y 7 gastos con proveedor no hay con qué comparar; el dato aparece
> solo cuando haya historia.

---

## Decisiones tomadas (cuestionario del 2026-10-09)

| # | Decisión |
|---|---|
| A1 | Al encargar algo que no tenés, **la app pregunta si es filamento o impresora**. |
| A2 | Pagar de más deja **saldo a favor con ese proveedor**, aplicable a otra factura. |
| A3 | El precio real se informa **al recibir**; la línea conserva lo que pediste. |
| A5 | Gastos muestra el proveedor: **columna y filtro**. |
| B1 | El pedido se arma **desde Stock del mes**, con lo que falta. |
| B2 | Lo que debés por facturas se **muestra al lado del equilibrio, sin entrar en el cálculo**. |
| B3 | Las entregas atrasadas avisan **en Compras y en el Dashboard**. |
| B5 | Los proveedores se suman como **tercer bloque de la pantalla Deuda**. |
| A6 | Un gasto **nacido de una factura no se toca desde Gastos**: se corrige en Compras. |
| A7 | El Dashboard muestra el mes como **cadena de caja** (venías con X → el mes → te queda Y). El orden en que se "gasta" la plata vieja o nueva **no se implementa**: no cambia ningún número. |
| A8 | "Mostrador vs encargo" tiene que sumar **los abonos de encargos**, no solo las ventas `ENCARGO` del Excel. |
| A9 | Una recepción se puede **deshacer**: sin eso, la guarda de A6 deja la fila congelada para siempre. |
| A10 | En Gastos, los KPIs se calculan sobre **lo que se ve**, y el filtro no ofrece proveedores sin gastos en el rango. |
| A11 | La cadena del Dashboard cierra **al final del rango**, no en el saldo de hoy; y una fecha que no existe en el calendario se rechaza al escribir. |
| C1/C6 | Los nombres los corrige Claude. ⚠️ **Falta que el dueño diga cómo se llama la contraparte propietaria** (hoy "vanan"). |
| C3 | Producción se queda, **con un recordatorio** para cargar las lecturas. |
| C4+C5 | **Recordar contar al cerrar el mes** Y que **la recepción sugiera el conteo**. |

---

## Fase 1 — Arreglar lo que está roto

Lo primero porque A1 es un defecto vivo en producción desde el 2026-10-09.

### 1.0 El gasto que nació de una factura se puede romper desde Gastos (A6)

Descubierto el 2026-10-10, al cargar a mano la factura del Cyan (cuesta $25, se
le pagaron $15). **Es la primera fila de producción que lo toca.**

`Expense.update` y `Expense.remove` **no miran `purchaseInvoiceLineId`**. Editar
o borrar ese gasto desde Gastos —o desde "editar compra" de filamento, que usa
los mismos endpoints— deja a la factura mintiendo: `received` sigue en 1 con el
rollo fuera del inventario, el monto del gasto y el de la línea se contradicen,
y el precio de cotización se recalcula contra una compra que ya no existe. Nada
de eso avisa. Es el mismo descuadre que la factura venía a evitar, entrando por
la puerta de al lado.

- [ ] La API rechaza `update` y `remove` de un gasto con `purchaseInvoiceLineId`,
      con un mensaje que manda a Compras.
- [ ] El gasto expone `fromInvoice` y Gastos lo muestra con una marca
      ("de factura") y sin botones de editar ni borrar. **Hoy el front no sabe
      que un gasto puede venir de una factura**: no hay ni un campo.
- [ ] Regresión: editar y borrar uno de esos → 400, y la factura queda intacta.
      Mutación: quitar la guarda tiene que tumbar los dos tests.
- [ ] ⚠️ Mientras no exista "des-recibir", esa fila solo se arregla anulando la
      factura. Que no se pueda romper es lo que importa; corregirla es Fase 2.

### 1.1 Encargar una impresora que todavía no tenés (A1)

Hoy la opción "algo que todavía no tenés" **siempre crea una ficha de
filamento**: encargar una impresora nueva te crea un rollo llamado
"Impresora A2". Y una impresora nueva es, por definición, una que no está en el
catálogo — o sea, el caso normal.

- [ ] `PurchaseInvoiceLine` gana `nuevoTipo` (`MATERIAL` | `PRINTER`), nulable.
      Migración **aditiva**.
- [ ] El `refine` del schema exige `nuevoTipo` cuando viene `nombreNuevo`, y lo
      prohíbe cuando no. Sin eso vuelve la ambigüedad por otra puerta.
- [ ] Al recibir, se crea `Material` o `Printer` según `nuevoTipo`. Una impresora
      nace con el precio de la compra; sus horas de vida y consumo quedan en el
      default y se corrigen desde el catálogo.
- [ ] El formulario pregunta "¿filamento o impresora?" cuando elegís "algo nuevo".
- [ ] Regresión: una línea con `nombreNuevo` y sin `nuevoTipo` es 400; recibir
      una de tipo `PRINTER` crea una impresora y **no** un filamento.
- [x] ⚠️ Verificado el 2026-10-09: **el bug no alcanzó a hacer daño**. En
      producción hay 0 líneas con `nombreNuevo`, así que nadie usó ese camino
      todavía. Las 4 fichas creadas ese día (Naranja, Rosado, Morado, Cyan) son
      filamentos de verdad, cargados por el camino normal.

### 1.2 El proveedor en Gastos (A5)

Ya hay **7 gastos con proveedor** cargado y la tabla no lo muestra.

- [ ] Columna "Proveedor" en la tabla de escritorio; en las tarjetas del
      teléfono, debajo de la descripción.
- [ ] Filtro por proveedor, con las mismas opciones que ya usa el formulario
      (contactos con tipo Proveedor).
- [ ] ⚠️ Verificar el ancho a 375 px: la tabla ya está justa.

---

### 1.3 El mes del Dashboard no es la caja, y se lee como si lo fuera (A7)

Planteado por el dueño el 2026-10-10: *"la caja muestra que tengo menos 10 de
saldo"*. Medido en producción ese día, con el filtro en "Este mes":

| En pantalla | Dice | Qué es de verdad |
|---|---|---|
| **Resultado de caja** | −61.20 | cobrado de octubre (140.80) − gastos de octubre (202) |
| **Saldo en caja** | 102.83 | lo que REALMENTE hay, toda la historia |

El −61.20 no es un saldo y **ni siquiera es plata**: ignora los $50 que puso
Evanan de su bolsillo, ignora los $29.19 que se le devolvieron y cuenta el Cyan
por los $25 que cuesta en vez de los $15 que salieron. Tres definiciones
distintas de "octubre" en una sola pantalla. Según la caja de verdad, octubre
fue **−30.39**: venías con **133.22**, quedan **102.83**.

⚠️ **Lo que NO se hace: cambiar el orden en que se descuenta la plata** (primero
la de meses anteriores, después la del mes). La plata no tiene mes escrito: si
los gastos de octubre se cargaran contra el saldo viejo, octubre cerraría en
+140.80 y el gasto desaparecería del mes en que pasó — el número dejaría de
responder lo único que responde, "¿este mes se pagó solo?". Y el número que
quedaría es 102.83, que **ya está en pantalla** como Saldo en caja.

- [ ] La cadena, con UNA sola definición (la de Caja): "venías con $133.22 ·
      octubre −$30.39 · te queda $102.83". El saldo inicial sale de
      `businessCash(ledger, hasta)`, que ya acepta fecha: falta exponerlo.
- [ ] "Resultado de caja" pasa a llamarse **"Resultado de la operación"** y su
      pie dice qué NO incluye (aportes, devoluciones, cuotas). Es la cuenta útil
      para "¿el taller se paga solo?", pero no es caja.
- [ ] ⚠️ **El color de alarma es del SALDO, no del mes.** Un mes en rojo con
      $102.83 en la cuenta no es una emergencia; un saldo en rojo sí.
- [ ] El gasto de factura cuenta $25 en el resultado de la operación (es lo que
      cuesta) y $15 en la caja (es lo que salió). Las dos cifras son correctas:
      lo que no puede es seguir llamándose igual.

### 1.4 "Mostrador vs encargo" no muestra los encargos (A8)

Reportado por el dueño el 2026-10-10 con el filtro en octubre: la dona dice
**100 % mostrador**. Medido en producción ese mismo día:

| Canal | Octubre | Lo que muestra la dona |
|---|---|---|
| Mostrador | $26.75 | **todo** |
| Encargos | $114.05 (4 abonos) | **nada** |

O sea: **el 81 % de lo que entró en octubre falta** justo en el gráfico cuyo
único trabajo es comparar los dos canales. Y no falta por poco: dice lo
contrario de la verdad — que el negocio vive del mostrador, cuando vive de los
encargos.

**Causa.** La dona se arma con `Sale.kind` solamente. Las 25 ventas `ENCARGO`
son **totales semanales del Excel** y se cortan el 2026-08-24: desde que la app
tomó el control, un encargo no genera un `Sale`, genera **abonos** (`Payment`),
justamente para no contar la plata dos veces. La dona nunca se enteró. El resto
de la pantalla sí: "Cobrado de encargos", ingresos por día y día de la semana ya
usan `paymentRows`. La dona es la única que quedó afuera.

- [ ] Encargos = ventas `ENCARGO` (el histórico del Excel) **+ abonos del
      periodo**. Mostrador = ventas `COUNTER`. Así el total de la dona es
      exactamente el de "Ventas + Cobrado de encargos".
- [ ] ⚠️ **No** convertir los abonos en `Sale`: ahí está el doble conteo que
      la app evita a propósito.
- [ ] Test del armado con números puestos a mano: un mes solo con abonos no
      puede dar 100 % mostrador.
- [ ] ⚠️ Revisar si el selector "Canal: todos / mostrador / encargos" filtra de
      verdad los abonos o solo las ventas.

### 1.5 Deshacer una recepción (A9)

Apareció al cerrar 1.0, el 2026-10-10: con la guarda puesta, una línea ya
recibida no se puede corregir por ninguna puerta y los cuatro mensajes de error
se mandan unos a otros en círculo. No existe "des-recibir".

- [ ] Revertir UNA recepción: borra el gasto que nació de ella y baja
      `received` en su cantidad, en una transacción; después recalcula el
      precio del rollo.
- [ ] ⚠️ **El saldo de caja no se mueve**, con test de número clavado: ese gasto
      nunca movió plata.
- [ ] ⚠️ La ficha creada al recibir **no se borra**: puede estar en uso.
- [ ] El mensaje de anular la factura deja de mandar a una puerta cerrada.

### 1.6 En Gastos, los totales de lo que se ve (A10)

Apareció al terminar 1.2, el 2026-10-10: la tabla muestra las filas filtradas y
los tres KPIs suman todas. Con el filtro de proveedor puesto, ves 2 gastos y un
"Total del periodo" de los 87. El `CLAUDE.md` del repo web ya fija lo
contrario para Ventas.

- [ ] Los tres KPIs sobre las filas visibles.
- [ ] ⚠️ Y la **etiqueta** acompaña: "Total del periodo" con un filtro puesto ya
      no es el total del periodo.
- [ ] Las opciones del filtro salen de las filas cargadas, como en Compras de
      filamento, para que no se pueda elegir un valor que deje la tabla vacía.
- [ ] El texto del vacío distingue "no hay gastos" de "el filtro no deja pasar
      nada".

### 1.7 Dos números que todavía mienten (A11)

Del cierre de 1.3, el 2026-10-10.

- [ ] Con un rango pasado, el tramo del medio se come todo lo posterior porque
      "te queda" es el saldo de hoy. Z pasa a ser el saldo al final del rango —
      la misma función con otra fecha de corte, no otra definición — y el texto
      deja de decir "te queda" cuando el periodo ya cerró.
- [ ] `FECHA` valida la forma y no el calendario: `2026-02-30` entra por los
      movimientos de caja y las conciliaciones, y Prisma lo corre al 2 de marzo.
      ⚠️ Superficie sensible: el test de regresión va CON el arreglo.

---

## Fase 2 — Que la factura refleje lo que te cobraron (A3)

Pediste 10 a $7 y te facturan $7.50. Hoy hay que corregir la línea antes de
recibir, y si ya recibiste algo no se puede.

**Regla:** la línea guarda **lo que pediste**; cada recepción guarda **lo que
costó**. El total de la factura usa el precio real de lo ya recibido y el
pedido para lo que falta.

- [x] `PurchaseReceiveSchema` acepta `unitPrice` opcional. Sin él, se usa el de
      la línea (el caso normal: llegó a lo pactado).
- [x] `invoiceTotals` recibe, por línea, las recepciones con su precio. El total
      deja de ser `Σ cantidad × precio pedido`.
- [x] ⚠️ Tests con números puestos a mano: 6 a $7.50 + 4 pendientes a $7 = 73,
      no 70 ni 75.
- [x] La pantalla avisa cuando el precio informado difiere del pedido: es un
      dato que cambia el total de la factura, no puede pasar en silencio.
- [x] Mutación: ignorar el precio informado y usar el de la línea tiene que
      tumbar un test. (Tumba 5.)

**Cerrada el 2026-10-10 (shared 0.44.0), SIN migración.** La decisión que lo
explica: **una recepción no estrena tabla, su registro ES el `Expense`** que ya
nacía al recibir. Ahí estaban guardados su cantidad y su monto, o sea el precio
real: lo que faltaba era mirarlos. Guardar el precio otra vez al lado habría
sido una segunda verdad sobre la misma entrega, y el día que una de las dos
cambie la factura y el gasto dirían cosas distintas de la misma compra.

- El total de la línea es `Σ(entregas: unidades × su precio) + pendientes ×
  precio pedido`. ⚠️ **Lo que una recepción no cubre vale lo PEDIDO**, y eso
  incluye lo recibido sin recepción registrada (toda la base anterior): una
  factura vieja sigue dando el mismo número que daba ayer.
- ⚠️ **`received` sigue siendo la única definición de cuántos llegaron**; las
  recepciones solo ponen PRECIO. El motor las recorta contra él.
- El precio de cotización del rollo sigue al **monto del gasto**, así que
  informar $7,50 deja $7,50 (`recalcularPrecioDelRollo`, sin tocar nada).
- La ficha que nace al recibir nace con el precio **informado**, no con el
  pedido.
- ⚠️ **`?? ` y no `||`** al resolver el precio: un precio informado de **0** es
  un dato verdadero (un rollo regalado) y con `||` se habría leído como "no
  informó nada".

---

## Fase 3 — Saldo a favor con el proveedor (A2)

Pagaste $100 de una factura de $85. Esos $15 no son un costo de esa compra: son
plata tuya que el proveedor te debe.

- [ ] Un abono puede marcarse como **tomado del saldo a favor** de ese
      proveedor, con la factura de origen.
- [ ] ⚠️ **Un abono tomado del saldo a favor NO mueve la caja.** Esa plata ya
      salió cuando pagaste de más. Es la misma clase de doble carga que el gasto
      nacido de una factura, y necesita su test con número clavado.
- [ ] El saldo a favor **se deriva**: Σ pagado de más − Σ aplicado. Nada
      guardado que pueda contradecir a sus partes.
- [ ] La pantalla del proveedor (o de la factura) muestra cuánto tiene a favor.
- [ ] No se puede aplicar más saldo del que hay, ni de otro proveedor.

---

## Fase 4 — Del faltante al pedido (B1)

La app ya sabe qué colores están agotados o por acabarse; las facturas ya
existen. Falta el eslabón.

- [ ] Botón en **Stock del mes**: "Armar pedido con lo que falta".
- [ ] Abre la factura nueva con una línea por cada filamento OUT o LOW, con la
      cantidad sugerida y el último precio pagado como precio unitario.
- [ ] Se puede sacar líneas y cambiar cantidades antes de guardar: es una
      **propuesta**, no un pedido automático.
- [ ] ⚠️ Un filamento descontinuado no entra en la propuesta aunque esté en cero.

---

## Fase 5 — Ver lo que debés y lo que no llegó

### 5.1 Entregas atrasadas (B3)

`expectedAt` se guarda desde el día uno y **nadie lo mira**.

- [ ] En Compras: la factura con fecha pasada y mercadería pendiente se destaca.
- [ ] En el Dashboard: un aviso corto con cuántas hay.
- [ ] Una factura anulada o ya recibida entera **nunca** está atrasada.

### 5.2 Los proveedores en la pantalla Deuda (B5)

Hoy "cuánto debe el negocio" está partido en dos pantallas.

- [ ] Tercer bloque en Deuda: lo que le debés a cada proveedor, derivado de las
      facturas sin pagar.
- [ ] La gestión de cada factura sigue en Compras: Deuda solo responde "cuánto".
- [ ] ⚠️ El total de la pantalla tiene que ser la suma de los tres bloques. Un
      total que no cuadre con sus partes es peor que no tenerlo.

### 5.3 Lo comprometido, al lado del equilibrio (B2)

- [ ] Junto al punto de equilibrio: "además debés $X de facturas".
- [ ] ⚠️ **NO entra en el cálculo del equilibrio.** Una factura se paga una vez;
      meterla entre los costos fijos haría saltar el número mes a mes y lo
      volvería inútil para decidir precios.

---

## Fase 6 — Que la app te recuerde

### 6.1 Contar el stock al cerrar el mes (C4)

El último conteo es de **septiembre**.

- [ ] Aviso cuando empieza un mes nuevo y el anterior quedó sin contar.
- [ ] Se puede descartar: un recordatorio que no se puede callar se vuelve ruido
      y entrena a ignorarlo.

### 6.2 La recepción sugiere el conteo (C5)

- [ ] Al contar, los rollos recibidos ese mes aparecen como punto de partida.
- [ ] ⚠️ **Sugerir, no escribir.** El conteo es manual a propósito: su valor es
      que alguien miró el estante. Un conteo autocompletado deja de ser un conteo.

### 6.3 Recordar las lecturas de impresora (C3)

Dos registros desde que existe la pantalla.

- [ ] Aviso cuando pasó mucho desde la última lectura.
- [ ] ⚠️ Si pasa un tiempo y sigue sin usarse, la conversación es sacarla del
      menú, no insistir con el aviso.

---

## Fase 7 — Los nombres (C1/C6)

Son cambios de **datos en producción**, sin migración.

- [ ] ⚠️ **Falta que el dueño diga cómo se llama la contraparte propietaria.**
      Hoy es "vanan" y la Caja dice "lo que el negocio le debe a vanan".
- [ ] Reescribir el concepto "Dinero de la caja usado por Vanan
      (regularizacion)", que se ve en el desglose de Caja.
- [ ] Los dos son un `UPDATE` de una fila. Se avisa y se espera OK, como todo lo
      que toca producción.

---

## Lo que NO entra, y por qué

| Qué | Por qué |
|---|---|
| **La tienda** | Feature futura para una landing de venta. Congelada por decisión del dueño. |
| **Comparar proveedores** (B4) | No hay historia todavía: un proveedor y 7 gastos. |
| **Caja con varios socios** (A4) | Hay un solo propietario. La puerta está abierta (la deuda ya se atribuye bien), falta solo mostrar cada bolsillo por separado. |
| **Monedas distintas del USD en facturas** | Igual que en el módulo de compras: si hace falta, se suma después. |
| **Devoluciones al proveedor** | Reemplazado por el saldo a favor (A2), que es lo que de verdad pasa. |

---

## Orden sugerido

1. **Fase 1** — arranca por **1.0** (la guarda del gasto de factura: ya hay una
   fila en producción que se puede romper), sigue con el bug de la impresora, el
   proveedor en Gastos, la cadena de caja del Dashboard y la dona de canales.
2. **Fase 4** — la que más valor agrega: cierra el circuito stock → pedido → inventario.
3. **Fase 5** — ver lo que debés y lo que no llegó.
4. **Fase 2** y **3** — precisión de las facturas, cuando el uso real las pida.
5. **Fase 6** — los recordatorios.
6. **Fase 7** — los nombres, en cualquier momento (es un `UPDATE`).
