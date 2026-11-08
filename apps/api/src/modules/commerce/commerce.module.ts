import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public';
import { CommerceService } from './services/commerce.service';
import { PromotionService } from './services/promotion.service';
import { ProductReviewService } from './services/product-review.service';

@Module({
  imports: [CatalogModule],
  providers: [CommerceService, PromotionService, ProductReviewService],
  exports: [CommerceService, PromotionService, ProductReviewService],
})
export class CommerceModule {}

