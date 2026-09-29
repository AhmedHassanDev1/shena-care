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
  skus: PublishedSku[];
  media: Array<{
    id: string;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
    originType: string;
  }>;
}

const productWithRelations = Prisma.validator<Prisma.ProductDefaultArgs>()({
  include: { brand: true, skus: true, media: true, productLine: true, category: true },
});

type ProductWithRelations = Prisma.ProductGetPayload<typeof productWithRelations>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  async getPublishedProduct(slugOrId: string): Promise<PublishedProduct | null> {
    const isId = this.isUuid(slugOrId);
    const product = await this.prisma.product.findFirst({
      where: isId ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
      ...productWithRelations,
    });

    if (!product || !product.isPublished) {
      return null;
    }

    return this.mapToPublishedProduct(product);
  }

  async getPublishedProducts(filters?: {
    categorySlug?: string;
    brandSlug?: string;
  }): Promise<PublishedProduct[]> {
    // نبني الـ where clause بشكل ديناميكي حسب الـ filters الموجودة
    // لو مفيش فلتر → كل المنتجات المنشورة
    // لو في categorySlug → فلتر على اسم التصنيف
    // لو في brandSlug → فلتر على اسم الماركة
    const where = {
      isPublished: true,
      ...(filters?.categorySlug && { category: { slug: filters.categorySlug } }),
      ...(filters?.brandSlug && { brand: { slug: filters.brandSlug } }),
    };

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...productWithRelations,
    });

    return products.map((p) => this.mapToPublishedProduct(p));
  }

  async getPublishedSku(skuId: string): Promise<PublishedSku | null> {
    if (!this.isUuid(skuId)) {
      return null;
    }

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
    if (!this.isUuid(skuId)) {
      return false;
    }

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
      productLine: product.productLine
        ? {
            id: product.productLine.id,
            name: product.productLine.name,
            slug: product.productLine.slug,
          }
        : null,
      category: product.category
        ? {
            id: product.category.id,
            name: product.category.name,
            slug: product.category.slug,
            parentId: product.category.parentId,
          }
        : null,
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
          originType: m.originType,
        })),
    };
  }
}
