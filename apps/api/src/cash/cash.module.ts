import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CashAccountUpsertSchema,
  CashCategorySchema,
  CashReconciliationConfirmSchema,
  CashReconciliationUpsertSchema,
  CashShortfallPlanQuerySchema,
  CounterpartyUpsertSchema,
  OwnerMovementCreateSchema,
  type CashAccountUpsertDto,
  type CashCategoryDto,
  type CashReconciliationConfirmDto,
  type CashReconciliationUpsertDto,
  type CashShortfallPlanQueryDto,
  type CounterpartyUpsertDto,
  type OwnerMovementCreateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CashAccountsService } from './cash-accounts.service';
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

  /**
   * El detalle de una línea del saldo: de dónde sale ese número, fila por fila.
   *
   * ⚠️ La categoría se valida con el enum compartido, no se pasa cruda al
   * servicio: sin el pipe, un `:category` inventado llegaría al `.filter` y
   * devolvería un desplegable vacío con la línea en rojo arriba — un 200 que
   * se lee como "no hay movimientos" cuando en realidad la ruta está mal.
   *
   * ⚠️ Es la única ruta con parámetro de este controlador. Si alguna vez se
   * agrega un `@Get(':algo')`, tiene que ir DESPUÉS de esta o Nest se queda
   * con la suya (el mismo tropiezo de `GET /printers/recovery`).
   */
  @Get('breakdown/:category')
  breakdown(
    @CurrentUser() user: AuthUser,
    @Param('category', new ZodValidationPipe(CashCategorySchema)) category: CashCategoryDto,
  ) {
    return this.service.breakdown(user.organizationId, category);
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

  /**
   * PREVISUALIZAR el reparto del faltante contra una deuda elegida. Solo
   * lectura: no escribe nada, por eso es un GET.
   *
   * ⚠️ El reparto lo calcula el SERVIDOR, siempre. El front NO puede deducirlo
   * de `obligations` del resumen: esa lista viene sin filtro de fecha y con la
   * contraparte por defecto de la organización, mientras que confirmar filtra
   * hasta la fecha del conteo y usa la contraparte de la CUENTA. Conciliando
   * con retraso —el caso normal— el dueño aprobaría un reparto que no es el
   * que ocurre. Ya pasó en la fase 1.
   *
   * ⚠️ El `:id` va en medio de una ruta de tres segmentos, así que no compite
   * con `breakdown/:category`. Si alguna vez aparece un `@Get(':algo')` suelto,
   * tiene que ir DESPUÉS de las dos.
   */
  @Get('reconciliations/:id/plan')
  shortfallPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(CashShortfallPlanQuerySchema)) query: CashShortfallPlanQueryDto,
  ) {
    return this.service.shortfallPlan(user.organizationId, id, query);
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

/**
 * Cuentas donde vive la plata: el exchange, el banco, el efectivo.
 *
 * ⚠️ Hoy solo se concilia la PRINCIPAL (ver el comentario de
 * `CashAccountsService`): las demás se registran para la fase de multicuenta.
 *
 * ⚠️ Si alguna vez se agrega una ruta LITERAL (tipo `@Get('activas')`), tiene
 * que ir ANTES de cualquier `:id` o Nest la toma como un id.
 */
@UseGuards(JwtAuthGuard)
@Controller('cash-accounts')
export class CashAccountsController {
  constructor(private service: CashAccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CashAccountUpsertSchema)) dto: CashAccountUpsertDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CashAccountUpsertSchema)) dto: CashAccountUpsertDto,
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
  controllers: [CashController, CounterpartiesController, CashAccountsController],
  providers: [CashService, CounterpartiesService, CashAccountsService],
  exports: [CashService, CounterpartiesService, CashAccountsService],
})
export class CashModule {}

// Se re-exporta para que quienes importan `CashService` desde este archivo
// (p. ej. `reports.module.ts`) sigan funcionando.
export { CashService } from './cash.service';
export { CounterpartiesService } from './counterparties.service';
export { CashAccountsService } from './cash-accounts.service';
