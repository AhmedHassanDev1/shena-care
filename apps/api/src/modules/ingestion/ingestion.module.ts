import { Module } from '@nestjs/common';
import { EligibilityController } from './eligibility.controller';
import { IngestionEligibilityService } from './services/ingestion-eligibility.service';
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
import { IngredientOntologyService } from './services/ingredient-ontology.service';
import { RoutinePlacementService } from './services/routine-placement.service';
import { IngestionController } from './ingestion.controller';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { AiModule } from '../../platform/ai';
import { StorageModule } from '../../platform/storage/storage.module';
import { CareModule } from '../care/public';

@Module({
  imports: [CatalogModule, CareModule, SourcingModule, AiModule, StorageModule],
  controllers: [IngestionController, EligibilityController],
  providers: [
    IngestionEligibilityService,
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
    IngredientOntologyService,
    RoutinePlacementService,
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
    IngredientOntologyService,
    RoutinePlacementService,
  ],
})
export class IngestionModule {}
