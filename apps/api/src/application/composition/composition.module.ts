import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import rateLimit from 'express-rate-limit';
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
import { CatalogPolicyController } from './controllers/catalog-policy.controller';
import { RoutineProfileController } from './controllers/routine-profile.controller';
import { CatalogPublicationService } from './services/catalog-publication.service';
import { CatalogProfileService } from './services/catalog-profile.service';
import { ProductViewService } from './services/product-view.service';
import { DiscoveryService } from './services/discovery.service';
import { ProductDetailService } from './services/product-detail.service';
import { ProductReviewsOrchestrationService } from './services/product-reviews-orchestration.service';
import { CareModule } from '../../modules/care/public';
import { OrderingModule } from '../../modules/ordering/public';
import { RoutineCartController } from './controllers/routine-cart.controller';
import { IntakeModule } from '../../modules/intake/public';
import { CatalogIntakeController, SupplierIntakeController } from './controllers/catalog-intake.controller';
import { AdminIntakeService } from './services/intake/admin-intake.service';
import { SupplierIntakeService } from './services/intake/supplier-intake.service';
import { MarketPriceResearchService } from './services/intake/market-price-research.service';
import { CatalogEnrichmentService } from './services/intake/catalog-enrichment.service';
import { IntakeRunnerService } from './services/intake/intake-runner.service';

// ─── CompositionModule ────────────────────────────────────────────────────────
// الـ Composition Layer هي المسؤولة عن الـ HTTP API
//
// تجمع البيانات من الموديولات المختلفة (Catalog, Commerce)
// وتقدمها للـ frontend بشكل موحد
//
// القاعدة: الـ Controllers هنا بس — مش جوا الـ Business Modules

@Module({
  imports: [CatalogModule, CommerceModule, SourcingModule, CareModule, OrderingModule, IntakeModule],
  controllers: [
    RoutineProfileController, // GET /catalog/skus/:id/routine-profile, /catalog/routine-profiles (live products only)
    ProductViewController,  // GET /products, GET /products/:slug
    MediaAssetController,   // /catalog/media-assets (staff only)
    MediaTemplateController, // /catalog/media-templates (Admin)
    CatalogWorkbenchController, // /catalog/workbench (Admin: intake, research review, publication)
    CatalogItemsController,
    CatalogPolicyController, // /catalog/policy (Admin: ingestion eligibility allowlist & evaluator)
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
    CatalogIntakeController, // /catalog/intake (Admin: names → verified drafts, supplier files on behalf, review queue, market prices)
    SupplierIntakeController, // /supplier/intake (Supplier: own price files and results)
  ],
  providers: [CatalogPublicationService, CatalogProfileService, ProductViewService, DiscoveryService, ProductDetailService,
    ProductReviewsOrchestrationService,
    CatalogEnrichmentService, MarketPriceResearchService, SupplierIntakeService, AdminIntakeService, IntakeRunnerService],
})
export class CompositionModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        rateLimit({
          windowMs: 15 * 60 * 1000,
          max: 30,
          standardHeaders: true,
          legacyHeaders: false,
          message: {
            code: 'REVIEW_RATE_LIMITED',
            message: 'Too many review submission attempts. Please try again later.',
          },
        }),
      )
      .forRoutes({ path: 'products/:slugOrId/reviews', method: RequestMethod.POST });
  }
}
