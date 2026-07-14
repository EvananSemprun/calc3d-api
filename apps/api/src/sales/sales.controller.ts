import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  SaleCreateSchema,
  SaleFromQuoteSchema,
  SaleUpdateSchema,
  type SaleCreateDto,
  type SaleFromQuoteDto,
  type SaleUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(user.organizationId, from, to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SaleCreateSchema)) dto: SaleCreateDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Post('from-quote')
  fromQuote(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SaleFromQuoteSchema)) dto: SaleFromQuoteDto,
  ) {
    return this.service.fromQuote(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaleUpdateSchema)) dto: SaleUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}
