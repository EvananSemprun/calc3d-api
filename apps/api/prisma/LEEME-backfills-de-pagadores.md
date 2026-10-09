# Los dos backfills de pagadores (borrados el 2026-10-10)

`backfill-caja.mjs` y `backfill-pagadores.mjs` **ya corrieron en producción** y
**no se pueden volver a correr**: leían la columna `paidBy`, que la migración
`20261010100000_adios_paidby` borró.

| Script | Qué hizo | Cuándo corrió en producción |
|---|---|---|
| `backfill-caja.mjs` | Creó las contrapartes y la cuenta compartida, y reconstruyó por FIFO los `DebtApplication` del histórico. | 2026-10-07 |
| `backfill-pagadores.mjs` | Tradujo el enum `paidBy` a `counterpartyId` en gastos, cuotas y préstamos. | 2026-10-09 |

Se borran y no se "arreglan" a propósito: un script de un solo uso que ya no
compila contra el esquema es una trampa — alguien lo encuentra, lo corre y se
lleva una sorpresa. El código vive en el historial:

```
git show 6e5db81:apps/api/prisma/backfill-pagadores.mjs
git show 6e5db81:apps/api/prisma/backfill-caja.mjs
```

⚠️ **Si alguna vez hay que montar la base desde cero**, el camino NO es estos
scripts: es restaurar un `pg_dump` posterior al 2026-10-09, que ya trae las
contrapartes puestas.
