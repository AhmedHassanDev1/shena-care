import { Injectable } from '@nestjs/common';
import { CatalogService, PublishedProduct } from '../../../modules/catalog/public';
import { CommerceService, SellingTerms } from '../../../modules/commerce/public';

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
    canOrder: boolean;
  }>;
  media: Array<{
    id: string;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
  }>;
}

@Injectable()
export class ProductViewService {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly commerceService: CommerceService,
  ) {}

  async getProductView(slugOrId: string): Promise<ProductView | null> {
    const product = await this.catalogService.getPublishedProduct(slugOrId);

    if (!product) {
      return null;
    }

    const skusWithCommerce = await Promise.all(
      product.skus.map(async (sku) => {
        const terms = await this.commerceService.getSellingTerms(sku.id);

        return {
          id: sku.id,
          code: sku.code,
          variantName: sku.variantName,
          size: sku.size,
          sizeUnit: sku.sizeUnit,
          price: terms?.price ?? null,
          canOrder: terms?.canOrder ?? false,
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
      skus: skusWithCommerce,
      media: product.media,
    };
  }

  async getProductViews(): Promise<ProductView[]> {
    const products = await this.catalogService.getPublishedProducts();

    const productViews = await Promise.all(
      products.map(async (product) => {
        const skusWithCommerce = await Promise.all(
          product.skus.map(async (sku) => {
            const terms = await this.commerceService.getSellingTerms(sku.id);

            return {
              id: sku.id,
              code: sku.code,
              variantName: sku.variantName,
              size: sku.size,
              sizeUnit: sku.sizeUnit,
              price: terms?.price ?? null,
              canOrder: terms?.canOrder ?? false,
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
          skus: skusWithCommerce,
          media: product.media,
        };
      }),
    );

    return productViews;
  }
}
