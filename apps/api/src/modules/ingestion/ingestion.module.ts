import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { ProductIdentityService } from './services/product-identity.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';

@Module({
  imports: [CatalogModule, SourcingModule, AiModule],
  controllers: [IngestionController],
  providers: [IngestionService, ProductIdentityService],
  exports: [IngestionService, ProductIdentityService],
})
export class IngestionModule {}
