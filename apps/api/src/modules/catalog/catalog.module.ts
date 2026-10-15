import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';
import { ProductIdentityService } from './services/product-identity.service';
import { StorageModule } from '../../platform/storage/storage.module';

// ─── CatalogModule ────────────────────────────────────────────────────────────
// هذا الموديول يمتلك كل ما يخص هوية المنتج:
//   - CatalogService   → المنتجات والـ SKUs
//   - BrandService     → الماركات وخطوط الإنتاج
//   - CategoryService  → تصنيفات المنتجات (شجرة هرمية)
//
// كل الـ services في exports عشان الـ CompositionLayer يقدر يستخدمها
// عبر public.ts فقط — مش مسموح بالاستيراد المباشر من برا الموديول

@Module({
  imports: [StorageModule],
  providers: [CatalogService, BrandService, CategoryService, ProductIdentityService],
  exports: [CatalogService, BrandService, CategoryService, ProductIdentityService],
})
export class CatalogModule {}
