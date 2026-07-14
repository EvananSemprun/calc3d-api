import { PrismaClient } from '@prisma/client';
import { RATE_LABELS } from '@calc3d/shared';
import * as bcrypt from 'bcryptjs';

/**
 * Seed. Por DEFECTO NO crea usuario/negocio demo: solo asegura (idempotente) las
 * tasas de protección en las organizaciones existentes. Esto evita reintroducir el
 * demo tras haberlo eliminado (foco actual = plataforma para el dueño, no SaaS).
 *
 * Para (re)crear el negocio de demostración (fresco, catálogo del llavero, usuario
 * demo@calc3d.dev / demo1234) hay que pedirlo explícitamente:
 *   SEED_DEMO=1 pnpm seed
 */
const prisma = new PrismaClient();

/**
 * Tasas de protección sembradas por defecto (Bs por 1 USD). Son MANUAL: el dueño
 * las pone/actualiza a mano en Config → Moneda; NO se traen por integración. Los
 * valores son PLACEHOLDER realistas — se editan a mano. La de Binance/USDT es la
 * referencia por defecto para proteger el margen al cobrar en bolívares.
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

/** Comportamiento por defecto: asegurar tasas de protección en las orgs existentes. */
async function ensureRatesForAllOrgs() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      'Sin organizaciones. Registra una cuenta en la app; el seed no crea usuarios demo.\n' +
        '(Para el negocio de demostración: SEED_DEMO=1 pnpm seed)',
    );
    return;
  }
  for (const o of orgs) await ensureProtectionRates(o.id);
  // eslint-disable-next-line no-console
  console.log(
    `Tasas de protección aseguradas en ${orgs.length} organización(es). ` +
      'El demo NO se crea por defecto (usa SEED_DEMO=1 si lo necesitas).',
  );
}

/**
 * Negocio de demostración (solo con SEED_DEMO=1): catálogo del caso del llavero.
 * Usuario: demo@calc3d.dev / demo1234. Idempotente: si el demo ya existe, solo
 * asegura sus tasas de protección.
 */
async function seedDemoBusiness() {
  const email = 'demo@calc3d.dev';
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });

  if (existing) {
    const orgId = existing.memberships[0]?.organizationId;
    if (orgId) await ensureProtectionRates(orgId);
    // eslint-disable-next-line no-console
    console.log('El usuario demo ya existe; tasas de protección aseguradas.');
    return;
  }

  const org = await prisma.organization.create({ data: { name: 'Impresiones Demo' } });
  await prisma.settings.create({ data: { organizationId: org.id, kwhPrice: 2.5 } });
  // Fuente AUTO a propósito: cuando la semilla envejezca (>12 h) el primer GET
  // la refresca solo desde el BCV; una MANUAL quedaría clavada para siempre.
  await prisma.exchangeRate.create({
    data: { organizationId: org.id, currencyCode: 'VES', rate: 667.05, source: 'AUTO' },
  });
  // Tasas de protección (manuales) para el cobro en bolívares sin perder margen.
  await ensureProtectionRates(org.id);
  await prisma.user.create({
    data: {
      email,
      name: 'Demo',
      passwordHash: await bcrypt.hash('demo1234', 10),
      emailVerified: true, // el usuario de demo entra sin el banner de verificación
      memberships: { create: { organizationId: org.id, role: 'OWNER' } },
    },
  });

  await prisma.material.create({
    data: { organizationId: org.id, name: 'PLA', type: 'PLA', rollPrice: 250, rollGrams: 1000, color: 'Negro' },
  });
  await prisma.printer.create({
    data: { organizationId: org.id, name: 'Ender 3', price: 6000, lifetimeHours: 5000, powerKw: 0.12 },
  });
  await prisma.component.create({
    data: { organizationId: org.id, name: 'Argolla llavero', packagePrice: 50, unitsPerPackage: 100, scope: 'PER_PIECE' },
  });
  await prisma.component.create({
    data: { organizationId: org.id, name: 'Bolsita', packagePrice: 30, unitsPerPackage: 100, scope: 'PER_PIECE' },
  });

  // eslint-disable-next-line no-console
  console.log('Seed demo listo. Login: demo@calc3d.dev / demo1234');
}

async function main() {
  const wantDemo = process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true';
  if (wantDemo) {
    await seedDemoBusiness();
  } else {
    await ensureRatesForAllOrgs();
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
