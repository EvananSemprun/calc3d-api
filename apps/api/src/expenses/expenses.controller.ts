import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ExpenseCreateSchema,
  RangoQuerySchema,
  ExpenseUpdateSchema,
  ExpenseWithDefinitionSchema,
  type ExpenseCreateDto,
  type ExpenseUpdateDto,
  type ExpenseWithDefinitionDto,
  type RangoQueryDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  /**
   * ⚠️ El rango va con DTO y pipe: `@Query('from') from?: string` dejaba
   * pasar un dia inventado, y `new Date('2026-02-30')` lo corre al 2 de marzo.
   * La lista salia mal filtrada SIN avisar. Ver `RangoQuerySchema`.
   */
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RangoQuerySchema)) q: RangoQueryDto,
  ) {
    return this.service.list(user.organizationId, q.from ?? undefined, q.to ?? undefined);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ExpenseCreateSchema)) dto: ExpenseCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  @Post('with-definition')
  createWithDefinition(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ExpenseWithDefinitionSchema)) dto: ExpenseWithDefinitionDto,
  ) {
    return this.service.createWithDefinition(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ExpenseUpdateSchema)) dto: ExpenseUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}
