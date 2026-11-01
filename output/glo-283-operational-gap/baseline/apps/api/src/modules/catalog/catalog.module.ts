import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';
import { ProductIdentityService } from './services/product-identity.service';
import { IngredientService } from './services/ingredient.service';
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
    IngredientService,
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
  exports: [CatalogService, BrandService, CategoryService, ProductIdentityService, IngredientService, SEARCH_PROVIDER],
})
export class CatalogModule {}
