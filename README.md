# Calc3D — API

Backend NestJS + Prisma (PostgreSQL). Contrato de cálculo en `packages/shared`
(**fuente de verdad**; `calc3d-web` sincroniza su copia desde aquí).

## Setup
    pnpm install                 # compila shared en postinstall
    cp apps/api/.env.example apps/api/.env   # y editar (DATABASE_URL, JWT_SECRET, ...)
    pnpm prisma:generate
    pnpm prisma:migrate

## Desarrollo
    pnpm dev                     # NestJS watch (puerto 3001 con el launch de Claude)
    SEED_DEMO=1 pnpm seed        # negocio demo (demo@calc3d.dev / demo1234)

## Test / build
    pnpm test:shared             # tests del motor (lo más importante)
    pnpm -r test
    pnpm build

## shared
`packages/shared` es la copia canónica. Si cambias el motor aquí, sincronízalo a
web: en `calc3d-web`, `pnpm sync:shared`. Sube `SHARED_VERSION` y `version` del
package.json juntos.

## Deploy
`Dockerfile` incluido (multi-stage). Necesita Postgres accesible vía `DATABASE_URL`.
