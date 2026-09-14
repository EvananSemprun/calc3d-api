import {
  Body,
  Controller,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  MonthSchema,
  StockMonthCloseSchema,
  StockMonthReopenSchema,
  type StockMonthCloseDto,
  type StockMonthReopenDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FilamentService } from './filament.service';

/**
 * Los dos controles de filamento: las compras y el conteo físico del mes.
 * `month` siempre viaja como `AAAA-MM`. El conteo se escribe SOLO cerrando el mes.
 */
@Controller('filament')
@UseGuards(JwtAuthGuard)
export class FilamentController {
  constructor(private readonly service: FilamentService) {}

  @Get('purchases')
  purchases(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.purchases(user.organizationId, from, to);
  }

  @Get('stock/status')
  status(@CurrentUser() user: AuthUser, @Query('month', new ZodValidationPipe(MonthSchema)) month: string) {
    return this.service.monthStatus(user.organizationId, month);
  }

  @Get('stock')
  stock(@CurrentUser() user: AuthUser, @Query('month', new ZodValidationPipe(MonthSchema)) month: string) {
    return this.service.stock(user.organizationId, month);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('month', new ZodValidationPipe(MonthSchema)) month: string) {
    return this.service.summary(user.organizationId, month);
  }

  @Post('stock/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StockMonthCloseSchema)) dto: StockMonthCloseDto,
  ) {
    return this.service.closeMonth(user.organizationId, dto);
  }

  @Post('stock/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StockMonthReopenSchema)) dto: StockMonthReopenDto,
  ) {
    return this.service.reopenMonth(user.organizationId, dto);
  }

  /**
   * Ya no guarda (cierre mensual, 2026-09-13). La ruta queda para que un panel
   * viejo, durante el despliegue, reciba un mensaje claro en vez de un 404.
   */
  @Put('stock')
  saveCount(): never {
    throw new GoneException('El conteo se guarda cerrando el mes.');
  }
}
