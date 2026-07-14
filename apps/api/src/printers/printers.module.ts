import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrinterSchema, type PrinterDto } from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrintersService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.printer.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } });
  }

  create(organizationId: string, dto: PrinterDto) {
    return this.prisma.printer.create({ data: { ...dto, organizationId } });
  }

  async update(organizationId: string, id: string, dto: Partial<PrinterDto>) {
    await this.ensureOwned(organizationId, id);
    return this.prisma.printer.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.ensureOwned(organizationId, id);
    await this.prisma.printer.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureOwned(organizationId: string, id: string) {
    const found = await this.prisma.printer.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Impresora no encontrada');
  }
}

@Controller('printers')
@UseGuards(JwtAuthGuard)
export class PrintersController {
  constructor(private readonly service: PrintersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(PrinterSchema)) dto: PrinterDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PrinterSchema.partial())) dto: Partial<PrinterDto>,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}

@Module({
  controllers: [PrintersController],
  providers: [PrintersService],
})
export class PrintersModule {}
