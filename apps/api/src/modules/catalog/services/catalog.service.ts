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
import { requireMediaReview } from '../../../platform/security/media-review';
import { MEDIA_STORAGE_PORT, MediaStoragePort } from '../../../platform/storage/media-storage.port';
import { Inject } from '@nestjs/common';

/** A reviewer-confirmed usage rule from the product's own directions (GLO-279); see catalog.product_usage_rules. */
export interface ReviewedUsageRuleInput {
  targetArea: 'FACE' | 'EYE_CONTOUR' | 'LIPS' | 'BODY' | 'SCALP' | 'HAIR' | null;
  routinePeriod: 'AM' | 'PM' | 'BOTH' | 'UNKNOWN';
  rinseMode: 'RINSE_OFF' | 'LEAVE_ON' | 'UNKNOWN';
  frequencyUnit: 'DAY' | 'WEEK' | 'AS_NEEDED' | 'UNKNOWN';
  usesMin: number | null;
  usesMax: number | null;
  contactMinutes: number | null;
  contactIsMaximum: boolean;
  condition: string | null;
  evidenceText: string;
  sourceUrl: string;
  sourceType: string;
  retrievedAt: Date | null;
  reviewedBy: string;
  reviewedAt: Date;
  sourceCandidateId: string | null;
}

/** A concentration the manufacturer/label states for this product, with evidence. */
export interface StatedConcentrationInput {
  ingredientId: string;
  value: number;
  unit: string;
  evidence: { sourceUrl: string; sourceType: string; evidenceText: string; reviewedBy: string; reviewedAt: string };
}

/** One reviewed key active of a product, as the routine engine reads it. */
export interface RoutineActiveFact {
  ingredientId: string;
  ingredientSlug: string;
  familySlug: string | null;
  concentrationValue: number | null;
  concentrationUnit: string | null;
  /** The stated concentration carries evidence (source + reviewer); never inferred. */
  concentrationVerified: boolean;
  concentrationReviewedAt: string | null;
}

/** What the routine engine may rely on for one published product: reviewed facts only, nothing inferred. */
export interface RoutineProductFacts {
  productId: string;
  name: string;
  brandName: string;
  skus: Array<{ id: string; size: number | null; sizeUnit: string | null; isActive: boolean }>;
  imageUrl: string | null;
  actives: RoutineActiveFact[];
  ingredientIds: string[];
  ingredientSlugs: string[];
  ingredientFamilies: string[];
  usageRules: Array<{
    skuId: string | null; targetArea: string | null; routinePeriod: string; rinseMode: string; frequencyUnit: string;
    usesMin: number | null; usesMax: number | null; condition: string | null; reviewedAt: string;
  }>;
}

export interface PublishedSku {
  id: string;
  code: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
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
  skuId: string | null;
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
  concerns: string[];
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

export interface SkuLabel {
  skuId: string;
  productName: string;
  brandName: string | null;
  variantName: string;
  skuCode: string;
  barcode: string | null;
  size?: number | null;
  sizeUnit?: string | null;
  imageUrl?: string | null;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_PORT) private readonly mediaPort: MediaStoragePort,
  ) {}

  /** Internal keyset scan; composition applies Commerce/availability before pagination. */
  async scanPublishedProducts(filters: { q?: string; category?: string; brand?: string; productLine?: string }, snapshotAt: Date, afterId?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        isPublished: true, createdAt: { lte: snapshotAt },
        ...(afterId && { id: { gt: afterId } }),
        ...(filters.category && { category: { OR: [{ slug: filters.category }, { parent: { slug: filters.category } }] } }),
        ...(filters.brand && { brand: { slug: filters.brand } }),
        ...(filters.productLine && { productLine: { slug: filters.productLine } }),
        ...(filters.q && { OR: [
          { name: { contains: filters.q, mode: 'insensitive' as const } },
          { brand: { name: { contains: filters.q, mode: 'insensitive' as const } } },
          { skus: { some: { isActive: true, OR: [
            { code: { contains: filters.q, mode: 'insensitive' as const } },
            { barcode: { contains: filters.q, mode: 'insensitive' as const } },
            { variantName: { contains: filters.q, mode: 'insensitive' as const } },
          ] } } },
        ] }),
      },
      orderBy: { id: 'asc' }, take: 100, ...productWithRelations,
    });
    return {
      products: products.map(p => this.mapToPublishedProduct(p)).filter(p => p.media.length && p.skus.length),
      nextAfterId: products.length === 100 ? products[products.length - 1].id : null,
    };
  }

  /** Batch hydrate ranked provider identities without crossing the Catalog boundary. */
  async getPublishedProductsByIds(ids: string[]): Promise<PublishedProduct[]> {
    if (!ids.length) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, isPublished: true }, ...productWithRelations,
    });
    return products.map(p => this.mapToPublishedProduct(p)).filter(p => p.media.length && p.skus.length);
  }

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

    if (!product || !product.isPublished || !this.mapToPublishedProduct(product).media.length) {
      return null;
    }

    return this.mapToPublishedProduct(product);
  }

  async getReviewedIdentityFacts(productId: string, skuIds: string[]) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, isPublished: true }, ...productWithRelations });
    if (!product) return [];
    return product.media.filter(m => this.isReviewedProductMedia(m, product.skus)).flatMap(m => {
      const review = requireMediaReview(m.generationMetadata);
      if (!review.skuId || !skuIds.includes(review.skuId)) return [];
      return (['barcode', 'size', 'sizeUnit', 'variantName'] as const).map(field => ({
        skuId: review.skuId!, field, value: review[field], sourceUrl: review.sourceUrl,
        sourceType: review.sourceType, verifiedAt: review.reviewedAt,
      }));
    }).filter((fact, index, all) => all.findIndex(f => f.skuId === fact.skuId && f.field === fact.field) === index);
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
      media: { some: { originType: MediaOriginType.verified, generationMetadata: { path: ['isTest'], equals: false } } },
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

    return products.map((p) => this.mapToPublishedProduct(p)).filter(p => p.media.length > 0 && p.skus.length > 0);
  }

  async countPublishedProducts(filters?: {
    categorySlug?: string;
    brandSlug?: string;
    productLineSlug?: string;
  }): Promise<number> {
    const where = {
      isPublished: true,
      media: { some: { originType: MediaOriginType.verified, generationMetadata: { path: ['isTest'], equals: false } } },
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
        concerns: dto.concerns ?? [],
        isPublished: dto.isPublished ?? false,
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
        ...(dto.concerns !== undefined && { concerns: dto.concerns }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
      ...productWithRelations,
    });

    return this.mapToPublishedProduct(updated, true);
  }

  /** Add only reviewer-approved canonical ingredient links; never replace an existing formula. */
  async addReviewedProductIngredients(productId: string, ingredientIds: string[]): Promise<void> {
    if (!ingredientIds.length) return;
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const uniqueIds = [...new Set(ingredientIds)];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: uniqueIds }, status: 'APPROVED' }, select: { id: true },
    });
    if (ingredients.length !== uniqueIds.length) throw new BadRequestException('Unapproved or unknown ingredient selection');
    await this.prisma.productIngredient.createMany({
      data: uniqueIds.map((ingredientId, sortOrder) => ({ productId, ingredientId, isKeyActive: true, sortOrder })),
      skipDuplicates: true,
    });
  }

  /**
   * GLO-279: stores reviewer-confirmed usage rules for one SKU. Existing reviewed rules are never silently replaced by a
   * later publication (another supplier's candidate): returns false so the caller records that a re-review is needed.
   */
  async addReviewedUsageRules(productId: string, skuId: string, rules: ReviewedUsageRuleInput[]): Promise<boolean> {
    if (!rules.length) return false;
    return this.prisma.$transaction(async tx => {
      if (await tx.productUsageRule.count({ where: { skuId } })) return false;
      await tx.productUsageRule.createMany({ data: rules.map(rule => ({ ...rule, productId, skuId })) });
      return true;
    });
  }

  /** Typed concentrations explicitly stated for this product, with their evidence (never inferred from INCI order). */
  async setStatedConcentrations(productId: string, entries: StatedConcentrationInput[]): Promise<void> {
    for (const entry of entries) {
      await this.prisma.productIngredient.updateMany({
        where: { productId, ingredientId: entry.ingredientId, concentrationValue: null },
        data: { concentrationValue: entry.value, concentrationUnit: entry.unit, concentration: `${entry.value}${entry.unit}`,
          concentrationEvidence: entry.evidence as Prisma.InputJsonValue },
      });
    }
  }

  /**
   * Reviewed facts of published products for the routine engine (care module): key actives with stated
   * concentrations and their evidence, the full reviewed ingredient set, and reviewed usage rules.
   */
  async getRoutineProductFacts(productIds: string[]): Promise<RoutineProductFacts[]> {
    const ids = [...new Set(productIds)].filter(id => this.isUuid(id));
    if (!ids.length) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, isPublished: true },
      include: {
        brand: true,
        skus: true,
        media: { where: { isPrimary: true }, take: 1 },
        productIngredients: { include: { ingredient: true } },
        usageRules: true,
      },
      orderBy: { id: 'asc' },
    });
    return products.map(p => ({
      productId: p.id,
      name: p.name,
      brandName: p.brand.name,
      skus: p.skus.map(sku => ({ id: sku.id, size: sku.size === null ? null : Number(sku.size), sizeUnit: sku.sizeUnit ?? null, isActive: sku.isActive })),
      imageUrl: p.media[0]?.url ?? null,
      actives: p.productIngredients
        .filter(pi => pi.isKeyActive && pi.ingredient.status === 'APPROVED')
        .map(pi => {
          const evidence = (pi.concentrationEvidence ?? null) as { reviewedAt?: string; sourceUrl?: string } | null;
          return {
            ingredientId: pi.ingredientId,
            ingredientSlug: pi.ingredient.slug,
            familySlug: pi.ingredient.familySlug ?? null,
            concentrationValue: pi.concentrationValue === null ? null : Number(pi.concentrationValue),
            concentrationUnit: pi.concentrationUnit ?? null,
            concentrationVerified: pi.concentrationValue !== null && !!evidence?.sourceUrl,
            concentrationReviewedAt: evidence?.reviewedAt ?? null,
          };
        }),
      ingredientIds: p.productIngredients.map(pi => pi.ingredientId),
      ingredientSlugs: p.productIngredients.map(pi => pi.ingredient.slug),
      ingredientFamilies: [...new Set(p.productIngredients.map(pi => pi.ingredient.familySlug).filter((f): f is string => !!f))],
      usageRules: p.usageRules.map(r => ({
        skuId: r.skuId, targetArea: r.targetArea, routinePeriod: r.routinePeriod, rinseMode: r.rinseMode,
        frequencyUnit: r.frequencyUnit, usesMin: r.usesMin, usesMax: r.usesMax, condition: r.condition,
        reviewedAt: r.reviewedAt.toISOString(),
      })),
    }));
  }

  /** Reviewed usage rules for the given SKUs, for product detail / routine building. */
  async getReviewedUsageRules(skuIds: string[]) {
    if (!skuIds.length) return [];
    return this.prisma.productUsageRule.findMany({
      where: { skuId: { in: skuIds } },
      orderBy: [{ skuId: 'asc' }, { condition: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      select: { skuId: true, targetArea: true, routinePeriod: true, rinseMode: true, frequencyUnit: true, usesMin: true, usesMax: true,
        contactMinutes: true, contactIsMaximum: true, condition: true, evidenceText: true, sourceUrl: true, reviewedAt: true },
    });
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
      packCount: sku.packCount,
      barcode: sku.barcode,
      isActive: sku.isActive,
    };
  }

  /** Human labels for operational screens (PO lines, picking): product/brand/variant/code/barcode, never prices. */
  async getSkuLabels(skuIds: string[]): Promise<Map<string, SkuLabel>> {
    const ids = [...new Set(skuIds)].filter(id => this.isUuid(id));
    if (!ids.length) return new Map();
    const rows = await this.prisma.sku.findMany({
      where: { id: { in: ids } },
      include: {
        product: {
          include: {
            brand: true,
            media: {
              where: { originType: { not: 'generated' } },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
            },
          },
        },
      },
    });
    return new Map(rows.map(sku => {
      const primaryMedia = sku.product.media[0];
      return [sku.id, {
        skuId: sku.id,
        productName: sku.product.name,
        brandName: sku.product.brand?.name ?? null,
        variantName: sku.variantName,
        skuCode: sku.code,
        barcode: sku.barcode,
        size: sku.size ? sku.size.toNumber() : null,
        sizeUnit: sku.sizeUnit,
        imageUrl: primaryMedia?.url ?? null,
      }];
    }));
  }

  /** Stable identity lookup for internal custody workflows, including inactive catalog items. */
  async getSkuIdentity(skuId: string): Promise<PublishedSku | null> {
    if (!this.isUuid(skuId)) return null;
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
    if (!sku) return null;
    return {
      id: sku.id,
      code: sku.code,
      variantName: sku.variantName,
      size: sku.size ? sku.size.toNumber() : null,
      sizeUnit: sku.sizeUnit,
      packCount: sku.packCount,
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

  async getSkuByBarcode(barcode: string): Promise<PublishedSku | null> {
    const sku = await this.prisma.sku.findFirst({
      where: { barcode, isActive: true },
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
      packCount: sku.packCount,
      barcode: sku.barcode,
      isActive: sku.isActive,
    };
  }

  async getSkuValidationStatus(skuId: string): Promise<SkuValidationStatus | null> {
    if (!this.isUuid(skuId)) {
      return null;
    }

    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { product: { include: { skus: true, media: true } } },
    });

    if (!sku) {
      return null;
    }

    return {
      exists: true,
      isActive: sku.isActive,
      isProductPublished: sku.product.isPublished && sku.product.media.some(m => this.isReviewedProductMedia(m, [sku])),
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
        packCount: dto.packCount ?? null,
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
      packCount: sku.packCount,
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
        ...(dto.packCount !== undefined && { packCount: dto.packCount }),
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
      packCount: updated.packCount,
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
      packCount: s.packCount,
      barcode: s.barcode,
      isActive: s.isActive,
    }));
  }

  // ---------------------------------------------------------------------------
  // ProductMedia Operations
  // ---------------------------------------------------------------------------

  async addMedia(productId: string, dto: CreateProductMediaDto, reviewerId?: string): Promise<PublishedMedia> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException(`Product not found with id: ${productId}`);
    }

    if (!dto.originType) throw new BadRequestException('Explicit media origin required; uploads are not automatically verified');
    if (dto.originType === MediaOriginType.verified) {
      await this.validateVerifiedMedia(productId, dto.generationMetadata, reviewerId);
    }

    if (dto.isPrimary) {
      await this.prisma.productMedia.updateMany({
        where: { productId },
        data: { isPrimary: false },
      });
    }

    const media = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${productId + ':' + dto.url}))`;
      const existing = await tx.productMedia.findFirst({ where: { productId, url: dto.url } });
      if (existing) {
        if (dto.originType === MediaOriginType.verified) {
          return tx.productMedia.update({ where: { id: existing.id }, data: {
            originType: dto.originType, generationMetadata: dto.generationMetadata as Prisma.InputJsonValue,
          } });
        }
        return existing;
      }
      return tx.productMedia.create({
        data: {
        productId,
        type: dto.type,
        url: dto.url,
        altText: dto.altText ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isPrimary: dto.isPrimary ?? false,
        originType: dto.originType,
        generationMetadata: (dto.generationMetadata as Prisma.InputJsonValue) ?? undefined,
        },
      });
    });

    return {
      id: media.id,
      skuId: typeof (media.generationMetadata as any)?.skuId === 'string' ? (media.generationMetadata as any).skuId : null,
      type: media.type,
      url: this.mediaPort.getDeliveryUrl(media.url),
      altText: media.altText,
      sortOrder: media.sortOrder,
      isPrimary: media.isPrimary,
      originType: media.originType,
    };
  }

  async updateMedia(id: string, dto: UpdateProductMediaDto, reviewerId?: string): Promise<PublishedMedia> {
    const media = await this.prisma.productMedia.findUnique({
      where: { id },
    });
    if (!media) {
      throw new NotFoundException(`ProductMedia not found with id: ${id}`);
    }

    if ((dto.originType ?? media.originType) === MediaOriginType.verified) {
      if (dto.url !== undefined && dto.url !== media.url && dto.generationMetadata === undefined) {
        throw new BadRequestException('Changing verified media requires a new review');
      }
      await this.validateVerifiedMedia(media.productId, dto.generationMetadata ?? media.generationMetadata, reviewerId);
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
      skuId: typeof (updated.generationMetadata as any)?.skuId === 'string' ? (updated.generationMetadata as any).skuId : null,
      type: updated.type,
      url: this.mediaPort.getDeliveryUrl(updated.url),
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

    if (media.url.startsWith('cloudinary://')) {
      await this.mediaPort.delete(media.url);
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
      skuId: typeof (m.generationMetadata as any)?.skuId === 'string' ? (m.generationMetadata as any).skuId : null,
      type: m.type,
      url: this.mediaPort.getDeliveryUrl(m.url),
      altText: m.altText,
      sortOrder: m.sortOrder,
      isPrimary: m.isPrimary,
      originType: m.originType,
    }));
  }

  private isReviewedProductMedia(media: { originType: string; generationMetadata: unknown }, skus: ProductWithRelations['skus']): boolean {
    try {
      if (media.originType !== MediaOriginType.verified) return false;
      const review = requireMediaReview(media.generationMetadata);
      return skus.some(sku => sku.id === review.skuId && sku.isActive && sku.barcode === review.barcode &&
        sku.size?.toNumber() === review.size && sku.sizeUnit === review.sizeUnit && sku.variantName === review.variantName);
    } catch { return false; }
  }

  private async validateVerifiedMedia(productId: string, metadata: unknown, reviewerId?: string): Promise<void> {
    const review = requireMediaReview(metadata);
    if (!reviewerId || reviewerId !== review.reviewedBy) throw new BadRequestException('Authenticated media reviewer required');
    const reviewer = await this.prisma.customer.findUnique({ where: { id: reviewerId } });
    if (!reviewer?.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')) {
      throw new BadRequestException('Authorized media reviewer required');
    }
    const sku = review.skuId ? await this.prisma.sku.findUnique({ where: { id: review.skuId } }) : null;
    if (!sku || sku.productId !== productId || sku.barcode !== review.barcode || sku.size?.toNumber() !== review.size ||
        sku.sizeUnit !== review.sizeUnit || sku.variantName !== review.variantName) {
      throw new BadRequestException('Media review must match the Product/SKU/size/variant');
    }
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
      description: includeAll ? product.description : null,
      usage: includeAll ? product.usage : null,
      warnings: includeAll ? product.warnings : null,
      concerns: product.concerns,
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
          packCount: sku.packCount,
          barcode: sku.barcode,
          isActive: sku.isActive,
        })),
      media: product.media
        .filter(m => includeAll || this.isReviewedProductMedia(m, product.skus))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({
          id: m.id,
          skuId: typeof (m.generationMetadata as any)?.skuId === 'string' ? (m.generationMetadata as any).skuId : null,
          type: m.type,
          url: this.mediaPort.getDeliveryUrl(m.url),
          altText: m.altText,
          sortOrder: m.sortOrder,
          isPrimary: m.isPrimary,
          originType: m.originType,
        })),
    };
  }
}
