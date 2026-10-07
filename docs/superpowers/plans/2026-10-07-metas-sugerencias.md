# Metas: sugerencias editables y resumen por mes

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development`,
> tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que proponer la meta del mes deje de ser adivinar, sin que el
sistema decida por el dueño.

**Stack:** TypeScript, Zod, NestJS, Prisma + PostgreSQL, Jest, React + React
Query + Tailwind.

**Orden:** este módulo va **PRIMERO**. Es independiente, no toca dinero ya
cargado y se entrega entero. Préstamos va después, con su propio despliegue:
[2026-10-07-prestamos-saas.md](2026-10-07-prestamos-saas.md).

> ⚠️ Los pasos de `git commit` se ejecutan, **uno por tarea**. `git push` sigue
> prohibido salvo pedido explícito: un push a `main` despliega a producción.

---

## Decisiones tomadas antes de este plan

### 1. La decisión que este plan tiene que respetar, no borrar

`packages/shared/src/calc/goal.ts` dice hoy, textualmente:

> *Las metas se cargan a mano, mes a mes, y no se proyectan. Los números del
> Excel (250 → 325 → 450 → 600 → enero 350) llevan adentro una decisión sobre
> la temporada: diciembre sube y enero cae. Una proyección automática borraría
> justo eso.*

**No es una opinión vieja: es el negocio.** Las metas cargadas en producción al
2026-10-07 son exactamente esas — `sep 250 · oct 325 · nov 450 · dic 600 ·
ene 350`. Un promedio ponderado de los 3 meses anteriores, aplicado a enero
2027, tomaría oct/nov/dic (temporada alta) y sugeriría cerca de **600** cuando
el dueño ya decidió **350**.

Por eso la sugerencia:
- **solo rellena el formulario**, nunca guarda;
- **avisa cuando la base engaña** (ver decisión 4);
- no mete ningún porcentaje de crecimiento escondido.

### 2. Lo real hay que poder calcularlo para CUALQUIER mes

Hoy `goals.module.ts` deriva lo real **solo para los meses que ya tienen meta**:
el rango sale de `metas[0].month` hasta el final de la última. Con cero metas
devuelve `{ months: [], … }`.

Eso rompe las dos cosas que pide este plan: sugerir mira **meses anteriores que
probablemente no tengan meta**, y el selector de mes tiene que poder mostrar un
mes sin meta con su resultado real. Hay que extraer el cálculo de lo real a algo
que reciba un rango y **no dependa de que exista una meta**.

Las definiciones **no se tocan** — están verificadas contra septiembre 2026
($68,50 · 5 encargos · 4 clientes nuevos) y son las mismas que usa el Dashboard:
- **ventas** = ventas del mes + pedidos entregados en el mes;
- **encargos** = pedidos entregados en el mes;
- **clientes nuevos** = los que tuvieron su PRIMERA compra en el mes.

### 3. "Sin actividad" y "sin datos" no son lo mismo

El pedido lo exige y en estos datos la diferencia es real: la primera venta es
del **2026-02-02** y el primer pedido del **2026-09-07**.

- Un mes **anterior** al primer dato de esa métrica es **sin datos**: no entra
  en la base, y si por eso quedan menos de 3 meses hay que decirlo.
- Un mes **posterior** sin movimiento es **sin actividad**: entra como **0**.

⚠️ La frontera es **por métrica, no por negocio**. Para sugerir encargos en
noviembre 2026, los meses completos son ago/sep/oct: **agosto no tiene datos de
encargos** (no existían pedidos), septiembre y octubre sí. Tratar agosto como un
0 hundiría la sugerencia inventando un mes malo que nunca ocurrió.

### 4. El aviso de temporada, y por qué hoy no se va a ver

Cuando el mes elegido tenga **el mismo mes del año anterior** en el historial,
se compara cuánto se despegó ese mes de su propia base de 3 meses. Si se despegó
más de un **25 %**, aparece un aviso corto antes de guardar — *"ojo: enero del
año pasado cayó 42 % contra su base"*. **No cambia el número sugerido.**

⚠️ Con historial desde febrero 2026, el primer mes que va a poder mostrar el
aviso es **febrero 2027**. Hasta entonces el aviso no aparece nunca, y eso **no
significa que no haya riesgo**: significa que no hay con qué medirlo. El texto
de la pantalla tiene que distinguir "sin señal de temporada" de "medido y sin
riesgo", o el silencio se lee como aprobación.

### 5. La fórmula: ponderada, pero con techo

El pedido exige dos cosas que tiran en direcciones opuestas: **dar más peso a lo
reciente** y **reducir el efecto de un mes excepcional**. Un promedio ponderado
solo no hace lo segundo — si el mes raro es el más reciente, lo **amplifica**.

La fórmula es, en este orden:

1. Tomar los meses completos con datos (hasta 3, el más reciente primero).
2. Calcular la **mediana** de esos valores.
3. **Recortar** cada mes a `[0,5 × mediana, 1,5 × mediana]`.
4. Promedio ponderado de los recortados, con pesos **3 / 2 / 1** del más
   reciente al más viejo.
5. Redondear: ventas al **entero** más cercano; encargos y clientes nuevos
   también a entero (nunca decimales de persona).

Con 2 meses los pesos son 2/1; con 1 mes es ese valor. Se muestra en pantalla en
una línea: *"Sugerido: $380 · promedio ponderado de 3 meses completos, con los
extremos recortados"*.

### 6. Crecimiento: +0 % / +10 % / +25 %

Conservador **+0 %** (sostener la base ya es una meta en un mes flojo), Moderado
**+10 %**, Ambicioso **+25 %**. Se aplica **sobre la misma base**, sin
recalcularla, y el porcentaje se muestra. Es **prioridad baja**: va al final y
si hay que recortar algo, se recorta esto.

### 7. Lo que NO entra

- **Guardar la sugerencia automáticamente**, ni "aceptar todas". El pedido es
  explícito: solo se guarda con "Guardar".
- **Proyección a varios meses** o metas anuales.
- **Metas por producto o por canal.**
- Un **modelo de estacionalidad** de verdad (índices por mes): necesita años de
  historia. El aviso de la decisión 4 es lo que se puede sostener hoy.

---

## Estructura de archivos

### `calc3d-api`

```
packages/shared/
  package.json · src/version.ts     MOD  0.24.0 → 0.25.0
  src/calc/goal.ts                  MOD  suggestGoals(), weightedBase(), GrowthLevel
  src/calc/goal.spec.ts             MOD  tests nuevos; los existentes NO se tocan
  src/schemas/api.ts                MOD  contrato de la sugerencia

apps/api/
  prisma/schema.prisma              MOD  Goal.source
  prisma/migrations/
    2026…_meta_origen/              NEW  ADD COLUMN aditivo
  src/goals/goals.module.ts         MOD  actuals por rango + endpoint de sugerencia
  src/goals/goals.service.spec.ts   NEW  (hoy la lógica vive en el module)
```

### `calc3d-web`

```
apps/web/
  src/features/goals/api.ts         MOD  tipos + useGoalSuggestion
  src/pages/Goals.tsx               MOD  selector de mes, tarjetas del período, Sugerir
```

---

## Tarea 1: lo real, para cualquier mes

**Archivos:** `apps/api/src/goals/goals.module.ts` (+ su spec nuevo)

- [ ] 1.1 — Extraer el cálculo de lo real a un método que reciba **un rango de
  meses** y devuelva, por mes, `{ sales, orders, newClients }` **más** una marca
  por métrica de si ese mes tiene datos. Que **no** dependa de que exista una
  meta.

- [ ] 1.2 — Conservar las tres definiciones **tal cual**. El comentario de
  cabecera del módulo las documenta y están verificadas contra septiembre 2026;
  si alguna cambia, la meta diría una cosa y el Dashboard otra.

- [ ] 1.3 — Calcular, por métrica, **el primer mes con datos** (primera venta,
  primer pedido entregado, primer cliente). Un mes anterior a eso es **sin
  datos**; uno posterior sin movimiento es **0**.

- [ ] 1.4 — ⚠️ **"Mes completo" se decide en hora de Venezuela.** Un mes está
  completo cuando ya terminó; el mes en curso **nunca** es base. Usar el helper
  del repo (`businessDateKey` / `currentMonthKey`), no `new Date()` a pelo: el
  servidor corre en UTC y el último día del mes, desde las 20:00 de Caracas,
  cree que ya empezó el siguiente. Hay tests de borde para esto en
  `printers.service.spec.ts` y `reports.controller.spec.ts`; seguir ese patrón.

- [ ] 1.5 — `GET /goals` sigue devolviendo exactamente lo mismo que hoy para los
  meses con meta. **Ningún test existente se toca.**

- [ ] 1.6 — Tests: un mes sin meta devuelve lo real; un mes sin actividad
  devuelve 0 y marcado **con** datos; un mes anterior al primer dato queda
  marcado **sin** datos; el borde de fin de mes en hora local.

- [ ] 1.7 — `pnpm -r test` verde. ⚠️ `pnpm -r lint` ahora **sale en 0**: si
  falla, es culpa tuya, no del baseline.

- [ ] 1.8 — `git commit -m "refactor(api): lo real de metas se calcula por rango, sin depender de que exista la meta"`

---

## Tarea 2: el motor de la sugerencia

**Archivos:** `packages/shared/src/calc/goal.ts`, `goal.spec.ts`, `version.ts`,
`package.json`

- [ ] 2.1 — `weightedBase(valores)`: implementa los pasos 2 a 4 de la decisión 5
  (mediana → recorte a ±50 % → ponderada 3/2/1). Función pura, sin fechas.

- [ ] 2.2 — `suggestGoals(entrada)`: recibe los hasta 3 meses con su marca de
  datos por métrica y devuelve, **por métrica**, o bien un valor sugerido con su
  explicación, o bien **`null` con el motivo** (`'SIN_DATOS'`).

  ⚠️ **`null` no es 0.** Una métrica sin datos suficientes **no se sugiere**: el
  campo queda para carga manual con su explicación. Devolver 0 sería inventar
  una recomendación, que es justo lo que el pedido prohíbe.

- [ ] 2.3 — `GROWTH_LEVELS`: `{ CONSERVADOR: 0, MODERADO: 0.10, AMBICIOSO: 0.25 }`,
  exportado, para que el porcentaje que se muestra y el que se aplica sean **el
  mismo dato**.

- [ ] 2.4 — `seasonalWarning(...)`: dado el mes elegido y el historial, devuelve
  el desvío del mismo mes del año anterior contra su propia base, o `null` si no
  hay con qué compararlo. ⚠️ `null` significa **"no se pudo medir"**, no "está
  todo bien"; que el tipo no permita confundirlos.

- [ ] 2.5 — **El motor no guarda nada y no conoce Prisma.** Son funciones puras
  sobre números, como el resto de `calc/`.

- [ ] 2.6 — Tests, **sin tocar los existentes**:
  - [ ] un mes excepcional **no** arrastra la sugerencia (el caso que motiva el
    recorte): `[1000, 300, 320]` no puede sugerir cerca de 1000;
  - [ ] el mes más reciente pesa más que el más viejo, con números clavados;
  - [ ] 2 meses y 1 mes dan pesos 2/1 y 1;
  - [ ] una métrica sin datos devuelve `null` y el motivo, nunca 0;
  - [ ] encargos y clientes nuevos salen **enteros**;
  - [ ] el crecimiento se aplica sobre la base **sin** recalcularla;
  - [ ] `seasonalWarning` sin año anterior devuelve `null`.

- [ ] 2.7 — **Verificación por mutación:** sacarle el recorte a `weightedBase`
  y confirmar que el test del mes excepcional se pone **rojo**. Revertir.
  Reportar qué se rompió.

- [ ] 2.8 — Subir `SHARED_VERSION` y el `version` del `package.json` a `0.25.0`
  **a la par** (`version.spec.ts` lo exige).

- [ ] 2.9 — `git commit -m "feat(shared): 0.25.0 — sugerencia de metas sobre meses completos"`

---

## Tarea 3: `Goal.source` y el contrato

**Archivos:** `prisma/schema.prisma`, la migración, `packages/shared/src/schemas/api.ts`

- [ ] 3.1 — `source RecordSource @default(MANUAL)` en `Goal`.

- [ ] 3.2 — Migración y **verificar a mano que es puramente aditiva**: un
  `ALTER TABLE "Goal" ADD COLUMN "source" "RecordSource" NOT NULL DEFAULT 'MANUAL'`
  y nada más. Si Prisma propone cualquier `DROP`, `RENAME` o `SET NOT NULL`,
  **parar y avisar**.

- [ ] 3.3 — Generar la migración **sin tocar ninguna base**, con
  `prisma migrate diff --from-schema-datamodel <schema de HEAD> --to-schema-datamodel <nuevo> --script`.

- [ ] 3.4 — El contrato Zod de la sugerencia, con el nivel de crecimiento
  derivado de `GROWTH_LEVELS` para que no puedan divergir.

- [ ] 3.5 — ⚠️ **Las 5 metas de producción quedan en `MANUAL`.** Vinieron del
  Excel, pero marcarlas "Importado" es una decisión sobre el origen de los datos
  del dueño: va en un paso aparte del despliegue, con su dry-run, **no** en la
  migración.

- [ ] 3.6 — `git commit -m "feat(api): origen del registro en las metas"`

---

## Tarea 4: el endpoint de sugerencia

**Archivos:** `apps/api/src/goals/goals.module.ts`, su spec

- [ ] 4.1 — `GET /goals/suggestion?month=AAAA-MM&growth=MODERADO` (growth
  opcional). **Solo lectura: no escribe nada, nunca.**

- [ ] 4.2 — Devuelve, por métrica: el valor sugerido o `null` con su motivo, la
  base ponderada, el valor del mes anterior, cuántos meses completos se usaron y
  cuáles, y el aviso de temporada si existe. Es lo que la pantalla necesita para
  mostrar *"Mes anterior: $325 · base ponderada: $340 · sugerencia: $375"* sin
  recalcular nada.

  ⚠️ **La respuesta se arma campo por campo**, como el resto del repo: un campo
  que no se agregue ahí existe en el servidor, compila, y nunca llega al
  cliente. Ya pasó con `stats.quotes`.

- [ ] 4.3 — Validar `month` con el `ZodValidationPipe` **real**: un mes inválido
  o un formato raro es **400**, no una sugerencia vacía.

- [ ] 4.4 — Tests:
  - [ ] **no escribe nada**: contar las metas antes y después de llamarlo;
  - [ ] usa **solo meses anteriores completos** — el mes elegido y el mes en
    curso nunca entran en la base;
  - [ ] con menos de 3 meses, informa cuántos usó;
  - [ ] una métrica sin datos viene `null` con motivo;
  - [ ] **aislamiento**: la sugerencia de una organización no puede mirar los
    meses de otra. El mock tiene que **modelar la base de verdad** —devolver las
    filas ajenas si el `where` no las filtra— y hay que sumar el test hermano
    que comprueba que esas filas **son alcanzables** para su propio negocio. Un
    test que no distingue "filtrado" de "no encontrado" no prueba nada.

- [ ] 4.5 — **Verificación por mutación:** sacarle `organizationId` al `where` y
  confirmar que el test de aislamiento se pone **rojo**. Revertir.

- [ ] 4.6 — Sumar la ruta a `apps/api/src/common/multi-tenant.audit.spec.ts`.

- [ ] 4.7 — `git commit -m "feat(api): sugerir metas desde los meses completos anteriores"`

---

## Tarea 5: la pantalla

**Archivos:** `calc3d-web` — `features/goals/api.ts`, `pages/Goals.tsx`

- [ ] 5.1 — `pnpm sync:shared` y `pnpm test:shared` verde en el web.
  ⚠️ La dependencia es `workspace:*`: la versión la escribe **solo**
  `sync:shared`, no se edita `apps/web/package.json` a mano.

- [ ] 5.2 — Hook `useGoalSuggestion(month, growth)`, **lazy**: no pide nada
  hasta que el dueño toca "Sugerir metas".

- [ ] 5.3 — **Selector de mes** en la página. Al abrir, el mes actual. Las
  tarjetas de Ventas, Encargos y Clientes nuevos pasan a ser **del mes elegido**,
  con el mes nombrado en el encabezado. El histórico mensual se conserva debajo.

- [ ] 5.4 — Cada tarjeta: meta, real y % de cumplimiento.
  - [ ] si el real supera la meta, **se conserva el % real** (126 %, 317 %) y la
    barra se recorta al 100 % con "Meta superada";
  - [ ] sin meta o meta en 0 → **"Sin meta definida"**, sin dividir.
  ⚠️ `goalProgress` ya devuelve `null` sin meta y **no recorta arriba de 1** a
  propósito; la pantalla respeta eso en vez de recortar por su cuenta.

- [ ] 5.5 — Botón **"Sugerir metas"** en el diálogo de crear y editar.
  - [ ] deshabilitado mientras no haya mes elegido, con el motivo visible;
  - [ ] si ya hay valores cargados, **confirmar antes de reemplazarlos**
    (`useConfirm` de `@/components/overlays`);
  - [ ] **solo rellena los campos**. Nada se guarda hasta "Guardar".
  - [ ] una métrica que vino `null` **no se toca** y muestra su motivo al lado.

- [ ] 5.6 — Bajo cada campo sugerido, la explicación corta: *"Sugerido: $380 ·
  basado en 3 meses completos"*, y la comparación *"Mes anterior: $325 · base
  ponderada: $340 · sugerencia: $375"*. **Los números salen del servidor**, no
  se recalculan en el front.

- [ ] 5.7 — El aviso de temporada, cuando exista, **arriba del botón Guardar** y
  no escondido al pie: es lo último que el dueño tiene que leer antes de fijar
  el número.

- [ ] 5.8 — Badge discreto **"Importado"** donde `source === 'EXCEL_IMPORT'`.
  Solo ese valor: `MIGRATION` y `RECONCILIATION` no son importaciones.

- [ ] 5.9 — Selector de crecimiento (Conservador / Moderado / Ambicioso) con su
  porcentaje a la vista. **Último paso**: si hay que recortar, se recorta esto.

- [ ] 5.10 — Respetar el sistema de diseño (`calc3d-web/CLAUDE.md`): primitivos
  propios de `@/components/ui`, **sin dependencias nuevas**. Y `FieldGrid` es
  para campos **lado a lado**; un campo solo va como `<Field>` pelado.

- [ ] 5.11 — `pnpm lint`, `tsc --noEmit` y `pnpm build` limpios.

- [ ] 5.12 — `git commit`

---

## Tarea 6: verificación y documentación

- [ ] 6.1 — Levantar `api` y `web` **solo** con `preview_start` (el panel va en
  **5180**, único origen que la API acepta por CORS).

- [ ] 6.2 — Medir **el DOM**, no la captura:
  - [ ] "Sugerir" con el formulario vacío rellena y **no guarda** — comprobarlo
    contra la base, no mirando la pantalla;
  - [ ] "Sugerir" con valores cargados **pide confirmación**;
  - [ ] cambiar el mes cambia las tres tarjetas;
  - [ ] un mes sin meta muestra "Sin meta definida" y el real;
  - [ ] un real por encima de la meta muestra el % real y la barra al 100 %;
  - [ ] a **375×812**, `document.documentElement.scrollWidth <= clientWidth`.

> ⚠️ **Para medir scroll hay que forzar `behavior: 'instant'`**: `index.css`
> pone `html { scroll-behavior: smooth }` y una lectura inmediata devuelve
> `scrollY: 0` como si la página no scrolleara. Y **el panel del escritorio de
> Claude no scrollea** y sus capturas salen negras a tamaño móvil: para eso hace
> falta un Chrome real.

- [ ] 6.3 — ⚠️ **Los datos locales no alcanzan para probarlo bien.** Hay metas
  solo desde septiembre 2026 y los pedidos arrancan el 2026-09-07, así que casi
  todas las sugerencias van a caer en "pocos meses" o "sin datos". Para ver el
  camino completo hay que **crear metas y datos de prueba en la base LOCAL** y
  dejarla como estaba, o inyectar el caso en el render y revertirlo. **Nunca
  contra producción.**

- [ ] 6.4 — Actualizar `calc3d-api/CLAUDE.md` y `calc3d-web/CLAUDE.md`.
  ⚠️ El del API acumula cambios del dueño: agregar la sección sin tocar lo suyo.

- [ ] 6.5 — ⚠️ **Actualizar el comentario de cabecera de `goal.ts`.** Hoy dice
  que las metas "no se proyectan" porque una proyección borraría la temporada.
  Eso **sigue siendo cierto y es el motivo de que la sugerencia no guarde**, pero
  el texto tal cual ya no describe el código. Reescribirlo para que diga la
  regla completa, no la mitad — es el mismo error que cometimos con la regla de
  fechas.

---

## Verificación final

- [ ] `pnpm test:shared` y `pnpm -r test` verdes
- [ ] `pnpm -r lint` **sale en 0** en los dos repos
- [ ] `pnpm build` pasa en los dos repos
- [ ] Nada pusheado

## Despliegue

1. **API primero**, panel después. La respuesta de `/goals` cambia de forma y un
   panel nuevo contra la API vieja se cae al dibujar; React Query además conserva
   la respuesta vieja en caché, así que en producción no se arregla recargando.
2. La migración de `Goal.source` se aplica sola al arrancar el contenedor
   (`prisma migrate deploy` en el `Dockerfile`). Es `ADD COLUMN` con `DEFAULT`:
   segura.
3. **Marcar las 5 metas como importadas es un paso aparte**, con dry-run, y se
   decide con el dueño. No va en la migración.
