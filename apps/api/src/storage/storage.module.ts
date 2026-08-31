import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';

/** Almacenamiento de objetos (fotos del catálogo). Global: lo usan la tienda y,
 *  eventualmente, cualquier otro módulo que necesite guardar archivos grandes. */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class StorageModule {}
