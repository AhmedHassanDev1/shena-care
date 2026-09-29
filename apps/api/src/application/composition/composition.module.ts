import { Module } from '@nestjs/common';
import { CatalogModule } from '../../modules/catalog/public';
import { CommerceModule } from '../../modules/commerce/public';
import { ProductViewController } from './controllers/product-view.controller';
import { BrandController } from './controllers/brand.controller';
import { CategoryController } from './controllers/category.controller';
import { ProductViewService } from './services/product-view.service';

// ─── CompositionModule ────────────────────────────────────────────────────────
// الـ Composition Layer هي المسؤولة عن الـ HTTP API
//
// تجمع البيانات من الموديولات المختلفة (Catalog, Commerce)
// وتقدمها للـ frontend بشكل موحد
//
// القاعدة: الـ Controllers هنا بس — مش جوا الـ Business Modules

@Module({
  imports: [CatalogModule, CommerceModule],
  controllers: [
    ProductViewController,  // GET /products, GET /products/:slug
    BrandController,        // GET /brands, GET /brands/:slug
    CategoryController,     // GET /categories, GET /categories/:slug
  ],
  providers: [ProductViewService],
})
export class CompositionModule {}

