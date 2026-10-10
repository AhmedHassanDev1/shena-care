import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { ProductIdentityService } from './services/product-identity.service';
import { ProductResearchService } from './services/product-research.service';
import { ProductContentService } from './services/product-content.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';
import { StorageModule } from '../../platform/storage/storage.module';

@Module({
  imports: [CatalogModule, SourcingModule, AiModule, StorageModule],
  controllers: [IngestionController],
  providers: [IngestionService, ProductIdentityService, ProductResearchService, ProductContentService],
  exports: [IngestionService, ProductIdentityService, ProductResearchService, ProductContentService],
})
export class IngestionModule {}
