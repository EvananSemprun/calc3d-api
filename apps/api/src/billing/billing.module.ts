import { Body, Controller, Get, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { PaymentReportCreateSchema, type PaymentReportCreateDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.module';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
  ) {}

  /** Estado del plan + historial de reportes de pago de la organización. */
  async status(organizationId: string) {
    const [status, reports] = await Promise.all([
      this.plan.status(organizationId),
      this.prisma.paymentReport.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      status,
      reports: reports.map((r) => ({ ...r, amount: Number(r.amount) })),
    };
  }

  /** El taller reporta un pago manual (queda PENDING hasta que el superadmin lo apruebe). */
  async report(organizationId: string, dto: PaymentReportCreateDto) {
    const report = await this.prisma.paymentReport.create({
      data: {
        organizationId,
        plan: dto.plan,
        months: dto.months,
        method: dto.method,
        reference: dto.reference,
        amount: dto.amount,
        currency: dto.currency,
        note: dto.note ?? null,
      },
    });
    return { ...report, amount: Number(report.amount) };
  }
}

@Controller('plan')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.organizationId);
  }

  @Post('report')
  report(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PaymentReportCreateSchema)) dto: PaymentReportCreateDto,
  ) {
    return this.service.report(user.organizationId, dto);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
