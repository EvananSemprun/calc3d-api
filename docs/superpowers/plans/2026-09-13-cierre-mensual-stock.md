# Cierre mensual del stock de filamento — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el conteo de rollos se registre como un **cierre de mes** (una sola acción desde el último día del mes, en hora de Venezuela) que deja el mes bloqueado y solo se corrige reabriéndolo.

**Architecture:** Una tabla nueva `StockMonth` marca cada mes como cerrado o abierto. `POST /filament/stock/close` escribe en una transacción una fila de conteo por cada ficha (lo vacío en 0) y cierra el mes; es la **única** escritura de conteos. El bloqueo vive en el servidor (fecha, mes cerrado, fichas ajenas) y se replica en las otras puertas: borrar una ficha y el script de importación. Resumen, consumo, reposición y reporte leen solo meses cerrados. El panel guarda un borrador en `localStorage` hasta cerrar.

**Tech Stack:** NestJS + Prisma (PostgreSQL 18), `packages/shared` (Zod + funciones puras, Jest), React + Vite + TanStack Query en `calc3d-web`.

**Spec:** `docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`

**Reglas del proyecto que aplican a todo el plan:**

- **No se commitea** salvo que el dueño lo pida: donde un plan normal diría "Commit", acá hay un **checkpoint** que verifica el estado.
- `packages/shared` se edita **solo en `calc3d-api`** y se sincroniza a `calc3d-web` con `pnpm sync:shared`.
- Los comandos están escritos para **Git Bash** (el shell de las herramientas). En PowerShell cambian `mkdir -p` y las comillas.
- `pnpm -r build` con la API corriendo en watch la tumba: para compilar shared usar `pnpm --filter @calc3d/shared build`.
- Rutas: `API=calc3d-api`, `WEB=calc3d-web`, ambas bajo `C:\Users\evanan-it\Desktop\Todo\mio\calculadora 3d`.

---

## Mapa de archivos

| Archivo | Qué cambia |
|---|---|
| `API/packages/shared/src/calc/stock.ts` | + `BUSINESS_TIME_ZONE`, `businessDateKey`, `monthCloseDay`, `canCloseMonth` |
| `API/packages/shared/src/calc/stock.spec.ts` | + tests de la ventana de cierre |
| `API/packages/shared/src/schemas/stock.ts` | + `StockMonthCloseSchema`, `StockMonthReopenSchema`, `StockMonthStatus`; − `StockCountUpsertSchema` |
| `API/packages/shared/src/schemas/stock.spec.ts` | nuevo: tests del contrato de cierre |
| `API/packages/shared/src/version.ts`, `package.json` | 0.12.0 → 0.13.0 |
| `API/apps/api/prisma/schema.prisma` | + modelo `StockMonth`, + relación en `Organization` |
| `API/apps/api/prisma/migrations/20260913180000_cierre_mensual_stock/migration.sql` | nueva, con backfill |
| `API/apps/api/src/filament/filament.service.ts` | + `monthStatus`, `closeMonth`, `reopenMonth`, `lastClosedMonth`; `stock`/`summary` por mes cerrado; − `saveCount` |
| `API/apps/api/src/filament/filament.service.spec.ts` | tests de cierre, reapertura, estado y lecturas |
| `API/apps/api/src/filament/filament.controller.ts` | + `GET stock/status`, `POST stock/close`, `POST stock/reopen`; `PUT stock` → 410 |
| `API/apps/api/src/filament/filament.controller.spec.ts` | nuevo: regresión del 410 |
| `API/apps/api/src/materials/materials.service.ts` | guarda al borrar |
| `API/apps/api/src/materials/materials.service.spec.ts` | nuevo |
| `API/apps/api/src/reports/reports.module.ts` | hoja "Stock mensual" = último mes cerrado |
| `API/apps/api/prisma/import-filamento.mjs` | aborta si hay meses cerrados |
| `WEB/apps/web/src/features/filament/api.ts` | hooks de estado, cierre y reapertura; − `useSaveStockCount` |
| `WEB/apps/web/src/features/filament/StockTab.tsx` | reescrito: borrador, cerrar, reabrir, solo lectura |
| `API/CLAUDE.md`, `WEB/CLAUDE.md` | documentación |

---

### Task 1: Shared — la fecha del negocio y la ventana de cierre

**Files:**
- Modify: `calc3d-api/packages/shared/src/calc/stock.ts` (agregar al final)
- Test: `calc3d-api/packages/shared/src/calc/stock.spec.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `stock.spec.ts`, agregar al import de `./stock` los nombres `businessDateKey`, `canCloseMonth` y `monthCloseDay`:

```ts
import {
  businessDateKey,
  canCloseMonth,
  monthCloseDay,
  monthConsumption,
  monthKey,
  monthStart,
  previousMonth,
  purchaseCostPerGram,
  purchaseCostPerRoll,
  restockStatus,
  stockTotal,
} from './stock';
```

Y al final del archivo:

```ts
/**
 * Cierre de mes: se decide en la hora del NEGOCIO (Venezuela, UTC−4), no en la
 * del servidor. Comparando en UTC, desde las 20:00 del 30/08 la app creería que
 * ya es 31 y dejaría cerrar agosto un día antes.
 */
describe('cierre de mes en la zona del negocio', () => {
  it('la fecha del negocio es la de Caracas, no la de UTC', () => {
    expect(businessDateKey(new Date('2026-09-01T00:30:00Z'))).toBe('2026-08-31');
  });

  it('el último día de agosto es el 31', () => {
    expect(monthCloseDay('2026-08')).toBe('2026-08-31');
  });

  it('febrero de un año bisiesto cierra el 29', () => {
    expect(monthCloseDay('2028-02')).toBe('2028-02-29');
  });

  it('el 30/08 a las 23:59 en Caracas todavía no se puede cerrar agosto', () => {
    expect(canCloseMonth('2026-08', new Date('2026-08-31T03:59:00Z'))).toBe(false);
  });

  it('desde las 00:00 del 31/08 en Caracas sí', () => {
    expect(canCloseMonth('2026-08', new Date('2026-08-31T04:00:00Z'))).toBe(true);
  });

  it('si se pasó el día, se puede cerrar igual después', () => {
    expect(canCloseMonth('2026-08', new Date('2026-09-05T12:00:00Z'))).toBe(true);
  });

  it('un mes futuro no se puede cerrar', () => {
    expect(canCloseMonth('2026-10', new Date('2026-09-13T12:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run (desde `calc3d-api/packages/shared`): `pnpm test -- stock.spec`
Expected: FAIL con `error TS2305: Module '"./stock"' has no exported member 'businessDateKey'` (y lo mismo para `canCloseMonth` y `monthCloseDay`).

- [ ] **Step 3: Implementar**

Al final de `calc3d-api/packages/shared/src/calc/stock.ts`:

```ts
// ----- Cierre de mes -----
//
// "El último día del mes" se decide en la zona horaria del negocio. El servidor
// corre en UTC y Venezuela está en UTC−4: comparar en UTC dejaría cerrar agosto
// desde las 20:00 del 30. Es el mismo error que ya rompió el calendario del panel.

/** Zona horaria del negocio (Banano Lab, Venezuela). */
export const BUSINESS_TIME_ZONE = 'America/Caracas';

/** La fecha de HOY en la zona del negocio, como `'AAAA-MM-DD'`. */
export function businessDateKey(now: Date, timeZone = BUSINESS_TIME_ZONE): string {
  // `en-CA` formatea como AAAA-MM-DD, que además se compara bien como texto.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Último día del mes, como `'AAAA-MM-DD'`: desde ese día se puede cerrar. */
export function monthCloseDay(month: string): string {
  const inicio = monthStart(month);
  const ultimo = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, 0));
  return ultimo.toISOString().slice(0, 10);
}

/**
 * true si el mes ya se puede cerrar: hoy, en la zona del negocio, es su último
 * día o después. Sin límite hacia adelante (decisión del dueño): si se pasó el
 * día, el mes se cierra igual.
 */
export function canCloseMonth(month: string, now: Date, timeZone = BUSINESS_TIME_ZONE): boolean {
  return businessDateKey(now, timeZone) >= monthCloseDay(month);
}
```

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `pnpm test -- stock.spec`
Expected: PASS, incluidos los 7 tests nuevos.

- [ ] **Step 5: Checkpoint**

Run: `git -C ../.. status --short packages/shared`
Expected: solo `M packages/shared/src/calc/stock.ts` y `M packages/shared/src/calc/stock.spec.ts`.

---

### Task 2: Shared — el contrato del cierre

**Files:**
- Modify: `calc3d-api/packages/shared/src/schemas/stock.ts`
- Create: `calc3d-api/packages/shared/src/schemas/stock.spec.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `calc3d-api/packages/shared/src/schemas/stock.spec.ts`:

```ts
import { StockMonthCloseSchema, StockMonthReopenSchema } from './stock';

describe('StockMonthCloseSchema', () => {
  it('acepta el mes con sus conteos', () => {
    const r = StockMonthCloseSchema.parse({
      month: '2026-08',
      counts: [{ materialId: 'm1', sealed: 1, inUse: 0, running: 2 }],
    });

    expect(r.counts[0]).toEqual({ materialId: 'm1', sealed: 1, inUse: 0, running: 2 });
  });

  it('una casilla que no vino llega como 0: casillas vacías = no hay', () => {
    const r = StockMonthCloseSchema.parse({ month: '2026-08', counts: [{ materialId: 'm1' }] });

    expect(r.counts[0]).toMatchObject({ sealed: 0, inUse: 0, running: 0 });
  });

  it('sin conteos es válido: todas las fichas quedan en 0', () => {
    expect(StockMonthCloseSchema.parse({ month: '2026-08' }).counts).toEqual([]);
  });

  it('rechaza rollos negativos', () => {
    const r = StockMonthCloseSchema.safeParse({
      month: '2026-08',
      counts: [{ materialId: 'm1', sealed: -1 }],
    });

    expect(r.success).toBe(false);
  });

  it('rechaza un mes mal escrito', () => {
    expect(StockMonthCloseSchema.safeParse({ month: '2026-8' }).success).toBe(false);
  });
});

describe('StockMonthReopenSchema', () => {
  it('solo pide el mes', () => {
    expect(StockMonthReopenSchema.parse({ month: '2026-08' })).toEqual({ month: '2026-08' });
  });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run (desde `calc3d-api/packages/shared`): `pnpm test -- schemas/stock`
Expected: FAIL con `error TS2305: Module '"./stock"' has no exported member 'StockMonthCloseSchema'`.

- [ ] **Step 3: Implementar**

En `calc3d-api/packages/shared/src/schemas/stock.ts`, justo después de `export type StockCountUpsertDto = …` (se elimina en la Task 7, cuando deje de usarse):

```ts
/**
 * CERRAR el conteo de un mes: la única forma de escribir conteos. Lo que no
 * viene en `counts` se guarda en 0 (casillas vacías = no hay, como el Excel).
 */
export const StockMonthCloseSchema = z.object({
  month: MonthSchema,
  counts: z
    .array(StockCountPartsSchema.extend({ materialId: z.string().min(1, 'Falta el material') }))
    .default([]),
});
export type StockMonthCloseDto = z.infer<typeof StockMonthCloseSchema>;

/** Reabrir un mes cerrado para corregirlo. */
export const StockMonthReopenSchema = z.object({ month: MonthSchema });
export type StockMonthReopenDto = z.infer<typeof StockMonthReopenSchema>;

/** Estado del cierre de un mes (`GET /filament/stock/status`). */
export interface StockMonthStatus {
  month: string;
  closed: boolean;
  /** ISO; null si está abierto */
  closedAt: string | null;
  /** ISO de la última reapertura */
  reopenedAt: string | null;
  /** hoy, en la zona del negocio, ya es el último día del mes o después */
  canClose: boolean;
  /** `'AAAA-MM-DD'`: desde qué día se puede cerrar */
  closableFrom: string;
}
```

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `pnpm test -- schemas/stock`
Expected: PASS (6 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm test`
Expected: todas las suites en verde (el total sube en 13 tests respecto de 213).

---

### Task 3: Shared — versión 0.13.0 y compilación

**Files:**
- Modify: `calc3d-api/packages/shared/src/version.ts`
- Modify: `calc3d-api/packages/shared/package.json`

- [ ] **Step 1: Subir la versión a la par**

En `src/version.ts`: `export const SHARED_VERSION = '0.12.0';` → `export const SHARED_VERSION = '0.13.0';`

En `package.json`: `"version": "0.12.0"` → `"version": "0.13.0"`

- [ ] **Step 2: Verificar que el test de versión los ata**

Run (desde `calc3d-api/packages/shared`): `pnpm test -- version`
Expected: PASS.

- [ ] **Step 3: Compilar shared (CJS para Nest, ESM para Vite)**

Run (desde `calc3d-api`): `pnpm --filter @calc3d/shared build`
Expected: termina sin errores (`tsc -p tsconfig.json && tsc -p tsconfig.esm.json`).

- [ ] **Step 4: Checkpoint**

Run: `grep -c "canCloseMonth" packages/shared/dist/cjs/calc/stock.js packages/shared/dist/esm/calc/stock.js`
Expected: un número mayor que 0 en los dos.

---

### Task 4: Base de datos — `StockMonth` y migración con backfill

**Files:**
- Modify: `calc3d-api/apps/api/prisma/schema.prisma`
- Create: `calc3d-api/apps/api/prisma/migrations/20260913180000_cierre_mensual_stock/migration.sql`

- [ ] **Step 1: Respaldo de la base local**

Run (desde `calc3d-api/apps/api`):

```bash
node --env-file=.env -e "
const { spawnSync } = require('node:child_process');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname)) { console.error('ABORTO: la DATABASE_URL no es local'); process.exit(1); }
url.search = '';
const r = spawnSync('C:/Program Files/PostgreSQL/18/bin/pg_dump.exe', ['--dbname', url.toString(), '--no-owner', '--file', 'C:/Users/evanan-it/Desktop/backup-antes-cierre-mensual.sql'], { encoding: 'utf8' });
if (r.status !== 0) { console.error('pg_dump falló'); process.exit(1); }
console.log('respaldo ok');
"
```

Expected: `respaldo ok`. (No imprime la URL: tiene la contraseña.)

- [ ] **Step 2: Agregar el modelo**

En `schema.prisma`, dentro de `model Organization`, debajo de `stockCounts     StockCount[]`:

```prisma
  stockMonths     StockMonth[]
```

Y justo después del bloque `model StockCount { … }`:

```prisma
/// Cierre del conteo físico de un mes. Un mes SIN fila está abierto (nunca se
/// cerró). Cerrar es la única forma de escribir conteos; corregir exige reabrir.
model StockMonth {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String

  /// Mes, como el primer día a medianoche UTC (igual que StockCount.month).
  month      DateTime
  /// null = abierto.
  closedAt   DateTime?
  /// Última reapertura. Se conserva al volver a cerrar: es el rastro de la corrección.
  reopenedAt DateTime?

  @@unique([organizationId, month])
}
```

- [ ] **Step 3: Generar el SQL de la migración**

Run (desde `calc3d-api/apps/api`):

```bash
mkdir -p prisma/migrations/20260913180000_cierre_mensual_stock
pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260913180000_cierre_mensual_stock/migration.sql
cat prisma/migrations/20260913180000_cierre_mensual_stock/migration.sql
```

Expected: `CREATE TABLE "StockMonth"`, un `CREATE UNIQUE INDEX "StockMonth_organizationId_month_key"` y un `ALTER TABLE "StockMonth" ADD CONSTRAINT … FOREIGN KEY ("organizationId")`. **Nada más**: si aparece un `DROP`, parar y revisar.

- [ ] **Step 4: Agregar el backfill al final del SQL**

Agregar al final de `migration.sql`:

```sql
-- Backfill: todo mes YA TERMINADO que tiene conteos se da por CERRADO (decisión
-- del dueño, 2026-09-13). En la base local es agosto 2026, que vino del Excel.
-- - Solo meses terminados (en hora de Venezuela): el mes en curso no se puede
--   cerrar antes de su último día, y sus conteos se reescriben al cerrarlo.
-- - `now() AT TIME ZONE 'UTC'`: la columna no guarda zona y Prisma la lee como
--   UTC; con `now()` a secas, un servidor en otra zona guardaría la hora corrida.
-- - El id no tiene default en la base (cuid lo genera Prisma): se deriva del mes.
INSERT INTO "StockMonth" ("id", "organizationId", "month", "closedAt")
SELECT DISTINCT ON ("organizationId", "month")
  'sm_' || md5("organizationId" || "month"::text),
  "organizationId",
  "month",
  now() AT TIME ZONE 'UTC'
FROM "StockCount"
WHERE "month" < date_trunc('month', now() AT TIME ZONE 'America/Caracas')
ON CONFLICT ("organizationId", "month") DO NOTHING;
```

- [ ] **Step 5: Aplicar y regenerar el cliente**

Run (desde `calc3d-api/apps/api`):

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Expected: `Applying migration 20260913180000_cierre_mensual_stock` y `All migrations have been successfully applied.` Si `generate` falla con `EPERM` es porque la API en watch tiene tomado el motor: los tipos igual se generan; se confirma en el Step 6.

- [ ] **Step 6: Verificar el backfill y los tipos**

Run (desde `calc3d-api/apps/api`):

```bash
node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.stockMonth.findMany({ select: { month: true, closedAt: true } }).then((r) => { console.log(r.map((x) => x.month.toISOString().slice(0, 7) + ' cerrado=' + !!x.closedAt)); return p.\$disconnect(); });
"
pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: `[ '2026-08 cerrado=true' ]` y `tsc` sin errores.

---

### Task 5: API — estado, cierre y reapertura

**Files:**
- Modify: `calc3d-api/apps/api/src/filament/filament.service.ts`
- Test: `calc3d-api/apps/api/src/filament/filament.service.spec.ts`

- [ ] **Step 1: Preparar el mock de Prisma**

En `filament.service.spec.ts`, reemplazar el import de Nest:

```ts
import { NotFoundException } from '@nestjs/common';
```

por:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
```

Y reemplazar la función `makePrisma` entera por:

```ts
/** Un mes cerrado, como lo guarda la tabla StockMonth. */
const CERRADO = { closedAt: new Date('2026-09-01T12:00:00Z'), reopenedAt: null as Date | null };

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    material: {
      findMany: jest.fn().mockResolvedValue(MATERIALES),
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          where.organizationId === ORG ? MATERIALES.find((m) => m.id === where.id) ?? null : null,
        ),
      ),
    },
    stockCount: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'sc1' }),
    },
    // Por defecto el mes está CERRADO: es el caso en que el resumen da números.
    stockMonth: {
      findUnique: jest.fn().mockResolvedValue(CERRADO as typeof CERRADO | null),
      findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    expense: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  // Transacción interactiva: el callback corre contra el mismo mock.
  const $transaction = jest.fn(async (cb: (tx: typeof base) => unknown) => cb(base));
  return Object.assign(base, { $transaction });
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Al final de `filament.service.spec.ts`:

```ts
/** 31/08 a las 11:00 en Caracas: ya se puede cerrar agosto. */
const DIA_DE_CIERRE = new Date('2026-08-31T15:00:00Z');
/** 30/08 a las 11:00 en Caracas: todavía no. */
const ANTES_DE_TIEMPO = new Date('2026-08-30T15:00:00Z');

/**
 * El cierre es la ÚNICA escritura de conteos, y el bloqueo vive en el servidor:
 * estos tests son la regresión de seguridad (un límite solo en el botón no
 * protege nada).
 */
describe('Cierre del mes', () => {
  it('escribe TODAS las fichas: las que no vinieron quedan en 0', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await service(prisma).closeMonth(
      ORG,
      { month: '2026-08', counts: [{ materialId: 'm1', sealed: 2, inUse: 1, running: 0 }] },
      DIA_DE_CIERRE,
    );

    const escritas = prisma.stockCount.upsert.mock.calls.map(([arg]) => arg.create);
    expect(escritas).toHaveLength(3);
    expect(escritas.find((c) => c.materialId === 'm1')).toMatchObject({ sealed: 2, inUse: 1, running: 0 });
    expect(escritas.find((c) => c.materialId === 'm2')).toMatchObject({ sealed: 0, inUse: 0, running: 0 });
    expect(prisma.stockMonth.upsert.mock.calls[0][0].update).toEqual({ closedAt: DIA_DE_CIERRE });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('al cerrar apaga el aviso de marca por identificar', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, DIA_DE_CIERRE);

    expect(prisma.stockCount.upsert.mock.calls[0][0].update.needsBrandCheck).toBe(false);
  });

  it('antes del último día del mes no cierra ni escribe', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const intento = service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, ANTES_DE_TIEMPO);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('31/08/2026');
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
  });

  it('un mes cerrado no se vuelve a cerrar', async () => {
    const prisma = makePrisma(); // cerrado por defecto

    await expect(
      service(prisma).closeMonth(ORG, { month: '2026-08', counts: [] }, DIA_DE_CIERRE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
    expect(prisma.stockMonth.upsert).not.toHaveBeenCalled();
  });

  it('una ficha de otra organización no se escribe', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await expect(
      service(prisma).closeMonth(
        ORG,
        { month: '2026-08', counts: [{ materialId: 'ajena', sealed: 5, inUse: 0, running: 0 }] },
        DIA_DE_CIERRE,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
  });

  it('una ficha repetida se rechaza con su nombre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);
    const fila = { materialId: 'm1', sealed: 1, inUse: 0, running: 0 };

    const intento = service(prisma).closeMonth(ORG, { month: '2026-08', counts: [fila, fila] }, DIA_DE_CIERRE);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow('PLA Creality Amarillo');
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
  });
});

describe('Reabrir el mes', () => {
  it('lo deja abierto, anota cuándo y no toca los conteos', async () => {
    const prisma = makePrisma(); // cerrado por defecto

    await service(prisma).reopenMonth(ORG, { month: '2026-08' }, DIA_DE_CIERRE);

    expect(prisma.stockMonth.update.mock.calls[0][0].data).toEqual({ closedAt: null, reopenedAt: DIA_DE_CIERRE });
    expect(prisma.stockCount.upsert).not.toHaveBeenCalled();
  });

  it('un mes abierto no se reabre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    await expect(service(prisma).reopenMonth(ORG, { month: '2026-08' }, DIA_DE_CIERRE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.stockMonth.update).not.toHaveBeenCalled();
  });
});

describe('Estado del mes', () => {
  it('dice si está cerrado y desde cuándo se puede cerrar', async () => {
    const prisma = makePrisma();

    const s = await service(prisma).monthStatus(ORG, '2026-08', ANTES_DE_TIEMPO);

    expect(s).toEqual({
      month: '2026-08',
      closed: true,
      closedAt: '2026-09-01T12:00:00.000Z',
      reopenedAt: null,
      canClose: false,
      closableFrom: '2026-08-31',
    });
  });

  it('un mes sin fila está abierto', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const s = await service(prisma).monthStatus(ORG, '2026-08', DIA_DE_CIERRE);

    expect(s).toMatchObject({ closed: false, closedAt: null, canClose: true });
  });
});
```

- [ ] **Step 3: Correrlos y verlos fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/filament/filament.service.spec.ts`
Expected: FAIL con `error TS2339: Property 'closeMonth' does not exist on type 'FilamentService'` (y `reopenMonth`, `monthStatus`). Los tests viejos no cambian de comportamiento.

- [ ] **Step 4: Implementar**

En `filament.service.ts`, reemplazar el import de Nest:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
```

por:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

Agregar al import de `@calc3d/shared`: `canCloseMonth`, `monthCloseDay`, `type StockMonthCloseDto`, `type StockMonthReopenDto`, `type StockMonthStatus`.

Dentro de la clase `FilamentService`, justo antes de `/** Totales del mes, consumo contra el mes anterior y qué reponer. */`:

```ts
  /** Si el mes está cerrado y desde cuándo se puede cerrar. */
  async monthStatus(organizationId: string, month: string, now = new Date()): Promise<StockMonthStatus> {
    const fila = await this.monthRow(organizationId, month);
    return {
      month,
      closed: !!fila?.closedAt,
      closedAt: fila?.closedAt?.toISOString() ?? null,
      reopenedAt: fila?.reopenedAt?.toISOString() ?? null,
      canClose: canCloseMonth(month, now),
      closableFrom: monthCloseDay(month),
    };
  }

  /**
   * CIERRA el conteo del mes: la única escritura de conteos. Escribe una fila
   * por CADA ficha (lo que no vino, en 0: casillas vacías = no hay) y marca el
   * mes cerrado, todo en una transacción. Las validaciones van ANTES de
   * escribir: si algo falla, no queda nada a medias.
   */
  async closeMonth(organizationId: string, dto: StockMonthCloseDto, now = new Date()): Promise<StockMonthStatus> {
    if (!canCloseMonth(dto.month, now)) {
      throw new BadRequestException(
        `${etiquetaMes(dto.month)} se puede cerrar desde el ${fechaCorta(monthCloseDay(dto.month))} (hora de Venezuela).`,
      );
    }
    const month = monthStart(dto.month);

    await this.prisma.$transaction(async (tx) => {
      const fila = await tx.stockMonth.findUnique({
        where: { organizationId_month: { organizationId, month } },
      });
      if (fila?.closedAt) {
        throw new ConflictException(`${etiquetaMes(dto.month)} ya está cerrado. Reabrilo para corregirlo.`);
      }

      const materiales = await tx.material.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      });
      const nombres = new Map(materiales.map((m) => [m.id, m.name]));
      const vistos = new Set<string>();
      for (const c of dto.counts) {
        if (!nombres.has(c.materialId)) throw new NotFoundException('Material no encontrado');
        if (vistos.has(c.materialId)) {
          throw new BadRequestException(`La ficha «${nombres.get(c.materialId)}» viene dos veces.`);
        }
        vistos.add(c.materialId);
      }

      const porFicha = new Map(dto.counts.map((c) => [c.materialId, c]));
      for (const m of materiales) {
        const c = porFicha.get(m.id);
        const partes = { sealed: c?.sealed ?? 0, inUse: c?.inUse ?? 0, running: c?.running ?? 0 };
        await tx.stockCount.upsert({
          where: { materialId_month: { materialId: m.id, month } },
          // Contarlo a mano resuelve la duda de marca que dejó la importación.
          update: { ...partes, needsBrandCheck: false, countedAt: now },
          create: { ...partes, organizationId, materialId: m.id, month, countedAt: now },
        });
      }

      await tx.stockMonth.upsert({
        where: { organizationId_month: { organizationId, month } },
        update: { closedAt: now },
        create: { organizationId, month, closedAt: now },
      });
    });

    return this.monthStatus(organizationId, dto.month, now);
  }

  /** REABRE un mes cerrado para corregirlo. Los conteos no se tocan. */
  async reopenMonth(organizationId: string, dto: StockMonthReopenDto, now = new Date()): Promise<StockMonthStatus> {
    const fila = await this.monthRow(organizationId, dto.month);
    if (!fila?.closedAt) throw new ConflictException(`${etiquetaMes(dto.month)} no está cerrado.`);

    await this.prisma.stockMonth.update({
      where: { organizationId_month: { organizationId, month: monthStart(dto.month) } },
      data: { closedAt: null, reopenedAt: now },
    });
    return this.monthStatus(organizationId, dto.month, now);
  }
```

Dentro de la clase, junto a `countsOf`:

```ts
  private monthRow(organizationId: string, month: string) {
    return this.prisma.stockMonth.findUnique({
      where: { organizationId_month: { organizationId, month: monthStart(month) } },
    });
  }
```

Y al final del archivo, junto a `dateWhere`:

```ts
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** `'2026-08'` → `'Agosto de 2026'`, para los mensajes de error. */
function etiquetaMes(month: string): string {
  const d = monthStart(month);
  const nombre = MESES[d.getUTCMonth()];
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} de ${d.getUTCFullYear()}`;
}

/** `'2026-08-31'` → `'31/08/2026'`. */
function fechaCorta(dia: string): string {
  const [anio, mes, d] = dia.split('-');
  return `${d}/${mes}/${anio}`;
}
```

- [ ] **Step 5: Correrlos y verlos pasar**

Run: `pnpm exec jest src/filament/filament.service.spec.ts`
Expected: PASS (los 20 de antes + 10 nuevos).

- [ ] **Step 6: Checkpoint**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint src/filament`
Expected: sin errores.

---

### Task 6: API — las lecturas usan solo meses cerrados

**Files:**
- Modify: `calc3d-api/apps/api/src/filament/filament.service.ts` (`stock`, `summary`, `FilamentSummary`, + `lastClosedMonth`)
- Test: `calc3d-api/apps/api/src/filament/filament.service.spec.ts`

- [ ] **Step 1: Ajustar los tests existentes que dependen de "abierto"**

En el test `'trae TODOS los materiales, contados o no'`, después de `const prisma = makePrisma();` agregar:

```ts
    prisma.stockMonth.findUnique.mockResolvedValue(null); // mes abierto
```

En el test `'sin el conteo del mes anterior, el consumo queda sin dato'`, después de `const prisma = makePrisma();` agregar:

```ts
    // Agosto cerrado; julio nunca se cerró.
    prisma.stockMonth.findUnique.mockImplementation(
      ({ where }: { where: { organizationId_month: { month: Date } } }) =>
        Promise.resolve(where.organizationId_month.month.getUTCMonth() === 7 ? CERRADO : null),
    );
```

Reemplazar el test entero `'un mes sin ningún conteo no está completo ni pide reponer'` por:

```ts
  it('un mes abierto no está completo ni pide reponer', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.countedColors).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.restock).toEqual([]);
  });
```

- [ ] **Step 2: Escribir los tests nuevos que fallan**

Al final de `describe('Conteo de stock', …)` (antes de su `});`):

```ts
  it('un mes con conteos pero ABIERTO no cuenta como contado', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null); // p. ej. reabierto
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 2, inUse: 1, running: 0, needsBrandCheck: false },
    ]);

    const filas = await service(prisma).stock(ORG, '2026-08');
    const m1 = filas.find((f) => f.materialId === 'm1')!;

    expect(m1.counted).toBe(false);
    // Los números guardados se muestran igual, para corregirlos.
    expect(m1.total).toBe(3);
  });
```

Al final de `describe('Resumen del mes', …)` (antes de su `});`):

```ts
  it('un mes con conteos pero ABIERTO no da números', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findUnique.mockResolvedValue(null);
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 3, inUse: 0, running: 1, needsBrandCheck: false },
    ]);

    const r = await service(prisma).summary(ORG, '2026-08');
    expect(r.totalRolls).toBe(0);
    expect(r.running).toBe(0);
    expect(r.consumption).toBeNull();
    expect(r.restock).toEqual([]);
    expect(r.countedColors).toBe(0);
    expect(r.totalColors).toBe(2);
    expect(r.complete).toBe(false);
  });

  it('el consumo exige que los DOS meses estén cerrados', async () => {
    const prisma = makePrisma();
    prisma.stockCount.findMany.mockResolvedValue([
      { materialId: 'm1', sealed: 5, inUse: 0, running: 0, needsBrandCheck: false },
    ]);
    // Septiembre cerrado; agosto reabierto.
    prisma.stockMonth.findUnique.mockImplementation(
      ({ where }: { where: { organizationId_month: { month: Date } } }) =>
        Promise.resolve(where.organizationId_month.month.getUTCMonth() === 8 ? CERRADO : null),
    );

    const r = await service(prisma).summary(ORG, '2026-09');
    expect(r.totalRolls).toBe(5);
    expect(r.consumption).toBeNull();
  });
```

Y al final del archivo, como `describe` aparte:

```ts
describe('Último mes cerrado', () => {
  it('es el mes más reciente con cierre', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findFirst.mockResolvedValue({ month: new Date('2026-08-01T00:00:00Z') });

    await expect(service(prisma).lastClosedMonth(ORG)).resolves.toBe('2026-08');
    expect(prisma.stockMonth.findFirst.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
  });

  it('sin meses cerrados es null', async () => {
    const prisma = makePrisma();

    await expect(service(prisma).lastClosedMonth(ORG)).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: Correrlos y verlos fallar**

Run: `pnpm exec jest src/filament/filament.service.spec.ts`
Expected: FAIL en `'un mes con conteos pero ABIERTO no cuenta como contado'` (`Expected: false, Received: true`), `'un mes con conteos pero ABIERTO no da números'`, `'el consumo exige que los DOS meses estén cerrados'`, y `TS2339 … 'lastClosedMonth'`.

- [ ] **Step 4: Implementar**

En `filament.service.ts`, en `stock()`, reemplazar:

```ts
    const [materiales, conteos] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.countsOf(organizationId, month),
    ]);
```

por:

```ts
    const [materiales, conteos, cerrado] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.countsOf(organizationId, month),
      this.isClosed(organizationId, month),
    ]);
```

y:

```ts
        // Como en el Excel: si el mes ya se contó, una ficha sin marcar es CERO
        // (decisión del dueño, 2026-09-13). Solo un mes sin NINGÚN conteo es
        // "todavía no se contó".
        counted: !!c || conteos.length > 0,
```

por:

```ts
        // "Contado" = el mes está CERRADO (cierre mensual, 2026-09-13). En un mes
        // cerrado lo que no se marcó es 0; un mes abierto o reabierto no es dato final.
        counted: cerrado,
```

En `summary()`, reemplazar desde `const [materiales, actual, previo, comprados, historico] = await Promise.all([` hasta `const previoTotal = …;` (inclusive) por:

```ts
    const [materiales, actualGuardado, previoGuardado, comprados, historico, cerrado, previoCerrado] =
      await Promise.all([
        this.prisma.material.findMany({ where: { organizationId } }),
        this.countsOf(organizationId, month),
        this.countsOf(organizationId, anterior),
        this.purchasedInMonth(organizationId, month),
        this.purchasedUpTo(organizationId, month),
        this.isClosed(organizationId, month),
        this.isClosed(organizationId, anterior),
      ]);

    // Un mes abierto (nunca cerrado, o reabierto a medio corregir) no da números.
    const actual = cerrado ? actualGuardado : [];
    const previo = previoCerrado ? previoGuardado : null;

    const totalRolls = actual.reduce((s, c) => s + stockTotal(c), 0);
    const running = actual.reduce((s, c) => s + c.running, 0);
    const previoTotal = previo ? previo.reduce((s, c) => s + stockTotal(c), 0) : null;
```

En el `return` de `summary()`, reemplazar:

```ts
      consumption: monthConsumption(previoTotal, actual.length ? totalRolls : null, comprados),
```

por:

```ts
      consumption: monthConsumption(previoTotal, cerrado ? totalRolls : null, comprados),
```

y:

```ts
      complete: reposicion.totalColors > 0 && reposicion.countedColors >= reposicion.totalColors,
```

por:

```ts
      complete: cerrado,
```

En la interfaz `FilamentSummary`, reemplazar:

```ts
  /** colores con al menos una ficha contada este mes */
  countedColors: number;
```

por:

```ts
  /** colores contados: todos si el mes está cerrado, ninguno si está abierto */
  countedColors: number;
```

y el comentario de `complete` (desde `/**` hasta `*/`) por:

```ts
  /** true si el mes está CERRADO: solo entonces el total, el consumo y la reposición son datos finales */
```

Dentro de la clase, junto a `monthRow`:

```ts
  private async isClosed(organizationId: string, month: string): Promise<boolean> {
    return !!(await this.monthRow(organizationId, month))?.closedAt;
  }

  /** El mes cerrado más reciente (`'AAAA-MM'`), o null si todavía no se cerró ninguno. */
  async lastClosedMonth(organizationId: string): Promise<string | null> {
    const fila = await this.prisma.stockMonth.findFirst({
      where: { organizationId, closedAt: { not: null } },
      orderBy: { month: 'desc' },
    });
    return fila ? monthKey(fila.month) : null;
  }
```

Agregar `monthKey` al import de `@calc3d/shared`.

- [ ] **Step 5: Correrlos y verlos pasar**

Run: `pnpm exec jest src/filament/filament.service.spec.ts`
Expected: PASS (todo el archivo).

- [ ] **Step 6: Checkpoint**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint src/filament`
Expected: sin errores.

---

### Task 7: API — rutas nuevas, `PUT` en 410 y adiós a `saveCount`

**Files:**
- Modify: `calc3d-api/apps/api/src/filament/filament.controller.ts`
- Create: `calc3d-api/apps/api/src/filament/filament.controller.spec.ts`
- Modify: `calc3d-api/apps/api/src/filament/filament.service.ts` (− `saveCount`)
- Modify: `calc3d-api/apps/api/src/filament/filament.service.spec.ts` (− 3 tests de `saveCount`)
- Modify: `calc3d-api/packages/shared/src/schemas/stock.ts` (− `StockCountUpsertSchema`)

- [ ] **Step 1: Escribir el test que falla**

Crear `filament.controller.spec.ts`:

```ts
import { GoneException } from '@nestjs/common';
import { FilamentController } from './filament.controller';

/**
 * Regresión de seguridad: el guardado por casilla dejó de existir. Si alguien
 * vuelve a conectar `PUT /filament/stock` al servicio, los meses cerrados se
 * vuelven editables por la puerta de atrás.
 */
describe('FilamentController', () => {
  it('PUT /filament/stock ya no guarda: responde 410 sin tocar el servicio', () => {
    const service = { closeMonth: jest.fn(), reopenMonth: jest.fn(), monthStatus: jest.fn() };
    const controller = new FilamentController(service as never);

    expect(() => controller.saveCount()).toThrow(GoneException);
    expect(service.closeMonth).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/filament/filament.controller.spec.ts`
Expected: FAIL (`TS2554: Expected 2 arguments, but got 0`: hoy `saveCount` pide usuario y cuerpo).

- [ ] **Step 3: Reescribir el controller**

Reemplazar `filament.controller.ts` entero por:

```ts
import {
  Body,
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  StockMonthCloseSchema,
  StockMonthReopenSchema,
  type StockMonthCloseDto,
  type StockMonthReopenDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FilamentService } from './filament.service';

/**
 * Los dos controles de filamento: las compras y el conteo físico del mes.
 * `month` siempre viaja como `AAAA-MM`. El conteo se escribe SOLO cerrando el mes.
 */
@Controller('filament')
@UseGuards(JwtAuthGuard)
export class FilamentController {
  constructor(private readonly service: FilamentService) {}

  @Get('purchases')
  purchases(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.purchases(user.organizationId, from, to);
  }

  @Get('stock/status')
  status(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.monthStatus(user.organizationId, month);
  }

  @Get('stock')
  stock(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.stock(user.organizationId, month);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.summary(user.organizationId, month);
  }

  @Post('stock/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StockMonthCloseSchema)) dto: StockMonthCloseDto,
  ) {
    return this.service.closeMonth(user.organizationId, dto);
  }

  @Post('stock/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StockMonthReopenSchema)) dto: StockMonthReopenDto,
  ) {
    return this.service.reopenMonth(user.organizationId, dto);
  }

  /**
   * Ya no guarda (cierre mensual, 2026-09-13). La ruta queda para que un panel
   * viejo, durante el despliegue, reciba un mensaje claro en vez de un 404.
   */
  @Put('stock')
  saveCount(): never {
    throw new GoneException('El conteo se guarda cerrando el mes.');
  }
}
```

- [ ] **Step 4: Quitar `saveCount` del servicio y sus tests**

En `filament.service.ts`, borrar el método entero `saveCount` (desde `/** Guarda el conteo de un material en un mes (uno por material y mes). */` hasta su `}`) y quitar `type StockCountUpsertDto,` del import de `@calc3d/shared`.

En `filament.service.spec.ts`, borrar los tres tests enteros:
`'guarda el conteo de un material del mes'`, `'no cuenta el material de otra organización'` (con su comentario `/** Contar el rollo de otra organización sería ver su inventario. */`) y `'al guardar a mano deja de estar pendiente de identificar'` (con su comentario `/** Identificar la marca de un rollo importado apaga el aviso. */`). La cobertura equivalente quedó en `Cierre del mes`.

En `calc3d-api/packages/shared/src/schemas/stock.ts`, borrar:

```ts
/** Guardar el conteo de un material en un mes. */
export const StockCountUpsertSchema = StockCountPartsSchema.extend({
  materialId: z.string().min(1, 'Falta el material'),
  month: MonthSchema,
});
export type StockCountUpsertDto = z.infer<typeof StockCountUpsertSchema>;
```

- [ ] **Step 5: Compilar shared, correr y verificar**

Run (desde `calc3d-api`):

```bash
pnpm --filter @calc3d/shared build
cd apps/api
pnpm exec jest src/filament
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/filament
grep -rn "StockCountUpsert\|saveCount(" src ../../packages/shared/src | grep -v "filament.controller"
```

Expected: jest PASS en las dos suites; `tsc` y `eslint` sin errores; el `grep` no devuelve nada.

---

### Task 8: API — no se borra una ficha con conteos en meses cerrados

**Files:**
- Modify: `calc3d-api/apps/api/src/materials/materials.service.ts`
- Create: `calc3d-api/apps/api/src/materials/materials.service.spec.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `materials.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MaterialsService } from './materials.service';

const ORG = 'org-A';
const AGOSTO = new Date('2026-08-01T00:00:00Z');

function makePrisma() {
  return {
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: 'm1', organizationId: ORG } as { id: string } | null),
      delete: jest.fn().mockResolvedValue({}),
    },
    stockMonth: { findMany: jest.fn().mockResolvedValue([] as { month: Date }[]) },
    stockCount: { findFirst: jest.fn().mockResolvedValue(null as { month: Date } | null) },
  };
}

const service = (prisma: ReturnType<typeof makePrisma>) => new MaterialsService(prisma as never);

/**
 * Borrar una ficha borra en CASCADA sus conteos: sin esta guarda, un mes cerrado
 * se podría modificar borrando la ficha. Regresión de seguridad del cierre mensual.
 */
describe('MaterialsService.remove', () => {
  it('una ficha con conteos en un mes cerrado no se borra', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);
    prisma.stockCount.findFirst.mockResolvedValue({ month: AGOSTO });

    const intento = service(prisma).remove(ORG, 'm1');

    await expect(intento).rejects.toBeInstanceOf(ConflictException);
    await expect(intento).rejects.toThrow('agosto de 2026');
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });

  it('busca conteos de esa ficha solo en los meses cerrados', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.stockMonth.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, closedAt: { not: null } },
    });
    expect(prisma.stockCount.findFirst.mock.calls[0][0]).toMatchObject({
      where: { materialId: 'm1', month: { in: [AGOSTO] } },
    });
  });

  it('con meses cerrados pero sin conteos de esa ficha, se borra', async () => {
    const prisma = makePrisma();
    prisma.stockMonth.findMany.mockResolvedValue([{ month: AGOSTO }]);

    await expect(service(prisma).remove(ORG, 'm1')).resolves.toEqual({ ok: true });
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('sin meses cerrados se borra como siempre', async () => {
    const prisma = makePrisma();

    await service(prisma).remove(ORG, 'm1');

    expect(prisma.stockCount.findFirst).not.toHaveBeenCalled();
    expect(prisma.material.delete).toHaveBeenCalled();
  });

  it('una ficha de otra organización sigue siendo 404', async () => {
    const prisma = makePrisma();
    prisma.material.findFirst.mockResolvedValue(null);

    await expect(service(prisma).remove(ORG, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.material.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run (desde `calc3d-api/apps/api`): `pnpm exec jest src/materials`
Expected: FAIL en `'una ficha con conteos en un mes cerrado no se borra'` (`Received promise resolved instead of rejected`) y en `'busca conteos de esa ficha solo en los meses cerrados'`.

- [ ] **Step 3: Implementar**

En `materials.service.ts`, reemplazar:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
```

por:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

Y reemplazar el método `remove` por:

```ts
  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);

    // Borrar la ficha borra en CASCADA sus conteos: si alguno es de un mes
    // cerrado, borrarla modificaría un registro que el dueño dio por final.
    const cerrados = await this.prisma.stockMonth.findMany({
      where: { organizationId, closedAt: { not: null } },
      select: { month: true },
    });
    if (cerrados.length > 0) {
      const conteo = await this.prisma.stockCount.findFirst({
        where: { materialId: id, month: { in: cerrados.map((c) => c.month) } },
        orderBy: { month: 'desc' },
        select: { month: true },
      });
      if (conteo) {
        const mes = conteo.month.toLocaleDateString('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        throw new ConflictException(
          `Esta ficha tiene conteos en meses cerrados (${mes}). No se puede borrar: se perderían esos conteos.`,
        );
      }
    }

    await this.prisma.material.delete({ where: { id } });
    return { ok: true };
  }
```

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `pnpm exec jest src/materials`
Expected: PASS (5 tests).

- [ ] **Step 5: Checkpoint**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint src/materials`
Expected: sin errores.

---

### Task 9: API — reporte en Excel y script de importación

**Files:**
- Modify: `calc3d-api/apps/api/src/reports/reports.module.ts`
- Modify: `calc3d-api/apps/api/prisma/import-filamento.mjs`

- [ ] **Step 1: La hoja "Stock mensual" muestra el último mes cerrado**

En `reports.module.ts`, reemplazar:

```ts
    const mesActual = monthKey(new Date());
    const stock = await this.filament.stock(organizationId, mesActual);
```

por:

```ts
    // "Stock mensual" muestra el ÚLTIMO MES CERRADO: un mes abierto (o reabierto
    // a medio corregir) no es un dato final.
    const mesStock = await this.filament.lastClosedMonth(organizationId);
    const stock = mesStock ? await this.filament.stock(organizationId, mesStock) : [];
```

y:

```ts
    hStock.addRow([`Conteo de ${mesActual}`]).font = { italic: true, size: 9 };
```

por:

```ts
    hStock.addRow([mesStock ? `Conteo cerrado de ${mesStock}` : 'Todavía no hay meses cerrados']).font = {
      italic: true,
      size: 9,
    };
```

- [ ] **Step 2: Verificar el import de `monthKey`**

Run (desde `calc3d-api/apps/api`): `grep -n "monthKey" src/reports/reports.module.ts`
Expected: si la única aparición es la línea del `import`, quitar `monthKey` de ese import (queda sin uso y `eslint` lo marca). Si aparece en otra línea, dejarlo.

- [ ] **Step 3: El import de filamento no corre con meses cerrados**

En `prisma/import-filamento.mjs`, justo después de:

```js
  if (!org) throw new Error('No hay ninguna organización en la base');
```

agregar:

```js
  // Este import BORRA y recrea todos los conteos. Con meses cerrados, eso
  // pisaría registros que el dueño dio por finales: es de carga inicial y no
  // corresponde correrlo (tampoco en ensayo, para que el aviso se vea antes).
  const cerrados = await prisma.stockMonth.count({ where: { organizationId: org.id, closedAt: { not: null } } });
  if (cerrados > 0) {
    throw new Error(
      `Hay ${cerrados} mes(es) de stock CERRADOS y este import borra todos los conteos. ` +
        'No se escribió nada. Si de verdad hay que reimportar, reabrí esos meses primero.',
    );
  }
```

- [ ] **Step 4: Verificar**

Run (desde `calc3d-api/apps/api`):

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/reports
node --env-file=.env prisma/import-filamento.mjs; echo "exit=$?"
```

Expected: `tsc` y `eslint` sin errores; el import termina con `Hay 1 mes(es) de stock CERRADOS…` y `exit=1` (agosto está cerrado por el backfill). No escribe nada.

---

### Task 10: Panel — sincronizar shared y los hooks

**Files:**
- Modify (vía script): `calc3d-web/packages/shared/**`
- Modify: `calc3d-web/apps/web/src/features/filament/api.ts`

- [ ] **Step 1: Sincronizar y compilar shared**

Run (desde `calc3d-web`):

```bash
pnpm sync:shared
pnpm --filter @calc3d/shared build
pnpm test:shared
```

Expected: `version: 0.12.0 → 0.13.0`, build sin errores y todas las suites en verde.

- [ ] **Step 2: Reemplazar los hooks de guardado**

En `apps/web/src/features/filament/api.ts`, reemplazar el import de tipos:

```ts
import type {
  FilamentPurchase,
  RestockGroup,
  StockCountRow,
  StockCountUpsertDto,
} from '@calc3d/shared';
```

por:

```ts
import type {
  FilamentPurchase,
  RestockGroup,
  StockCountRow,
  StockMonthCloseDto,
  StockMonthStatus,
} from '@calc3d/shared';
```

En `FilamentSummary`, reemplazar:

```ts
  /** colores contados: todos si el mes tiene algún conteo, ninguno si no */
  countedColors: number;
```

por:

```ts
  /** colores contados: todos si el mes está cerrado, ninguno si está abierto */
  countedColors: number;
```

y:

```ts
  /** false si el mes no tiene ningún conteo */
  complete: boolean;
```

por:

```ts
  /** true si el mes está CERRADO: solo entonces los números son finales */
  complete: boolean;
```

Reemplazar la función entera `useSaveStockCount` por:

```ts
/** Si el mes está cerrado y desde cuándo se puede cerrar. */
export function useFilamentMonthStatus(month: string) {
  return useQuery({
    queryKey: ['filament-month-status', month],
    queryFn: async () => {
      const { data } = await api.get<StockMonthStatus>('/filament/stock/status', { params: { month } });
      return data;
    },
  });
}

/** Tras cerrar o reabrir cambian el conteo, el resumen y el estado del mes. */
function useInvalidarStock() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['filament-stock', 'filament-summary', 'filament-month-status']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Cierra el mes con todas las casillas: la única forma de guardar el conteo. */
export function useCloseStockMonth() {
  const invalidar = useInvalidarStock();
  return useMutation({
    mutationFn: async (dto: StockMonthCloseDto) => {
      const { data } = await api.post<StockMonthStatus>('/filament/stock/close', dto);
      return data;
    },
    onSuccess: invalidar,
  });
}

/** Reabre un mes cerrado para corregirlo. */
export function useReopenStockMonth() {
  const invalidar = useInvalidarStock();
  return useMutation({
    mutationFn: async (month: string) => {
      const { data } = await api.post<StockMonthStatus>('/filament/stock/reopen', { month });
      return data;
    },
    onSuccess: invalidar,
  });
}
```

- [ ] **Step 3: Checkpoint**

Run (desde `calc3d-web/apps/web`): `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: FALLA solo en `StockTab.tsx` (`useSaveStockCount` ya no existe). Se arregla en la Task 11.

---

### Task 11: Panel — Stock del mes con borrador, cierre y reapertura

**Files:**
- Modify (reemplazo completo): `calc3d-web/apps/web/src/features/filament/StockTab.tsx`

- [ ] **Step 1: Reemplazar el archivo**

Reemplazar `StockTab.tsx` entero por:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Lock,
  LockOpen,
  PackageCheck,
} from 'lucide-react';
import {
  BUSINESS_TIME_ZONE,
  monthKey,
  monthStart,
  previousMonth,
  stockTotal,
  type RestockGroup,
  type StockCountRow,
} from '@calc3d/shared';
import { Badge, Button, Card, CardContent, NumberInput, TableSkeleton } from '@/components/ui';
import { useConfirm } from '@/components/overlays';
import { notify } from '@/components/toast';
import { apiErrorMessage } from '@/lib/api';
import { usePersistentState } from '@/lib/usePersistentState';
import { cn } from '@/lib/utils';
import {
  useCloseStockMonth,
  useFilamentMonthStatus,
  useFilamentStock,
  useFilamentSummary,
  useReopenStockMonth,
} from '@/features/filament/api';

/**
 * STOCK AL CIERRE DE MES — la hoja "Stock mensual" del Excel.
 *
 * El conteo es un ACTO DE CIERRE (decisión del dueño, 2026-09-13): el último día
 * del mes (o después) se llenan las casillas y se toca "Guardar y cerrar". Hasta
 * entonces lo escrito vive en un borrador del navegador; después el mes queda de
 * solo lectura y se corrige reabriéndolo. El bloqueo REAL está en el servidor.
 *
 * Casillas vacías = no hay, como en el Excel: al cerrar, lo que no se marcó es 0.
 * Las filas se agrupan por color, con una fila por marca.
 */
export function StockTab() {
  const [month, setMonth] = usePersistentState('filament:stock:month', monthKey(new Date()));
  const { data: filas = [], isLoading } = useFilamentStock(month);
  const { data: resumen } = useFilamentSummary(month);
  const { data: estado } = useFilamentMonthStatus(month);
  const cerrar = useCloseStockMonth();
  const reabrir = useReopenStockMonth();
  const confirm = useConfirm();

  const cerrado = !!estado?.closed;
  const claveBorrador = `filament:stock:draft:${month}`;

  // Borrador: lo escrito y todavía no cerrado. Arranca con lo guardado en este
  // navegador o, si no hay, con lo que tiene la base (un mes reabierto trae sus
  // números para corregirlos).
  const [draft, setDraft] = useState<Record<string, Partes>>({});
  useEffect(() => {
    setDraft(
      leerBorrador(claveBorrador) ?? Object.fromEntries(filas.map((f) => [f.materialId, partesDe(f)])),
    );
  }, [claveBorrador, filas]);

  const grupos = useMemo(() => agruparPorColor(filas), [filas]);

  const set = (id: string, patch: Partial<Partes>) =>
    setDraft((d) => {
      const next = { ...d, [id]: { ...(d[id] ?? CERO), ...patch } };
      guardarBorrador(claveBorrador, next);
      return next;
    });

  const cerrarMes = async () => {
    const counts = filas.map((f) => ({ materialId: f.materialId, ...(draft[f.materialId] ?? CERO) }));
    const rollos = counts.reduce((s, c) => s + stockTotal(c), 0);
    const colores = new Set(
      filas.filter((f) => stockTotal(draft[f.materialId] ?? CERO) > 0).map(claveDeColor),
    ).size;
    const mes = etiquetaMes(month);
    const ok = await confirm({
      title: `¿Cerrar ${mes}?`,
      description: `Vas a cerrar ${mes} con ${rollos} rollo(s) en ${colores} color(es). Lo que dejaste vacío queda en 0. Después solo se corrige reabriendo el mes.`,
      confirmLabel: 'Guardar y cerrar',
    });
    if (!ok) return;
    cerrar.mutate(
      { month, counts },
      {
        onSuccess: () => {
          borrarBorrador(claveBorrador);
          notify.success(`Stock de ${mes} cerrado`);
        },
        // El borrador NO se borra: si el cierre falla, lo escrito sigue ahí.
        onError: (e) => notify.error('No se pudo cerrar el mes', apiErrorMessage(e)),
      },
    );
  };

  const reabrirMes = async () => {
    const mes = etiquetaMes(month);
    const ok = await confirm({
      title: `¿Reabrir ${mes}?`,
      description: `Vas a reabrir ${mes} para corregirlo. Mientras esté abierto no cuenta para el resumen ni la reposición.`,
      confirmLabel: 'Reabrir',
    });
    if (!ok) return;
    reabrir.mutate(month, {
      onSuccess: () => notify.success(`${mes} reabierto`),
      onError: (e) => notify.error('No se pudo reabrir el mes', apiErrorMessage(e)),
    });
  };

  const pendientes = filas.filter((f) => f.needsBrandCheck);
  const urgentes = resumen?.restock.filter((g) => g.status !== 'SUGGEST').length ?? 0;
  const sugeridos = resumen?.restock.filter((g) => g.status === 'SUGGEST').length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <MonthPicker month={month} onChange={setMonth} />
          <p className="text-sm text-muted-foreground">
            El último día del mes contá los rollos, llená las casillas y cerrá el mes.
          </p>
        </div>

        {estado &&
          (cerrado ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge variant="outline" className="gap-1 border-success/50 text-success">
                <Lock className="h-3 w-3" aria-hidden />
                Cerrado el {fechaNegocio(estado.closedAt as string)}
              </Badge>
              {estado.reopenedAt && (
                <span className="text-xs text-muted-foreground">
                  reabierto el {fechaNegocio(estado.reopenedAt)}
                </span>
              )}
              <Button size="sm" variant="outline" onClick={reabrirMes} disabled={reabrir.isPending}>
                <LockOpen className="h-4 w-4" /> Reabrir mes
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="accent"
                onClick={cerrarMes}
                disabled={!estado.canClose || cerrar.isPending || isLoading}
              >
                <Lock className="h-4 w-4" /> Guardar y cerrar {etiquetaMes(month)}
              </Button>
              {!estado.canClose && (
                <p className="text-xs text-muted-foreground">
                  Se puede cerrar desde el {diaLargo(estado.closableFrom)}.
                </p>
              )}
            </div>
          ))}
      </div>

      {cerrado && resumen ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Rollos en total" value={String(resumen.totalRolls)} />
            <Metric
              label="Por acabarse"
              value={String(resumen.running)}
              tone={resumen.running > 0 ? 'warn' : undefined}
            />
            <Metric
              label="Consumidos en el mes"
              value={resumen.consumption == null ? 'Sin dato' : String(resumen.consumption)}
              hint={
                resumen.consumption == null
                  ? `Falta cerrar ${etiquetaMes(previousMonth(month))}`
                  : `Se compraron ${resumen.purchased}`
              }
            />
            <Metric
              label="Hay que reponer"
              value={String(urgentes)}
              hint={sugeridos > 0 ? `+ ${sugeridos} que conviene reponer` : undefined}
              tone={urgentes > 0 ? 'warn' : undefined}
            />
          </div>
          {resumen.restock.length > 0 && (
            <RestockCard grupos={resumen.restock} promedio={resumen.averagePurchased} />
          )}
        </>
      ) : (
        !isLoading && (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            Cuando cierres {etiquetaMes(month)} vas a ver el total, el consumo y la reposición.
          </p>
        )
      )}

      {pendientes.length > 0 && (
        <Card className="border-brand-blue/40">
          <CardContent className="pt-5">
            <h3 className="mb-1 flex items-center gap-2 font-display text-base font-semibold">
              <HelpCircle className="h-4 w-4 text-brand-blue-bright" />
              {pendientes.length} rollo(s) por identificar
            </h3>
            <p className="text-sm text-muted-foreground">
              Vinieron del Excel sin saber de qué marca eran. Al cerrar el mes contándolos de nuevo
              mirando el estante, el aviso se apaga solo.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pendientes.map((p) => (
                <Badge key={p.materialId} variant="outline">
                  {p.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-5">
            {grupos.map((g) => (
              <section key={g.clave}>
                <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
                  <h3 className="font-display text-sm font-semibold">{g.clave}</h3>
                  <span className="text-xs text-muted-foreground">
                    {g.total} rollo(s) · {g.filas.length} marca(s)
                  </span>
                </header>

                <div className="hidden grid-cols-[1fr_5rem_5rem_5rem_4rem] gap-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
                  <span>Marca</span>
                  <span className="text-center">Sin abrir</span>
                  <span className="text-center">En uso</span>
                  <span className="text-center">Por acabarse</span>
                  <span className="text-center">Total</span>
                </div>

                <div className="space-y-2">
                  {g.filas.map((f) => {
                    // Cerrado: lo guardado, de solo lectura. Abierto: el borrador.
                    const p = cerrado ? partesDe(f) : draft[f.materialId] ?? CERO;
                    const total = stockTotal(p);
                    return (
                      <div
                        key={f.materialId}
                        className="grid grid-cols-3 items-center gap-2 sm:grid-cols-[1fr_5rem_5rem_5rem_4rem]"
                      >
                        <div className="col-span-3 flex items-center gap-2 sm:col-span-1">
                          <span className="truncate text-sm">{f.brand ?? 'Sin marca'}</span>
                          {f.status === 'DISCONTINUED' && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              descontinuado
                            </Badge>
                          )}
                          {f.needsBrandCheck && (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-brand-blue-bright" />
                          )}
                        </div>
                        <Campo
                          etiqueta="Sin abrir"
                          value={p.sealed}
                          disabled={cerrado}
                          onChange={(n) => set(f.materialId, { sealed: n })}
                        />
                        <Campo
                          etiqueta="En uso"
                          value={p.inUse}
                          disabled={cerrado}
                          onChange={(n) => set(f.materialId, { inUse: n })}
                        />
                        <Campo
                          etiqueta="Por acabarse"
                          value={p.running}
                          disabled={cerrado}
                          onChange={(n) => set(f.materialId, { running: n })}
                        />
                        <div
                          className={cn(
                            'col-span-3 text-right text-sm font-semibold tabular-nums sm:col-span-1 sm:text-center',
                            // Rojo solo en un mes CERRADO: ahí un 0 es "no hay".
                            // Mientras se llena el borrador todavía no es un dato.
                            cerrado && total === 0 && f.status === 'ACTIVE' && 'text-destructive',
                            total > 0 && p.running > 0 && 'text-brand-yellow-ink',
                          )}
                        >
                          {total}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface Partes {
  sealed: number;
  inUse: number;
  running: number;
}

const CERO: Partes = { sealed: 0, inUse: 0, running: 0 };

const partesDe = (f: StockCountRow): Partes => ({ sealed: f.sealed, inUse: f.inUse, running: f.running });

/** Tipo + color, como las filas de la hoja. */
const claveDeColor = (f: StockCountRow) => [f.type, f.color].filter(Boolean).join(' ') || f.name;

/** El borrador del mes en este navegador. Sin almacenamiento, vive solo en memoria. */
function leerBorrador(clave: string): Record<string, Partes> | null {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as Record<string, Partes>) : null;
  } catch {
    return null;
  }
}

function guardarBorrador(clave: string, draft: Record<string, Partes>) {
  try {
    localStorage.setItem(clave, JSON.stringify(draft));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el borrador queda solo en memoria.
  }
}

function borrarBorrador(clave: string) {
  try {
    localStorage.removeItem(clave);
  } catch {
    // Idem: no hay nada que borrar.
  }
}

/** Una fecha guardada (ISO) → `'01/09/2026'`, en la zona del negocio. */
function fechaNegocio(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', {
    timeZone: BUSINESS_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** `'2026-08-31'` → `'31 de agosto'`. */
function diaLargo(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-VE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function Campo({
  etiqueta,
  value,
  disabled,
  onChange,
}: {
  etiqueta: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <NumberInput
      className="h-9 text-center"
      min={0}
      value={value}
      disabled={disabled}
      onChange={(n) => onChange(Math.max(0, Math.round(n)))}
      aria-label={etiqueta}
      placeholder="0"
    />
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            'font-display text-2xl font-bold tabular-nums',
            tone === 'warn' && 'text-brand-yellow-ink',
          )}
        >
          {value}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Las tres columnas de la lista de reposición, en el orden de urgencia. */
const COLUMNAS: {
  status: RestockGroup['status'];
  titulo: string;
  vacio: string;
  punto: string;
  texto: string;
}[] = [
  { status: 'OUT', titulo: 'Sin rollos', vacio: 'Ningún color en cero.', punto: 'bg-destructive', texto: 'text-destructive' },
  { status: 'LOW', titulo: 'Por acabarse', vacio: 'Ninguno por acabarse.', punto: 'bg-brand-yellow', texto: 'text-brand-yellow-ink' },
  { status: 'SUGGEST', titulo: 'Conviene reponer', vacio: 'Tus colores más comprados tienen repuesto.', punto: 'bg-brand-blue-bright', texto: 'text-foreground' },
];

/**
 * LISTA DE REPOSICIÓN — por tipo + color, no por marca: la marca cambia de un
 * mes a otro, el color es lo que se maneja. Cada columna va de más comprado a
 * menos, para que arriba quede lo que más se usa.
 */
function RestockCard({ grupos, promedio }: { grupos: RestockGroup[]; promedio: number }) {
  return (
    <Card className="border-brand-yellow/40">
      <CardContent className="space-y-4 pt-5">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <PackageCheck className="h-4 w-4 text-brand-yellow-ink" />
          Lista de reposición
        </h3>
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))' }}
        >
          {COLUMNAS.map((col) => {
            const items = grupos.filter((g) => g.status === col.status);
            return (
              <section key={col.status} className="space-y-2 rounded-xl border border-border/60 bg-background/30 p-3">
                <h4 className={cn('flex items-center gap-2 text-sm font-semibold', col.texto)}>
                  <span aria-hidden className={cn('h-2 w-2 rounded-full', col.punto)} />
                  {col.titulo}
                  <span className="ml-auto tabular-nums text-muted-foreground">{items.length}</span>
                </h4>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{col.vacio}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((g) => (
                      <li key={g.key} className="rounded-lg bg-card/60 px-2.5 py-1.5">
                        <div className="text-sm font-medium">{g.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {g.purchased > 0
                            ? `Compraste ${g.purchased} ${g.purchased === 1 ? 'rollo' : 'rollos'}`
                            : 'Sin compras registradas'}
                          {g.status !== 'OUT' && ` · te ${g.total === 1 ? 'queda 1' : `quedan ${g.total}`}`}
                          {g.brands.length > 0 && ` · ${g.brands.join(', ')}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Por tipo y color, con todas las marcas juntas. «Conviene reponer» son los colores que
          comprás más que el promedio ({promedio.toLocaleString('es', { maximumFractionDigits: 1 })}{' '}
          rollos por color, hasta el cierre del mes) y a los que les queda 1 rollo o menos. Los
          colores descontinuados no entran.
        </p>
      </CardContent>
    </Card>
  );
}

/** ‹ Septiembre 2026 › — el conteo es de cierre de mes, se navega de a un mes. */
function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const mover = (delta: number) => {
    const d = monthStart(month);
    d.setUTCMonth(d.getUTCMonth() + delta);
    onChange(monthKey(d));
  };
  const esFuturo = month >= monthKey(new Date());

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-background/40 p-1">
      <button
        type="button"
        onClick={() => mover(-1)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-brand-blue/15 hover:text-foreground"
        aria-label="Mes anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[9rem] text-center text-sm font-semibold first-letter:uppercase">
        {etiquetaMes(month)}
      </span>
      <button
        type="button"
        onClick={() => mover(1)}
        disabled={esFuturo}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-brand-blue/15 hover:text-foreground disabled:opacity-40"
        aria-label="Mes siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** `'2026-09'` → `'septiembre de 2026'`, leyendo el mes en UTC. */
function etiquetaMes(month: string): string {
  return monthStart(month).toLocaleDateString('es-VE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface Grupo {
  clave: string;
  filas: StockCountRow[];
  total: number;
}

/** Agrupa por tipo + color, como las filas de la hoja. */
function agruparPorColor(filas: StockCountRow[]): Grupo[] {
  const mapa = new Map<string, StockCountRow[]>();
  for (const f of filas) {
    const clave = claveDeColor(f);
    const lista = mapa.get(clave) ?? [];
    lista.push(f);
    mapa.set(clave, lista);
  }
  return [...mapa.entries()]
    .map(([clave, lista]) => ({
      clave,
      filas: lista,
      total: lista.reduce((s, f) => s + f.total, 0),
    }))
    .sort((a, b) => a.clave.localeCompare(b.clave, 'es'));
}
```

- [ ] **Step 2: Verificar tipos y lint**

Run (desde `calc3d-web/apps/web`):

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec eslint src/features/filament
```

Expected: sin errores. Si `tsc` dice que `NumberInput` no acepta `disabled`, abrir `src/components/ui.tsx`, buscar `export function NumberInput` y agregar `disabled?: boolean` a sus props pasándolo al `<Input>`; volver a correr.

---

### Task 12: Documentación

**Files:**
- Modify: `calc3d-web/CLAUDE.md`
- Modify: `calc3d-api/CLAUDE.md`

- [ ] **Step 1: `calc3d-web/CLAUDE.md`**

Reemplazar:

```
- **El guardado es al SALIR del campo (`onBlur`)**, con un borrador local: con 39
  materiales × 3 casillas, guardar en cada tecla sería un bombardeo de requests.
```

por:

```
- **El mes se CIERRA, no se guarda casilla por casilla** (2026-09-13, shared
  0.13.0). Lo escrito vive en un borrador del navegador
  (`filament:stock:draft:AAAA-MM`) hasta tocar **"Guardar y cerrar"**, que manda
  todas las fichas juntas (`POST /filament/stock/close`). Un mes cerrado queda de
  solo lectura y se corrige con **"Reabrir mes"** (con confirmación). El botón se
  habilita desde el último día del mes en hora de Venezuela (`canCloseMonth`),
  pero el límite REAL está en el servidor. Un mes abierto no muestra total,
  consumo ni reposición. Spec:
  `calc3d-api/docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`.
```

Y reemplazar el bullet que empieza con `- ⚠️ **Casillas vacías = no hay, dentro de un mes contado**` (las 8 líneas, hasta `Por eso ya no hay aviso de "X de Y colores".`) por:

```
- ⚠️ **Casillas vacías = no hay** (2026-09-13, decisión del dueño, como se lee el
  Excel): al cerrar, lo que no se marcó queda en 0. `counted` es "el mes está
  CERRADO"; un mes abierto (nunca cerrado o reabierto) es "sin dato" y su total
  no se pinta en rojo. Por eso no hay aviso de "X de Y colores".
```

- [ ] **Step 2: `calc3d-api/CLAUDE.md`**

Reemplazar:

```
    total se DERIVA con `stockTotal`) — `GET/PUT /filament/stock?month=AAAA-MM` y
    `GET /filament/summary`.
```

por:

```
    total se DERIVA con `stockTotal`) — `GET /filament/stock?month=AAAA-MM` y
    `GET /filament/summary`. Se escribe SOLO cerrando el mes (ver "Cierre mensual").
```

Reemplazar:

```
    `purchasedUpTo` en el servicio) y con 1 rollo o menos. **Casillas vacías = no
    hay** (decisión del dueño, como el Excel): si el mes tiene al menos un
    conteo, toda ficha sin marcar vale 0; solo un mes sin NINGÚN conteo es "sin
    dato" (`counted` en `GET /filament/stock` sigue la misma regla). Un color con
    todas sus fichas descontinuadas no cuenta. Tests: `restock-by-color.spec.ts`
    y el servicio.
```

por:

```
    `purchasedUpTo` en el servicio) y con 1 rollo o menos. **Casillas vacías = no
    hay** (decisión del dueño, como el Excel): en un mes cerrado, toda ficha sin
    marcar vale 0; un mes abierto es "sin dato" (`counted` en
    `GET /filament/stock` es "el mes está cerrado"). Un color con todas sus fichas
    descontinuadas no cuenta. Tests: `restock-by-color.spec.ts` y el servicio.
```

Reemplazar:

```
  - ⚠️ **Un conteo PARCIAL se lee como ceros** (desde 2026-09-13): con la regla
    "casillas vacías = no hay", `complete` es true apenas el mes tiene un conteo,
    y lo que falte por contar vale 0 rollos — igual que en la hoja. Antes se
    avisaba "X de Y"; el dueño eligió la semántica del Excel.
```

por:

```
  - **Cierre mensual del stock (2026-09-13, shared 0.13.0)** — tabla `StockMonth`
    (org + mes, `closedAt`, `reopenedAt`; un mes sin fila está abierto).
    `POST /filament/stock/close` escribe una fila por CADA ficha (lo que no vino,
    en 0) y cierra, todo en una transacción; `POST /filament/stock/reopen` reabre
    sin tocar los conteos; `GET /filament/stock/status` dice si está cerrado y
    desde cuándo se puede cerrar. `PUT /filament/stock` responde **410**.
    ⚠️ Se cierra desde el último día del mes en **hora de Venezuela**
    (`canCloseMonth`/`BUSINESS_TIME_ZONE` en shared): el servidor corre en UTC.
    Resumen, consumo y reposición solo usan meses CERRADOS (`complete` = cerrado);
    el reporte en Excel muestra el último cerrado. Guardas en las otras puertas:
    borrar una ficha con conteos en un mes cerrado → 409, e
    `import-filamento.mjs` aborta si hay meses cerrados. Regresión de seguridad:
    `filament.service.spec.ts`, `filament.controller.spec.ts`,
    `materials.service.spec.ts`. Spec:
    `docs/superpowers/specs/2026-09-13-cierre-mensual-stock-design.md`.
```

- [ ] **Step 3: Checkpoint**

Run:

```bash
cd "C:/Users/evanan-it/Desktop/Todo/mio/calculadora 3d"
grep -n "GET/PUT /filament/stock" calc3d-api/CLAUDE.md
grep -n "El guardado es al SALIR del campo" calc3d-web/CLAUDE.md
grep -n "Cierre mensual del stock" calc3d-api/CLAUDE.md
```

Expected: los dos primeros `grep` sin resultados; el tercero, una línea.

---

### Task 13: Verificación final

- [ ] **Step 1: Suites completas**

Run:

```bash
cd "C:/Users/evanan-it/Desktop/Todo/mio/calculadora 3d/calc3d-api" && pnpm test:shared
cd apps/api && pnpm exec jest src/filament src/materials && pnpm exec tsc --noEmit -p tsconfig.json && pnpm lint
cd "C:/Users/evanan-it/Desktop/Todo/mio/calculadora 3d/calc3d-web" && pnpm test:shared
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec eslint src
```

Expected: todo en verde. El total de `test:shared` es el mismo en los dos repos.

- [ ] **Step 2: Prueba en pantalla** (API en 3001 + panel en 5180, recargando la página después de desplegar: cambió la forma de las respuestas)

1. Stock del mes → **agosto 2026**: insignia "Cerrado el …", casillas deshabilitadas, tarjetas y reposición visibles.
2. **Reabrir mes** → confirmación → casillas editables con los números de agosto; tarjetas reemplazadas por el aviso.
3. Cambiar un número, **recargar la página**: el cambio sigue (borrador en el navegador).
4. **Guardar y cerrar agosto** → confirmación con rollos y colores → insignia de cerrado, reposición de vuelta.
5. Ir a **septiembre 2026**: botón deshabilitado con "Se puede cerrar desde el 30 de septiembre".
6. Materiales → intentar **borrar** una ficha contada en agosto → mensaje "Esta ficha tiene conteos en meses cerrados (agosto de 2026)…".
7. Configuración → Datos → **reporte en Excel** → hoja "Stock mensual" dice "Conteo cerrado de 2026-08".

- [ ] **Step 3: Producción (NO en este plan)**

La migración se aplica en Railway **solo con OK explícito del dueño**, con `pg_dump` antes y **la API desplegada antes que el panel**.
