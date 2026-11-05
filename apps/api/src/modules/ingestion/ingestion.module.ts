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
import { AdminCatalogImportController } from './admin-catalog-import.controller';
import { BrandResearchService } from './services/brand-research.service';
import { AdminCatalogImportService } from './services/admin-catalog-import.service';
import { RetailPriceController } from './retail-price.controller';
import { RetailPriceObservationService } from './services/retail-price-observation.service';
import { CatalogModule } from '../catalog/public';
import { SourcingModule } from '../sourcing/public';
import { ResearchSourceFetcher, RESEARCH_TRANSPORT, NodeResearchTransport } from './services/research-source-fetcher';
import { AiModule } from '../../platform/ai';
import { StorageModule } from '../../platform/storage/storage.module';
import { CareModule } from '../care/public';

@Module({
  imports: [CatalogModule, CareModule, SourcingModule, AiModule, StorageModule],
  controllers: [IngestionController, EligibilityController, RetailPriceController, AdminCatalogImportController],
  providers: [
    AdminCatalogImportService,
    BrandResearchService,
    ResearchSourceFetcher,
    { provide: RESEARCH_TRANSPORT, useClass: NodeResearchTransport },
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
    RetailPriceObservationService,
  ],
  exports: [
    AdminCatalogImportService,
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
