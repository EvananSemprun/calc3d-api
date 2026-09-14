# Cierre mensual del stock de filamento — diseño

- **Fecha:** 2026-09-13
- **Estado:** diseño aprobado por el dueño; spec pendiente de revisión.
- **Repos:** `calc3d-api` (shared + API) y `calc3d-web` (pantalla Stock del mes).
- **Versión de shared:** 0.12.0 → **0.13.0**.

## 1. Problema

Hoy el conteo de rollos se guarda **casilla por casilla** al salir de cada campo
(`PUT /filament/stock`). Cualquier número de cualquier mes se puede cambiar en
cualquier momento, sin que quede rastro, y un mes nunca "termina": no hay un
momento en que el registro del estante quede firme.

El dueño quiere que el conteo sea **un acto de cierre de mes**: el último día del
mes (o después, para el mes anterior) llena las casillas, toca **Guardar**, y ese
registro queda fijo. Corregirlo tiene que ser una decisión explícita, no un
descuido.

## 2. Decisiones del dueño

| Tema | Decisión |
|---|---|
| Cuándo se cierra | **Desde el último día del mes, sin límite después.** Agosto se cierra a partir del 31/08; si se pasa, se cierra el 5/09 igual. Antes del último día, no. |
| Corregir un error | **Reabrir con confirmación.** Queda anotado cuándo se reabrió. |
| Lo escrito antes de guardar | **Borrador en el navegador.** No se escribe nada en la base hasta cerrar. |
| Agosto (vino del Excel) | **Se da por cerrado** en la migración. |

Siguen vigentes dos reglas del mismo día:

- **Casillas vacías = no hay** (como el Excel): lo que no se marcó vale 0.
- **La reposición va por tipo + color**, no por marca (`restockByColor`).

## 3. Enfoque elegido

Un registro propio del **mes cerrado** (tabla `StockMonth`), y cerrar como la
**única** escritura de conteos.

Descartados:

- **Marcar cada `StockCount` como cerrado.** Una ficha sin fila en ese mes no
  puede "cerrarse", reabrir toca decenas de filas y el mes nunca existe como una
  sola cosa.
- **Bloquear solo en la pantalla.** Cualquier llamada directa a la API seguiría
  editando: es el antipatrón de "límite solo-UX" de `CLAUDE.md`.

## 4. Datos

```prisma
model StockMonth {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String
  /// Mes, como el primer día a medianoche UTC (igual que StockCount.month).
  month          DateTime
  /// null = abierto. Un mes SIN fila también está abierto (nunca se cerró).
  closedAt       DateTime?
  /// Última reapertura. Se conserva al volver a cerrar: es el rastro de que se corrigió.
  reopenedAt     DateTime?

  @@unique([organizationId, month])
}
```

- Migración **`cierre_mensual_stock`**: solo agrega. Incluye el backfill que da
  por cerrado cada mes que ya tiene conteos Y que ya terminó (en hora de
  Venezuela) — el mes en curso no se puede cerrar antes de su último día, ni
  aunque ya tenga conteos cargados. `closedAt` se guarda en UTC explícito
  (`now() AT TIME ZONE 'UTC'`; la columna no tiene zona y Prisma la lee como
  UTC). Ver el SQL exacto en
  `apps/api/prisma/migrations/20260913180000_cierre_mensual_stock/migration.sql`.
  En la base local eso cierra agosto 2026.
- `pg_dump` antes de aplicarla, aunque no borre nada. En producción, además, con
  OK explícito del dueño (regla de `CLAUDE.md`).
- **En un mes cerrado, una ficha sin fila vale 0.** Cerrar escribe una fila por
  cada ficha, pero la regla de lectura no depende de eso: agosto (backfill) tiene
  37 filas para 48 fichas, y una ficha dada de alta después del cierre tampoco
  tiene fila.

## 5. Reglas puras (`shared/calc/stock.ts`)

```ts
export const BUSINESS_TIME_ZONE = 'America/Caracas';

/** La fecha de HOY en la zona del negocio, como 'AAAA-MM-DD'. */
export function businessDateKey(now: Date, timeZone = BUSINESS_TIME_ZONE): string;

/** Último día del mes, como 'AAAA-MM-DD': desde ese día se puede cerrar. */
export function monthCloseDay(month: string): string;

/** true si el mes ya se puede cerrar: hoy (en la zona del negocio) >= su último día. */
export function canCloseMonth(month: string, now: Date, timeZone = BUSINESS_TIME_ZONE): boolean;
```

La zona importa: el servidor corre en UTC y **Venezuela está en UTC−4**. Las 20:30
del 31/08 en Caracas ya son el 1/09 en UTC; comparando en UTC, el 30/08 a las 21:00
la app creería que ya es 31. Es el mismo error que ya rompió el calendario
(`lib/today.ts`). `businessDateKey` usa `Intl.DateTimeFormat` con `timeZone`, no
un desfase fijo.

## 6. API (`filament/`)

### `GET /filament/stock/status?month=AAAA-MM`

```ts
{
  month: string;
  closed: boolean;
  closedAt: string | null;
  reopenedAt: string | null;
  canClose: boolean;      // canCloseMonth(month, ahora)
  closableFrom: string;   // monthCloseDay(month)
}
```

Endpoint aparte a propósito: no cambia la forma de `GET /filament/stock`, que
sigue devolviendo el arreglo de filas. Ruta literal declarada **antes** de
cualquier ruta con parámetro.

### `POST /filament/stock/close`

Cuerpo (`StockMonthCloseSchema` en shared):

```ts
{
  month: string;                  // AAAA-MM
  counts: { materialId: string; sealed: number; inUse: number; running: number }[];
}
```

En este orden. El paso 1 va **antes** de abrir la transacción (sin tocar la base); del 2 en adelante, todo dentro de ella:

1. **Antes de tiempo** → `400`: "Agosto de 2026 se puede cerrar desde el 31/08/2026 (hora de Venezuela)."
2. **Ya cerrado** → `409`: "Agosto de 2026 ya está cerrado. Reabrilo para corregirlo."
3. **Cada fila del cuerpo, en orden**: un `materialId` que no es de la
   organización → `404`; uno repetido → `400`. Todas las validaciones corren
   antes de escribir.
4. Escribe **una fila por cada ficha de la organización** (activas y
   descontinuadas): los valores del cuerpo o **0** si no vino. Apaga
   `needsBrandCheck` y fija `countedAt`.
5. Crea o actualiza `StockMonth` con `closedAt = ahora` (conserva `reopenedAt`).

Devuelve el estado del mes (misma forma que `/status`). Dos cierres simultáneos
(un doble clic) NO están protegidos por el chequeo del paso 2: con READ
COMMITTED los dos leen el mes abierto; los datos no se corrompen (cada cierre
escribe todas las fichas y gana el último completo), pero el segundo puede
terminar en error. Con un solo dueño se acepta, y el botón del panel se
deshabilita mientras el cierre está en curso. La transacción tiene
`timeout: 15 s`.

### `POST /filament/stock/reopen`

Cuerpo `{ month }`. Si el mes no está cerrado → `409` ("Agosto de 2026 no está
cerrado"). Si lo está: `closedAt = null`, `reopenedAt = ahora`. **Los conteos no
se tocan**: vuelven a la pantalla precargados para corregirlos.

### `PUT /filament/stock` — ya no guarda

Responde **`410 Gone`** ("El conteo se guarda cerrando el mes") y no escribe
nada. Se deja la ruta en vez de borrarla para que un panel viejo, durante el
despliegue, reciba un mensaje claro y no un 404. `saveCount` se elimina del
servicio y `StockCountUpsertSchema` de shared.

## 7. Las otras puertas de escritura

- **Borrar una ficha de material** (`materials/`): hoy borra en cascada sus
  `StockCount`, incluidos los de meses cerrados. Si la ficha tiene conteos en
  algún mes cerrado → `409`: "Esta ficha tiene conteos en meses cerrados
  (agosto 2026). Descontinuala en vez de borrarla." (desde 2026-09-13 el panel
  deja descontinuar: ver 2026-09-13-estado-material-design.md). Sin conteos en
  meses cerrados, se borra como hoy.
- **`prisma/import-filamento.mjs`**: borra y recrea materiales y conteos. Si hay
  algún mes cerrado, **aborta sin escribir**, también en modo ensayo, con un
  mensaje que lo explica.

## 8. Lecturas

- **`GET /filament/stock`**: `counted` = el mes está cerrado (antes: "tiene al
  menos un conteo"). Los valores son los guardados; un mes reabierto los muestra.
- **`GET /filament/summary`**: solo usa el conteo del mes si está **cerrado**. Un
  mes abierto devuelve el resumen vacío: `totalRolls` 0, `running` 0,
  `consumption` null, `restock` `[]`, `countedColors` 0, `totalColors` con los
  colores que se reponen (para decir "0 de 31"), `complete` false. El consumo exige que **los dos** meses (el
  actual y el anterior) estén cerrados. `complete` pasa a ser "el mes está
  cerrado". `restockByColor` no cambia.
- **Reporte en Excel** (hoja "Stock mensual"): solo meses cerrados. Un mes
  reabierto a medio corregir no sale como dato final.

## 9. Pantalla (Stock del mes)

### Mes abierto

- Casillas editables. Lo escrito queda en `localStorage` con la clave
  `filament:stock:draft:AAAA-MM`. Si el mes se reabrió, el borrador arranca con
  los valores guardados.
- Se quita el guardado al salir del campo (`onBlur`).
- Botón **"Guardar y cerrar agosto"**:
  - Deshabilitado si `canClose` es false, con el texto "Se puede cerrar desde el
    31 de agosto".
  - Pide confirmación (`useConfirm`): "Vas a cerrar agosto con **N rollos** en **M
    colores**. Lo que dejaste vacío queda en 0. Después solo se corrige
    reabriendo el mes."
  - Al cerrar: borra el borrador, avisa con un toast e invalida las consultas de
    stock, resumen y estado.
- Tarjetas y lista de reposición: en su lugar, "Cuando cierres agosto vas a ver
  el total, el consumo y la reposición."

### Mes cerrado

- Casillas de solo lectura.
- Insignia **"Cerrado el 01/09/2026"** (y "reabierto el …" si corresponde),
  formateada en la zona del negocio.
- Botón **"Reabrir mes"** con confirmación: "Vas a reabrir agosto para
  corregirlo. Mientras esté abierto no cuenta para el resumen ni la reposición."

## 10. Errores

| Caso | Código | Mensaje |
|---|---|---|
| Cerrar antes del último día | 400 | "Agosto de 2026 se puede cerrar desde el 31/08/2026 (hora de Venezuela)." |
| Cerrar un mes cerrado | 409 | "Agosto de 2026 ya está cerrado. Reabrilo para corregirlo." |
| Ficha repetida en el cuerpo | 400 | "La ficha «PLA Creality Negro» viene dos veces." (con el `name` de la ficha) |
| Ficha de otra organización | 404 | "Una de las fichas ya no existe (se borró o no es de esta cuenta). Recargá el conteo." |
| Reabrir un mes abierto | 409 | "Agosto de 2026 no está cerrado." |
| `PUT /filament/stock` | 410 | "El conteo se guarda cerrando el mes." |
| Borrar ficha con meses cerrados | 409 | "Esta ficha tiene conteos en meses cerrados (…). Descontinuala en vez de borrarla." (desde 2026-09-13 el panel deja descontinuar: ver 2026-09-13-estado-material-design.md) |

La pantalla muestra el mensaje del servidor con `apiErrorMessage` y **no borra el
borrador** si el cierre falla.

## 11. Tests (primero en rojo)

**shared — `stock.spec.ts`**

- `businessDateKey`: `2026-09-01T00:30Z` es `2026-08-31` en Caracas.
- `canCloseMonth('2026-08', …)`:
  - `2026-08-31T03:59Z` (30/08 23:59 en Caracas) → false.
  - `2026-08-31T04:00Z` (31/08 00:00 en Caracas) → true.
  - `2026-09-05T12:00Z` → true (sin límite después).
  - Un mes futuro → false.
- `monthCloseDay('2028-02')` → `2028-02-29` (bisiesto).

**API — `filament.service.spec.ts`** (regresión de seguridad: el bloqueo vive en
el servidor)

- Cerrar escribe **todas** las fichas; las que no vinieron quedan en 0.
- Cerrar antes de tiempo → 400 y **ninguna escritura**.
- Cerrar un mes cerrado → 409 y ninguna escritura.
- Ficha de otra organización → 404 y ninguna escritura.
- Ficha repetida → 400.
- Reabrir: `closedAt` null, `reopenedAt` fijado, conteos intactos.
- Reabrir un mes abierto → 409.
- `PUT /filament/stock` → 410 y ninguna escritura.
- `stock()`: `counted` sigue al cierre del mes.
- `summary()`: un mes abierto devuelve vacío; el consumo exige los dos meses
  cerrados.

**API — materiales**

- Borrar una ficha con conteos en un mes cerrado → 409 y no se borra.
- Borrar una ficha sin conteos en meses cerrados → se borra.

**Panel** (sin framework de tests de UI: verificación con `tsc`, `eslint` y en
pantalla)

- Mes abierto: editable, borrador que sobrevive a recargar, botón deshabilitado
  antes del último día.
- Cerrar: confirmación, casillas bloqueadas, insignia.
- Reabrir: confirmación, casillas editables con los valores guardados.

## 12. Despliegue

1. **API primero** (migración + backfill + endpoints), por la regla de
   `CLAUDE.md` sobre cambios de contrato. Durante la ventana, un panel viejo que
   intente guardar recibe el 410 con su mensaje.
2. **Panel después.**
3. ⚠️ El `Dockerfile` corre `prisma migrate deploy` al arrancar el contenedor, así
   que DESPLEGAR la API ya aplica la migración sola: en producción, `pg_dump` y OK
   del dueño van **antes del push/deploy**, no antes de un `migrate deploy` manual.
4. El backfill (`prisma/import-filamento.mjs` al correr con meses cerrados, o el
   script equivalente) **no apaga `needsBrandCheck`** en los meses que cierra (a
   diferencia de `closeMonth`); si hay filas con el aviso encendido en esos meses,
   se resuelve reabriendo y cerrando ese mes de nuevo.
5. Checklist previo al deploy: correr esta consulta de solo lectura contra
   producción para ver qué meses cerrará el backfill y con qué avisos pendientes:
   ```sql
   SELECT "month", count(*), sum("needsBrandCheck"::int)
   FROM "StockCount" GROUP BY 1 ORDER BY 1;
   ```
6. Rollback: Prisma no genera migraciones de vuelta. Revertir =
   `DROP TABLE "StockMonth"` + `prisma migrate resolve --rolled-back
   20260913180000_cierre_mensual_stock`, y SIEMPRE junto con el código de las
   tareas 5-9 (sin él, el panel no tiene cómo escribir conteos).

## 13. Fuera de alcance

- Historial completo de cierres y reaperturas (solo se guarda la última
  reapertura).
- Quién cerró o reabrió (hay un solo dueño).
- Botón para descartar el borrador.
- Resumen o reposición calculados sobre un mes todavía abierto.
