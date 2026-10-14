# Tienda Banano Lab — Hito B: Banners administrables — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ejecución inline Native, elegida por el dueño) para implementar tarea por tarea. Pasos con checkbox (`- [ ]`).

**Goal:** Que el carrusel de la home deje de usar banners fijos y pase a mostrar banners que el dueño administra desde el panel (crear, editar, ordenar, publicar/ocultar, con imagen y destino opcional).

**Architecture:** Nuevo modelo `StoreBanner` en `calc3d-api` (Prisma) con imagen en **R2** (se guarda la clave, como `StoreImage`). CRUD admin en el módulo `store` (NestJS, `@Controller('store')` ya protegido con `JwtAuthGuard`), subida de imagen con el **flujo de URL firmada de 2 pasos** que ya usan las fotos de ficha. Endpoint público `GET /public/store/banners` con lista blanca de campos. Contratos Zod en `packages/shared`. El panel (`calc3d-web`) agrega una pantalla de banners (axios + TanStack Query + UI propia). La landing consume el endpoint público y cae a los banners fijos si no hay ninguno o la API falla.

**Tech Stack:** NestJS 10, Prisma (PostgreSQL), Zod (shared), `@aws-sdk/client-s3` (R2), Jest (api), React + Vite + TanStack Query v5 + axios + Tailwind/Radix + sonner (web), vitest (web). Landing: Vite + JS de navegador.

**Spec:** `docs/superpowers/specs/2026-10-12-tienda-rediseno-banano-design.md` (Hito B; §5, §6.1, §6.2, §7, §8, §10).

## Global Constraints

- **La organización SIEMPRE sale del servidor**, nunca de un parámetro del cliente: admin → `@CurrentUser() user.organizationId`; público → `STORE_ORGANIZATION_ID` del entorno.
- **El endpoint público NUNCA devuelve** id, clave de R2, `organizationId` ni campos internos: lista blanca armada a mano en el service (como `store-public.service.ts`). Devuelve solo banners `visible: true`, ordenados por `position asc`.
- **La imagen va a R2** con el flujo de 2 pasos: `POST .../upload-url` (URL firmada) → el cliente hace `PUT` directo al bucket con `fetch` crudo (NUNCA axios, mandaría el Bearer y rompe la firma) → el servidor confirma verificando con `head()` el **prefijo** `{organizationId}/store/banners/`, el **MIME** (`STORE_IMAGE_MIME_TYPES`) y el **tamaño** (`STORE_IMAGE_MAX_BYTES`). En fallo de tipo/tamaño se borra el objeto.
- **URL de banner solo http/https** con protocolo escrito (un `javascript:` no puede terminar en un href). Validado en el schema Zod.
- **El destino de tipo CATEGORY/PRODUCT se valida contra la organización** (el slug debe existir en la org; PRODUCT además `visible`). Es el IDOR a cerrar.
- **shared es canónico en `calc3d-api`**: editar ahí, subir `SHARED_VERSION` (en `version.ts`) **y** el `version` de `package.json` **a la par** (0.52.0 → **0.53.0**), recompilar (`pnpm --filter @calc3d/shared build`). En `calc3d-web` traer con `pnpm sync:shared` + rebuild. **Cambia la forma de una respuesta pública nueva, no una existente**, pero igual: API primero, panel después.
- **NO hay sistema de permisos ni de auditoría** en calc3d-api (confirmado): los endpoints admin usan el `JwtAuthGuard` de clase del `StoreController`, igual que productos/categorías. **Se omite la auditoría** que el spec tomó del repo de referencia (mayorista) — esa infra no existe acá y construirla es otro proyecto. (Ruling registrado.)
- **Migración aditiva y autosuficiente** (tabla + enum nuevos): `migrate dev` SOLO contra la base local; producción se migra sola al pushear. No se pushea nada en este hito salvo pedido.
- **Errores y textos en español.** Decimal no aplica (banner no tiene montos).
- **Git**: commit por tarea en `main` de cada repo; **nunca push** salvo pedido. Al terminar cada tarea, dar la lista de lo que falta.

## Review Focus

1. **IDOR del destino**: un banner con `linkType: CATEGORY`/`PRODUCT` cuyo `linkValue` es un slug de OTRA organización debe rechazarse (no crear/guardar apuntando a algo ajeno). (Tarea 3.)
2. **URL maliciosa**: `linkType: URL` con `javascript:…` u otro protocolo → rechazado por el schema. (Tarea 1 schema, Tarea 3 integración.)
3. **Imagen de otra org o inexistente**: una `imageKey` cuyo prefijo no es `{org}/store/banners/`, o que no existe en el bucket, o con MIME/tamaño inválido → rechazada; el objeto inválido se borra. (Tarea 3.)
4. **Fuga de datos en el público**: `GET /public/store/banners` no devuelve id, clave, organizationId ni banners ocultos. (Tarea 4.)
5. **Landing con la API caída o sin banners**: el carrusel cae a los banners fijos existentes, sin quedar vacío ni romper la home. (Tarea 7.)

---

## Task 1: Contratos de banner en `shared` + bump de versión

**Files (en `calc3d-api`):**
- Modify: `packages/shared/src/schemas/store.ts` (agregar schemas de banner)
- Modify: `packages/shared/src/version.ts` (0.52.0 → 0.53.0)
- Modify: `packages/shared/package.json` (version → 0.53.0)
- Modify: `packages/shared/src/schemas/store.spec.ts` (tests de los schemas nuevos)

**Interfaces:**
- Produces: `StoreBannerLinkTypeSchema` (`z.enum(['NONE','CATEGORY','PRODUCT','URL'])`), `StoreBannerCreateSchema`/`StoreBannerCreateDto`, `StoreBannerUpdateSchema`/`Dto` (`.partial()`), `StoreBannerImageUploadUrlSchema` (reusa el de imagen), y `STORE_BANNER_*` constantes si hacen falta. Lo consumen las Tareas 3, 5, 6.

- [ ] **Step 1: Escribir los tests de los schemas (store.spec.ts)**

Agregar un `describe('StoreBannerCreateSchema', ...)` con casos:
```ts
import { StoreBannerCreateSchema } from './store';
// válido mínimo (NONE sin linkValue)
expect(StoreBannerCreateSchema.safeParse({ title: 'Promo', imageKey: 'org/store/banners/x.png', linkType: 'NONE' }).success).toBe(true);
// URL http válida
expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: 'k', linkType: 'URL', linkValue: 'https://wa.me/58412' }).success).toBe(true);
// URL javascript: RECHAZADA
expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: 'k', linkType: 'URL', linkValue: 'javascript:alert(1)' }).success).toBe(false);
// URL sin protocolo RECHAZADA
expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: 'k', linkType: 'URL', linkValue: 'wa.me/x' }).success).toBe(false);
// CATEGORY sin linkValue RECHAZADA
expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: 'k', linkType: 'CATEGORY' }).success).toBe(false);
// NONE con linkValue RECHAZADA (coherencia)
expect(StoreBannerCreateSchema.safeParse({ title: 'T', imageKey: 'k', linkType: 'NONE', linkValue: 'algo' }).success).toBe(false);
// title vacío RECHAZADO
expect(StoreBannerCreateSchema.safeParse({ title: '', imageKey: 'k', linkType: 'NONE' }).success).toBe(false);
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared exec jest src/schemas/store.spec.ts -t Banner`
Expected: FAIL (`StoreBannerCreateSchema` no existe).

- [ ] **Step 3: Implementar los schemas en `store.ts`**

```ts
export const StoreBannerLinkTypeSchema = z.enum(['NONE', 'CATEGORY', 'PRODUCT', 'URL']);
export type StoreBannerLinkType = z.infer<typeof StoreBannerLinkTypeSchema>;

export const StoreBannerCreateSchema = z
  .object({
    title: z.string().min(1, 'El título es obligatorio').max(120),
    subtitle: z.string().max(200).nullable().optional(),
    imageKey: z.string().min(1, 'Falta la imagen').max(200),
    linkType: StoreBannerLinkTypeSchema.default('NONE'),
    // slug de categoría/producto, o URL http(s); vacío para NONE.
    linkValue: z.string().max(500).nullable().optional(),
    visible: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.linkType === 'NONE') {
      if (v.linkValue) ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'Un banner sin enlace no lleva destino' });
      return;
    }
    if (!v.linkValue) {
      ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'Falta el destino del banner' });
      return;
    }
    if (v.linkType === 'URL' && !/^https?:\/\//i.test(v.linkValue)) {
      ctx.addIssue({ code: 'custom', path: ['linkValue'], message: 'El enlace tiene que empezar con http:// o https://' });
    }
  });
export type StoreBannerCreateDto = z.infer<typeof StoreBannerCreateSchema>;

export const StoreBannerUpdateSchema = StoreBannerCreateSchema;
export type StoreBannerUpdateDto = z.infer<typeof StoreBannerUpdateSchema>;
```
> Nota: `.partial()` no funciona sobre un schema con `.superRefine` (ZodEffects no tiene `.partial`). El Update exige el objeto completo (el panel siempre manda todos los campos del banner, igual que StoreProduct manda el form entero). La imagen en el update puede repetir la `imageKey` vigente si no cambió (ver Tarea 3).

Reusar `StoreImageUploadUrlSchema` y `STORE_IMAGE_MIME_TYPES`/`STORE_IMAGE_MAX_BYTES` existentes para la subida (no duplicar).

- [ ] **Step 4: Subir la versión**

En `packages/shared/src/version.ts`: `export const SHARED_VERSION = '0.53.0';`
En `packages/shared/package.json`: `"version": "0.53.0"`.

- [ ] **Step 5: Correr tests + build de shared**

Run: `cd calc3d-api && pnpm --filter @calc3d/shared exec jest src/schemas/store.spec.ts && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: todos PASS (incluido `version.spec.ts` que ancla version.ts == package.json).

- [ ] **Step 6: Commit**

```bash
cd calc3d-api && git add packages/shared && git commit -m "feat(shared): contratos de StoreBanner + bump 0.53.0"
```

---

## Task 2: Modelo `StoreBanner` + migración

**Files (en `calc3d-api`):**
- Modify: `apps/api/prisma/schema.prisma` (enum + modelo + relación en `Organization`)
- Create: `apps/api/prisma/migrations/<timestamp>_store_banners/migration.sql` (la genera Prisma)

**Interfaces:**
- Produces: tabla `StoreBanner` + enum `StoreBannerLinkType`. La consumen las Tareas 3 y 4 (Prisma client).

- [ ] **Step 1: Agregar el enum y el modelo al schema**

Cerca de los otros modelos de tienda (después de `StoreImage`/opciones, ~línea 912):
```prisma
enum StoreBannerLinkType {
  NONE
  CATEGORY
  PRODUCT
  URL
}

/// Banner del carrusel de la home. Imagen en R2 (se guarda la clave, como StoreImage).
model StoreBanner {
  id             String       @id @default(cuid())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  organizationId String

  title     String
  subtitle  String?
  imageKey  String

  /// Destino opcional, UN solo tipo por banner.
  linkType  StoreBannerLinkType @default(NONE)
  /// slug de categoría/producto, o URL http(s); null para NONE.
  linkValue String?

  position  Int      @default(0)
  visible   Boolean  @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([organizationId])
  @@index([organizationId, visible])
}
```

- [ ] **Step 2: Agregar la back-relation en `Organization`**

En `model Organization` (junto a `storeCategories StoreCategory[]`, ~línea 123):
```prisma
  storeBanners    StoreBanner[]
```

- [ ] **Step 3: Generar y aplicar la migración (base local)**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec prisma migrate dev --name store_banners`
Expected: crea `migrations/<ts>_store_banners/` y la aplica sin errores; `prisma generate` corre solo.

- [ ] **Step 4: Verificar que el cliente Prisma conoce el modelo**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec tsc --noEmit -p apps/api/tsconfig.json 2>&1 | head -5` (o un build parcial). Expected: sin errores de tipo por `prisma.storeBanner`.
(Verificación rápida alternativa: `node -e "const {PrismaClient}=require('./apps/api/node_modules/@prisma/client'); console.log(!!new PrismaClient().storeBanner)"` desde la raíz del api → `true`.)

- [ ] **Step 5: Commit**

```bash
cd calc3d-api && git add apps/api/prisma && git commit -m "feat(api): modelo StoreBanner + migracion store_banners"
```

---

## Task 3: `StoreBannersService` + endpoints admin + validación

**Files (en `calc3d-api`):**
- Create: `apps/api/src/store/store-banners.service.ts`
- Create: `apps/api/src/store/store-banners.service.spec.ts`
- Modify: `apps/api/src/store/store.module.ts` (registrar el service + endpoints en `StoreController`)

**Interfaces:**
- Consumes: `PrismaService`, `ObjectStorageService` (global), schemas de la Tarea 1, modelo de la Tarea 2.
- Produces: endpoints admin `store/banners*`. Los consume el panel (Tareas 5–6).

**Endpoints (en `StoreController`, rutas literales antes de `:id`):**
- `POST store/banners/image/upload-url` → `service.createImageUploadUrl(org, dto)` (dto = `StoreImageUploadUrlSchema`)
- `PATCH store/banners/reorder` → `service.reorder(org, dto.ids)` (dto = `StoreReorderSchema`)
- `GET  store/banners` → `service.list(org)`
- `POST store/banners` → `service.create(org, dto)` (dto = `StoreBannerCreateSchema`)
- `GET  store/banners/:id` → `service.get(org, id)`
- `PATCH store/banners/:id` → `service.update(org, id, dto)` (dto = `StoreBannerUpdateSchema`)
- `DELETE store/banners/:id` → `service.remove(org, id)`

- [ ] **Step 1: Escribir los tests del service (store-banners.service.spec.ts)**

Calcar el patrón de `store.service.spec.ts` (mocks a mano). Usar un mock de Prisma que **filtre sobre un array** por `where.organizationId` para poder escribir el test de aislamiento Y su hermano alcanzable. `ORG='org-A'`, `OTHER='org-B'`. Casos:

```ts
// --- imagen ---
// clave de otra org -> BadRequestException y storage.head NO llamado, no crea
// head devuelve null -> BadRequestException ("no llegó al almacenamiento")
// MIME application/pdf -> rechaza y storage.remove llamado
// 6 MB -> rechaza y storage.remove llamado
// caso feliz -> prisma.storeBanner.create con imageKey, position = nextPosition, title

// --- destino (IDOR / URL) ---
// linkType CATEGORY con slug inexistente en la org -> BadRequestException ("La categoría no existe")
// linkType CATEGORY con slug de OTRA org -> BadRequestException (el findFirst filtra por organizationId)
// linkType PRODUCT con slug inexistente o no visible -> BadRequestException
// (la URL javascript: ya la ataja el schema; no hace falta re-testear acá)

// --- aislamiento ---
// get(OTHER, id-de-ORG) -> NotFoundException  (hermano: get(ORG, id-de-ORG) -> devuelve)
// update/remove idem filtran por {id, organizationId}
// reorder(ORG, ['mio','ajeno']) -> solo actualiza 'mio'
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/store/store-banners.service.spec.ts`
Expected: FAIL (service no existe).

- [ ] **Step 3: Implementar `StoreBannersService`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  StoreBannerCreateDto, StoreBannerUpdateDto, StoreImageUploadUrlDto,
  STORE_IMAGE_MIME_TYPES, STORE_IMAGE_MAX_BYTES,
} from '@calc3d/shared';

const BANNER_PREFIX = 'store/banners';

@Injectable()
export class StoreBannersService {
  constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorageService) {}

  createImageUploadUrl(organizationId: string, dto: StoreImageUploadUrlDto) {
    return this.storage.createUploadUrl({ organizationId, prefix: BANNER_PREFIX, contentType: dto.contentType, contentLength: dto.contentLength });
  }

  private withUrl = <T extends { imageKey: string }>(b: T) => ({ ...b, imageUrl: this.storage.publicUrl(b.imageKey) });

  async list(organizationId: string) {
    const rows = await this.prisma.storeBanner.findMany({ where: { organizationId }, orderBy: { position: 'asc' } });
    return rows.map(this.withUrl);
  }

  async get(organizationId: string, id: string) {
    const b = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Banner no encontrado');
    return this.withUrl(b);
  }

  private async assertImage(organizationId: string, imageKey: string) {
    const prefix = `${organizationId}/${BANNER_PREFIX}/`;
    if (!imageKey.startsWith(prefix)) throw new BadRequestException('La imagen no pertenece a esta organización');
    const obj = await this.storage.head(imageKey);
    if (!obj) throw new BadRequestException('La imagen no llegó al almacenamiento');
    if (!obj.contentType || !(STORE_IMAGE_MIME_TYPES as readonly string[]).includes(obj.contentType)) {
      await this.storage.remove(imageKey);
      throw new BadRequestException('La imagen debe ser PNG, JPEG o WebP');
    }
    if ((obj.contentLength ?? 0) > STORE_IMAGE_MAX_BYTES) {
      await this.storage.remove(imageKey);
      throw new BadRequestException('La imagen no puede pesar más de 5 MB');
    }
  }

  private async assertLink(organizationId: string, dto: { linkType: string; linkValue?: string | null }) {
    if (dto.linkType === 'CATEGORY') {
      const c = await this.prisma.storeCategory.findFirst({ where: { organizationId, slug: dto.linkValue ?? '' }, select: { id: true } });
      if (!c) throw new BadRequestException('La categoría del enlace no existe');
    } else if (dto.linkType === 'PRODUCT') {
      const p = await this.prisma.storeProduct.findFirst({ where: { organizationId, slug: dto.linkValue ?? '', visible: true }, select: { id: true } });
      if (!p) throw new BadRequestException('El producto del enlace no existe o no está publicado');
    }
    // URL ya validada por el schema; NONE no tiene destino.
  }

  private async nextPosition(organizationId: string) {
    const last = await this.prisma.storeBanner.findFirst({ where: { organizationId }, orderBy: { position: 'desc' }, select: { position: true } });
    return (last?.position ?? -1) + 1;
  }

  async create(organizationId: string, dto: StoreBannerCreateDto) {
    await this.assertImage(organizationId, dto.imageKey);
    await this.assertLink(organizationId, dto);
    const row = await this.prisma.storeBanner.create({
      data: {
        organizationId, title: dto.title, subtitle: dto.subtitle ?? null, imageKey: dto.imageKey,
        linkType: dto.linkType, linkValue: dto.linkType === 'NONE' ? null : (dto.linkValue ?? null),
        visible: dto.visible, position: await this.nextPosition(organizationId),
      },
    });
    return this.withUrl(row);
  }

  async update(organizationId: string, id: string, dto: StoreBannerUpdateDto) {
    const current = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Banner no encontrado');
    if (dto.imageKey !== current.imageKey) await this.assertImage(organizationId, dto.imageKey);
    await this.assertLink(organizationId, dto);
    const row = await this.prisma.storeBanner.update({
      where: { id },
      data: {
        title: dto.title, subtitle: dto.subtitle ?? null, imageKey: dto.imageKey,
        linkType: dto.linkType, linkValue: dto.linkType === 'NONE' ? null : (dto.linkValue ?? null),
        visible: dto.visible,
      },
    });
    if (dto.imageKey !== current.imageKey) await this.storage.remove(current.imageKey);
    return this.withUrl(row);
  }

  async reorder(organizationId: string, ids: string[]) {
    const propios = await this.prisma.storeBanner.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
    const set = new Set(propios.map((b) => b.id));
    const ordenados = ids.filter((id) => set.has(id));
    await this.prisma.$transaction(ordenados.map((id, i) => this.prisma.storeBanner.update({ where: { id }, data: { position: i } })));
    return this.list(organizationId);
  }

  async remove(organizationId: string, id: string) {
    const b = await this.prisma.storeBanner.findFirst({ where: { id, organizationId } });
    if (!b) throw new NotFoundException('Banner no encontrado');
    await this.prisma.storeBanner.delete({ where: { id } });
    await this.storage.remove(b.imageKey);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Registrar en el módulo + endpoints en el controller**

En `store.module.ts`: importar `StoreBannersService`; agregarlo a `providers` del `@Module`; inyectarlo en el constructor de `StoreController` (segundo parámetro `private readonly banners: StoreBannersService`); importar `StoreBannerCreateSchema`/`StoreBannerUpdateSchema`/`StoreImageUploadUrlSchema`/`StoreReorderSchema` de `@calc3d/shared`. Agregar los 7 endpoints listados arriba, con `@UseGuards` ya heredado de la clase y `@Body(new ZodValidationPipe(...))`. Ejemplo del create:
```ts
@Post('banners')
createBanner(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(StoreBannerCreateSchema)) dto: StoreBannerCreateDto) {
  return this.banners.create(user.organizationId, dto);
}
```
Rutas literales `banners/image/upload-url` y `banners/reorder` declaradas ANTES de `banners/:id`.

- [ ] **Step 5: Correr los tests del service y verlos pasar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/store/store-banners.service.spec.ts`
Expected: PASS (todos los casos de imagen/destino/aislamiento).

- [ ] **Step 6: Build de la API (sin romper tipos)**

Run: `cd calc3d-api && pnpm --filter @calc3d/api build 2>&1 | tail -5`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
cd calc3d-api && git add apps/api/src/store && git commit -m "feat(api): CRUD admin de banners de tienda con validacion de imagen y destino"
```

---

## Task 4: Endpoint público `GET /public/store/banners`

**Files (en `calc3d-api`):**
- Modify: `apps/api/src/store-public/store-public.service.ts` (método `banners()` + tipo público)
- Modify: `apps/api/src/store-public/store-public.module.ts` (handler `GET banners`)
- Modify: `apps/api/src/store-public/store-public.service.spec.ts` (tests)

**Interfaces:**
- Consumes: modelo `StoreBanner`, `ObjectStorageService`, `STORE_ORGANIZATION_ID`.
- Produces: `GET /api/public/store/banners` → `{ banners: PublicBanner[] }`. Lo consume la landing (Tarea 7).

- [ ] **Step 1: Escribir los tests (store-public.service.spec.ts)**

```ts
// solo visibles, ordenados por position asc
// la org sale del entorno (findMany where contiene organizationId del env, visible:true)
// lista blanca: la respuesta NO contiene 'id', 'imageKey', 'organizationId', 'position'
//   (reusar el patrón clavesDe/PROHIBIDOS del archivo; agregar 'imageKey')
// la imagen viene como imageUrl (publicUrl), nunca la clave
```

- [ ] **Step 2: Correr y ver fallar**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/store-public/store-public.service.spec.ts -t banner`
Expected: FAIL (`banners` no existe).

- [ ] **Step 3: Implementar el método público**

En `store-public.service.ts`, agregar el tipo y el método (lista blanca explícita):
```ts
export interface PublicBanner {
  title: string;
  subtitle: string | null;
  imageUrl: string;
  linkType: 'NONE' | 'CATEGORY' | 'PRODUCT' | 'URL';
  linkValue: string | null;
}

async banners(): Promise<{ banners: PublicBanner[] }> {
  const rows = await this.prisma.storeBanner.findMany({
    where: { organizationId: this.organizationId, visible: true },
    orderBy: { position: 'asc' },
  });
  return {
    banners: rows.map((b) => ({
      title: b.title,
      subtitle: b.subtitle,
      imageUrl: this.storage.publicUrl(b.imageKey),
      linkType: b.linkType,
      linkValue: b.linkValue,
    })),
  };
}
```

- [ ] **Step 4: Agregar el handler público**

En `store-public.module.ts`, en `StorePublicController`:
```ts
@Get('banners')
@Header('Cache-Control', 'public, max-age=60, s-maxage=300')
banners() { return this.service.banners(); }
```

- [ ] **Step 5: Correr los tests y build**

Run: `cd calc3d-api && pnpm --filter @calc3d/api exec jest src/store-public && pnpm --filter @calc3d/api build 2>&1 | tail -3`
Expected: PASS + build OK.

- [ ] **Step 6: Verificación de humo contra la API corriendo**

Con la API en 3001: `curl -s "http://localhost:3001/api/public/store/banners" -H "Origin: http://localhost:5182"` → `{"banners":[]}` (aún no hay banners cargados; que responda 200 con el envoltorio correcto).

- [ ] **Step 7: Commit**

```bash
cd calc3d-api && git add apps/api/src/store-public && git commit -m "feat(api): endpoint publico GET /public/store/banners (lista blanca)"
```

---

## Task 5: Hooks del panel (`banners-api.ts`) + sync de shared

**Files (en `calc3d-web`):**
- Run: `pnpm sync:shared` + rebuild shared
- Create: `apps/web/src/features/store/banners-api.ts`

**Interfaces:**
- Consumes: tipos de `@calc3d/shared` (banner), `api`/`apiErrorMessage` de `lib/api`, el patrón de `features/store/api.ts`.
- Produces: `useStoreBanners`, `useStoreBanner`, `useCreateStoreBanner`, `useUpdateStoreBanner`, `useDeleteStoreBanner`, `useReorderStoreBanners`, `uploadBannerImage`. Los consume la Tarea 6.

- [ ] **Step 1: Traer shared y recompilar**

Run (en `calc3d-web`): `pnpm sync:shared && pnpm --filter @calc3d/shared build && pnpm test:shared`
Expected: copia la 0.53.0, compila, tests verdes. Verificar `packages/shared/package.json` → `0.53.0`.

- [ ] **Step 2: Escribir `banners-api.ts`**

Calcar `features/store/api.ts`. Tipo de respuesta `StoreBanner` a mano (incluye `id`, `imageUrl`, `imageKey`, `title`, `subtitle`, `linkType`, `linkValue`, `position`, `visible`). Query key `['store','banners']` (hereda `useStoreInvalidate`). Hooks:
```ts
export function useStoreBanners() {
  return useQuery({ queryKey: ['store','banners'], queryFn: async () => (await api.get<StoreBanner[]>('/store/banners')).data });
}
export function useCreateStoreBanner() {
  const invalidate = useStoreInvalidate();
  return useMutation({ mutationFn: async (dto: StoreBannerCreateDto) => (await api.post<StoreBanner>('/store/banners', dto)).data, onSuccess: invalidate });
}
// useUpdateStoreBanner(id): api.patch(`/store/banners/${id}`)
// useDeleteStoreBanner(): api.delete(`/store/banners/${id}`)
// useReorderStoreBanners(): api.patch('/store/banners/reorder',{ids}) -> setQueryData(['store','banners'], ...)
```
Subida de imagen (calcar `uploadStoreImage`, pero el banner NO existe todavía al subir → devuelve la `key`, no un banner):
```ts
export async function uploadBannerImage(file: File): Promise<{ key: string }> {
  const { data: target } = await api.post<{ key: string; url: string; headers: Record<string,string> }>(
    '/store/banners/image/upload-url', { contentType: file.type, contentLength: file.size });
  const put = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file });
  if (!put.ok) throw new Error('No se pudo subir la imagen al almacenamiento');
  return { key: target.key };
}
```

- [ ] **Step 3: Verificar tipos (build parcial)**

Run: `cd calc3d-web && pnpm --filter @calc3d/web exec tsc --noEmit 2>&1 | grep -i banner | head` → sin errores de los tipos de banner. (El build completo se corre en la Tarea 6.)

- [ ] **Step 4: Commit**

```bash
cd calc3d-web && git add packages/shared apps/web/src/features/store/banners-api.ts && git commit -m "feat(web): sync shared 0.53.0 + hooks de banners de tienda"
```

---

## Task 6: Pantalla de banners + wiring (ruta + nav) + test

**Files (en `calc3d-web`):**
- Create: `apps/web/src/pages/StoreBanners.tsx`
- Create: `apps/web/src/pages/StoreBanners.spec.tsx`
- Modify: `apps/web/src/App.tsx` (ruta `/store/banners` ANTES de `/store/:id`)
- Modify: `apps/web/src/components/AppLayout.tsx` (ítem "Banners" en el grupo Tienda + ícono lucide + `activeWhen`)

**Interfaces:**
- Consumes: hooks de la Tarea 5, `ui.tsx` (`Button/Input/Field/FieldGrid/Select/Switch/Card/EmptyState/Badge`), `notify`, `useConfirm`, `ReorderControls`, `moveItem`, `useStoreStatus`, `useStoreCategories`, `useStoreProducts`.
- Produces: la pantalla `/store/banners`.

- [ ] **Step 1: Escribir la pantalla**

Estructura calcando `Store.tsx` + `StoreProductDetail.tsx` + `StoreCategoriesModal.tsx`:
- Header con título "Banners" y botón "Nuevo banner" (abre un formulario/modal de alta).
- Aviso de almacenamiento si `!status.storageReady` (como en Store.tsx).
- Lista de banners (cards) con: miniatura (`imageUrl`), título, subtítulo, `Badge` publicado/oculto, destino legible, `ReorderControls` (ocultos con filtros; acá no hay filtros, así que siempre visibles si total≥2), y acciones Editar/Borrar (`useConfirm` con `tone:'destructive'` para borrar).
- Formulario (modal `Dialog` o panel inline) con: `Input` título, `Input` subtítulo, subida de imagen (input file oculto + botón, `accept=STORE_IMAGE_MIME_TYPES`, deshabilitado si `!storageReady`; muestra preview de la imagen subida), `Select` de **tipo de destino** (Ninguno/Categoría/Producto/URL) y, condicional:
  - CATEGORY → `Select` con `useStoreCategories()` (value = slug).
  - PRODUCT → `Select` con `useStoreProducts()` visibles (value = slug).
  - URL → `Input` (placeholder `https://…`).
  - NONE → nada.
  - `Switch` visible (Publicado/Oculto).
- Guardar: para crear, primero `uploadBannerImage(file)` → `key`, luego `create.mutateAsync({ title, subtitle, imageKey:key, linkType, linkValue, visible })`; `notify.success`/`notify.error(apiErrorMessage(e))`. Para editar, si no cambió la imagen reusar la `imageKey` existente.
- Mover: `moveItem(banners, from, to).map(b=>b.id)` → `reorder.mutateAsync(ids)`.

- [ ] **Step 2: Escribir el test de pantalla (StoreBanners.spec.tsx)**

Calcar `pages/Loans.cerrar.spec.tsx`: mockear `@/lib/api` con `vi.hoisted`, import dinámico de la página, montar con QueryClient/MemoryRouter/ConfirmProvider/TooltipProvider. Casos mínimos:
- Con 2 banners mockeados en `GET /store/banners`, se listan los dos (conteo exacto en jsdom).
- "Nuevo banner" abre el formulario con los campos (título, tipo de destino).
- Elegir tipo "URL" muestra el input de URL; elegir "Ninguno" lo oculta.
(No hace falta testear la subida real a R2; mockear `api.post` del upload-url si el flujo lo toca, o cubrir solo la UI del form.)

- [ ] **Step 3: Correr el test y verlo fallar, luego pasar**

Run: `cd calc3d-web && pnpm --filter @calc3d/web test -- --project dom StoreBanners`
Expected: primero FAIL (página no existe), luego PASS tras implementar.

- [ ] **Step 4: Cablear ruta y navegación**

- `App.tsx`: import de `StoreBannersPage` (lazy, como las otras) y `<Route path="/store/banners" element={<StoreBannersPage/>} />` ANTES de `/store/:id`.
- `AppLayout.tsx`: en el grupo "Tienda", agregar `{ to: '/store/banners', label: 'Banners', icon: GalleryHorizontalEnd }` (importar el ícono de `lucide-react`); darle al ítem "Tienda" (`/store`) un `end: true` o `activeWhen` para que no se resalte en `/store/banners`.

- [ ] **Step 5: Build completo del web + tests**

Run: `cd calc3d-web && pnpm --filter @calc3d/web build 2>&1 | tail -5 && pnpm --filter @calc3d/web test 2>&1 | tail -8`
Expected: build OK (tsc --noEmit incluido), tests verdes.

- [ ] **Step 6: Verificación en el navegador**

Con API (3001) y panel (5180) arriba, loguear como dueño, ir a `/store/banners`, crear un banner (subir una imagen, poner título, destino URL `https://wa.me/…`, publicar), confirmar que aparece en la lista y que `GET /api/public/store/banners` ya lo devuelve (curl). Probar validación: tipo URL con `javascript:...` → el backend lo rechaza (el schema), se ve el toast de error.

- [ ] **Step 7: Commit**

```bash
cd calc3d-web && git add apps/web/src && git commit -m "feat(web): pantalla de administracion de banners de tienda"
```

---

## Task 7: La landing consume los banners del panel

**Files (en `calc3d-landing`):**
- Modify: `index.html` (el script del carrusel: traer banners de la API, caer a los fijos si no hay)
- Modify: `CLAUDE.md` (nota: carrusel ya administrable — hito B hecho)

**Interfaces:**
- Consumes: `GET /api/public/store/banners` (Tarea 4), el `API` base de `app.js`.
- Produces: carrusel alimentado por el panel.

- [ ] **Step 1: Hacer que el carrusel pida los banners y reconstruya las slides**

En el `<script>` del carrusel de `index.html`, antes de inicializar, intentar traer banners y, si hay ≥1, reemplazar el contenido de `.carousel-track` por slides armadas desde los datos (escapando con una función local; resolver el `href` según `linkType`: CATEGORY→`/tienda/?cat=<linkValue>`, PRODUCT→`/producto/<linkValue>`, URL→`<linkValue>`, NONE→sin botón). Si la petición falla o `banners` está vacío, **no tocar nada**: quedan los 3 slides fijos del HTML. Usar el mismo origen de API que `app.js` (`import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'`). Reconstruir los slides ANTES de que el IIFE del carrusel lea `.carousel-slide` (o reinicializar el carrusel después de reconstruir).

Boceto:
```js
const API = (import.meta?.env?.VITE_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function hrefDe(b){ if(b.linkType==='CATEGORY') return `/tienda/?cat=${encodeURIComponent(b.linkValue)}`;
  if(b.linkType==='PRODUCT') return `/producto/${encodeURIComponent(b.linkValue)}`;
  if(b.linkType==='URL') return b.linkValue; return null; }
try {
  const r = await fetch(`${API}/public/store/banners`);
  const { banners } = await r.json();
  if (Array.isArray(banners) && banners.length) {
    const track = root.querySelector('.carousel-track');
    track.innerHTML = banners.map((b, i) => {
      const href = hrefDe(b);
      const btn = href ? `<a href="${esc(href)}" class="btn btn-primary btn-lg">Ver más</a>` : '';
      return `<article class="carousel-slide${i===0?' is-active':''}">
        <div class="container carousel-content">
          <div class="carousel-text"><h1 class="h1 text-balance">${esc(b.title)}</h1>
            ${b.subtitle?`<p class="lead">${esc(b.subtitle)}</p>`:''}${btn}</div>
          <img class="carousel-art" src="${esc(b.imageUrl)}" alt="">
        </div></article>`;
    }).join('');
  }
} catch (e) { /* se quedan los banners fijos */ }
```
⚠️ Este fetch y la reconstrucción van **dentro** del IIFE del carrusel, ANTES de calcular `slides`/`i`/`dots`, y el IIFE debe volverse `async` (o envolver la lógica en una función async que se llama al final). Mantener el fallback: si algo falla, los slides fijos del HTML siguen.

- [ ] **Step 2: Verificar los dos caminos en el navegador**

Con API arriba y **al menos un banner cargado** desde el panel (Tarea 6): recargar la home → el carrusel muestra los banners del panel (imagen + título + subtítulo + botón al destino). Clic al botón lleva al destino correcto. Con la API **caída** (o sin banners): el carrusel muestra los 3 slides fijos (sin romperse). `read_console_messages` sin errores que rompan.

- [ ] **Step 3: Actualizar el CLAUDE.md de la landing**

En la sección "El diseño", cambiar la nota del carrusel: ya NO usa banners fijos como estado final; los administra el panel (hito B hecho); los fijos quedan solo como fallback.

- [ ] **Step 4: Build + commit**

```bash
cd calc3d-landing && pnpm build && git add -A && git commit -m "feat(landing): el carrusel consume los banners del panel (fallback a fijos)"
```

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec (Hito B):** modelo StoreBanner + migración (T2) ✓; endpoint público (T4) ✓; CRUD admin + R2 + validación de destino (T3) ✓; contratos shared (T1) ✓; panel (T5, T6) ✓; landing consume (T7) ✓. **Omitido a propósito:** auditoría (no existe infra en calc3d; ruling) y "permiso" (no hay sistema de permisos; se usa JwtAuthGuard de clase).
- **Sin placeholders:** schemas, modelo, service y endpoints van con código real; la UI del panel referencia primitivas y patrones mapeados con casos de test concretos.
- **Consistencia de tipos:** `StoreBannerCreateDto`/`UpdateDto`, `imageKey`/`imageUrl`, `linkType`/`linkValue`, query key `['store','banners']`, prefijo R2 `store/banners` — coherentes entre T1/T3/T4/T5/T6/T7.
- **Review Focus:** IDOR destino (T3), URL maliciosa (T1+T3), imagen ajena/inválida (T3), fuga pública (T4), fallback landing (T7) — cada uno con su test/verificación en la tarea dueña.
- **Orden/deploy:** API (T1–T4) primero, panel (T5–T6) después (regla "forma de respuesta nueva: API primero"), landing (T7) al final. Commit por repo; sin push.
