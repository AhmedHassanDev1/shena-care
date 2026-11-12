import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, MediaOriginType, MediaRole, SafetyWarningKind } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreateProductDto, UpdateProductDto } from '../dto/product.dto';
import { CreateSkuDto, UpdateSkuDto } from '../dto/sku.dto';
import { CreateProductMediaDto, UpdateProductMediaDto } from '../dto/media.dto';
import { slugify } from '../utils/slug.util';
import { normalizeSearchText } from '../search/search-text';
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
  applicationQuantity?: number | null;
  applicationUnit?: string | null;
  contactMinutes: number | null;
  contactIsMaximum?: boolean;
  condition: string | null;
  isIntroductory?: boolean;
  phaseOrder?: number | null;
  phaseWeeksMin?: number | null;
  phaseWeeksMax?: number | null;
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
  skuId?: string | null;
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
  targetArea?: string | null;
  texture?: string | null;
  suitableSkinTypes?: string[];
  suitableHairTypes?: string[];
  spf?: number | null;
  broadSpectrum?: boolean | null;
  uvFilterType?: string | null;
  waterResistanceMinutes?: number | null;
  isFragranceFree?: boolean | null;
  isNonComedogenic?: boolean | null;
  claimsEvidence?: Record<string, unknown> | null;
  factVersion?: number;
  lastReviewedAt?: string | null;
  skus: Array<{ id: string; size: number | null; sizeUnit: string | null; isActive: boolean; estimatedDaysOfUse?: number | null }>;
  imageUrl: string | null;
  actives: RoutineActiveFact[];
  productIngredients?: Array<{
    ingredientId: string;
    skuId?: string | null;
    ingredientSlug: string;
    familySlug: string | null;
    isKeyActive: boolean;
    concentrationValue: number | null;
    concentrationUnit: string | null;
  }>;
  ingredientIds: string[];
  ingredientSlugs: string[];
  ingredientFamilies: string[];
  safetyWarnings?: Array<{
    id: string;
    skuId?: string | null;
    kind: string;
    condition: string | null;
    descriptionEn: string;
    descriptionAr: string | null;
  }>;
  usageRules: Array<{
    skuId: string | null; targetArea: string | null; routinePeriod: string; rinseMode: string; frequencyUnit: string;
    usesMin: number | null; usesMax: number | null; applicationQuantity: number | null; applicationUnit: string | null;
    isIntroductory: boolean; phaseOrder: number | null; condition: string | null; reviewedAt: string;
  }>;
}

export interface PublicProductIngredientFact {
  skuId: string | null;
  name: string;
  nameAr: string | null;
  inciName: string;
  primaryFunction: string;
  isActiveIngredient: boolean;
  isKeyActive: boolean;
  concentration: string | null;
  concentrationStatus: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  visualUrl: string | null;
}

export interface PublicSafetyWarningFact {
  id: string;
  skuId: string | null;
  kind: string;
  condition: string | null;
  descriptionEn: string;
  descriptionAr: string | null;
}

export interface PublicKeyIngredientClaim {
  name: string;
  function: string | null;
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
  estimatedDaysOfUse?: number | null;
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
  /** Explicit display role: CATEGORY_EDITORIAL leads the PDP, PRIMARY_PACKSHOT identifies the product in compact contexts. */
  role: string | null;
}

export interface PublishedProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  concerns: string[];
  targetArea?: string | null;
  texture?: string | null;
  suitableSkinTypes?: string[];
  suitableHairTypes?: string[];
  spf?: number | null;
  broadSpectrum?: boolean | null;
  uvFilterType?: string | null;
  waterResistanceMinutes?: number | null;
  isFragranceFree?: boolean | null;
  isNonComedogenic?: boolean | null;
  claimsEvidence?: Record<string, unknown> | null;
  factVersion?: number;
  lastReviewedAt?: string | null;
  lastReviewedBy?: string | null;
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
  // Keep catalog reads scoped to the published contract. Selecting every scalar
  // also selects columns introduced by a pending catalog migration.
  select: {
    id: true,
    brandId: true,
    name: true,
    slug: true,
    description: true,
    usage: true,
    warnings: true,
    concerns: true,
    targetArea: true,
    texture: true,
    suitableSkinTypes: true,
    suitableHairTypes: true,
    spf: true,
    broadSpectrum: true,
    uvFilterType: true,
    waterResistanceMinutes: true,
    isFragranceFree: true,
    isNonComedogenic: true,
    claimsEvidence: true,
    factVersion: true,
    lastReviewedAt: true,
    lastReviewedBy: true,
    isPublished: true,
    brand: { select: { id: true, name: true, slug: true } },
    productLine: { select: { id: true, name: true, slug: true } },
    category: { select: { id: true, name: true, slug: true, parentId: true } },
    skus: true,
    media: true,
  },
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

export interface SkuIdentityCandidateRequest {
  key: string;
  brandId: string;
  query: string;
  size: number | null;
  sizeUnit: string | null;
}

export interface SkuIdentityCandidate {
  skuId: string;
  code: string;
  productId: string;
  productName: string;
  brandName: string;
  spf: number | null;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
  barcode: string | null;
  isActive: boolean;
  barcodeAliases: string[];
  textScore: number;
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
        targetArea: dto.targetArea ?? null,
        texture: dto.texture ?? null,
        suitableSkinTypes: dto.suitableSkinTypes ?? [],
        suitableHairTypes: dto.suitableHairTypes ?? [],
        spf: dto.spf ?? null,
        broadSpectrum: dto.broadSpectrum ?? null,
        uvFilterType: dto.uvFilterType ?? null,
        waterResistanceMinutes: dto.waterResistanceMinutes ?? null,
        isFragranceFree: dto.isFragranceFree ?? null,
        isNonComedogenic: dto.isNonComedogenic ?? null,
        claimsEvidence: (dto.claimsEvidence as Prisma.InputJsonValue) ?? null,
        factVersion: dto.factVersion ?? 1,
        lastReviewedAt: dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : null,
        lastReviewedBy: dto.lastReviewedBy ?? null,
        isPublished: dto.isPublished ?? false,
      },
      ...productWithRelations,
    });

    return this.mapToPublishedProduct(created, true);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<PublishedProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { ...productWithRelations.select, archivedAt: true },
    });
    if (product?.archivedAt && dto.isPublished) throw new ConflictException('Archived product must be restored before publication');
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
      const brand = await this.prisma.brand.findUnique({ where: { id: targetBrandId }, select: { name: true } });
      const brandPrefix = brand ? `${brand.name}-` : '';
      slug = slugify(`${brandPrefix}${dto.name}`);
    }

    if (slug !== product.slug) {
      const existingSlug = await this.prisma.product.findFirst({
        where: { slug, NOT: { id } },
        select: { id: true },
      });
      if (existingSlug) {
        throw new ConflictException(`A product with slug '${slug}' already exists`);
      }
    }

    if (dto.isFragranceFree === true) {
      const fragrance = await this.prisma.productIngredient.findFirst({
        where: {
          productId: id,
          ingredient: {
            OR: [
              { primaryFunction: { equals: 'Fragrance', mode: 'insensitive' } },
              { slug: { in: ['fragrance', 'parfum'] } },
            ],
          },
        },
        include: { ingredient: true },
      });
      if (fragrance) {
        throw new BadRequestException(
          `Cannot mark product fragrance-free: linked ingredient '${fragrance.ingredient.name}' is fragrance (contradictory fact)`,
        );
      }
    }

    const updated = await this.prisma.product.update({
      where: dto.isPublished ? { id, archivedAt: null } : { id },
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
        ...(dto.targetArea !== undefined && { targetArea: dto.targetArea }),
        ...(dto.texture !== undefined && { texture: dto.texture }),
        ...(dto.suitableSkinTypes !== undefined && { suitableSkinTypes: dto.suitableSkinTypes }),
        ...(dto.suitableHairTypes !== undefined && { suitableHairTypes: dto.suitableHairTypes }),
        ...(dto.spf !== undefined && { spf: dto.spf }),
        ...(dto.broadSpectrum !== undefined && { broadSpectrum: dto.broadSpectrum }),
        ...(dto.uvFilterType !== undefined && { uvFilterType: dto.uvFilterType }),
        ...(dto.waterResistanceMinutes !== undefined && { waterResistanceMinutes: dto.waterResistanceMinutes }),
        ...(dto.isFragranceFree !== undefined && { isFragranceFree: dto.isFragranceFree }),
        ...(dto.isNonComedogenic !== undefined && { isNonComedogenic: dto.isNonComedogenic }),
        ...(dto.claimsEvidence !== undefined && {
          claimsEvidence: dto.claimsEvidence as Prisma.InputJsonValue,
        }),
        ...(dto.factVersion !== undefined && { factVersion: dto.factVersion }),
        ...(dto.lastReviewedAt !== undefined && {
          lastReviewedAt: dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : null,
        }),
        ...(dto.lastReviewedBy !== undefined && { lastReviewedBy: dto.lastReviewedBy }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
      ...productWithRelations,
    });

    return this.mapToPublishedProduct(updated, true);
  }

  /** Add only reviewer-approved canonical ingredient links; optionally scoped to a SKU; never replace an existing formula. */
  async addReviewedProductIngredients(productId: string, ingredientIds: string[], skuId?: string): Promise<void> {
    if (!ingredientIds.length) return;
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, isFragranceFree: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (skuId) {
      const sku = await this.prisma.sku.findUnique({ where: { id: skuId } });
      if (!sku || sku.productId !== productId) throw new BadRequestException('Target SKU does not belong to this product');
    }
    const uniqueIds = [...new Set(ingredientIds)];
    const ingredients = await this.prisma.ingredient.findMany({
      where: { id: { in: uniqueIds }, status: 'APPROVED' }, select: { id: true, name: true, slug: true, primaryFunction: true },
    });
    if (ingredients.length !== uniqueIds.length) throw new BadRequestException('Unapproved or unknown ingredient selection');
    if (product.isFragranceFree) {
      const fragrance = ingredients.find(
        i => i.primaryFunction?.toLowerCase() === 'fragrance' || ['fragrance', 'parfum'].includes(i.slug.toLowerCase()),
      );
      if (fragrance) {
        throw new BadRequestException(
          `Cannot link fragrance ingredient '${fragrance.name}' to a product declared fragrance-free (contradictory fact)`,
        );
      }
    }
    await this.prisma.productIngredient.createMany({
      data: uniqueIds.map((ingredientId, sortOrder) => ({
        productId,
        skuId: skuId ?? null,
        ingredientId,
        isKeyActive: true,
        sortOrder,
      })),
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
          concentrationEvidence: entry.evidence as Prisma.InputJsonValue, concentrationStatus: 'STATED' },
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
        safetyWarnings: { where: { isActive: true } },
      },
      orderBy: { id: 'asc' },
    });
    return products.map(p => ({
      productId: p.id,
      name: p.name,
      brandName: p.brand.name,
      targetArea: p.targetArea ?? null,
      texture: p.texture ?? null,
      suitableSkinTypes: p.suitableSkinTypes ?? [],
      suitableHairTypes: p.suitableHairTypes ?? [],
      spf: p.spf ?? null,
      broadSpectrum: p.broadSpectrum ?? null,
      uvFilterType: p.uvFilterType ?? null,
      waterResistanceMinutes: p.waterResistanceMinutes ?? null,
      isFragranceFree: p.isFragranceFree ?? null,
      isNonComedogenic: p.isNonComedogenic ?? null,
      claimsEvidence: (p.claimsEvidence as Record<string, unknown> | null) ?? null,
      factVersion: p.factVersion ?? 1,
      lastReviewedAt: p.lastReviewedAt ? p.lastReviewedAt.toISOString() : null,
      skus: p.skus.map(sku => ({
        id: sku.id,
        size: sku.size === null ? null : Number(sku.size),
        sizeUnit: sku.sizeUnit ?? null,
        isActive: sku.isActive,
        estimatedDaysOfUse: sku.estimatedDaysOfUse ?? null,
      })),
      imageUrl: p.media[0]?.url ?? null,
      actives: p.productIngredients
        .filter(pi => pi.isKeyActive && pi.ingredient.status === 'APPROVED')
        .map(pi => {
          const evidence = (pi.concentrationEvidence ?? null) as { reviewedAt?: string; sourceUrl?: string } | null;
          return {
            ingredientId: pi.ingredientId,
            skuId: pi.skuId ?? null,
            ingredientSlug: pi.ingredient.slug,
            familySlug: pi.ingredient.familySlug ?? null,
            concentrationValue: pi.concentrationValue === null ? null : Number(pi.concentrationValue),
            concentrationUnit: pi.concentrationUnit ?? null,
            concentrationVerified: pi.concentrationValue !== null && !!evidence?.sourceUrl,
            concentrationReviewedAt: evidence?.reviewedAt ?? null,
          };
        }),
      productIngredients: p.productIngredients.map(pi => ({
        ingredientId: pi.ingredientId,
        skuId: pi.skuId ?? null,
        ingredientSlug: pi.ingredient.slug,
        familySlug: pi.ingredient.familySlug ?? null,
        isKeyActive: pi.isKeyActive,
        concentrationValue: pi.concentrationValue === null ? null : Number(pi.concentrationValue),
        concentrationUnit: pi.concentrationUnit ?? null,
      })),
      ingredientIds: p.productIngredients.map(pi => pi.ingredientId),
      ingredientSlugs: p.productIngredients.map(pi => pi.ingredient.slug),
      ingredientFamilies: [...new Set(p.productIngredients.map(pi => pi.ingredient.familySlug).filter((f): f is string => !!f))],
      safetyWarnings: p.safetyWarnings?.map(sw => ({
        id: sw.id,
        skuId: sw.skuId ?? null,
        kind: sw.kind,
        condition: sw.condition,
        descriptionEn: sw.descriptionEn,
        descriptionAr: sw.descriptionAr,
      })) ?? [],
      usageRules: p.usageRules.map(r => ({
        skuId: r.skuId, targetArea: r.targetArea, routinePeriod: r.routinePeriod, rinseMode: r.rinseMode,
        frequencyUnit: r.frequencyUnit, usesMin: r.usesMin, usesMax: r.usesMax,
        applicationQuantity: r.applicationQuantity === null ? null : Number(r.applicationQuantity),
        applicationUnit: r.applicationUnit,
        isIntroductory: r.isIntroductory, phaseOrder: r.phaseOrder,
        condition: r.condition,
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

  /** Add structured safety warning (GLO-284 §4D). Supports optional skuId for formula/variant scoping. */
  async addProductSafetyWarning(productId: string, warning: {
    skuId?: string | null;
    kind: SafetyWarningKind;
    condition?: string | null;
    descriptionEn: string;
    descriptionAr?: string | null;
    sourceType: string;
    sourceUrl?: string | null;
    reviewedBy: string;
    reviewedAt?: Date;
  }) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (warning.skuId) {
      const sku = await this.prisma.sku.findUnique({ where: { id: warning.skuId } });
      if (!sku || sku.productId !== productId) {
        throw new BadRequestException('Target SKU does not belong to this product');
      }
    }
    return this.prisma.productSafetyWarning.create({
      data: {
        productId,
        skuId: warning.skuId ?? null,
        kind: warning.kind,
        condition: warning.condition ?? null,
        descriptionEn: warning.descriptionEn,
        descriptionAr: warning.descriptionAr ?? null,
        sourceType: warning.sourceType,
        sourceUrl: warning.sourceUrl ?? null,
        reviewedBy: warning.reviewedBy,
        reviewedAt: warning.reviewedAt ?? new Date(),
      },
    });
  }

  /** Get active structured safety warnings for a product. */
  async getProductSafetyWarnings(productId: string) {
    return this.prisma.productSafetyWarning.findMany({
      where: { productId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Public catalog facts for PDP composition: ordered ingredients, active warnings, and reviewed key ingredient claims. */
  async getProductDetailCatalogFacts(productId: string): Promise<{
    productIngredients: PublicProductIngredientFact[];
    safetyWarnings: PublicSafetyWarningFact[];
    keyIngredientsClaim: PublicKeyIngredientClaim[];
  }> {
    if (!this.isUuid(productId)) {
      return { productIngredients: [], safetyWarnings: [], keyIngredientsClaim: [] };
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isPublished: true },
      select: {
        claimsEvidence: true,
        productIngredients: {
          orderBy: { sortOrder: 'asc' },
          include: {
            ingredient: {
              select: {
                name: true,
                nameAr: true,
                inciName: true,
                primaryFunction: true,
                isActiveIngredient: true,
                descriptionEn: true,
                descriptionAr: true,
                visualUrl: true,
              },
            },
          },
        },
        safetyWarnings: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            skuId: true,
            kind: true,
            condition: true,
            descriptionEn: true,
            descriptionAr: true,
          },
        },
      },
    });
    if (!product) {
      return { productIngredients: [], safetyWarnings: [], keyIngredientsClaim: [] };
    }
    const claims =
      (product.claimsEvidence as { keyIngredients?: { items?: Array<{ name?: unknown; function?: unknown }> } } | null) ?? {};
    const keyIngredientsClaim = Array.isArray(claims.keyIngredients?.items)
      ? claims.keyIngredients!.items.flatMap((item) =>
          item && typeof item.name === 'string' && item.name.trim()
            ? [
                {
                  name: item.name.trim(),
                  function: typeof item.function === 'string' && item.function.trim() ? item.function.trim() : null,
                },
              ]
            : [],
        )
      : [];
    return {
      productIngredients: product.productIngredients.map((pi) => ({
        skuId: pi.skuId ?? null,
        name: pi.ingredient.name,
        nameAr: pi.ingredient.nameAr ?? null,
        inciName: pi.ingredient.inciName,
        primaryFunction: pi.ingredient.primaryFunction,
        isActiveIngredient: pi.ingredient.isActiveIngredient,
        isKeyActive: pi.isKeyActive,
        concentration:
          pi.concentrationValue !== null
            ? `${Number(pi.concentrationValue)}${pi.concentrationUnit ?? '%'}`
            : pi.concentration ?? null,
        concentrationStatus: pi.concentrationStatus,
        descriptionEn: pi.ingredient.descriptionEn ?? null,
        descriptionAr: pi.ingredient.descriptionAr ?? null,
        visualUrl: pi.ingredient.visualUrl ?? null,
      })),
      safetyWarnings: product.safetyWarnings.map((sw) => ({
        id: sw.id,
        skuId: sw.skuId ?? null,
        kind: sw.kind,
        condition: sw.condition ?? null,
        descriptionEn: sw.descriptionEn,
        descriptionAr: sw.descriptionAr ?? null,
      })),
      keyIngredientsClaim,
    };
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

  /** The identity facts of a SKU with its product and brand names, for evidence checks by other modules. */
  async getSkuEvidenceFacts(skuId: string): Promise<{ size: number | null; sizeUnit: string | null; packCount: number | null; productName: string; brandName: string } | null> {
    if (!this.isUuid(skuId)) return null;
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: {
      size: true, sizeUnit: true, packCount: true, product: { select: { name: true, brand: { select: { name: true } } } } } });
    if (!sku) return null;
    return { size: sku.size ? sku.size.toNumber() : null, sizeUnit: sku.sizeUnit, packCount: sku.packCount, productName: sku.product.name, brandName: sku.product.brand.name };
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

  /**
   * Top-K canonical SKUs per identity block, one SQL statement for the whole batch: the SKUs of the brand's K closest
   * products by trigram similarity, plus the K closest in the stated packaging (the only reachable block when an Arabic
   * row meets a Latin title). Retrieval only; callers rank and veto, and it proves nothing. Ties break on stable IDs.
   */
  async findSkuIdentityCandidates(requests: SkuIdentityCandidateRequest[], limit: number): Promise<Map<string, SkuIdentityCandidate[]>> {
    const result = new Map<string, SkuIdentityCandidate[]>();
    if (!requests.length) return result;
    const payload = requests.map(request => ({ ...request, query: normalizeSearchText(request.query) }));
    const score = Prisma.sql`public.similarity(catalog.search_normalize(p.name), r.query)`;
    const columns = Prisma.sql`s.id AS "skuId", s.code, s.product_id AS "productId", p.name AS "productName", p.spf,
      s.variant_name AS "variantName", s.size::float8 AS size, s.size_unit AS "sizeUnit", s.pack_count AS "packCount", s.barcode, s.is_active AS "isActive"`;
    // LIMIT gives the planner the true row count (a set-returning function otherwise estimates 100, enough to pay for JIT).
    // OFFSET 0 keeps the SKU probe a per-product index lookup instead of a hash join over every SKU in the catalog.
    const rows = await this.prisma.$queryRaw<Array<SkuIdentityCandidate & { key: string }>>(Prisma.sql`
      SELECT r.key, (SELECT b.name FROM catalog.brands b WHERE b.id = r."brandId") AS "brandName", c.*,
        COALESCE((SELECT array_agg(a.barcode ORDER BY a.barcode) FROM catalog.sku_barcode_aliases a WHERE a.sku_id = c."skuId" AND a.status = 'approved'), ARRAY[]::varchar[]) AS "barcodeAliases"
      FROM (SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x("key" text, "brandId" uuid, query text, size numeric, "sizeUnit" text) LIMIT ${payload.length}) r
      CROSS JOIN LATERAL (
        (SELECT ${columns}, p.score::float8 AS "textScore"
          FROM (SELECT p.id, p.name, p.spf, ${score} AS score FROM catalog.products p WHERE p.brand_id = r."brandId" ORDER BY score DESC, p.id LIMIT ${limit}) p
          CROSS JOIN LATERAL (SELECT * FROM catalog.skus s WHERE s.product_id = p.id OFFSET 0) s)
        UNION ALL
        (SELECT ${columns}, ${score}::float8 AS "textScore"
          FROM catalog.products p
          CROSS JOIN LATERAL (SELECT * FROM catalog.skus s WHERE s.product_id = p.id AND
            ((s.size = r.size AND lower(s.size_unit) = lower(r."sizeUnit")) OR (s.size * 1000 = r.size AND lower(s.size_unit) IN ('l', 'kg'))) OFFSET 0) s
          WHERE p.brand_id = r."brandId" AND r.size IS NOT NULL
          ORDER BY ${score} DESC, p.id, s.id LIMIT ${limit})
      ) c`);
    const seen = new Set<string>();
    for (const { key, ...candidate } of rows) {
      if (seen.has(`${key}|${candidate.skuId}`)) continue;
      seen.add(`${key}|${candidate.skuId}`);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(candidate);
    }
    return result;
  }

  /** The first verified image of each product, for reviewers. Never generated or derived media. */
  async getVerifiedProductImages(productIds: string[]): Promise<Map<string, string>> {
    if (!productIds.length) return new Map();
    const media = await this.prisma.productMedia.findMany({
      where: { productId: { in: productIds }, type: 'image', originType: MediaOriginType.verified },
      select: { productId: true, url: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    const images = new Map<string, string>();
    for (const { productId, url } of media) if (!images.has(productId)) images.set(productId, url);
    return images;
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
      include: { product: { select: { isPublished: true, media: true } } },
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

  /** Same published-media gate as getSkuValidationStatus, for public read batches. */
  async getSkuValidationStatuses(skuIds: string[]): Promise<Map<string, SkuValidationStatus>> {
    const ids = [...new Set(skuIds.filter(id => this.isUuid(id)))];
    if (!ids.length) return new Map();
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, isActive: true, barcode: true, size: true, sizeUnit: true, variantName: true,
        product: { select: { isPublished: true, media: { select: { originType: true, generationMetadata: true } } } },
      },
    });
    return new Map(skus.map(sku => [sku.id, {
      exists: true,
      isActive: sku.isActive,
      isProductPublished: sku.product.isPublished && sku.product.media.some(media => this.isReviewedProductMedia(media, [sku])),
    }]));
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
        estimatedDaysOfUse: dto.estimatedDaysOfUse ?? null,
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
      estimatedDaysOfUse: sku.estimatedDaysOfUse ?? null,
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
        ...(dto.estimatedDaysOfUse !== undefined && { estimatedDaysOfUse: dto.estimatedDaysOfUse }),
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
      estimatedDaysOfUse: updated.estimatedDaysOfUse ?? null,
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
    if (dto.originType === MediaOriginType.generated && (dto.role === MediaRole.PRIMARY_PACKSHOT || dto.role === MediaRole.PACKAGING_PROOF)) {
      throw new BadRequestException('Generated images can never be packaging or identity proof');
    }
    if (dto.originType === MediaOriginType.verified || dto.originType === MediaOriginType.derived) {
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
        if (dto.originType === MediaOriginType.verified || dto.originType === MediaOriginType.derived) {
          return tx.productMedia.update({ where: { id: existing.id }, data: {
            originType: dto.originType, generationMetadata: dto.generationMetadata as Prisma.InputJsonValue,
            ...(dto.role && { role: dto.role }), ...(dto.assetId && { assetId: dto.assetId }),
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
        role: dto.role ?? null,
        assetId: dto.assetId ?? null,
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
      role: media.role,
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
      role: updated.role,
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
      role: m.role,
    }));
  }

  private isReviewedProductMedia(media: { originType: string; generationMetadata: unknown }, skus: Array<Pick<ProductWithRelations['skus'][number], 'id' | 'isActive' | 'barcode' | 'size' | 'sizeUnit' | 'variantName'>>): boolean {
    try {
      if (media.originType !== MediaOriginType.verified && media.originType !== MediaOriginType.derived) return false;
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
      targetArea: product.targetArea ?? null,
      texture: product.texture ?? null,
      suitableSkinTypes: product.suitableSkinTypes ?? [],
      suitableHairTypes: product.suitableHairTypes ?? [],
      spf: product.spf ?? null,
      broadSpectrum: product.broadSpectrum ?? null,
      uvFilterType: product.uvFilterType ?? null,
      waterResistanceMinutes: product.waterResistanceMinutes ?? null,
      isFragranceFree: product.isFragranceFree ?? null,
      isNonComedogenic: product.isNonComedogenic ?? null,
      claimsEvidence: (product.claimsEvidence as Record<string, unknown> | null) ?? null,
      factVersion: product.factVersion ?? 1,
      lastReviewedAt: product.lastReviewedAt ? product.lastReviewedAt.toISOString() : null,
      lastReviewedBy: product.lastReviewedBy ?? null,
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
          estimatedDaysOfUse: sku.estimatedDaysOfUse ?? null,
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
          role: m.role,
        })),
    };
  }
}
