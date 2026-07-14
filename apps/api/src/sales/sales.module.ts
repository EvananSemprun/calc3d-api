import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [ExchangeRatesModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
