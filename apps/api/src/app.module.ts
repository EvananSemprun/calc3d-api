import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { MaterialsModule } from './materials/materials.module';
import { FilamentModule } from './filament/filament.module';
import { PrintersModule } from './printers/printers.module';
import { ComponentsModule } from './components/components.module';
import { CatalogOptionsModule } from './catalog-options/catalog-options.module';
import { ClientsModule } from './clients/clients.module';
import { ProvidersModule } from './providers/providers.module';
import { CalcModule } from './calc/calc.module';
import { ExportModule } from './export/export.module';
import { SalesModule } from './sales/sales.module';
import { ExpensesModule } from './expenses/expenses.module';
import { OrdersModule } from './orders/orders.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { BackupModule } from './backup/backup.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ReportsModule } from './reports/reports.module';
import { LoansModule } from './loans/loans.module';
import { GoalsModule } from './goals/goals.module';
import { StorageModule } from './storage/storage.module';
import { StoreModule } from './store/store.module';
import { StoreRequestsModule } from './store-requests/store-requests.module';
import { StorePublicModule } from './store-public/store-public.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    ExchangeRatesModule,
    MaterialsModule,
    FilamentModule,
    PrintersModule,
    ComponentsModule,
    CatalogOptionsModule,
    ClientsModule,
    ProvidersModule,
    CalcModule,
    ExportModule,
    SalesModule,
    ExpensesModule,
    OrdersModule,
    OnboardingModule,
    BackupModule,
    CampaignsModule,
    LoansModule,
    GoalsModule,
    ReportsModule,
    StorageModule,
    StoreModule,
    // Catálogo público: SIN sesión. Va último para dejar claro que es la única
    // superficie abierta de la API (ver store-public.module.ts).
    StorePublicModule,
    StoreRequestsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
