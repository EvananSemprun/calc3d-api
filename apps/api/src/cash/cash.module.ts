import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  CashReconciliationConfirmSchema,
  CashReconciliationUpsertSchema,
  OwnerMovementCreateSchema,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
  type OwnerMovementCreateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CashService } from './cash.service';

@UseGuards(JwtAuthGuard)
@Controller('cash')
export class CashController {
  constructor(private service: CashService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.service.summary(user.organizationId);
  }

  @Post('movements')
  addMovement(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OwnerMovementCreateSchema)) dto: OwnerMovementCreateDto,
  ) {
    return this.service.addMovement(user.organizationId, dto);
  }

  @Delete('movements/:id')
  removeMovement(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeMovement(user.organizationId, id);
  }

  @Put('reconciliations')
  saveReconciliation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CashReconciliationUpsertSchema)) dto: CashReconciliationUpsertDto,
  ) {
    return this.service.saveReconciliation(user.organizationId, dto);
  }

  @Post('reconciliations/:id/confirm')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CashReconciliationConfirmSchema)) dto: CashReconciliationConfirmDto,
  ) {
    return this.service.confirm(user.organizationId, id, dto, user.userId);
  }

  @Post('reconciliations/:id/void')
  voidReconciliation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.voidReconciliation(user.organizationId, id);
  }
}

@Module({
  controllers: [CashController],
  providers: [CashService],
  exports: [CashService],
})
export class CashModule {}

// Se re-exporta para que quienes importan `CashService` desde este archivo
// (p. ej. `reports.module.ts`) sigan funcionando.
export { CashService } from './cash.service';
