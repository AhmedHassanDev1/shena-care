import { Module } from '@nestjs/common';
import { CatalogModule } from '../../modules/catalog/public';
import { CommerceModule } from '../../modules/commerce/public';
import { SourcingModule } from '../../modules/sourcing/public';
import { ProductViewController } from './controllers/product-view.controller';
import { BrandController } from './controllers/brand.controller';
import { CategoryController } from './controllers/category.controller';
import { ListingController } from './controllers/listing.controller';
import { PriceController } from './controllers/price.controller';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { BarcodeAliasController } from './controllers/barcode-alias.controller';
import { ProductViewService } from './services/product-view.service';
import { DiscoveryService } from './services/discovery.service';
import { ProductDetailService } from './services/product-detail.service';
import { CareModule } from '../../modules/care/public';
import { IngestionModule } from '../../modules/ingestion/public';
import { OrderingModule } from '../../modules/ordering/public';
import { RoutineCartController } from './controllers/routine-cart.controller';

// ─── CompositionModule ────────────────────────────────────────────────────────
// الـ Composition Layer هي المسؤولة عن الـ HTTP API
//
// تجمع البيانات من الموديولات المختلفة (Catalog, Commerce)
// وتقدمها للـ frontend بشكل موحد
//
// القاعدة: الـ Controllers هنا بس — مش جوا الـ Business Modules

@Module({
  imports: [CatalogModule, CommerceModule, SourcingModule, CareModule, IngestionModule, OrderingModule],
  controllers: [
    ProductViewController,  // GET /products, GET /products/:slug
    BrandController,        // GET /brands, GET /brands/:slug
    CategoryController,     // GET /categories, GET /categories/:slug
    ListingController,      // /commerce/listings
    PriceController,        // /commerce/prices
    // /sourcing/* is served by the guarded SourcingController in the Sourcing module
    PurchaseOrderController,// /purchase-orders
    BarcodeAliasController, // /catalog/barcode-aliases (GLO-242)
    RoutineCartController,  // /care/me/routines/:id/cart, /care/workspace/proposals/:id/cart
  ],
  providers: [ProductViewService, DiscoveryService, ProductDetailService],
})
export class CompositionModule {}

