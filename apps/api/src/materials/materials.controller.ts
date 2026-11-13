import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  MaterialCorrectionSchema,
  MaterialStatusBatchSchema,
  MaterialStatusUpdateSchema,
  UnirFichaSchema,
  type MaterialCorrectionDto,
  type MaterialStatusBatchDto,
  type MaterialStatusUpdateDto,
  type UnirFichaDto,
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

  /**
   * Corregir la ficha: nombre, color, marca y tipo.
   *
   * ⚠️ Los **gramos del rollo** y el **precio** quedan afuera a propósito: los
   * gramos reescriben el costo por gramo de todas las compras pasadas, y el
   * precio sale SIEMPRE de la última compra.
   */
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

  /**
   * Cambiar el estado de varias fichas (descontinuar toda una marca). PATCH (no hay rutas POST: ver el test «no hay alta suelta») y ruta de
   * dos segmentos que no encajan con `:id` ni con `:id/status`.
   */
  @Patch('status/batch')
  setStatusBatch(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MaterialStatusBatchSchema)) dto: MaterialStatusBatchDto,
  ) {
    return this.service.setStatusBatch(user.organizationId, dto);
  }

  /**
   * Vista previa de unir esta ficha DENTRO de `destinoId`: qué se mueve y a qué
   * precio queda. Solo lectura.
   */
  @Get(':id/unir')
  vistaDeUnion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('destinoId') destinoId: string) {
    return this.service.vistaDeUnion(user.organizationId, id, destinoId ?? '');
  }

  /**
   * Unir esta ficha dentro de otra (`{ destinoId }`). PATCH y no POST, por lo
   * mismo que el lote: es una acción sobre fichas que ya existen, no un alta
   * (ver el test «no hay alta suelta»).
   */
  @Patch(':id/unir')
  unir(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UnirFichaSchema)) dto: UnirFichaDto,
  ) {
    return this.service.unir(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }
}
