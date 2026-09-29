import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';

export interface PublishedSku {
  id: string;
  code: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  barcode: string | null;
}

export interface PublishedProduct {
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
  skus: PublishedSku[];
  media: Array<{
    id: string;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
  }>;
}

const productWithRelations = Prisma.validator<Prisma.ProductDefaultArgs>()({
  include: { brand: true, skus: true, media: true },
});

type ProductWithRelations = Prisma.ProductGetPayload<typeof productWithRelations>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublishedProduct(slugOrId: string): Promise<PublishedProduct | null> {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
      ...productWithRelations,
    });

    if (!product || !product.isPublished) {
      return null;
    }

    return this.mapToPublishedProduct(product);
  }

  async getPublishedProducts(): Promise<PublishedProduct[]> {
    const products = await this.prisma.product.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
      ...productWithRelations,
    });

    return products.map((p) => this.mapToPublishedProduct(p));
  }

  async getPublishedSku(skuId: string): Promise<PublishedSku | null> {
    const sku = await this.prisma.sku.findFirst({
      where: { id: skuId, isActive: true },
      include: { product: true },
    });

    if (!sku || !sku.product.isPublished) {
      return null;
    }

    return {
      id: sku.id,
      code: sku.code,
      variantName: sku.variantName,
      size: sku.size ? sku.size.toNumber() : null,
      sizeUnit: sku.sizeUnit,
      barcode: sku.barcode,
    };
  }

  async validateSku(skuId: string): Promise<boolean> {
    const sku = await this.prisma.sku.findFirst({
      where: { id: skuId, isActive: true },
      include: { product: true },
    });

    return sku !== null && sku.product.isPublished;
  }

  private mapToPublishedProduct(product: ProductWithRelations): PublishedProduct {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      usage: product.usage,
      warnings: product.warnings,
      brand: {
        id: product.brand.id,
        name: product.brand.name,
        slug: product.brand.slug,
      },
      skus: product.skus
        .filter((sku) => sku.isActive)
        .map((sku) => ({
          id: sku.id,
          code: sku.code,
          variantName: sku.variantName,
          size: sku.size ? sku.size.toNumber() : null,
          sizeUnit: sku.sizeUnit,
          barcode: sku.barcode,
        })),
      media: product.media
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({
          id: m.id,
          type: m.type,
          url: m.url,
          altText: m.altText,
          isPrimary: m.isPrimary,
        })),
    };
  }
}
