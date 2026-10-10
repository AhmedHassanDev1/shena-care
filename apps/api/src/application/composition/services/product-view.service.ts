import { Injectable } from '@nestjs/common';
import { CatalogService, PublishedProduct } from '../../../modules/catalog/public';
import { CommerceService } from '../../../modules/commerce/public';
import { SourcingService } from '../../../modules/sourcing/public';

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  brand: {
    id: string;
    name: string;
    slug: string;
  };
  productLine?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  category?: {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
  } | null;
  skus: Array<{
    id: string;
    code: string;
    barcode: string | null;
    variantName: string;
    size: number | null;
    sizeUnit: string | null;
    price: {
      amount: number;
      currency: string;
      compareAtAmount: number | null;
    } | null;
    isAvailable: boolean;
    canOrder: boolean;
    availability: Awaited<ReturnType<SourcingService['getPublicAvailability']>>;
  }>;
  media: Array<{
    id: string;
    skuId: string | null;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
    originType: string;
  }>;
}

@Injectable()
export class ProductViewService {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly commerceService: CommerceService,
    private readonly sourcingService: SourcingService,
  ) {}

  async getProductView(slugOrId: string): Promise<ProductView | null> {
    const product = await this.catalogService.getPublishedProduct(slugOrId);

    if (!product) {
      return null;
    }

    return this.composeProduct(product);
  }

  async composeProduct(product: PublishedProduct, at = new Date()): Promise<ProductView | null> {

    const skusWithCommerce = await Promise.all(
      product.skus.filter(sku => product.media.some(media => media.skuId === sku.id)).map(async (sku) => {
        const [terms, availability] = await Promise.all([
          this.commerceService.getSellingTerms(sku.id),
          this.sourcingService.getPublicAvailability(sku.id, at),
        ]);

        return {
          id: sku.id,
          code: sku.code,
          barcode: sku.barcode,
          variantName: sku.variantName,
          size: sku.size,
          sizeUnit: sku.sizeUnit,
          price: terms?.price ?? null,
          isAvailable: availability.isAvailable,
          availability,
          canOrder: (terms?.canOrder ?? false) && availability.isAvailable,
        };
      }),
    );

    if (!product.media.length || !skusWithCommerce.some(sku => sku.canOrder)) return null;
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      usage: product.usage,
      warnings: product.warnings,
      brand: product.brand,
      productLine: product.productLine ?? null,
      category: product.category ?? null,
      skus: skusWithCommerce.filter(sku => sku.canOrder),
      media: product.media.filter(m => skusWithCommerce.some(sku => sku.id === m.skuId && sku.canOrder)),
    };
  }

  // filters اختيارية — لو متعدتش هيرجع كل المنتجات
  async getProductViews(filters?: {
    categorySlug?: string;
    brandSlug?: string;
    productLineSlug?: string;
    page?: number;
    limit?: number;
  }): Promise<ProductView[]> {
    // بنمرر الـ filters للـ CatalogService اللي هو مسؤول عن الـ DB query
    const products = await this.catalogService.getPublishedProducts({ categorySlug: filters?.categorySlug,
      brandSlug: filters?.brandSlug, productLineSlug: filters?.productLineSlug });

    const productViews = await Promise.all(
      products.sort((a, b) => a.id.localeCompare(b.id)).map(product => this.composeProduct(product)),
    );

    const visible = productViews.filter((product): product is ProductView => product !== null);
    const limit = Math.min(filters?.limit ?? 20, 100);
    return visible.slice(((filters?.page ?? 1) - 1) * limit, (filters?.page ?? 1) * limit);
  }
}
