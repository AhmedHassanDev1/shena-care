import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../../modules/catalog/public';
import { CareService } from '../../../modules/care/public';
import { ProductViewService } from './product-view.service';

@Injectable()
export class ProductDetailService {
  constructor(private readonly views: ProductViewService, private readonly catalog: CatalogService, private readonly care: CareService) {}

  async getDetail(slugOrId: string) {
    const product = await this.views.getProductView(slugOrId);
    if (!product) return null;
    const [verifiedFacts, routinePlacements] = await Promise.all([
      this.catalog.getReviewedIdentityFacts(product.id, product.skus.map(s => s.id)),
      this.care.getPublicProductPlacements(product.id),
    ]);
    return { ...product, verifiedFacts, routinePlacements,
      factVerification: { identity: verifiedFacts.length ? 'reviewed' : 'unavailable', content: 'unavailable' },
      evaluatedAt: new Date().toISOString() };
  }
}
