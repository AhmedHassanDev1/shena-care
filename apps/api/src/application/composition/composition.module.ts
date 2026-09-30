import { Module } from '@nestjs/common';
import { CatalogModule } from '../../modules/catalog/public';
import { CommerceModule } from '../../modules/commerce/public';
import { SourcingModule } from '../../modules/sourcing/public';
import { ProductViewController } from './controllers/product-view.controller';
import { BrandController } from './controllers/brand.controller';
import { CategoryController } from './controllers/category.controller';
import { ListingController } from './controllers/listing.controller';
import { PriceController } from './controllers/price.controller';
import { SupplierController } from './controllers/supplier.controller';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { ProductViewService } from './services/product-view.service';

// ─── CompositionModule ────────────────────────────────────────────────────────
// الـ Composition Layer هي المسؤولة عن الـ HTTP API
//
// تجمع البيانات من الموديولات المختلفة (Catalog, Commerce)
// وتقدمها للـ frontend بشكل موحد
//
// القاعدة: الـ Controllers هنا بس — مش جوا الـ Business Modules

@Module({
  imports: [CatalogModule, CommerceModule, SourcingModule],
  controllers: [
    ProductViewController,  // GET /products, GET /products/:slug
    BrandController,        // GET /brands, GET /brands/:slug
    CategoryController,     // GET /categories, GET /categories/:slug
    ListingController,      // /commerce/listings
    PriceController,        // /commerce/prices
    SupplierController,     // /sourcing/suppliers and /sourcing/offers
    PurchaseOrderController,// /purchase-orders
  ],
  providers: [ProductViewService],
})
export class CompositionModule {}

