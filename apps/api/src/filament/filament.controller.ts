import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { StockCountUpsertSchema, type StockCountUpsertDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FilamentService } from './filament.service';

/**
 * Los dos controles de filamento: las compras y el conteo físico del mes.
 * `month` siempre viaja como `AAAA-MM`.
 */
@Controller('filament')
@UseGuards(JwtAuthGuard)
export class FilamentController {
  constructor(private readonly service: FilamentService) {}

  @Get('purchases')
  purchases(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.purchases(user.organizationId, from, to);
  }

  @Get('stock')
  stock(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.stock(user.organizationId, month);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query('month') month: string) {
    return this.service.summary(user.organizationId, month);
  }

  @Put('stock')
  saveCount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StockCountUpsertSchema)) dto: StockCountUpsertDto,
  ) {
    return this.service.saveCount(user.organizationId, dto);
  }
}
