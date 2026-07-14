import { Controller, Get, Module, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { QuotesModule } from '../quotes/quotes.module';
import { ExportService } from './export.service';

@Controller('quotes/:id')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Get('pdf')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.pdf(user.organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cotizacion-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Get('csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const csv = await this.service.csv(user.organizationId, id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cotizacion-${id}.csv"`,
    });
    res.end(csv);
  }
}

@Module({
  imports: [QuotesModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
