import { Body, Controller, Delete, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  StoreCustomRequestSchema,
  StoreOrderRequestSchema,
  StoreRequestStatusSchema,
  type StoreCustomRequestDto,
  type StoreOrderRequestDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProxyThrottlerGuard } from '../auth/throttler-proxy.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StoreRequestsService } from './store-requests.service';

/**
 * ESCRITURA pública: la única del sistema que responde sin sesión.
 *
 * El límite es mucho más duro que el del catálogo (120/min de solo lectura):
 * un pedido es un acto humano, no una ráfaga. 5 por minuto y por IP real deja
 * pasar a cualquier cliente de verdad —incluso si se equivoca y reintenta— y
 * corta el llenado automático de la bandeja.
 */
@Controller('public/store')
@UseGuards(ProxyThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class StoreRequestsPublicController {
  constructor(private readonly service: StoreRequestsService) {}

  @Post('orders')
  submitOrder(@Body(new ZodValidationPipe(StoreOrderRequestSchema)) dto: StoreOrderRequestDto) {
    return this.service.submitOrder(dto);
  }

  @Post('custom-requests')
  submitCustom(
    @Body(new ZodValidationPipe(StoreCustomRequestSchema)) dto: StoreCustomRequestDto,
  ) {
    return this.service.submitCustom(dto);
  }
}

/** Bandeja en el panel. Todo acá exige sesión y va scopeado por organización. */
@Controller('store/requests')
@UseGuards(JwtAuthGuard)
export class StoreRequestsController {
  constructor(private readonly service: StoreRequestsService) {}

  // Las rutas literales van ANTES de ':id' para que no las capture como un id.
  @Get('pending-count')
  pendingCount(@CurrentUser() user: AuthUser) {
    return this.service.pendingCount(user.organizationId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    const parsed = StoreRequestStatusSchema.safeParse(status);
    return this.service.list(user.organizationId, parsed.success ? parsed.data : undefined);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.confirm(user.organizationId, id);
  }

  @Post(':id/discard')
  discard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.discard(user.organizationId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [StoreRequestsPublicController, StoreRequestsController],
  providers: [StoreRequestsService],
})
export class StoreRequestsModule {}
