import {
  CanActivate,
  ExecutionContext,
  Global,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { planStatus, type PlanTierDto } from '@calc3d/shared';
import { PrismaService } from '../prisma/prisma.service';

const TRIAL_DAYS = 14;

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fecha de fin de trial para un registro nuevo (hoy + 14 días). */
  trialDeadline(): Date {
    return new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  }

  async status(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, trialEndsAt: true, planExpiresAt: true },
    });
    if (!org) return null;
    return planStatus({
      plan: org.plan as PlanTierDto,
      trialEndsAt: org.trialEndsAt,
      planExpiresAt: org.planExpiresAt,
    });
  }

  /** true si la organización puede ESCRIBIR (plan vigente). */
  async isActive(organizationId: string): Promise<boolean> {
    const s = await this.status(organizationId);
    return !!s?.active;
  }

  /**
   * Extiende el plan tras un pago aprobado. La renovación ACUMULA sobre lo que
   * quede: base = max(hoy, vencimiento actual) + N meses. Cambia el tier al pagado.
   */
  async extend(organizationId: string, plan: 'TALLER' | 'PRO', months: number): Promise<Date> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { planExpiresAt: true },
    });
    const current = org?.planExpiresAt?.getTime() ?? 0;
    const base = new Date(Math.max(Date.now(), current));
    base.setMonth(base.getMonth() + months);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { plan, planExpiresAt: base },
    });
    return base;
  }
}

/** Métodos de solo lectura no consumen plan. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Prefijos SIEMPRE permitidos aunque el plan venza: cuenta, plan/pago, admin,
 *  export ("tus datos son tuyos") y rutas públicas. */
const WHITELIST = ['/api/auth', '/api/plan', '/api/admin', '/api/backup', '/api/public', '/api/users'];

/**
 * Guard GLOBAL que bloquea las ESCRITURAS cuando el plan venció (solo lectura).
 * Hace su propia verificación del JWT (corre antes que los guards de controlador)
 * y falla-cerrado: cualquier POST/PATCH/PUT/DELETE fuera de la whitelist con plan
 * vencido responde 402. Lectura y export nunca se bloquean.
 */
@Injectable()
export class PlanGuard implements CanActivate {
  private readonly secret: string;
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly plan: PlanService,
  ) {
    this.secret = this.config.get<string>('JWT_SECRET', 'dev-secret');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(req.method)) return true;
    const path: string = req.path ?? req.url ?? '';
    if (WHITELIST.some((p) => path.startsWith(p))) return true;

    const auth: string | undefined = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return true; // sin token → lo rechaza el JwtAuthGuard del controlador

    let payload: { organizationId?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.secret });
    } catch {
      return true; // token inválido/vencido → lo maneja el JwtAuthGuard (401)
    }
    if (!payload.organizationId) return true;

    if (!(await this.plan.isActive(payload.organizationId))) {
      throw new HttpException(
        'Tu plan venció. Renueva para seguir editando; puedes seguir viendo y exportando tus datos.',
        HttpStatus.PAYMENT_REQUIRED, // 402
      );
    }
    return true;
  }
}

@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret'),
      }),
    }),
  ],
  providers: [PlanService, { provide: APP_GUARD, useClass: PlanGuard }],
  exports: [PlanService],
})
export class PlanModule {}
