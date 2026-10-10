import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { ProductIdentityService } from './services/product-identity.service';
import { ProductResearchService } from './services/product-research.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';

@Module({
  imports: [CatalogModule, SourcingModule, AiModule],
  controllers: [IngestionController],
  providers: [IngestionService, ProductIdentityService, ProductResearchService],
  exports: [IngestionService, ProductIdentityService, ProductResearchService],
})
export class IngestionModule {}
