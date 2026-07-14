import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentReviewSchema, planStatus, type PaymentReviewDto, type PlanTierDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { SuperadminGuard } from '../common/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.module';
import { MailModule } from '../mail/mail.module';
import { MailService } from '../mail/mail.module';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
    private readonly mail: MailService,
  ) {}

  /** Reportes de pago PENDIENTES (la pantalla diaria del superadmin). */
  async pendingPayments() {
    const rows = await this.prisma.paymentReport.findMany({
      where: { status: 'PENDING' },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  /**
   * Aprueba o rechaza un reporte de pago. Idempotente: solo se puede revisar uno
   * PENDIENTE (aprobar dos veces NO duplica tiempo). Aprobar extiende el plan.
   */
  async reviewPayment(reportId: string, reviewerId: string, dto: PaymentReviewDto) {
    const report = await this.prisma.paymentReport.findUnique({
      where: { id: reportId },
      include: {
        organization: { select: { id: true, name: true, members: { include: { user: { select: { email: true } } } } } },
      },
    });
    if (!report) throw new NotFoundException('Reporte no encontrado');
    if (report.status !== 'PENDING') {
      throw new ConflictException('Ese reporte ya fue revisado');
    }

    const ownerEmail = report.organization.members[0]?.user.email;

    if (dto.action === 'approve') {
      const until = await this.plan.extend(
        report.organizationId,
        report.plan as 'TALLER' | 'PRO',
        report.months,
      );
      await this.prisma.paymentReport.update({
        where: { id: reportId },
        data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: dto.note ?? null },
      });
      if (ownerEmail) {
        await this.mail.sendNotice(
          ownerEmail,
          'Pago aprobado · Calc3D',
          `<p>Tu pago fue aprobado. Tu plan <strong>${report.plan}</strong> está activo hasta el
           <strong>${until.toLocaleDateString('es-VE')}</strong>. ¡Gracias!</p>`,
        );
      }
      return { ok: true, plan: report.plan, until: until.toISOString() };
    }

    // reject
    await this.prisma.paymentReport.update({
      where: { id: reportId },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: dto.note ?? null },
    });
    if (ownerEmail) {
      await this.mail.sendNotice(
        ownerEmail,
        'Sobre tu reporte de pago · Calc3D',
        `<p>No pudimos confirmar tu pago${dto.note ? `: ${dto.note}` : '.'} Revisa los datos y vuelve
         a reportarlo, o escríbenos.</p>`,
      );
    }
    return { ok: true };
  }

  /** Todas las organizaciones con su estado de plan (para el panel). */
  async organizations() {
    const orgs = await this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        plan: true,
        trialEndsAt: true,
        planExpiresAt: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      members: o._count.members,
      createdAt: o.createdAt,
      status: planStatus({
        plan: o.plan as PlanTierDto,
        trialEndsAt: o.trialEndsAt,
        planExpiresAt: o.planExpiresAt,
      }),
    }));
  }

  /** Métricas simples de la plataforma. */
  async metrics() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [orgs, newThisWeek, pendingPayments, approvedThisMonth] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.paymentReport.count({ where: { status: 'PENDING' } }),
      this.prisma.paymentReport.count({
        where: { status: 'APPROVED', reviewedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      }),
    ]);
    return { orgs, newThisWeek, pendingPayments, approvedThisMonth };
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperadminGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('payments/pending')
  pending() {
    return this.service.pendingPayments();
  }

  @Post('payments/:id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PaymentReviewSchema)) dto: PaymentReviewDto,
  ) {
    return this.service.reviewPayment(id, user.userId, dto);
  }

  @Get('organizations')
  organizations() {
    return this.service.organizations();
  }

  @Get('metrics')
  metrics() {
    return this.service.metrics();
  }
}

@Module({
  imports: [MailModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
