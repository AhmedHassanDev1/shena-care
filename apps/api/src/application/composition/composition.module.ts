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
import { RfqController } from './controllers/rfq.controller';
import { AcquisitionCostController, SupplierEnrollmentController } from './controllers/procurement-closure.controller';
import { BarcodeAliasController } from './controllers/barcode-alias.controller';
import { MediaAssetController, MediaTemplateController } from './controllers/media-asset.controller';
import { CatalogWorkbenchController } from './controllers/catalog-workbench.controller';
import { CatalogItemsController } from './controllers/catalog-items.controller';
import { RoutineProfileController } from './controllers/routine-profile.controller';
import { CatalogPublicationService } from './services/catalog-publication.service';
import { CatalogAutopilotService } from './services/catalog-autopilot.service';
import { CatalogProfileService } from './services/catalog-profile.service';
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
    RoutineProfileController, // GET /catalog/skus/:id/routine-profile, /catalog/routine-profiles (live products only)
    ProductViewController,  // GET /products, GET /products/:slug
    MediaAssetController,   // /catalog/media-assets (staff only)
    MediaTemplateController, // /catalog/media-templates (Admin)
    CatalogWorkbenchController, // /catalog/workbench (Admin: intake, research review, publication)
    CatalogItemsController,
    BrandController,        // GET /brands, GET /brands/:slug
    CategoryController,     // GET /categories, GET /categories/:slug
    ListingController,      // /commerce/listings
    PriceController,        // /commerce/prices
    // /sourcing/* is served by the guarded SourcingController in the Sourcing module
    PurchaseOrderController,// /purchase-orders
    RfqController,          // /rfq (BROADCAST_ON_DEMAND supplier workspace + staff)
    SupplierEnrollmentController, // /procurement/enrollment (Admin)
    AcquisitionCostController,    // /procurement/acquisition-costs (Hub capture, Admin corrections)
    BarcodeAliasController, // /catalog/barcode-aliases (GLO-242)
    RoutineCartController,  // /care/me/routines/:id/cart, /care/workspace/proposals/:id/cart
  ],
  providers: [CatalogPublicationService, CatalogAutopilotService, CatalogProfileService, ProductViewService, DiscoveryService, ProductDetailService],
})
export class CompositionModule {}

