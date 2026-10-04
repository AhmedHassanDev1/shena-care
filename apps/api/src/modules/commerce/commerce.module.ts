import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/public';
import { CommerceService } from './services/commerce.service';
import { PromotionService } from './services/promotion.service';

@Module({
  imports: [CatalogModule],
  providers: [CommerceService, PromotionService],
  exports: [CommerceService, PromotionService],
})
export class CommerceModule {}

