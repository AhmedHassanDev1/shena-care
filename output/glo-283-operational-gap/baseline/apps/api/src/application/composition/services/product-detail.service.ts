import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../../modules/catalog/public';
import { CareService } from '../../../modules/care/public';
import { ProductViewService } from './product-view.service';
import { ProductContentService } from '../../../modules/ingestion/public';
import { PromotionService } from '../../../modules/commerce/public';

@Injectable()
export class ProductDetailService {
  constructor(private readonly views: ProductViewService, private readonly catalog: CatalogService, private readonly care: CareService,
    private readonly content: ProductContentService, private readonly promotions: PromotionService) {}

  async getDetail(slugOrId: string, selectedSkuId?: string) {
    const product = await this.views.getProductView(slugOrId);
    if (!product) return null;
    const selected = product.skus.find(sku => sku.id === (selectedSkuId ?? product.skus[0].id));
    if (!selected) return null;
    const [verifiedFacts, routinePlacements, contents, promotions, usageRules] = await Promise.all([
      this.catalog.getReviewedIdentityFacts(product.id, product.skus.map(s => s.id)),
      this.care.getPublicProductPlacements(product.id),
      this.content.getPublishedContent(product.skus.map(s => s.id)),
      this.promotions.getActivePromotions(),
      this.catalog.getReviewedUsageRules(product.skus.map(s => s.id)),
    ]);
    const skus = await Promise.all(product.skus.map(async sku => ({ ...sku,
      media: product.media.filter(m => m.skuId === sku.id),
      verifiedFacts: verifiedFacts.filter(f => f.skuId === sku.id), content: contents.get(sku.id) ?? null,
      // GLO-279: reviewer-confirmed, source-linked usage rules (empty = directions not yet reviewed, not "use daily").
      usageRules: usageRules.filter(rule => rule.skuId === sku.id),
      promotions: sku.price ? await this.promotions.getProductPreview(sku.id, sku.price, promotions) : null,
    })));
    const selectedContent = contents.get(selected.id);
    return { ...product, description: selectedContent?.description ?? null, usage: selectedContent?.usage ?? null, warnings: selectedContent?.warnings ?? null,
      skus, selectedSkuId: selected.id, selectedVariant: skus.find(sku => sku.id === selected.id)!, verifiedFacts, routinePlacements,
      factVerification: { identity: verifiedFacts.length ? 'reviewed' : 'unavailable', content: contents.has(selected.id) ? 'reviewed' : 'unavailable' },
      evaluatedAt: new Date().toISOString() };
  }
}
