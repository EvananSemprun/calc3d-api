import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ExchangeRateSetSchema, type ExchangeRateSetDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExchangeRatesService } from './exchange-rates.service';

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard)
export class ExchangeRatesController {
  constructor(private readonly service: ExchangeRatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Put()
  setManual(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ExchangeRateSetSchema)) dto: ExchangeRateSetDto,
  ) {
    return this.service.setManual(user.organizationId, dto);
  }

  @Delete(':label')
  remove(@CurrentUser() user: AuthUser, @Param('label') label: string) {
    return this.service.remove(user.organizationId, decodeURIComponent(label));
  }

  @Post('refresh')
  refresh(@CurrentUser() user: AuthUser) {
    return this.service.refresh(user.organizationId);
  }
}
