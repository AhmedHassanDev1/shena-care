import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { CatalogItemManagementService } from './services/catalog-item-management.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';
import { ProductIdentityService } from './services/product-identity.service';
import { SkuReferenceService } from './services/sku-reference.service';
import { MediaTemplateService } from './services/media-template.service';
import { CatalogIntakeService } from './services/catalog-intake.service';
import { CatalogSnapshotService } from './services/catalog-snapshot.service';
import { CatalogPolicyService } from './services/catalog-policy.service';
import { IngredientService } from './services/ingredient.service';
import { ProductMediaService } from './services/product-media.service';
import { BrandResearchService } from './research/brand-research.service';
import { CanonicalResearchService } from './research/canonical-research.service';
import { ProductContentService } from './research/product-content.service';
import { RoutinePlacementService } from './research/routine-placement.service';
import { IngredientOntologyService } from './research/ingredient-ontology.service';
import { CatalogDecisionLogService } from './research/catalog-decision-log.service';
import { ResearchSourceFetcher, RESEARCH_TRANSPORT, NodeResearchTransport } from './research/research-source-fetcher';
import { ProductResearchService } from './research/product-research.service';
import { BrandEnrichmentService } from './research/brand-enrichment.service';
import { BACKGROUND_REMOVAL, MEDIA_PROCESSOR } from '../../platform/storage/media-processor.port';
import { DeterministicBackgroundRemoval, DisabledBackgroundRemoval, SharpMediaProcessor } from '../../platform/storage/sharp-media-processor';
import { StorageModule } from '../../platform/storage/storage.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SEARCH_PROVIDER } from './search/search-provider';
import { PostgresSearchProvider } from './search/postgres-search.provider';

@Module({
  imports: [StorageModule, ConfigModule],
  providers: [
    CatalogService,
    CatalogItemManagementService,
    BrandService,
    CategoryService,
    ProductIdentityService,
    SkuReferenceService,
    MediaTemplateService,
    CatalogIntakeService,
    CatalogSnapshotService,
    CatalogPolicyService,
    IngredientService,
    ProductMediaService,
    BrandResearchService,
    CanonicalResearchService,
    ProductContentService,
    RoutinePlacementService,
    IngredientOntologyService,
    CatalogDecisionLogService,
    ProductResearchService,
    BrandEnrichmentService,
    ResearchSourceFetcher,
    { provide: RESEARCH_TRANSPORT, useClass: NodeResearchTransport },
    { provide: MEDIA_PROCESSOR, useClass: SharpMediaProcessor },
    { provide: BACKGROUND_REMOVAL, useFactory: () => process.env.MEDIA_BACKGROUND_REMOVAL === 'disabled' ? new DisabledBackgroundRemoval() : new DeterministicBackgroundRemoval() },
    PostgresSearchProvider,
    {
      provide: SEARCH_PROVIDER,
      inject: [ConfigService, PostgresSearchProvider],
      useFactory: (config: ConfigService, postgres: PostgresSearchProvider) => {
        const selected = config.get<string>('SEARCH_PROVIDER') ?? 'postgres';
        if (selected !== 'postgres') throw new Error(`Unsupported SEARCH_PROVIDER: ${selected}`);
        return postgres;
      },
    },
  ],
  exports: [
    CatalogService,
    CatalogItemManagementService,
    BrandService,
    CategoryService,
    ProductIdentityService,
    SkuReferenceService,
    IngredientService,
    ProductMediaService,
    MediaTemplateService,
    CatalogIntakeService,
    CatalogSnapshotService,
    CatalogPolicyService,
    SEARCH_PROVIDER,
    BrandResearchService,
    CanonicalResearchService,
    ProductContentService,
    RoutinePlacementService,
    IngredientOntologyService,
    CatalogDecisionLogService,
    ProductResearchService,
    BrandEnrichmentService,
    ResearchSourceFetcher,
    RESEARCH_TRANSPORT,
  ],
})
export class CatalogModule {}
