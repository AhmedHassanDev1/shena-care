import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';
import { ProductIdentityService } from './services/product-identity.service';
import { MediaTemplateService } from './services/media-template.service';
import { CatalogIntakeService } from './services/catalog-intake.service';
import { IngredientService } from './services/ingredient.service';
import { ProductMediaService } from './services/product-media.service';
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
    BrandService,
    CategoryService,
    ProductIdentityService,
    MediaTemplateService,
    CatalogIntakeService,
    IngredientService,
    ProductMediaService,
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
  exports: [CatalogService, BrandService, CategoryService, ProductIdentityService, IngredientService, ProductMediaService, MediaTemplateService, CatalogIntakeService, SEARCH_PROVIDER],
})
export class CatalogModule {}
