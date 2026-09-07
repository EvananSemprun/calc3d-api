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

## 3. Ventas 🔴

Leerla es fácil (los montos ya vienen calculados en las filas auxiliares). Lo
difícil es conciliar. **No empezar sin resolver 3.1 y 3.2.**

3.1. **Decidir qué pasa con $1.292 de encargos históricos** 🔴
   - Los encargos de febrero a julio existen ÚNICAMENTE como una nota semanal.
   - Opción A: entran como una venta semanal agregada (tipo ENCARGO, fechada en
     su semana, sin cliente ni detalle).
   - Opción B: no se importan y el histórico previo a agosto queda solo con
     mostrador — se pierde el 59 % de la facturación.
   - Sin esta decisión, cualquier import de `Ventas` está mal de entrada.

3.2. **Decidir los $23,50 de descuadre** 🔴
   - 9 semanas donde la nota no explica la diferencia. Las dos que importan:
     - **Semana 2**: nota "Encargos: 9$" que nunca se sumó al total.
     - **Semana 3**: $20 de diferencia sin ninguna nota.
   - Definir si se corrigen en el origen o se importan como están y se documenta.

3.3. **Evitar la doble carga de los encargos de agosto-septiembre**
   - ~$136,50 están en la hoja `Encargos` (1.2) **y** dentro de las notas
     semanales. Al importar, uno de los dos lados tiene que ceder.

3.4. **Importar el mostrador**
   - Filas 19-24 (lunes a sábado) con la fecha real de la fila 18 → `Sale` diaria.
   - No usar la fila 11: incluye encargos e infla el mostrador un 200 %.
   - Los domingos no se importan: 0 ventas en 52 semanas.

3.5. **Verificar contra el Excel antes de escribir**
   - Mostrador = $720 · total con encargos = $2.203. Si el import no da esos
     números, no escribe.

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

## 5. Punto de equilibrio en tres niveles 🟡

Hoy la app calcula un solo nivel (costos fijos ÷ margen de contribución).

5.1. Agregar a Configuración: **cuota mensual del préstamo** y **reserva mensual
     para equipos**.
5.2. Calcular los tres niveles de la hoja:
   - No perder dinero.
   - Además pagar la cuota.
   - Además generar la reserva.
5.3. Mostrarlos en el Dashboard con el avance del mes contra cada uno.
5.4. 🟡 Decidir si el costo variable se expresa como **% de la venta** (como la
     hoja, 25 % de filamento) o se mantiene el margen de contribución actual.

---

## 6. Reposición de equipos 🟡

6.1. Repartir la ganancia acumulada entre las impresoras hasta cubrir su costo.
6.2. Mostrar por equipo: costo, repuesto, falta y % — como la hoja `Inversion`.
6.3. 🟡 Definir qué cuenta como "ganancia acumulada": hoy el dashboard tiene
     recuperación de inversión global, pero no equipo por equipo.

---

## 7. Deuda (feature nueva) 🟡

7.1. Modelo de préstamo: monto inicial, cuota mensual y sus pagos.
7.2. Saldo pendiente derivado (no almacenado), como el saldo de un pedido.
7.3. Alimenta el nivel 2 del punto de equilibrio (5.2).
7.4. 🟡 Decidir si es un préstamo único o si puede haber varios.

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
