import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  StoreCategorySchema,
  StoreImageConfirmSchema,
  StoreImageUploadUrlSchema,
  StoreProductCreateSchema,
  StoreProductFromSourceSchema,
  StoreProductUpdateSchema,
  StoreReorderSchema,
  type StoreCategoryDto,
  type StoreImageConfirmDto,
  type StoreImageUploadUrlDto,
  type StoreProductCreateDto,
  type StoreProductFromSourceDto,
  type StoreProductUpdateDto,
  type StoreReorderDto,
} from '@calc3d/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RecostService } from './recost.service';
import { StoreService } from './store.service';

/**
 * Administración del catálogo de tienda. TODO acá exige sesión; lo que consume
 * la tienda pública vive aparte, en `StorePublicModule`, y solo lee.
 */
@Controller('store')
@UseGuards(JwtAuthGuard)
export class StoreController {
  constructor(private readonly service: StoreService) {}

  // Las rutas literales van ANTES de ':id' para que no las capture como un id.

  @Get('status')
  status() {
    return { storageReady: this.service.storageReady };
  }

  @Get('categories')
  listCategories(@CurrentUser() user: AuthUser) {
    return this.service.listCategories(user.organizationId);
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StoreCategorySchema)) dto: StoreCategoryDto,
  ) {
    return this.service.createCategory(user.organizationId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StoreCategorySchema)) dto: StoreCategoryDto,
  ) {
    return this.service.updateCategory(user.organizationId, id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeCategory(user.organizationId, id);
  }

  @Get('products')
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post('products')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StoreProductCreateSchema)) dto: StoreProductCreateDto,
  ) {
    return this.service.create(user.organizationId, dto);
  }

  /** Publicar a partir de un producto interno o de una cotización. */
  @Post('products/from-source')
  createFromSource(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StoreProductFromSourceSchema)) dto: StoreProductFromSourceDto,
  ) {
    return this.service.createFromSource(user.organizationId, dto);
  }

  @Patch('products/reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StoreReorderSchema)) dto: StoreReorderDto,
  ) {
    return this.service.reorder(user.organizationId, dto.ids);
  }

  @Get('products/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.organizationId, id);
  }

  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StoreProductUpdateSchema)) dto: StoreProductUpdateDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }

  @Delete('products/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id);
  }

  /** Paso 1 de la subida: URL firmada para mandar el archivo directo a R2. */
  @Post('products/:id/images/upload-url')
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StoreImageUploadUrlSchema)) dto: StoreImageUploadUrlDto,
  ) {
    return this.service.createImageUploadUrl(user.organizationId, id, dto);
  }

  /** Paso 2: registrar la foto ya subida (verificada contra el almacenamiento). */
  @Post('products/:id/images')
  confirmImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StoreImageConfirmSchema)) dto: StoreImageConfirmDto,
  ) {
    return this.service.confirmImage(user.organizationId, id, dto);
  }

  @Patch('products/:id/images/reorder')
  reorderImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StoreReorderSchema)) dto: StoreReorderDto,
  ) {
    return this.service.reorderImages(user.organizationId, id, dto.ids);
  }

  @Delete('products/:id/images/:imageId')
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.service.removeImage(user.organizationId, id, imageId);
  }
}

@Module({
  controllers: [StoreController],
  providers: [StoreService, RecostService],
  exports: [StoreService],
})
export class StoreModule {}
