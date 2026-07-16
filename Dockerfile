FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm --filter @calc3d/shared build \
 && pnpm --filter @calc3d/api prisma:generate \
 && pnpm --filter @calc3d/api build

FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
EXPOSE 3000
# Aplica las migraciones pendientes (idempotente) antes de arrancar: así cada
# deploy con cambios de schema se auto-aplica sin pasos manuales.
CMD ["sh", "-c", "pnpm --filter @calc3d/api exec prisma migrate deploy && node apps/api/dist/src/main.js"]
