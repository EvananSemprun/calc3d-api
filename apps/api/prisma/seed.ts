import 'dotenv/config'; // carga apps/api/.env (DATABASE_URL) al correr con ts-node
import { PrismaClient } from '@prisma/client';
import { RATE_LABELS } from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';

/**
 * Seed para la app de "un solo dueño". Por DEFECTO asegura (idempotente) UNA
 * organización con su usuario dueño y las tasas de protección en bolívares. Como ya
 * no existe el registro público, el seed es la ÚNICA vía de crear la cuenta del dueño.
 *
 * Credenciales desde variables de entorno, con defaults de DESARROLLO que conviene
 * cambiar al primer login (y definir explícitamente en producción):
 *   OWNER_EMAIL     (default: dueno@calc3d.local)
 *   OWNER_PASSWORD  (default: calc3d1234)
 *   OWNER_NAME      (default: Dueño)
 *   ORG_NAME        (default: Mi negocio)
 *
 * Con SEED_DEMO=1 además siembra un catálogo de ejemplo (caso del llavero) en la
 * organización del dueño, idempotente por nombre.
 */
const prisma = new PrismaClient();

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'dueno@calc3d.local';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'calc3d1234';
const OWNER_NAME = process.env.OWNER_NAME || 'Dueño';
const ORG_NAME = process.env.ORG_NAME || 'Mi negocio';

/**
 * Tasas de protección sembradas por defecto (Bs por 1 USD). Son MANUAL: el dueño las
 * pone/actualiza a mano en Config → Moneda; NO se traen por integración. Los valores
 * son PLACEHOLDER realistas. La de Binance/USDT es la referencia por defecto para
 * proteger el margen al cobrar en bolívares.
 */
const PROTECTION_RATES: { label: string; rate: number }[] = [
  { label: RATE_LABELS.BINANCE, rate: 700 }, // paralelo (dólar real, referencia)
  { label: RATE_LABELS.BCV_USD, rate: 667 }, // oficial dólar
  { label: RATE_LABELS.BCV_EUR, rate: 685 }, // implícito por el euro BCV
];

/**
 * Siembra (idempotente por `label`) las 3 tasas de protección para una org.
 * No duplica: si ya existe una tasa con ese nombre, la deja como está.
 */
async function ensureProtectionRates(organizationId: string) {
  for (const { label, rate } of PROTECTION_RATES) {
    const existing = await prisma.exchangeRate.findFirst({
      where: { organizationId, label },
    });
    if (existing) continue;
    await prisma.exchangeRate.create({
      data: { organizationId, label, currencyCode: 'VES', rate, source: 'MANUAL' },
    });
  }
}

/**
 * Asegura la cuenta del dueño: crea la organización + settings + usuario OWNER +
 * membresía + tasas de protección si no existen. Idempotente por el correo del dueño.
 * Devuelve el id de la organización.
 */
async function ensureOwner(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    include: { memberships: { orderBy: { createdAt: 'asc' } } },
  });

  if (existing?.memberships[0]) {
    const orgId = existing.memberships[0].organizationId;
    await ensureProtectionRates(orgId);
    // eslint-disable-next-line no-console
    console.log(`Dueño ya existe (${OWNER_EMAIL}); tasas de protección aseguradas.`);
    return orgId;
  }

  const org = await prisma.organization.create({ data: { name: ORG_NAME } });
  await prisma.settings.create({ data: { organizationId: org.id } });
  await prisma.user.create({
    data: {
      email: OWNER_EMAIL,
      name: OWNER_NAME,
      passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
      memberships: { create: { organizationId: org.id, role: 'OWNER' } },
    },
  });
  await ensureProtectionRates(org.id);
  // eslint-disable-next-line no-console
  console.log(
    `Dueño creado. Login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}\n` +
      '(Cambia la contraseña al entrar; define OWNER_EMAIL/OWNER_PASSWORD para producción.)',
  );
  return org.id;
}

/**
 * Catálogo de ejemplo (caso del llavero) en la organización dada. Idempotente por
 * nombre: no duplica lo que ya exista. Se activa con SEED_DEMO=1.
 */
async function seedDemoCatalog(organizationId: string) {
  let created = 0;

  if (!(await prisma.material.findFirst({ where: { organizationId, name: 'PLA' } }))) {
    await prisma.material.create({
      data: { organizationId, name: 'PLA', type: 'PLA', rollPrice: 250, rollGrams: 1000, color: 'Negro' },
    });
    created++;
  }
  if (!(await prisma.printer.findFirst({ where: { organizationId, name: 'Ender 3' } }))) {
    await prisma.printer.create({
      data: { organizationId, name: 'Ender 3', price: 6000, lifetimeHours: 5000, powerKw: 0.12 },
    });
    created++;
  }
  for (const c of [
    { name: 'Argolla llavero', packagePrice: 50 },
    { name: 'Bolsita', packagePrice: 30 },
  ]) {
    if (await prisma.component.findFirst({ where: { organizationId, name: c.name } })) continue;
    await prisma.component.create({
      data: { organizationId, name: c.name, packagePrice: c.packagePrice, unitsPerPackage: 100, scope: 'PER_PIECE' },
    });
    created++;
  }

  // eslint-disable-next-line no-console
  console.log(created > 0 ? `Catálogo de ejemplo: ${created} ítem(s) creados.` : 'Catálogo de ejemplo ya presente.');
}

async function main() {
  const orgId = await ensureOwner();
  const wantDemo = process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true';
  if (wantDemo) await seedDemoCatalog(orgId);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
