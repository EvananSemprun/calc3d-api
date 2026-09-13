# El Excel y la app: qué lleva cada uno

Mapa de `bananolab.xlsx` (14 hojas) contra Calc3D. Sirve para decidir qué falta
migrar y para no volver a analizar el archivo desde cero.

Actualizado: 2026-09-07 · Sin montos a propósito: este repo es público.

> **El Excel ya no se edita a mano.** Desde 2026-09-07 la app lo GENERA:
> Configuración → Datos → "Descargar reporte en Excel" (`GET
> /reports/excel.xlsx`). Los datos se cargan en la app y el libro es su salida,
> así que las diferencias que este documento describe son históricas: ya no hay
> dos sistemas que puedan discrepar.

## 1. Hoja por hoja

| Hoja | Qué información lleva | Dónde vive en la app | Estado |
|---|---|---|---|
| **Costeo** | Costeo de una pieza: filamento, insumos, máquina, tiempo, empaque, margen, redondeo, cobro en Bs, mayoreo | Calculadora (`/`) | ✅ **Migrado** y ampliado |
| **Inventario** | 48 compras de filamento: fecha, color, marca, cantidad, precio, pago en Bs, proveedor | Filamento → Compras | ✅ **Migrado** |
| **Stock mensual** | Conteo físico de rollos por mes, estado activo/descontinuado, reposición | Filamento → Stock del mes | ✅ **Migrado** |
| **Hoja de datos (respaldo)** | Listas de validación (marcas, tipos, colores) | `CatalogOption` | ✅ Equivalente |
| **Materiales** | Catálogo de costos de 3 insumos que NO son filamento (imanes, papel burbuja, clicks) | Catálogos → Insumos (`Component`) | ✅ **Migrado** |
| **Inversion** | Dos impresoras: costo y cuánto se repuso con la ganancia acumulada | `Printer` + `Expense` + `GET /printers/recovery` | ✅ **Migrado** |
| **Resumen** | Dashboard derivado de las demás hojas | Dashboard | ⚠️ Parcial — ver §3 |
| **Encargos** | 7 encargos: fecha de pago, cliente, descripción, canal, monto, costo de material | `Order` DELIVERED + su abono | ✅ **Migrado** |
| **Publicidad** | 7 campañas: fecha, formato, público, objetivo, gasto, alcance, conversaciones, visitas | `Campaign` + su gasto en el ledger | ✅ **Migrado** (se agregaron alcance/conversaciones/visitas al modelo) |
| **Clientes** | 5 clientes. Solo nombre y tipo son datos; lo demás son fórmulas | `Client` | ✅ **Migrado** |
| **Gastos** | 19 gastos con categoría propia (Insumos/Repuestos/Empaque/Diseño) | `Expense` | ✅ **Migrado** (16 filas; 3 ya estaban por `Publicidad` y `Materiales`) |
| **Ventas** | Grilla semanal desde febrero. Los montos están en el texto de cada día; las filas auxiliares que los parseaban **llegaron vacías** (ver §6) | `Sale` | ✅ **Sincronizado** — $2.233,96 (ver §6) |
| **Deuda** | Préstamo de la impresora P2S y sus pagos | `Loan` + `LoanPayment` | ✅ **Migrado** — saldo $750 |
| **Metas** | Metas mensuales de ventas, encargos y clientes nuevos, con % de cumplimiento | `Goal` (lo real se deriva) | ✅ **Migrado** — 5 meses |

## 2. Lo que la app tiene y el Excel no

No es "de más": es la razón por la que la app reemplaza a la hoja.

| Capacidad | Detalle |
|---|---|
| **Presupuestos con historia** | Guardados con snapshot del cálculo, versionados, con PDF para el cliente y desglose interno aparte |
| **Precio con semáforo** | Margen real, piso configurable y aviso en rojo al bajar de él; el Excel solo muestra el número |
| **Mayoreo verificado** | Cada tramo muestra el margen que deja y si cae bajo el piso |
| **Cobro protegido en Bs** | Tres bases de tasa, colchón de reposición y cuánto se pierde por cada redondeo |
| **Tienda pública** | Catálogo con fotos, opciones y enlace público, alimentado por el costeo |
| **Bandeja de pedidos** | Lo que llega de la tienda entra en una bandeja; nada toca la operación hasta confirmar |
| **Pedidos con abonos** | Saldo derivado, estados, nota de entrega en PDF, cuentas por cobrar |
| **Productos con recosteo** | Recalcula con los precios de hoy y avisa si un producto quedó bajo el margen mínimo |
| **Campañas con ROI** | ROAS, salud y recomendación automática (escalar/mantener/revisar/pausar) |
| **CRM con mapa** | Contactos por tipo, historial y ubicación en mapa |
| **Multi-moneda con historia** | Tasas con nombre, congeladas por documento; el Excel usa la tasa del día que esté escrita |

## 3. Mismo dato, cuenta distinta

Donde los dos calculan lo mismo pero no igual. **Ninguna de estas diferencias es
un error de la app: son decisiones tomadas a propósito.**

| Concepto | El Excel | La app | Por qué |
|---|---|---|---|
| **Costo por gramo** | `Costeo` lo hace bien (el peso del rollo es editable); **`Inventario` divide entre 1000 fijo** | Usa los gramos reales de cada ficha | Ver el recuadro de abajo: es un bug con consecuencia hoy |
| **Merma** | Solo sobre los gramos | Sobre filamento + desgaste + luz | Una impresión fallida también gasta horas de máquina y electricidad |
| **Consumo del mes** | Total anterior − total actual | Además suma lo comprado en el mes | La resta sola da consumo NEGATIVO en un mes con compras |
| **Conteo parcial** | Suma lo poco cargado como si fuera todo | Avisa "llevás N de M fichas contadas" | Ese total alimenta el consumo: leerlo como firme es peor que no tenerlo |
| **Stock** | Por color, sin marca | Por ficha, con marca | Al reponer hay que saber qué marca comprar |
| **Precio del filamento al costear** | Se copia a mano de `Inventario` a `Costeo` | Sale del catálogo, que la última compra actualiza sola | Si se olvida, se cotiza con un precio viejo |
| **Mayoreo** | Descuento sobre el precio final | Igual (se cambió para seguir la hoja) | Es como se negocia de verdad |
| **Punto de equilibrio** | Tres niveles: no perder / + cuota del préstamo / + reserva para equipos | Los mismos tres niveles | La cuota se **deriva** de los préstamos abiertos, no se escribe a mano |
| **Reposición de equipos** | Reparte la ganancia acumulada entre las impresoras hasta cubrirlas | Lo mismo, en cascada por orden de compra | Acumulado de toda la historia; ya no depende del filtro de fechas |
| **Mantenimiento por hora** | **No lo cobra**: la máquina solo cuesta inversión ÷ vida útil | Campo propio en la impresora, se suma al desgaste | Boquillas, correas y grasa son gasto real que la vida útil sola no captura. Hoy el campo está en cero: hay repuestos comprados que no tocan ningún precio |

### El ÷1000 de `Inventario`, en detalle

La hoja **`Costeo` no tiene este problema**: ahí `Peso del rollo (g)` es una
casilla editable y el costo por gramo sale de `precio ÷ ese peso`.

El 1000 está quemado en **`Inventario`**, columna *Costo por gramo USD*
(`= costo por rollo / 1000`). No es teórico: **Filaven vende en 100 g, 1 kg, 2 kg
y 5 kg**. Un rollo de 2 kg comprado por $40 sale en esa columna a **$0,04/g**
cuando el real es **$0,02/g** — el doble. A la hoja le falta una columna de
*gramos por rollo*; la app ya la tiene (`rollGrams` por ficha).

## 4. Lo que el Excel calcula y la app todavía no

Analítica que hoy solo existe en la hoja:

- ~~**Rollos por marca** e **inversión por marca**~~ → ✅ Filamento → Análisis.
- ~~**Top 10 de colores** por rollos comprados~~ → ✅ Filamento → Análisis.
- **% de recurrencia de clientes** (clientes con 2+ compras sobre el total).
- ~~**Los tres niveles de venta mensual necesaria**~~ → ✅ Dashboard.
- ~~**Saldo del préstamo** y su cuota mensual~~ → ✅ Finanzas → Deuda.
- ~~El **seguimiento contra metas** mensuales~~ → ✅ Finanzas → Metas.

Las dos primeras salían de datos que la app **ya tenía** (compras con marca y
color): eran pantalla, no migración, y ya están hechas. Las tres últimas
necesitan features nuevas.

## 5. Orden sugerido para lo que falta

1. **Importaciones directas**: Clientes, Encargos, Publicidad, Inversión. Datos
   limpios y con destino claro.
2. **Gastos**: 19 filas, pero hay que mapear categorías y decidir las fechas.
3. **Analítica de filamento** (rollos por marca, top colores): sin migración, solo
   pantalla.
4. **Ventas**: leer las filas auxiliares y decidir qué hacer con los encargos
   históricos y el descuadre (§6). No es difícil de leer; es difícil de conciliar.
5. **Metas** y **Deuda**: features nuevas; conviene diseñarlas, no importarlas.

---

## 6. `Ventas`: cómo se lee y dónde está la trampa

**Fila 18** (`aux: lunes de la semana`): la fecha real del lunes de las **52
semanas**, como fecha. No hay que inferir el año de los encabezados. Ningún
domingo tuvo venta en 52 semanas.

⚠️ **Las filas auxiliares 19-24 NO se pueden usar.** Eran FÓRMULAS que parseaban
el monto de cada día, y el libro se guardó sin recalcular: `openpyxl` con
`data_only=True` devuelve `None` en todas. Un lector que confíe en ellas ve un
mostrador de **$0** y no falla — simplemente no carga nada.

Hay que **parsear el texto del día** (`"Martes 3: 10$"` → `10`), que es lo que
hace `montos_del_texto()` en el extractor. Se validó contra la propia hoja: el
parseo reproduce exactamente los mismos totales que dieron las auxiliares cuando
sí tenían valor, incluido el descuadre de $23,50 al centavo.

**La trampa: la fila 11 (`Total`) no es el mostrador.**

| | Monto |
|---|---|
| Suma de los días (parseando el texto) — mostrador real | **$726** |
| Fila 11 (`Total ($)`), escrita a mano | **$2.257,46** |
| Diferencia | **$1.531,46** |
| Notas de encargos de la fila 10 | **$1.507,96** |
| **Descuadre sin explicación** | **$23,50** |

Importar la fila 11 como ventas de mostrador **infla el mostrador un 200 %**.

**Pero importar solo los días pierde más todavía.** La hoja `Encargos` arranca el
11/08/2026 y suma **$136,50**; los encargos de febrero a julio existen ÚNICAMENTE
como una nota semanal:

| | Monto |
|---|---|
| Encargos en la hoja `Encargos` (7 filas, ago-sep) | $136,50 |
| Solapamiento con las notas de esas mismas semanas | ~$167,50 |
| **Encargos que solo existen como nota semanal** | **$1.292** |

O sea: el riesgo de **duplicar** es de ~$136,50, no de $1.459. Y quedarse solo con
los días tira **$1.292 de $2.257,46: el 57 % de la facturación histórica**.

**Cómo se importó (2026-09-07):**

1. **Mostrador**: filas 19-24, con fecha exacta por día. Directo.
2. **Encargos de agosto en adelante**: de la hoja `Encargos`, con cliente, canal y
   descripción. Directo.
3. **Encargos que solo existen como nota**: entran como venta semanal agregada
   (ENCARGO, fechada el lunes, sin cliente, con la nota copiada). El descuento de
   lo ya cargado es **semana por semana**, no por fecha de corte: un corte en
   agosto perdía $46 de semanas cuya nota vale más que sus pedidos.
4. **Los $23,50 de descuadre** NO se importaron. Esa diferencia es el descuadre
   de la hoja, repartido en 9 semanas. Las dos que importan:
   - **Semana 2**: la nota dice "Encargos: 9$" y el total **nunca los sumó**.
   - **Semana 3**: $20 de diferencia **sin ninguna nota** que la explique.

**Cómo se re-sincronizó (2026-09-09):** `prisma/sincronizar-excel.mjs`, pensado
para correrse **cada vez que el Excel cambie** (los `import-*.mjs` son de carga
inicial y fallan si ya hay datos). Compara contra la base y escribe SOLO la
diferencia; correrlo dos veces seguidas no hace nada la segunda vez.

⚠️ **Un encargo se identifica por cliente + monto + DESCRIPCIÓN, nunca por fecha.**
La fecha no sirve: un pedido cargado a mano puede tener un día distinto del que
quedó escrito en la hoja (un cliente, 10/09 en la app y 09/09 en el Excel). Pero
**tolerar unos días es peor que exigir la fecha exacta**: la hoja tiene dos
encargos de un mismo cliente por $10 en la misma semana ("2 macetas" el 05/09 y "2
materos" el 09/09), y con tolerancia el segundo se daba por cargado — una venta
real que desaparecía en silencio. La descripción sí es identidad: la escribió el
dueño y es la que el import copió a la línea del pedido. Cada pedido de la base
se consume una sola vez, para que uno no tape dos filas iguales del Excel.

El script también **recalcula los agregados semanales**: cada semana vale
`nota − pedidos de esa semana`, y el agregado se borra cuando llega a cero (le
pasó a la del 07/09 al entrar sus cuatro encargos).

Resultado: mostrador **$726**, encargos **$1.507,96**, ingresos **$2.233,96**
contra los $2.257,46 de la fila 11 — el mismo descuadre de $23,50 de siempre.

---

## 7. Lo que no mide ninguno de los dos

Vacíos que no son de migración: hoy nadie tiene el dato.

| Qué falta | Por qué importa |
|---|---|
| **Horas de máquina acumuladas** | ✅ Se anotan por pedido; la pantalla Producción muestra el % de vida útil de cada equipo |
| **Tasa real de fallos** | ✅ Campo "piezas reimpresas" en el pedido. Con dos meses anotados, la merma del 8 % deja de ser un supuesto |
| **Mantenimiento gastado vs cobrado** | ✅ Se compara por máquina. Hoy: $10 gastados en la A1 contra $0 cobrados, porque la tarifa por hora está en cero |

> Los tres se **empiezan a medir ahora**: la app tiene dónde anotarlos, pero el
> dato no existe hasta que se cargue. Un pedido sin anotar queda fuera de las
> cuentas, no cuenta como cero.
