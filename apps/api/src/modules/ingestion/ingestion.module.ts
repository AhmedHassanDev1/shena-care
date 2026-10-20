import { Module } from '@nestjs/common';
import { IngestionService } from './services/ingestion.service';
import { ProductIdentityService } from './services/product-identity.service';
import { ProductResearchService } from './services/product-research.service';
import { ProductContentService } from './services/product-content.service';
import { SpreadsheetParserService } from './services/spreadsheet-parser.service';
import { FormatFingerprintService } from './services/format-fingerprint.service';
import { ExportProfileService } from './services/export-profile.service';
import { RowNormalizationService } from './services/row-normalization.service';
import { OfferBatchCommitService } from './services/offer-batch-commit.service';
import { BrandEnrichmentService } from './services/brand-enrichment.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';
import { StorageModule } from '../../platform/storage/storage.module';

@Module({
  imports: [CatalogModule, SourcingModule, AiModule, StorageModule],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    ProductIdentityService,
    ProductResearchService,
    ProductContentService,
    SpreadsheetParserService,
    FormatFingerprintService,
    ExportProfileService,
    RowNormalizationService,
    OfferBatchCommitService,
    BrandEnrichmentService,
  ],
  exports: [
    IngestionService,
    ProductIdentityService,
    ProductResearchService,
    ProductContentService,
    SpreadsheetParserService,
    FormatFingerprintService,
    ExportProfileService,
    RowNormalizationService,
    OfferBatchCommitService,
    BrandEnrichmentService,
  ],
})
export class IngestionModule {}
