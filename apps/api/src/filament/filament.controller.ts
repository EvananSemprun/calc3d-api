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
  RangoQuerySchema,
  StockMonthCloseSchema,
  StockMonthReopenSchema,
  type RangoQueryDto,
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
  /**
   * ⚠️ El rango va con DTO y pipe: `@Query('from') from?: string` dejaba
   * pasar un dia inventado, y `new Date('2026-02-30')` lo corre al 2 de marzo.
   * La lista salia mal filtrada SIN avisar. Ver `RangoQuerySchema`.
   */
  purchases(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RangoQuerySchema)) q: RangoQueryDto,
  ) {
    return this.service.purchases(user.organizationId, q.from ?? undefined, q.to ?? undefined);
  }

  /**
   * El precio de cada TIPO, para que la calculadora arranque en el promedio en
   * vez de obligar a elegir un color. Es DERIVADO de las compras: no hay ningún
   * promedio guardado que pueda quedar viejo.
   */
  @Get('type-prices')
  typePrices(@CurrentUser() user: AuthUser) {
    return this.service.typePrices(user.organizationId);
  }

  /**
   * El ÚLTIMO mes cerrado, para el aviso del Dashboard que recuerda contar.
   *
   * ⚠️ **El panel no puede deducirlo del estado de un mes suelto.**
   * `/stock/status?month=2026-09` dice si septiembre está cerrado, pero no
   * distingue "no lo cerró" de "este negocio todavía no cerró ningún mes", que
   * es justo el caso en el que el aviso NO tiene que aparecer (ver
   * `conteoDeStockPendiente` en shared).
   *
   * ⚠️ Devuelve `{ month: null }` y no un 404: "no hay ningún cierre" es un
   * DATO que apaga el aviso. Con un error, el panel tendría que tratar un fallo
   * de red como "no hay", que es cómo se termina avisando de más o de menos.
   */
  @Get('stock/last-closed')
  async lastClosed(@CurrentUser() user: AuthUser): Promise<{ month: string | null }> {
    return { month: await this.service.lastClosedMonth(user.organizationId) };
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
