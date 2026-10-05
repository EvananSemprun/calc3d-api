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
  CounterpartyUpsertSchema,
  OwnerMovementCreateSchema,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
  type CounterpartyUpsertDto,
  type OwnerMovementCreateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CashService } from './cash.service';
import { CounterpartiesService } from './counterparties.service';

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

/**
 * Contrapartes: quién pone plata y a quién se le debe. El ABM existe para que
 * un negocio nuevo configure la suya sin tocar SQL (la fase 1 dejó una
 * provisional, "Propietario").
 *
 * ⚠️ Si alguna vez se agrega una ruta LITERAL (tipo `@Get('activas')`), tiene
 * que ir ANTES de cualquier `:id` o Nest la toma como un id. Tropiezo que este
 * repo ya tuvo con `GET /printers/recovery` y `GET /orders/payments`.
 */
@UseGuards(JwtAuthGuard)
@Controller('counterparties')
export class CounterpartiesController {
  constructor(private service: CounterpartiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CounterpartyUpsertSchema)) dto: CounterpartyUpsertDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CounterpartyUpsertSchema)) dto: CounterpartyUpsertDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Post(':id/default')
  setDefault(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setDefault(user.organizationId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [CashController, CounterpartiesController],
  providers: [CashService, CounterpartiesService],
  exports: [CashService, CounterpartiesService],
})
export class CashModule {}

// Se re-exporta para que quienes importan `CashService` desde este archivo
// (p. ej. `reports.module.ts`) sigan funcionando.
export { CashService } from './cash.service';
export { CounterpartiesService } from './counterparties.service';
