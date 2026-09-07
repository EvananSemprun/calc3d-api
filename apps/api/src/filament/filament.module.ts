import { Module } from '@nestjs/common';
import { FilamentController } from './filament.controller';
import { FilamentService } from './filament.service';

@Module({
  controllers: [FilamentController],
  providers: [FilamentService],
  exports: [FilamentService],
})
export class FilamentModule {}
