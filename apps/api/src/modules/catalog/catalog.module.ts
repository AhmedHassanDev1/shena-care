import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';
import { ProductIdentityService } from './services/product-identity.service';
import { StorageModule } from '../../platform/storage/storage.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SEARCH_PROVIDER } from './search/search-provider';
import { PostgresSearchProvider } from './search/postgres-search.provider';

// ─── CatalogModule ────────────────────────────────────────────────────────────
// هذا الموديول يمتلك كل ما يخص هوية المنتج:
//   - CatalogService   → المنتجات والـ SKUs
//   - BrandService     → الماركات وخطوط الإنتاج
//   - CategoryService  → تصنيفات المنتجات (شجرة هرمية)
//
// كل الـ services في exports عشان الـ CompositionLayer يقدر يستخدمها
// عبر public.ts فقط — مش مسموح بالاستيراد المباشر من برا الموديول

@Module({
  imports: [StorageModule, ConfigModule],
  providers: [CatalogService, BrandService, CategoryService, ProductIdentityService, PostgresSearchProvider,
    { provide: SEARCH_PROVIDER, inject: [ConfigService, PostgresSearchProvider],
      useFactory: (config: ConfigService, postgres: PostgresSearchProvider) => {
        const selected = config.get<string>('SEARCH_PROVIDER') ?? 'postgres';
        if (selected !== 'postgres') throw new Error(`Unsupported SEARCH_PROVIDER: ${selected}`);
        return postgres;
      } },
  ],
  exports: [CatalogService, BrandService, CategoryService, ProductIdentityService, SEARCH_PROVIDER],
})
export class CatalogModule {}
