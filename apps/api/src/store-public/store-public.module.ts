import { Controller, Get, Header, Module, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ProxyThrottlerGuard } from '../auth/throttler-proxy.guard';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { StorePublicService } from './store-public.service';

/**
 * Catálogo público de la tienda. **Sin `JwtAuthGuard`**: es la única superficie
 * del proyecto que responde sin sesión, y la trata como tal —
 *
 * - solo LECTURA; no hay un solo endpoint de escritura acá;
 * - rate limit por IP real (`ProxyThrottlerGuard`, honra Cloudflare);
 * - respuestas cacheables, para que el CDN absorba el grueso del tráfico;
 * - los campos salen de una lista blanca en el service, nunca de la fila cruda.
 */
@Controller('public/store')
@UseGuards(ProxyThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class StorePublicController {
  constructor(private readonly service: StorePublicService) {}

  @Get('info')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  info() {
    return this.service.info();
  }

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  categories() {
    return this.service.categories();
  }

  @Get('products')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  list(@Query('category') category?: string) {
    return this.service.list(category);
  }

  @Get('products/:slug')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  bySlug(@Param('slug') slug: string) {
    return this.service.bySlug(slug);
  }
}

@Module({
  imports: [ExchangeRatesModule],
  controllers: [StorePublicController],
  providers: [StorePublicService],
})
export class StorePublicModule {}
