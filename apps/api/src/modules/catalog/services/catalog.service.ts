import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, MediaOriginType } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreateProductDto, UpdateProductDto } from '../dto/product.dto';
import { CreateSkuDto, UpdateSkuDto } from '../dto/sku.dto';
import { CreateProductMediaDto, UpdateProductMediaDto } from '../dto/media.dto';
import { slugify } from '../utils/slug.util';

export interface PublishedSku {
  id: string;
  code: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  barcode: string | null;
  isActive: boolean;
}

export interface SkuValidationStatus {
  exists: boolean;
  isActive: boolean;
  isProductPublished: boolean;
}

export interface PublishedMedia {
  id: string;
  type: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  originType: string;
}

export interface PublishedProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  isPublished: boolean;
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
  media: PublishedMedia[];
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

  // ---------------------------------------------------------------------------
  // Product Read Operations
  // ---------------------------------------------------------------------------

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

  async getProduct(slugOrId: string): Promise<PublishedProduct | null> {
    const isId = this.isUuid(slugOrId);
    const product = await this.prisma.product.findFirst({
      where: isId ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
      ...productWithRelations,
    });

    if (!product) {
      return null;
    }

    return this.mapToPublishedProduct(product, true);
  }

  async getPublishedProducts(filters?: {
    categorySlug?: string;
    brandSlug?: string;
    productLineSlug?: string;
    page?: number;
    limit?: number;
  }): Promise<PublishedProduct[]> {
    const where = {
      isPublished: true,
      ...(filters?.categorySlug && {
        category: {
          OR: [
            { slug: filters.categorySlug },
            { parent: { slug: filters.categorySlug } },
          ],
        },
      }),
      ...(filters?.brandSlug && { brand: { slug: filters.brandSlug } }),
      ...(filters?.productLineSlug && { productLine: { slug: filters.productLineSlug } }),
    };

    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const limit = filters?.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : undefined;
    const skip = limit ? (page - 1) * limit : undefined;

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      ...productWithRelations,
    });

    return products.map((p) => this.mapToPublishedProduct(p));
  }

  async countPublishedProducts(filters?: {
    categorySlug?: string;
    brandSlug?: string;
    productLineSlug?: string;
  }): Promise<number> {
    const where = {
      isPublished: true,
      ...(filters?.categorySlug && {
        category: {
          OR: [
            { slug: filters.categorySlug },
            { parent: { slug: filters.categorySlug } },
          ],
        },
      }),
      ...(filters?.brandSlug && { brand: { slug: filters.brandSlug } }),
      ...(filters?.productLineSlug && { productLine: { slug: filters.productLineSlug } }),
    };

    return this.prisma.product.count({ where });
  }

  // ---------------------------------------------------------------------------
  // Product Write Operations
  // ---------------------------------------------------------------------------

  async createProduct(dto: CreateProductDto): Promise<PublishedProduct> {
    const brand = await this.prisma.brand.findUnique({
      where: { id: dto.brandId },
    });
    if (!brand) {
      throw new NotFoundException(`Brand not found with id: ${dto.brandId}`);
    }

    if (dto.productLineId) {
      const productLine = await this.prisma.productLine.findUnique({
        where: { id: dto.productLineId },
      });
      if (!productLine) {
        throw new NotFoundException(`ProductLine not found with id: ${dto.productLineId}`);
      }
      if (productLine.brandId !== dto.brandId) {
        throw new BadRequestException(
          `ProductLine '${productLine.name}' does not belong to Brand '${brand.name}'`,
        );
      }
    }

    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new NotFoundException(`Category not found with id: ${dto.categoryId}`);
      }
    }

    const slug = dto.slug ? dto.slug.toLowerCase() : slugify(`${brand.name}-${dto.name}`);

    const existingSlug = await this.prisma.product.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(`A product with slug '${slug}' already exists`);
    }

    const created = await this.prisma.product.create({
      data: {
        brandId: dto.brandId,
        productLineId: dto.productLineId ?? null,
        categoryId: dto.categoryId ?? null,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        usage: dto.usage ?? null,
        warnings: dto.warnings ?? null,
        isPublished: dto.isPublished ?? true,
      },
      ...productWithRelations,
    });

    return this.mapToPublishedProduct(created, true);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<PublishedProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      ...productWithRelations,
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${id}`);
    }

    const targetBrandId = dto.brandId ?? product.brandId;
    if (dto.brandId && dto.brandId !== product.brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
      if (!brand) {
        throw new NotFoundException(`Brand not found with id: ${dto.brandId}`);
      }
    }

    if (dto.productLineId !== undefined) {
      if (dto.productLineId !== null) {
        const productLine = await this.prisma.productLine.findUnique({
          where: { id: dto.productLineId },
        });
        if (!productLine) {
          throw new NotFoundException(`ProductLine not found with id: ${dto.productLineId}`);
        }
        if (productLine.brandId !== targetBrandId) {
          throw new BadRequestException('ProductLine does not belong to the target Brand');
        }
      }
    }

    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new NotFoundException(`Category not found with id: ${dto.categoryId}`);
      }
    }

    let slug = product.slug;
    if (dto.slug) {
      slug = dto.slug.toLowerCase();
    } else if (dto.name && dto.name !== product.name) {
      const brand = await this.prisma.brand.findUnique({ where: { id: targetBrandId } });
      const brandPrefix = brand ? `${brand.name}-` : '';
      slug = slugify(`${brandPrefix}${dto.name}`);
    }

    if (slug !== product.slug) {
      const existingSlug = await this.prisma.product.findFirst({
        where: { slug, NOT: { id } },
      });
      if (existingSlug) {
        throw new ConflictException(`A product with slug '${slug}' already exists`);
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(slug !== product.slug && { slug }),
        ...(dto.brandId !== undefined && { brandId: dto.brandId }),
        ...(dto.productLineId !== undefined && { productLineId: dto.productLineId }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.usage !== undefined && { usage: dto.usage }),
        ...(dto.warnings !== undefined && { warnings: dto.warnings }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
      ...productWithRelations,
    });

    return this.mapToPublishedProduct(updated, true);
  }

  // ---------------------------------------------------------------------------
  // SKU Operations
  // ---------------------------------------------------------------------------

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
      isActive: sku.isActive,
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

  async getSkuValidationStatus(skuId: string): Promise<SkuValidationStatus | null> {
    if (!this.isUuid(skuId)) {
      return null;
    }

    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { product: true },
    });

    if (!sku) {
      return null;
    }

    return {
      exists: true,
      isActive: sku.isActive,
      isProductPublished: sku.product.isPublished,
    };
  }

  async createSku(productId: string, dto: CreateSkuDto): Promise<PublishedSku> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${productId}`);
    }

    const existingCode = await this.prisma.sku.findUnique({
      where: { code: dto.code },
    });
    if (existingCode) {
      throw new ConflictException(`A SKU with code '${dto.code}' already exists`);
    }

    if (dto.barcode) {
      const existingBarcode = await this.prisma.sku.findUnique({
        where: { barcode: dto.barcode },
      });
      if (existingBarcode) {
        throw new ConflictException(`A SKU with barcode '${dto.barcode}' already exists`);
      }
    }

    const sku = await this.prisma.sku.create({
      data: {
        productId,
        code: dto.code,
        variantName: dto.variantName,
        size: dto.size !== undefined ? new Prisma.Decimal(dto.size) : null,
        sizeUnit: dto.sizeUnit ?? null,
        barcode: dto.barcode ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    return {
      id: sku.id,
      code: sku.code,
      variantName: sku.variantName,
      size: sku.size ? sku.size.toNumber() : null,
      sizeUnit: sku.sizeUnit,
      barcode: sku.barcode,
      isActive: sku.isActive,
    };
  }

  async updateSku(id: string, dto: UpdateSkuDto): Promise<PublishedSku> {
    const sku = await this.prisma.sku.findUnique({
      where: { id },
    });
    if (!sku) {
      throw new NotFoundException(`SKU not found with id: ${id}`);
    }

    if (dto.code && dto.code !== sku.code) {
      const existingCode = await this.prisma.sku.findFirst({
        where: { code: dto.code, NOT: { id } },
      });
      if (existingCode) {
        throw new ConflictException(`A SKU with code '${dto.code}' already exists`);
      }
    }

    if (dto.barcode && dto.barcode !== sku.barcode) {
      const existingBarcode = await this.prisma.sku.findFirst({
        where: { barcode: dto.barcode, NOT: { id } },
      });
      if (existingBarcode) {
        throw new ConflictException(`A SKU with barcode '${dto.barcode}' already exists`);
      }
    }

    const updated = await this.prisma.sku.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.variantName !== undefined && { variantName: dto.variantName }),
        ...(dto.size !== undefined && {
          size: dto.size !== null ? new Prisma.Decimal(dto.size) : null,
        }),
        ...(dto.sizeUnit !== undefined && { sizeUnit: dto.sizeUnit }),
        ...(dto.barcode !== undefined && { barcode: dto.barcode }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return {
      id: updated.id,
      code: updated.code,
      variantName: updated.variantName,
      size: updated.size ? updated.size.toNumber() : null,
      sizeUnit: updated.sizeUnit,
      barcode: updated.barcode,
      isActive: updated.isActive,
    };
  }

  async getSkus(productId: string): Promise<PublishedSku[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${productId}`);
    }

    const skus = await this.prisma.sku.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });

    return skus.map((s) => ({
      id: s.id,
      code: s.code,
      variantName: s.variantName,
      size: s.size ? s.size.toNumber() : null,
      sizeUnit: s.sizeUnit,
      barcode: s.barcode,
      isActive: s.isActive,
    }));
  }

  // ---------------------------------------------------------------------------
  // ProductMedia Operations
  // ---------------------------------------------------------------------------

  async addMedia(productId: string, dto: CreateProductMediaDto): Promise<PublishedMedia> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${productId}`);
    }

    if (dto.isPrimary) {
      await this.prisma.productMedia.updateMany({
        where: { productId },
        data: { isPrimary: false },
      });
    }

    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        type: dto.type,
        url: dto.url,
        altText: dto.altText ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isPrimary: dto.isPrimary ?? false,
        originType: dto.originType ?? MediaOriginType.verified,
        generationMetadata: (dto.generationMetadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    return {
      id: media.id,
      type: media.type,
      url: media.url,
      altText: media.altText,
      sortOrder: media.sortOrder,
      isPrimary: media.isPrimary,
      originType: media.originType,
    };
  }

  async updateMedia(id: string, dto: UpdateProductMediaDto): Promise<PublishedMedia> {
    const media = await this.prisma.productMedia.findUnique({
      where: { id },
    });
    if (!media) {
      throw new NotFoundException(`ProductMedia not found with id: ${id}`);
    }

    if (dto.isPrimary) {
      await this.prisma.productMedia.updateMany({
        where: { productId: media.productId, NOT: { id } },
        data: { isPrimary: false },
      });
    }

    const updated = await this.prisma.productMedia.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.altText !== undefined && { altText: dto.altText }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
        ...(dto.originType !== undefined && { originType: dto.originType }),
        ...(dto.generationMetadata !== undefined && {
          generationMetadata: dto.generationMetadata as Prisma.InputJsonValue,
        }),
      },
    });

    return {
      id: updated.id,
      type: updated.type,
      url: updated.url,
      altText: updated.altText,
      sortOrder: updated.sortOrder,
      isPrimary: updated.isPrimary,
      originType: updated.originType,
    };
  }

  async deleteMedia(id: string): Promise<void> {
    const media = await this.prisma.productMedia.findUnique({
      where: { id },
    });
    if (!media) {
      throw new NotFoundException(`ProductMedia not found with id: ${id}`);
    }

    await this.prisma.productMedia.delete({
      where: { id },
    });
  }

  async getMedia(productId: string): Promise<PublishedMedia[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${productId}`);
    }

    const items = await this.prisma.productMedia.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });

    return items.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      altText: m.altText,
      sortOrder: m.sortOrder,
      isPrimary: m.isPrimary,
      originType: m.originType,
    }));
  }

  // ---------------------------------------------------------------------------
  // Private Mapper
  // ---------------------------------------------------------------------------

  private mapToPublishedProduct(
    product: ProductWithRelations,
    includeAll = false,
  ): PublishedProduct {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      usage: product.usage,
      warnings: product.warnings,
      isPublished: product.isPublished,
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
        .filter((sku) => (includeAll ? true : sku.isActive))
        .map((sku) => ({
          id: sku.id,
          code: sku.code,
          variantName: sku.variantName,
          size: sku.size ? sku.size.toNumber() : null,
          sizeUnit: sku.sizeUnit,
          barcode: sku.barcode,
          isActive: sku.isActive,
        })),
      media: product.media
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({
          id: m.id,
          type: m.type,
          url: m.url,
          altText: m.altText,
          sortOrder: m.sortOrder,
          isPrimary: m.isPrimary,
          originType: m.originType,
        })),
    };
  }
}
