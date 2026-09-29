import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareController } from './care.controller';
import { CatalogModule } from '../catalog/public';

@Module({
  imports: [CatalogModule],
  controllers: [CareController],
  providers: [CareService],
  exports: [CareService],
})
export class CareModule {}
