import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  MaterialCorrectionSchema,
  MaterialStatusUpdateSchema,
  type MaterialCorrectionDto,
  type MaterialStatusUpdateDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MaterialsService } from './materials.service';

/**
 * Fichas de material. Desde 2026-09-14 NO hay alta suelta (`POST`): una ficha
 * nace de una compra en Gastos (`POST /expenses/with-definition`), que es la que
 * fija el precio del rollo.
 */
@Controller('materials')
@UseGuards(JwtAuthGuard)
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  /** Corregir tipeos: solo nombre y color. El precio no se toca a mano. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MaterialCorrectionSchema)) dto: MaterialCorrectionDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  /** Descontinuar o reactivar. Aparte del PATCH de la ficha: corregirla no cambia el estado. */
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MaterialStatusUpdateSchema)) dto: MaterialStatusUpdateDto,
  ) {
    return this.service.setStatus(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}
