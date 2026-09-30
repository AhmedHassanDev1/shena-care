import { Module } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CareController } from './care.controller';
import { CatalogModule } from '../catalog/public';

@Module({
  imports: [CatalogModule],
  controllers: [CareController],
  providers: [CareService, CareProfileService],
  exports: [CareService, CareProfileService],
})
export class CareModule {}
