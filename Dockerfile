# Node 22: pnpm 11 (packageManager) exige Node >= 22.13. Con node:20 el build
# moría en `pnpm install` con "No such built-in module: node:sqlite".
FROM node:22-alpine AS build
# Prisma necesita OpenSSL para elegir su motor en Alpine (musl).
RUN apk add --no-cache openssl \
 && corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Lockfile congelado: el build instala exactamente las versiones probadas en local.
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @calc3d/shared build \
 && pnpm --filter @calc3d/api prisma:generate \
 && pnpm --filter @calc3d/api build

FROM node:22-alpine
RUN apk add --no-cache openssl \
 && corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
EXPOSE 3000
# Aplica las migraciones pendientes (idempotente) antes de arrancar: así cada
# deploy con cambios de schema se auto-aplica sin pasos manuales.
CMD ["sh", "-c", "pnpm --filter @calc3d/api exec prisma migrate deploy && node apps/api/dist/src/main.js"]
