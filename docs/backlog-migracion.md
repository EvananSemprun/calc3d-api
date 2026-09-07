# Lo que falta: actividades

Backlog derivado de [`excel-vs-app.md`](./excel-vs-app.md). Cada actividad dice
qué incluye, qué hay que **decidir antes** y dónde toca.

Marcas: 🔴 bloqueada por una decisión · 🟡 decisión menor · 🟢 lista para hacer

Actualizado: 2026-09-07

---

## 1. Importaciones directas ✅ HECHO (2026-09-07)

> 5 clientes · 7 encargos como pedidos entregados con su abono ($136,50) ·
> 7 campañas con su gasto ($103,56) · 2 impresoras ($1.532) · 3 insumos ($34).
> Script: `prisma/import-negocio.mjs` (ensayo por defecto, `--commit` para
> escribir). Verificado contra el Excel antes y después.
>
> Se agregaron al modelo `alcance`, `conversaciones` y `visitas al perfil` de la
> campaña, con el costo por conversación derivado: sin eso, las 7 campañas se
> ven como fracaso total (ROAS 0×) porque la atribución conservadora no les
> asignó ninguna venta.

Datos limpios, con destino claro en la app. Un solo script por hoja, con ensayo
y verificación, como el de filamento.

1.1. **Clientes** (5 filas)
   - Importar solo **nombre** y **tipo**: el resto de la hoja son fórmulas que la
     app ya deriva (primera compra, total gastado, ticket, recurrencia).
   - Cruzar por nombre con los contactos que ya existan para no duplicar.

1.2. **Encargos** (7 filas, desde el 11/08/2026)
   - Cada fila → `Order` o `Sale` con cliente, descripción, canal y monto.
   - El **canal** de la hoja (WhatsApp / Instagram / Personal / Referido) mapea a
     `originChannel`; falta confirmar el valor para "Personal".
   - Enlazar con los clientes de 1.1 por nombre.
   - ⚠️ Depende de 3.3: estos 7 encargos también están contados dentro de las
     notas semanales de `Ventas`.

1.3. **Publicidad** (7 campañas)
   - Cada fila → `Campaign` con fecha, formato, público, objetivo y gasto.
   - El **gasto** además debe entrar como `Expense` de categoría publicidad
     enlazado a la campaña: así el ROI se deriva del ledger, como ya funciona.
   - Alcance, conversaciones y visitas: hoy la app no los guarda. Decidir si se
     agregan al modelo o se pierden (son la base del "costo por conversación").

1.4. **Inversión en equipos** (2 impresoras)
   - Cada equipo → `Printer` con su costo, y un `Expense` marcado como inversión.
   - No confundir con 6: acá solo entra el equipo y lo que costó.

1.5. **Materiales** — insumos que no son filamento (2 filas)
   - Imanes y papel de burbujas → `Component`, con su costo por unidad.
   - La hoja usa "el precio de la compra más reciente"; en la app eso ya lo hace
     el catálogo.

---

## 2. Gastos ✅ HECHO (2026-09-07)

> 16 de las 19 filas, $934. Script: `prisma/import-gastos.mjs`.
> Categorías: Insumos y Empaque → CONSUMABLE · Repuestos → MAINTENANCE ·
> Diseño → OTHER. Fechas al cierre del histórico (31/08), salvo los pagos al
> diseñador, que nombran su mes y se fechan ahí.
>
> **Tres filas NO se importaron** porque ya estaban por otra hoja: la de
> publicidad ($103,56 = las 7 campañas) y los imanes y el papel de burbujas
> ($19, de `Materiales`). El script verifica que cada una esté realmente
> cargada antes de saltarla; si no la encuentra, no escribe nada.
>
> Pendiente menor: **$82 de repuestos sin máquina asignada** (teclas, dos
> boquillas, grasa). La fila no dice a cuál impresora fueron, y sin eso no
> alimentan el mantenimiento por hora (ver 9.3). Solo "Repuestos A1" quedó
> enlazado.

---

## 3. Ventas ✅ HECHO (2026-09-07)

> 87 ventas de mostrador ($720, día por día con su fecha real) + 25 ventas
> semanales de encargos ($1.323). Con los $136,50 ya cargados como pedidos, la
> facturación histórica queda en **$2.179,50**.
> Script: `prisma/import-ventas.mjs`.
>
> **3.1 resuelto** (los $1.292 históricos): entran como venta semanal agregada,
> fechada el lunes, sin cliente ni detalle y con la nota original copiada. No
> existen en ningún otro lado; la alternativa era perder el 58 % de la
> facturación.
>
> **3.3 resuelto** (doble carga): el descuento es **semana por semana**, no por
> fecha de corte. A cada nota se le resta lo que esa misma semana ya tiene como
> pedido. Un corte en "de agosto en adelante no importo" perdía $46: hay semanas
> de agosto donde la nota vale más que los pedidos de la hoja `Encargos`.
>
> **3.2 sigue abierto** (los $23,50 de descuadre): NO se inventaron. La app dice
> $2.179,50 y la fila 11 de la hoja dice $2.203; esa diferencia es exactamente
> el descuadre que la hoja no explica. Los dos casos claros:
> la semana del 02/02 (nota "Encargos: 9$" que el total nunca sumó) y la del
> 09/02 ($20 sin ninguna nota).
>
> ⚠️ **Agosto queda deformado en la vista mensual**: los gastos históricos sin
> fecha (filamento, insumos, repuestos) se fecharon todos al 31/08, así que ese
> mes muestra $1.649 de gastos contra $188 de ingresos. No es un mes real.

---

## 4. Analítica de filamento ✅ HECHO (2026-09-07)

> Pestaña **Análisis** en Filamento: rollos e inversión por marca (con el costo
> promedio por rollo y la participación de cada una), colores más comprados y
> reparto por material. Agrega sobre las MISMAS compras que muestra la pestaña de
> al lado con el helper puro `groupPurchases` (shared 0.7.3) — no hay endpoint
> nuevo: dos fuentes para el mismo total terminan discrepando.
>
> Para poder agrupar, `GET /filament/purchases` ahora devuelve también la marca,
> el tipo y el color de la ficha.

---

## 5. Punto de equilibrio en tres niveles ✅ HECHO (2026-09-07)

> El Dashboard muestra los tres niveles de la hoja, con el avance del periodo
> contra cada uno. Con los datos del Excel: **$157,33 / $290,67 / $490,67**,
> idénticos a la hoja `Metas`.
>
> **5.4 no era una decisión**: el "costo variable 25 %" de la hoja y el "margen
> de contribución" que la app ya guardaba son el mismo dato al revés
> (0,25 y 0,75). Se guardó 0,75 y se mejoró la etiqueta.
>
> **La cuota NO se guarda en Configuración** (el 5.1 decía eso): se deriva de los
> préstamos abiertos con `monthlyLoanPayments`. El mismo número en dos lugares
> termina diciendo dos cosas. Sí se agregó `Settings.equipmentReserve`.
>
> Un nivel se oculta cuando no aplica: sin préstamos no hay nivel 2, y sin
> reserva no hay nivel 3.

---

## 6. Reposición de equipos ✅ HECHO (2026-09-07)

> `GET /printers/recovery` + tarjeta en el Dashboard, con el reparto de la hoja
> `Inversion`: una **cascada en orden de compra** (la primera máquina se cubre
> hasta su costo y recién lo que sobra pasa a la siguiente). Se ordena por la
> fecha del gasto de inversión, no por el alta de la ficha.
>
> **6.3 resuelto: ganancia acumulada = ingresos − gastos operativos**, sin la
> inversión en equipos (sería restar dos veces lo que se está reponiendo) ni los
> pagos del préstamo (devolver capital no es un costo).
>
> Es **acumulado sobre toda la historia** y lo calcula el servidor: la tarjeta
> vieja "Recuperación de la inversión" usaba el filtro de fechas del Dashboard,
> así que el mismo negocio se veía distinto según el rango elegido. Se
> reemplazó, no se agregó al lado.
>
> Hoy: ganancia acumulada **−$182,06**, los dos equipos en 0 % repuesto, igual
> que la hoja. La hoja dice −$143,56; la diferencia de $38,50 son los $23,50 del
> descuadre de `Ventas` más $15 de los clicks, que están en `Materiales` pero no
> en `Gastos`.

---

## 7. Deuda ✅ HECHO (2026-09-07)

> Modelos `Loan` + `LoanPayment` (migración `deuda_y_reserva`), CRUD en
> `/loans`, página **Finanzas → Deuda** y helpers puros en
> `shared/calc/loan.ts`. Importado de la hoja: préstamo de la P2S, $1.000 de
> capital, 4 pagos, **saldo $750, faltan 8 meses**.
>
> **7.4 resuelto: varios préstamos.** Cuesta lo mismo que uno y "uno solo" es
> una apuesta sobre el futuro; el nivel 2 del equilibrio suma la cuota de todos
> los abiertos.
>
> **Un pago de préstamo NO es un `Expense`.** El equipo ya está en el ledger
> como inversión: contar además cada cuota sería contar la misma máquina dos
> veces. Devolver capital no es un costo — el costo fue la impresora. La hoja
> dice lo mismo: "se paga aparte de la operación... no toca el capital".
>
> El saldo se **deriva** (capital − abonos), nunca se almacena, igual que el de
> un pedido.

---

## 8. Metas ✅ HECHO (2026-09-07)

> Modelo `Goal` (migración `metas_mensuales`), `/goals`, página **Finanzas →
> Metas** y tarjeta del mes en curso en el Dashboard. Importadas las 5 metas de
> la hoja (sep 2026 – ene 2027): $1.975 de ventas, 44 encargos, 28 clientes
> nuevos.
>
> **Solo se guarda la meta.** Las tres cifras reales se DERIVAN, con las mismas
> definiciones de la hoja:
> - **ventas** = ventas del mes + pedidos entregados en el mes (la misma cuenta
>   que el Dashboard llama ingresos).
> - **encargos** = cantidad de pedidos del mes.
> - **clientes nuevos** = los que tuvieron su PRIMERA compra en el mes. No
>   alcanza con contar clientes con actividad: Toplevel compró en septiembre
>   pero su primera fue en agosto, y la hoja dice 4, no 5.
>
> El import **verifica esas definiciones** contra las columnas "reales" de la
> hoja y no escribe si no coinciden. Septiembre da $68,50 / 5 / 4 en los dos.
>
> **8.4 resuelto: metas a mano, mes a mes.** Los números del Excel
> (250 → 325 → 450 → 600 → enero 350) llevan adentro una decisión sobre la
> temporada; una proyección automática la borraría.
>
> El avance **no se recorta arriba de 100 %** (a diferencia del equilibrio):
> pasarse de la meta es información. La barra sí se recorta; el número no.

---

## 9. Medición que hoy no existe ✅ HECHO (2026-09-07)

> Tres campos en el pedido (**impresora, horas de máquina, piezas reimpresas**),
> una tarjeta para cargarlos en el detalle del pedido y la pantalla
> **Finanzas → Producción** que los lee. Endpoint `GET /printers/usage`,
> helpers puros en `shared/calc/production.ts`.
>
> Nada de esto se migra: son datos que empiezan a existir hoy. Lo que arreglan:
> - **9.1 Horas acumuladas** → % de vida útil consumida por máquina.
> - **9.2 Tasa real de fallos** → reimpresas ÷ piezas entregadas, expresada así
>   para que sea comparable con la merma del 8 % que el motor asume.
> - **9.3 Mantenimiento** → repuestos comprados contra lo cobrado por hora.
>   Hoy: $10 gastados en la A1 contra $0 cobrados, porque la tarifa está en cero.
>
> ⚠️ **Un trabajo sin medir NO es un trabajo perfecto.** Los pedidos sin anotar
> quedan FUERA de las cuentas en vez de contarse como cero horas y cero fallos.
> La pantalla muestra siempre cuántos trabajos hay medidos: una tasa sacada de
> dos pedidos no es una tasa, y esconder la muestra la haría parecer firme.

---

## 10. El Excel ✅ RESUELTO (2026-09-07)

> **Decisión del dueño: conviven, pero el Excel deja de ser un lugar donde
> cargar datos y pasa a ser una SALIDA.** `GET /reports/excel.xlsx` arma el
> libro completo (Resumen, Ventas, Encargos, Gastos, Inventario, Stock mensual,
> Clientes, Publicidad, Deuda, Metas y Producción) y se baja desde
> Configuración → Datos.
>
> Es mejor que las dos opciones que estaban planteadas: no hay dos sistemas que
> puedan discrepar, porque solo hay uno y el otro es su reporte. Los tres bugs
> de la hoja dejan de importar: nadie va a escribir ahí.
>
> Las hojas se arman **reusando los servicios de cada pantalla** (metas,
> préstamos, filamento, producción), no repitiendo las consultas: si el reporte
> hiciera sus propias cuentas, terminaría diciendo algo distinto de la app.
>
> Dependencia nueva en la API: **`exceljs`** (aprobada). `fast-csv` y `pdfkit`,
> que ya estaban, no escriben un `.xlsx` real con varias hojas y formatos.

---

## Orden sugerido

**Las 10 actividades están hechas** (2026-09-07). Las 14 hojas del Excel están
migradas y el propio Excel pasó a ser un reporte que la app genera.

Lo único que queda abierto, y es del dueño, no del código:

- **Los $23,50 de descuadre de `Ventas`** (punto 3.2). No se inventaron: la app
  dice $2.179,50 y la fila 11 de la hoja vieja decía $2.203.
- **$82 de repuestos sin máquina asignada**: la fila del Excel no dice a cuál
  impresora fueron, y sin eso no alimentan el mantenimiento por hora.
- **Empezar a anotar la producción** en cada pedido (punto 9). La herramienta
  está; el dato aparece recién cuando se use.
