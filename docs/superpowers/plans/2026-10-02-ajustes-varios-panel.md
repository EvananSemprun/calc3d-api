# Ajustes varios del panel — Plan de implementación

> **Para agentes:** este plan es el contrato. Las decisiones ya están cerradas
> con el dueño (13 rondas de preguntas). No re-abrir decisiones: si algo parece
> mal, reportarlo, no cambiarlo por cuenta propia.

**Objetivo:** 13 ítems de corrección y mejora en el panel (`calc3d-web`) y el
motor/API (`calc3d-api`), acordados el 2026-10-02.

**Arquitectura:** `packages/shared` en `calc3d-api` es la fuente de verdad; todo
cambio ahí sube `SHARED_VERSION` + `package.json`, se recompila (CJS+ESM) y se
trae a la web con `pnpm sync:shared`.

---

## Orden de ejecución

1. **G1 — Campañas** (shared + API + web): ítems 1, 6, 9
2. **G2 — Calculadora** (shared + web): ítem 4
3. **G3 — Dashboard** (web): ítems 7, 8, 13
4. **G4 — Encargos** (web): ítems 3-pestañas, 10, 12
5. **G5 — Varios** (web): ítems 2, 3-sidebar, 5, 11

`shared` se toca en G1 y G2 → van **secuenciales**, no en paralelo.

---

## G1 · Campañas

### Ítem 1 — El detalle revienta (`DecimalError: Invalid argument: undefined`)

**Causa raíz (reproducida 2026-10-02):** `CampaignDetail.tsx:163` llama
`costPer(s.invested, s.quotes)`, pero la API **no devuelve `quotes`** (se dejó de
calcular al eliminar los presupuestos). La guarda `if (count <= 0) return null`
no atrapa `undefined` porque `undefined <= 0` es `false` (con `null` sí
funcionaría). Pasa de largo y ejecuta `D(invested).div(undefined)`.

El tipo `CampaignStats` del front declara `quotes: number`, así que TypeScript no
lo detecta: **el tipo miente sobre lo que manda el servidor.**

- Arreglo 1 (API): devolver `quotes` = encargos atribuidos en estado `QUOTED`.
- Arreglo 2 (shared, defensivo): `costPer`, `roas`, `roi` y `netAfterAds` deben
  devolver `null`/0 ante valores no finitos, no reventar. Es la clase de bug que
  tumba una pantalla entera por un campo que falta.

### Ítem 6 — Campañas vencidas siguen alertando

- `CampaignMetricsInput` no recibe fechas ni estado → el motor no puede saber si
  una campaña sigue corriendo. Agregar estado **derivado**: vigente = estado
  `ACTIVE` **y** (sin `endDate` **o** `endDate` >= hoy en día LOCAL).
- `CampaignAlert` (Dashboard) avisa **solo de las vigentes**.
- La lista muestra «Finalizada» para las vencidas y el filtro «Estado» usa el
  estado derivado.
- `campaignRecommendation`: acción nueva `CLOSED` con veredicto en pasado
  («No rindió: costó $X y dejó $Y»), sin imperativos.

### Ítem 9 — La dona sale de un solo color

`Dashboard.tsx:417` compara `entry.name === 'Encargo'` pero la etiqueta real es
`'Encargo anterior'` → siempre cae al `else` y pinta todo `BLUE`. Colorear por la
**clave** (`kind`), nunca por el texto visible.

---

## G2 · Calculadora (ítem 4, prioridad alta)

1. **Total duplicado:** `order.total` (canónico) vs `wholesale.orderTotal`.
   `buildWholesale` re-redondea el precio aunque el descuento sea 0 %, así que
   con precio manual + redondeo las dos cifras divergen. Que el mayoreo use el
   mismo precio aplicado que `buildOrder`.
2. **Semántica margen → recargo:** `markup`, `marginReal` y `minMarginPct` son
   los tres *markup sobre costo*. Renombrar a «recargo» en la UI y **agregar**
   el margen real **sobre venta** como indicador nuevo.
3. **Entrega:** `machineHours` usa `batchCount` (ceil) mientras el costo usa
   `batchMultiplier` (fraccionario). Las horas pasan a escalar igual que el
   costo. `production.batches` sigue mostrando las tandas enteras.

**No se toca:** el costo por impresora (no se alinea al fondo común del Excel) ni
el piso del semáforo (se revisa después, con los dos números a la vista).

---

## G3 · Dashboard (ítems 7, 8, 13)

- «Utilidad» → **«Resultado de caja»**; «Vendiste $X» → **«Ingresos cobrados $X»**.
  Ningún número cambia. Revisar que el reporte de Excel use el mismo término.
- Punto de equilibrio: **siempre el mes en curso**, ignorando el filtro, igual que
  ya hace Metas.
- «Gasto por tipo de recurso»: **excluir la inversión** (alinear con el KPI).
- Sacar las 25 ventas semanales importadas (`kind: ENCARGO`, todas fechadas el
  lunes) de los gráficos **por día** y del **ticket promedio**. En los gráficos
  **mensuales sí cuentan**: una semana cae dentro de un mes.
- «Ventas por día de la semana»: barras **apiladas por canal**, leyenda
  clickeable. Un **único selector de canal** para toda la sección de gráficos.
- **Ingresos por mes** (bloque anual al final, con su propio selector de año
  derivado de los datos): tabla ordenable (orden de meses / mayor a menor), los
  12 meses con $0,00 donde no hubo, barras apiladas por canal + línea del total
  **que se corta en el mes actual** (no dibujar meses futuros).

---

## G4 · Encargos (ítems 3-pestañas, 10, 12)

- **3 pestañas en la URL**: `/orders`, `/orders/calendario`, `/orders/por-cobrar`.
  `/calendar` queda como **redirect**. Actualizar también `CommandPalette.tsx:45`.
- **Filtro de fecha solo en Lista**, con selector entrega/creación. Rango «Todo»
  por defecto. Los encargos **sin fecha de entrega** se ocultan al filtrar por
  entrega, con aviso clickeable «N encargos sin fecha de entrega».
- **Modal de artículos**: encabezados de columna (Descripción · Cant. · Precio) +
  `aria-label` en cada input; subtotal por línea y total del encargo en vivo; en
  móvil cada artículo es un bloque con etiquetas propias. Mismo componente de
  fila para **todos** los formularios con artículos.
- **Selector de moneda en blanco**: si el valor guardado no está entre las
  opciones, caer a «Solo USD» (la regla del «valor seguro» que ya rige para los
  filtros).

---

## G5 · Varios (ítems 2, 3-sidebar, 5, 11)

- **Sidebar**: Finanzas queda con Dashboard · Ventas · Gastos · Encargos ·
  Por cobrar · Caja · Deuda · Metas. Nuevas categorías **OPERACIONES**
  (Producción) y **MARKETING** (Publicidad). **TIENDA** (Tienda · Bandeja) sale
  de Definiciones, que se renombra a **CATÁLOGOS**. El acordeón **se queda** en
  uno abierto a la vez (decisión del dueño) → el **badge debe burbujear al
  encabezado** cuando el grupo está cerrado, o el contador de la Bandeja queda
  invisible.
- **Mensaje de red** (`lib/api.ts:103`): no mencionar `pnpm dev:api` en
  producción; distinguir «sin conexión» de «el servidor no responde»; reintentar
  con backoff antes de mostrar el cartel.
- **Login**: ojo para ver la contraseña (`type="button"`, `aria-label` que
  alterna, foco preservado); correo recordado; checkbox «Recuérdame» marcado por
  defecto → `localStorage`, desmarcado → `sessionStorage`. `getToken`/`setTokens`/
  `clearTokens` deben consultar **los dos** almacenamientos.
- **Ventas → «Ventas de mostrador»** (solo front): histórico `ENCARGO` oculto tras
  un interruptor «ver histórico importado»; **los KPIs se recalculan según ese
  interruptor**; quitar la columna Cliente (el cliente va junto a la nota cuando
  exista); KPIs propios (Total vendido · Cantidad · Ticket promedio); fecha
  `dd/mm/aaaa`; **Resumen semanal** sin «días libres» (ese dato no existe).

---

## Verificación antes de cerrar

- `pnpm test:shared` verde en **los dos** repos.
- `pnpm -r lint` y `pnpm -r build` sin errores.
- Suite de seguridad verde (el ítem 5 toca auth).
- Verificación renderizada a **390×844** y escritorio de las pantallas tocadas.
