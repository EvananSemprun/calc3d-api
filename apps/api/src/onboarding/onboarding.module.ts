import { Controller, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Plantillas de catálogo para arrancar (Fase 5 / onboarding). Precios de
 * referencia genéricos y EDITABLES — no atados a ningún taller en particular;
 * el dueño ajusta a sus costos reales. Sembrar es idempotente por NOMBRE: no
 * duplica lo que ya existe, así se puede correr varias veces sin miedo.
 */
const MATERIAL_TEMPLATES = [
  { name: 'PLA', type: 'PLA', rollPrice: 20, rollGrams: 1000, color: null as string | null },
  { name: 'PETG', type: 'PETG', rollPrice: 24, rollGrams: 1000, color: null },
  { name: 'ABS', type: 'ABS', rollPrice: 22, rollGrams: 1000, color: null },
  { name: 'TPU', type: 'TPU', rollPrice: 30, rollGrams: 1000, color: null },
];

const PRINTER_TEMPLATES = [
  { name: 'Impresora FDM (genérica)', price: 300, lifetimeHours: 5000, powerKw: 0.15, maintPerHour: 0.05 },
];

const COMPONENT_TEMPLATES = [
  { name: 'Argolla de llavero', packagePrice: 3, unitsPerPackage: 100, scope: 'PER_PIECE' },
  { name: 'Bolsa de empaque', packagePrice: 2, unitsPerPackage: 100, scope: 'PER_PIECE' },
];

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async seedTemplates(organizationId: string) {
    const [materials, printers, components] = await Promise.all([
      this.prisma.material.findMany({ where: { organizationId }, select: { name: true } }),
      this.prisma.printer.findMany({ where: { organizationId }, select: { name: true } }),
      this.prisma.component.findMany({ where: { organizationId }, select: { name: true } }),
    ]);
    const has = (arr: { name: string }[]) => new Set(arr.map((x) => x.name.trim().toLowerCase()));
    const matHas = has(materials);
    const prtHas = has(printers);
    const compHas = has(components);

    const newMats = MATERIAL_TEMPLATES.filter((m) => !matHas.has(m.name.toLowerCase()));
    const newPrts = PRINTER_TEMPLATES.filter((p) => !prtHas.has(p.name.toLowerCase()));
    const newComps = COMPONENT_TEMPLATES.filter((c) => !compHas.has(c.name.toLowerCase()));

    await this.prisma.$transaction([
      ...newMats.map((m) => this.prisma.material.create({ data: { ...m, organizationId } })),
      ...newPrts.map((p) => this.prisma.printer.create({ data: { ...p, organizationId } })),
      ...newComps.map((c) => this.prisma.component.create({ data: { ...c, organizationId } })),
    ]);

    return {
      created: { materials: newMats.length, printers: newPrts.length, components: newComps.length },
      skipped: {
        materials: MATERIAL_TEMPLATES.length - newMats.length,
        printers: PRINTER_TEMPLATES.length - newPrts.length,
        components: COMPONENT_TEMPLATES.length - newComps.length,
      },
    };
  }
}

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Post('seed-templates')
  seed(@CurrentUser() user: AuthUser) {
    return this.service.seedTemplates(user.organizationId);
  }
}

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
