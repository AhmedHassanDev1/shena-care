import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../../modules/catalog/public';
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

    const skusWithCommerce = await Promise.all(
      product.skus.map(async (sku) => {
        const [terms, isAvailable] = await Promise.all([
          this.commerceService.getSellingTerms(sku.id),
          this.sourcingService.checkAvailability(sku.id, true),
        ]);

        return {
          id: sku.id,
          code: sku.code,
          variantName: sku.variantName,
          size: sku.size,
          sizeUnit: sku.sizeUnit,
          price: terms?.price ?? null,
          isAvailable,
          canOrder: (terms?.canOrder ?? false) && isAvailable,
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
    const products = await this.catalogService.getPublishedProducts(filters);

    const productViews = await Promise.all(
      products.map(async (product) => {
        const skusWithCommerce = await Promise.all(
          product.skus.map(async (sku) => {
            const [terms, isAvailable] = await Promise.all([
              this.commerceService.getSellingTerms(sku.id),
              this.sourcingService.checkAvailability(sku.id, true),
            ]);

            return {
              id: sku.id,
              code: sku.code,
              variantName: sku.variantName,
              size: sku.size,
              sizeUnit: sku.sizeUnit,
              price: terms?.price ?? null,
              isAvailable,
              canOrder: (terms?.canOrder ?? false) && isAvailable,
            };
          }),
        );

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
      }),
    );

    return productViews.filter(product => product.media.length > 0 && product.skus.some(sku => sku.canOrder));
  }
}
