# Quitar el SaaS — Calc3D "solo uso del dueño"

Fecha: 2026-07-15 · Repos afectados: `calc3d-api`, `calc3d-web` (la landing NO se toca).

## Objetivo

Convertir Calc3D de SaaS multi-inquilino a una app **de un solo dueño**, quitando
toda la capa comercial/administrativa, sin romper el motor de cálculo ni la operación
diaria (calculadora, pedidos, productos, contactos, campañas, finanzas).

## Decisiones tomadas

1. **Multi-tenancy:** se CONSERVA la plomería (`organizationId` en todas las tablas).
   Se fija todo a **una sola organización** sembrada. NO se arranca `organizationId`
   (sería una migración masiva de alto riesgo por poco beneficio).
2. **Login:** se MANTIENE (JWT + refresh tokens + recuperación de contraseña). Se quita
   el **registro público**.
3. **Alta del dueño:** el `seed` asegura UNA organización + usuario dueño desde
   `OWNER_EMAIL` / `OWNER_PASSWORD` (con default de desarrollo), idempotente.
4. **Se elimina:** (A) Monetización — planes/trial, `PlanGuard`, cobro manual, panel
   superadmin. (B) Registro público + equipo — signup, verificación de email,
   invitaciones/gestión de miembros. (C) Links públicos de pedidos.
5. **Landing (`calc3d-landing`):** sin cambios. Nota: su copy de "planes / Probar gratis
   14 días" quedará desalineado; se ajustará por separado si se quiere.

## Fuera de alcance

- Arrancar `organizationId` del modelo.
- Tocar el motor de cálculo, finanzas, CRM, campañas, catálogos.
- Reescribir la landing.

---

## Plan de ejecución (orden importa para no romper el build)

### Fase 1 — Backend: borrar módulos y limpiar referencias (`calc3d-api`)

**Eliminar por completo:**
- `apps/api/src/plan/` (contiene `PlanService`, `PlanGuard`, y el `APP_GUARD` global).
- `apps/api/src/billing/`.
- `apps/api/src/admin/` (módulo + `admin.service.spec.ts`).
- `apps/api/src/common/superadmin.guard.ts`.
- `apps/api/src/common/email-verified.guard.ts`.

**Editar:**
- `app.module.ts`: quitar imports y entradas de `PlanModule`, `BillingModule`,
  `AdminModule`. (El guard global se va con `PlanModule`.)
- `auth/auth.controller.ts`: quitar `register`, `verify-email`, `resend-verification`
  (+ imports). Conservar `login`, `refresh`, `logout`, `forgot-password`,
  `reset-password`, `me`. Conservar la constante `TIGHT` (la usan login/forgot/reset).
- `auth/auth.service.ts`: quitar `register()` (crea la org — su rol pasa al seed),
  `verifyEmail()`, `resendVerification()`, `sendVerification()`. Quitar `emailVerified`
  de `login`/`refresh`/`buildTokens`. Conservar el import de `MailService` (reset lo usa).
- `auth/jwt.strategy.ts` + `common/auth-user.ts`: quitar `emailVerified` e `isSuperadmin`.
- `users/users.module.ts`: quitar `EmailVerifiedGuard` y la gestión de equipo
  (`list`/`create`/`update`/`remove` + endpoints). Conservar `me`/`updateMe` (y sus
  helpers `ensureEmailFree`/`buildUserData`).
- `organizations/organizations.module.ts`: quitar `invite` y `members`. El módulo queda
  vacío → eliminarlo y su import en `app.module.ts`. (Verificar antes que el front ya no
  llame `/organization/members`.)
- `orders/orders.module.ts`: quitar `EmailVerifiedGuard`, `ensurePublicToken`,
  `getByToken`, `acceptByToken`, el endpoint `POST /:id/public-link`, la clase
  `PublicOrdersController` (y su registro) y el import `randomBytes`. Conservar
  `rateForLabel`, CRUD, pagos, `settle`, nota de entrega.
- `mail/mail.module.ts`: quitar `sendVerification()` y `sendNotice()`. Conservar
  `sendPasswordReset()`, `send()` y el modo dev.

### Fase 2 — Backend: contrato compartido (`packages/shared`)

- Eliminar `calc/plan.ts` + `calc/plan.spec.ts`; quitar su `export` de `index.ts`.
- `schemas/api.ts`: quitar `RegisterSchema/Dto`, `VerifyEmailSchema/Dto`,
  `InviteCollaboratorSchema`, y el bloque de planes/pago (`PlanTierSchema`,
  `PaymentMethodSchema`, `PaymentReportCreateSchema`, `PaymentReviewSchema`).
  Quitar `user.emailVerified` de `AuthTokensResponse` (conservar el resto).
- Subir `SHARED_VERSION` (`version.ts`) **y** el `version` de `packages/shared/package.json`
  a la par (el test `version.spec.ts` los ancla).

### Fase 3 — Backend: Prisma (migración nueva)

En `schema.prisma`, quitar:
- Enums `PlanTier`, `PaymentMethod`, `PaymentReportStatus`.
- `Organization.plan` / `trialEndsAt` / `planExpiresAt` + relación `paymentReports`.
- `User.emailVerified` / `isSuperadmin` + relación `reviewedPayments`.
- Modelo `PaymentReport` completo.
- `Order.publicToken` (elimina su índice único).

Se conservan `RefreshToken`, `AuthToken` y el enum `AuthTokenPurpose` (el valor
`EMAIL_VERIFY` queda sin emitir pero no molesta). Correr `pnpm prisma:migrate` para
generar la migración de `DROP`. **Borra datos de esas columnas** (aceptable en base personal).

### Fase 4 — Backend: seed del dueño

- Reescribir `seed.ts` para que por defecto **asegure una sola organización del dueño**
  idempotente: buscar `User` por `OWNER_EMAIL`; si no existe, crear `Organization` +
  `Settings` + `User` (OWNER) + `Membership` + tasas de protección Bs. Credenciales desde
  `OWNER_EMAIL` / `OWNER_PASSWORD` (defaults de desarrollo). Quitar `emailVerified`/plan.
- Agregar `OWNER_EMAIL` / `OWNER_PASSWORD` a `apps/api/.env.example`.

### Fase 5 — Frontend (`calc3d-web`)

- `pnpm sync:shared` (trae los contratos ya recortados) + recompilar shared.
- **Eliminar:** `pages/Admin.tsx`, `pages/Register.tsx`, `pages/VerifyEmail.tsx`,
  `pages/PublicOrder.tsx`, `features/billing/` (todo).
- **Editar:** `App.tsx` (rutas `/admin`, `/register`, `/verify-email`, `/p/orders/:token`
  + imports), `components/AppLayout.tsx` (nav "Plataforma", `PlanBanner` y
  `VerifyEmailBanner` inline + imports huérfanos `usePlan`/`api`/`Link`/`ShieldCheck`),
  `pages/Settings.tsx` (secciones "Mi plan" y "Equipo" + componentes `PlanSettings`/
  `Users`/`UserModal` + imports), `lib/api.ts` (`PUBLIC_PREFIXES`, `isAuthCall`),
  `auth/AuthContext.tsx` (quitar `register`, tipos `isSuperadmin`/`emailVerified`),
  `pages/Login.tsx` (link a registro), `pages/OrderDetail.tsx` (botón de link público +
  import `Link2`).

### Fase 6 — Verificación

- `calc3d-api`: `pnpm test:shared`, `pnpm -r build`, `pnpm -r lint`, `pnpm prisma:generate`,
  correr el seed contra una BD y confirmar login del dueño.
- `calc3d-web`: `pnpm build` (tsc + vite) sin imports huérfanos; levantar la app y
  verificar que login, calculadora, pedidos (sin link público) y Configuración (sin "Mi
  plan"/"Equipo") funcionan. Confirmar que no quedan rutas muertas (`/admin`, etc.).

## Riesgos / notas

- **Pérdida de datos** en las columnas dropeadas (plan, pagos, publicToken): esperado.
- **Orden de contrato:** los cambios de `shared` deben ir en `calc3d-api` primero, luego
  `sync:shared` en `calc3d-web`; subir versión a la par en ambos.
- **Landing desalineada** (copy de planes) — pendiente aparte, no bloquea.
- **`role` OWNER/COLLABORATOR** se conserva (un solo usuario = OWNER); no se toca.
