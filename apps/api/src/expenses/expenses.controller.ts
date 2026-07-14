import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  ExpenseWithDefinitionSchema,
  type ExpenseCreateDto,
  type ExpenseUpdateDto,
  type ExpenseWithDefinitionDto,
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
  list(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(user.organizationId, from, to);
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
