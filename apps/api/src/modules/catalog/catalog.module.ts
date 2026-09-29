import { Module } from '@nestjs/common';
import { CatalogService } from './services/catalog.service';
import { BrandService } from './services/brand.service';
import { CategoryService } from './services/category.service';

// ─── CatalogModule ────────────────────────────────────────────────────────────
// هذا الموديول يمتلك كل ما يخص هوية المنتج:
//   - CatalogService   → المنتجات والـ SKUs
//   - BrandService     → الماركات وخطوط الإنتاج
//   - CategoryService  → تصنيفات المنتجات (شجرة هرمية)
//
// كل الـ services في exports عشان الـ CompositionLayer يقدر يستخدمها
// عبر public.ts فقط — مش مسموح بالاستيراد المباشر من برا الموديول

@Module({
  providers: [CatalogService, BrandService, CategoryService],
  exports: [CatalogService, BrandService, CategoryService],
})
export class CatalogModule {}
