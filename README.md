# Calc3D — API

> Backend de **Calc3D**: calculadora de precios y gestión integral para talleres de impresión 3D.

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)

Calc3D calcula el **precio real** de cada impresión 3D — material, desgaste de
máquina, electricidad, insumos, mano de obra, merma y tramos de mayoreo — y
administra el negocio completo: presupuestos con versionado, pedidos con abonos
y nota de entrega en PDF, catálogo de productos con alerta de rentabilidad,
finanzas, directorio de contactos y campañas de publicidad con ROI. Todo con
base de costeo en **USD** y presentación **multi-moneda** (bolívares con tasas
con nombre: BCV, paralelo, etc.).

> **App de un solo dueño (self-hosted).** Hay autenticación (JWT + refresh
> tokens rotatorios + recuperación de contraseña), pero **no hay registro
> público**: la cuenta del dueño se crea con el seed.

## Stack

- **[NestJS 10](https://nestjs.com/)** — API REST con prefijo global `/api`.
- **[Prisma 6](https://www.prisma.io/) + PostgreSQL** — datos y migraciones.
- **[Zod](https://zod.dev/)** — contratos compartidos front ↔ back.
- **[decimal.js](https://mikemcl.github.io/decimal.js/)** — motor de cálculo puro, sin errores de coma flotante.
- **pnpm workspaces** — `apps/api` + `packages/shared`.

## Estructura

| Ruta | Qué es |
|---|---|
| `apps/api` | Aplicación NestJS (módulos: auth, calc, quotes, orders, products, sales, expenses, clients, campaigns, catálogos, exchange-rates, backup…) |
| `packages/shared` | **Copia canónica** del motor de cálculo + schemas Zod. Se sincroniza hacia [calc3d-web](https://github.com/EvananSemprun/calc3d-web) con `pnpm sync:shared` (allá). |

## Requisitos

- Node.js ≥ 20
- pnpm (`npm install -g pnpm`)
- PostgreSQL accesible

## Puesta en marcha

```bash
pnpm install                              # compila shared en el postinstall
cp apps/api/.env.example apps/api/.env    # editar DATABASE_URL, JWT_SECRET…
pnpm prisma:generate
pnpm prisma:migrate                       # aplica las migraciones
pnpm seed                                 # crea la cuenta del dueño (idempotente)
pnpm dev                                  # NestJS en watch (http://localhost:<PORT>/api)
```

El seed crea **una organización + el usuario dueño** a partir de las variables
de entorno (o sus defaults de desarrollo). Con `SEED_DEMO=1 pnpm seed` siembra
además un catálogo de ejemplo para probar la calculadora.

## Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL | — (requerida) |
| `JWT_SECRET` | Secreto para firmar los JWT | `dev-secret` (¡cambiar!) |
| `JWT_EXPIRES_IN` | Vida del access token | `7d` |
| `PORT` | Puerto HTTP | `3000` |
| `WEB_ORIGIN` | Origen permitido para CORS (frontend) | `http://localhost:5173` |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | Credenciales del dueño para el seed | `dueno@calc3d.local` / `calc3d1234` |
| `OWNER_NAME` / `ORG_NAME` | Nombre del dueño / del negocio (seed) | `Dueño` / `Mi negocio` |
| `RESEND_API_KEY` / `MAIL_FROM` / `APP_URL` | Correo para el reset de contraseña. Sin API key funciona en **modo dev**: el enlace sale en el log | — |
| `TRUST_PROXY` | Detrás de proxy/CDN: habilita la IP real para el rate limiting | — |

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API en modo watch |
| `pnpm build` / `pnpm start` | Build de producción / arrancar el build |
| `pnpm test:shared` | Tests del motor de cálculo (**los más importantes**) |
| `pnpm -r test` / `pnpm -r lint` | Tests y lint de todo el workspace |
| `pnpm prisma:generate` / `pnpm prisma:migrate` | Cliente y migraciones de Prisma |
| `pnpm seed` | Asegura la cuenta del dueño + tasas de protección (Bs) |

## El paquete `shared`

`packages/shared` (motor de cálculo + contratos Zod) vive **duplicado**: este
repo es la **fuente de verdad** y `calc3d-web` mantiene una copia sincronizada.
Reglas para no divergir:

1. El motor/contratos se editan **siempre aquí**.
2. En `calc3d-web`: `pnpm sync:shared` + `pnpm test:shared`.
3. `SHARED_VERSION` (en `src/version.ts`) y el `version` del `package.json` de
   shared se suben **a la par en ambos repos** (un test lo ancla).

Convenciones del motor: porcentajes como **fracción** (0.3 = 30 %), costos "por
lote" vs "por pieza", mayoreo siempre como **markup**, base de costeo **USD**
(la multi-moneda es capa de presentación; el motor no convierte).

## Deploy

`Dockerfile` multi-stage incluido. Necesita PostgreSQL accesible vía
`DATABASE_URL`; aplicar migraciones con `prisma migrate deploy` y correr el
seed una vez para crear la cuenta del dueño.

## Ecosistema Calc3D

| Repo | Qué es |
|---|---|
| **calc3d-api** (este) | Backend + motor de cálculo canónico |
| [calc3d-web](https://github.com/EvananSemprun/calc3d-web) | Panel web (React + Vite) |
| [calc3d-landing](https://github.com/EvananSemprun/calc3d-landing) | Sitio público / tienda de Banano Lab (Vite, sin React). ⚠️ El nombre dice "landing" por historia git |
