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

## 6. Reposición de equipos 🟡

6.1. Repartir la ganancia acumulada entre las impresoras hasta cubrir su costo.
6.2. Mostrar por equipo: costo, repuesto, falta y % — como la hoja `Inversion`.
6.3. 🟡 Definir qué cuenta como "ganancia acumulada": hoy el dashboard tiene
     recuperación de inversión global, pero no equipo por equipo.

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

## 8. Metas (feature nueva) 🟡

8.1. Meta mensual de **ventas**, **encargos** y **clientes nuevos**.
8.2. Real vs meta y % de cumplimiento, derivados de lo que ya hay.
8.3. Mostrarlo en el Dashboard junto al punto de equilibrio.
8.4. 🟡 Decidir si las metas se cargan a mano por mes o se proyectan.

---

## 9. Medición que hoy no existe 🟢

Nada que migrar: son datos que nadie tiene todavía. Cuanto antes se empiecen a
registrar, antes sirven.

9.1. **Horas de máquina acumuladas**
   - Sumar las horas de cada trabajo a la impresora usada.
   - Sin esto no se sabe qué tan cerca está cada equipo de su vida útil, y el
     mantenimiento por hora es un número inventado.

9.2. **Tasa real de fallos**
   - Un campo de "reimpresiones por fallo" en el pedido.
   - Convierte la merma de supuesto (8 %) en dato medido en dos meses.

9.3. **Mantenimiento gastado vs cobrado**
   - Comparar los repuestos comprados (gastos enlazados a la impresora, ver 2.3)
     contra lo que se cobró por mantenimiento por hora.
   - Hoy el campo está en cero: hay repuestos comprados que no tocan ningún precio.

---

## 10. El Excel: arreglar o retirar 🔴

10.1. 🔴 **Decidir si la hoja sigue usándose en paralelo.**
   - Si la app la reemplaza, arreglar sus bugs es trabajo que se tira.
   - Si conviven, hay que arreglarlos o los dos sistemas van a discrepar.

10.2. Si se sigue usando, los tres bugs confirmados:
   - Consumo mensual negativo (`anterior + comprados − actual`).
   - Conteo parcial leído como total.
   - Merma aplicada solo a los gramos, no al desgaste ni a la luz.
   - Y el cuarto: la columna *Costo por gramo* de `Inventario` divide entre 1000
     fijo; le falta una columna de gramos por rollo.

---

## Orden sugerido

| # | Actividad | Por qué en ese lugar |
|---|---|---|
| 1 | Importaciones directas (1) | Datos limpios, sin decisiones pendientes |
| 2 | Analítica de filamento (4) | Sin migración: solo pantalla sobre datos ya cargados |
| 3 | Gastos (2) | Dos decisiones menores y queda cerrado el ledger |
| 4 | Medición (9) | Cuanto antes se empiece a registrar, antes hay datos reales |
| 5 | Ventas (3) | Necesita 3.1 y 3.2 decididas; es la de mayor riesgo |
| 6 | Punto de equilibrio (5) + Deuda (7) | Van juntos: el nivel 2 depende de la cuota |
| 7 | Reposición (6) y Metas (8) | Valor alto, pero dependen de que lo anterior esté cargado |
