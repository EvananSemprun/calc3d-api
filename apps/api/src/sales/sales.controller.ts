import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  RangoQuerySchema,
  SaleCreateSchema,
  SaleUpdateSchema,
  type RangoQueryDto,
  type SaleCreateDto,
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

  /**
   * ⚠️ El rango va con DTO y pipe: `@Query('from') from?: string` dejaba
   * pasar un dia inventado, y `new Date('2026-02-30')` lo corre al 2 de marzo.
   * La lista salia mal filtrada SIN avisar. Ver `RangoQuerySchema`.
   */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RangoQuerySchema)) q: RangoQueryDto,
  ) {
    return this.service.list(user.organizationId, q.from ?? undefined, q.to ?? undefined);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(SaleCreateSchema)) dto: SaleCreateDto) {
    return this.service.create(user.organizationId, dto);
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
