import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { findPolicyReferences } from './catalog-policy.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from '../dto/brand.dto';
import { CreateProductLineDto, UpdateProductLineDto } from '../dto/product-line.dto';
import { slugify } from '../utils/slug.util';

export interface ProductLineSummary {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl?: string | null;
  imageMetadata?: unknown;
  isActive: boolean;
}

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  logoMetadata?: unknown;
  websiteUrl: string | null;
  countryOfOrigin: string | null;
  isActive: boolean;
  aliases?: string[];
  productCount?: number;
  publishedProductCount?: number;
  productLines: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl?: string | null;
    imageMetadata?: unknown;
    isActive: boolean;
  }>;
}

export interface BrandDetail extends BrandSummary {
  products: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

function normalizeAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function extractBrandAliases(profile: unknown): string[] {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return [];
  return normalizeAliases((profile as Record<string, unknown>).aliases);
}

function mergeBrandProfile(
  existingProfile: unknown,
  aliases: string[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (aliases === undefined) return undefined;
  const base =
    existingProfile && typeof existingProfile === 'object' && !Array.isArray(existingProfile)
      ? { ...(existingProfile as Record<string, unknown>) }
      : {};
  base.aliases = normalizeAliases(aliases);
  return base as Prisma.InputJsonValue;
}

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  private async getBrandProductCounts(): Promise<
    Map<string, { total: number; published: number }>
  > {
    const map = new Map<string, { total: number; published: number }>();
    if (!this.prisma.product?.groupBy) return map;
    const rows = await this.prisma.product.groupBy({
      by: ['brandId', 'isPublished'],
      where: { archivedAt: null },
      _count: { _all: true },
    });
    for (const row of rows) {
      const current = map.get(row.brandId) ?? { total: 0, published: 0 };
      const count = row._count._all;
      current.total += count;
      if (row.isPublished) current.published += count;
      map.set(row.brandId, current);
    }
    return map;
  }

  async getBrands(includeInactive = false): Promise<BrandSummary[]> {
    const [brands, countMap] = await Promise.all([
      this.prisma.brand.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: {
          productLines: {
            where: includeInactive ? {} : { isActive: true },
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              imageUrl: true,
              imageMetadata: true,
              isActive: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.getBrandProductCounts(),
    ]);

    return brands.map((b) => {
      const counts = countMap.get(b.id) ?? { total: 0, published: 0 };
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        description: b.description,
        logoUrl: b.logoUrl,
        logoMetadata: b.logoMetadata,
        websiteUrl: b.websiteUrl,
        countryOfOrigin: b.countryOfOrigin,
        isActive: b.isActive,
        aliases: extractBrandAliases(b.profile),
        productCount: counts.total,
        publishedProductCount: counts.published,
        productLines: b.productLines,
      };
    });
  }

  async getBrand(slugOrId: string): Promise<BrandDetail | null> {
    const isId = this.isUuid(slugOrId);
    const brand = await this.prisma.brand.findFirst({
      where: isId ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
      include: {
        productLines: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            imageUrl: true,
            imageMetadata: true,
            isActive: true,
          },
        },
        products: {
          where: { isPublished: true },
          select: {
            id: true,
            name: true,
            slug: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!brand) return null;

    const [totalCount, publishedCount] = this.prisma.product?.count
      ? await Promise.all([
          this.prisma.product.count({ where: { brandId: brand.id, archivedAt: null } }),
          this.prisma.product.count({
            where: { brandId: brand.id, archivedAt: null, isPublished: true },
          }),
        ])
      : [brand.products.length, brand.products.length];

    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      description: brand.description,
      logoUrl: brand.logoUrl,
      logoMetadata: brand.logoMetadata,
      websiteUrl: brand.websiteUrl,
      countryOfOrigin: brand.countryOfOrigin,
      isActive: brand.isActive,
      aliases: extractBrandAliases(brand.profile),
      productCount: totalCount,
      publishedProductCount: publishedCount,
      productLines: brand.productLines,
      products: brand.products,
    };
  }

  async createBrand(dto: CreateBrandDto, extra: { logoMetadata?: Prisma.InputJsonValue } = {}): Promise<BrandSummary> {
    const slug = dto.slug ? dto.slug.toLowerCase() : slugify(dto.name);

    const existingName = await this.prisma.brand.findUnique({
      where: { name: dto.name },
    });
    if (existingName) {
      throw new ConflictException(`A brand with name '${dto.name}' already exists`);
    }

    const existingSlug = await this.prisma.brand.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(`A brand with slug '${slug}' already exists`);
    }

    const profileData = mergeBrandProfile(undefined, dto.aliases);

    const brand = await this.prisma.brand.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description ?? null,
        logoUrl: dto.logoUrl ?? null,
        ...(extra.logoMetadata !== undefined && { logoMetadata: extra.logoMetadata }),
        websiteUrl: dto.websiteUrl ?? null,
        countryOfOrigin: dto.countryOfOrigin ?? null,
        isActive: dto.isActive ?? true,
        ...(profileData !== undefined && { profile: profileData }),
      },
      include: {
        productLines: true,
      },
    });

    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      description: brand.description,
      logoUrl: brand.logoUrl,
      websiteUrl: brand.websiteUrl,
      countryOfOrigin: brand.countryOfOrigin,
      isActive: brand.isActive,
      aliases: extractBrandAliases(brand.profile),
      productCount: 0,
      publishedProductCount: 0,
      productLines: [],
    };
  }

  async updateBrand(id: string, dto: UpdateBrandDto): Promise<BrandSummary> {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: { productLines: true },
    });

    if (!brand) {
      throw new NotFoundException(`Brand not found with id: ${id}`);
    }

    let slug = brand.slug;
    if (dto.slug) {
      slug = dto.slug.toLowerCase();
    } else if (dto.name && dto.name !== brand.name) {
      slug = slugify(dto.name);
    }

    if (dto.name && dto.name !== brand.name) {
      const existingName = await this.prisma.brand.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (existingName) {
        throw new ConflictException(`A brand with name '${dto.name}' already exists`);
      }
    }

    if (slug !== brand.slug) {
      const existingSlug = await this.prisma.brand.findFirst({
        where: { slug, NOT: { id } },
      });
      if (existingSlug) {
        throw new ConflictException(`A brand with slug '${slug}' already exists`);
      }
    }

    const profileData = mergeBrandProfile(brand.profile, dto.aliases);

    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(slug !== brand.slug && { slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.websiteUrl !== undefined && { websiteUrl: dto.websiteUrl }),
        ...(dto.countryOfOrigin !== undefined && { countryOfOrigin: dto.countryOfOrigin }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(profileData !== undefined && { profile: profileData }),
      },
      include: {
        productLines: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            imageUrl: true,
            imageMetadata: true,
            isActive: true,
          },
        },
      },
    });

    const [totalCount, publishedCount] = this.prisma.product?.count
      ? await Promise.all([
          this.prisma.product.count({ where: { brandId: updated.id, archivedAt: null } }),
          this.prisma.product.count({
            where: { brandId: updated.id, archivedAt: null, isPublished: true },
          }),
        ])
      : [0, 0];

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      logoUrl: updated.logoUrl,
      logoMetadata: updated.logoMetadata,
      websiteUrl: updated.websiteUrl,
      countryOfOrigin: updated.countryOfOrigin,
      isActive: updated.isActive,
      aliases: extractBrandAliases(updated.profile),
      productCount: totalCount,
      publishedProductCount: publishedCount,
      productLines: updated.productLines,
    };
  }

  async deleteBrand(id: string): Promise<{ deleted: true; id: string }> {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!brand) {
      throw new NotFoundException(`Brand not found with id: ${id}`);
    }

    const [productCount, productLineCount] = await Promise.all([
      this.prisma.product.count({ where: { brandId: id } }),
      this.prisma.productLine.count({ where: { brandId: id } }),
    ]);

    if (productCount > 0 || productLineCount > 0) {
      throw new ConflictException({
        code: 'BRAND_HAS_DEPENDENCIES',
        message: `Cannot delete brand '${brand.name}' because it has ${productCount} linked products and ${productLineCount} product lines. Deactivate it or remove dependencies first.`,
        productCount,
        productLineCount,
      });
    }

    const policyRefs = await findPolicyReferences(this.prisma, { brandId: id });
    if (policyRefs.length > 0) {
      throw new ConflictException({
        code: 'BRAND_IN_ALLOWLIST_POLICY',
        message: `Cannot delete brand '${brand.name}' because the current Allowlist policy has a rule for it (${policyRefs.join(', ')}). Remove the rule and save a new policy version first.`,
        policyReferences: policyRefs,
      });
    }

    await this.prisma.brand.delete({ where: { id } });
    return { deleted: true, id };
  }

  // ---------------------------------------------------------------------------
  // ProductLine operations
  // ---------------------------------------------------------------------------

  async getProductLines(brandId: string): Promise<ProductLineSummary[]> {
    const isId = this.isUuid(brandId);
    const brand = await this.prisma.brand.findFirst({
      where: isId ? { OR: [{ id: brandId }, { slug: brandId }] } : { slug: brandId },
    });

    if (!brand) {
      throw new NotFoundException(`Brand not found: ${brandId}`);
    }

    const lines = await this.prisma.productLine.findMany({
      where: { brandId: brand.id },
      orderBy: { name: 'asc' },
    });

    return lines.map((l) => ({
      id: l.id,
      brandId: l.brandId,
      name: l.name,
      slug: l.slug,
      description: l.description,
      isActive: l.isActive,
    }));
  }

  async getProductLine(slugOrId: string): Promise<ProductLineSummary | null> {
    const isId = this.isUuid(slugOrId);
    const line = await this.prisma.productLine.findFirst({
      where: isId ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
    });

    if (!line) return null;

    return {
      id: line.id,
      brandId: line.brandId,
      name: line.name,
      slug: line.slug,
      description: line.description,
      imageUrl: line.imageUrl,
      imageMetadata: line.imageMetadata,
      isActive: line.isActive,
    };
  }

  async createProductLine(brandId: string, dto: CreateProductLineDto): Promise<ProductLineSummary> {
    const isId = this.isUuid(brandId);
    const brand = await this.prisma.brand.findFirst({
      where: isId ? { OR: [{ id: brandId }, { slug: brandId }] } : { slug: brandId },
    });

    if (!brand) {
      throw new NotFoundException(`Brand not found: ${brandId}`);
    }

    const slug = dto.slug ? dto.slug.toLowerCase() : slugify(`${brand.name}-${dto.name}`);

    const existingSlug = await this.prisma.productLine.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(`A product line with slug '${slug}' already exists`);
    }

    const line = await this.prisma.productLine.create({
      data: {
        brandId: brand.id,
        name: dto.name,
        slug,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        imageMetadata: (dto.imageMetadata as any) ?? null,
        isActive: dto.isActive ?? true,
      },
    });

    return {
      id: line.id,
      brandId: line.brandId,
      name: line.name,
      slug: line.slug,
      description: line.description,
      imageUrl: line.imageUrl,
      imageMetadata: line.imageMetadata,
      isActive: line.isActive,
    };
  }

  async updateProductLine(id: string, dto: UpdateProductLineDto): Promise<ProductLineSummary> {
    const line = await this.prisma.productLine.findUnique({
      where: { id },
    });

    if (!line) {
      throw new NotFoundException(`Product line not found with id: ${id}`);
    }

    let slug = line.slug;
    if (dto.slug) {
      slug = dto.slug.toLowerCase();
    } else if (dto.name && dto.name !== line.name) {
      const brand = await this.prisma.brand.findUnique({ where: { id: line.brandId } });
      const prefix = brand ? `${brand.name}-` : '';
      slug = slugify(`${prefix}${dto.name}`);
    }

    if (slug !== line.slug) {
      const existingSlug = await this.prisma.productLine.findFirst({
        where: { slug, NOT: { id } },
      });
      if (existingSlug) {
        throw new ConflictException(`A product line with slug '${slug}' already exists`);
      }
    }

    const updated = await this.prisma.productLine.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(slug !== line.slug && { slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.imageMetadata !== undefined && { imageMetadata: dto.imageMetadata as any }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return {
      id: updated.id,
      brandId: updated.brandId,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      imageUrl: updated.imageUrl,
      imageMetadata: updated.imageMetadata,
      isActive: updated.isActive,
    };
  }

  async deleteProductLine(id: string): Promise<{ deleted: true; id: string }> {
    const line = await this.prisma.productLine.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!line) {
      throw new NotFoundException(`Product line not found with id: ${id}`);
    }

    const productCount = await this.prisma.product.count({
      where: { productLineId: id },
    });
    if (productCount > 0) {
      throw new ConflictException({
        code: 'PRODUCT_LINE_HAS_PRODUCTS',
        message: `Cannot delete product line '${line.name}' because ${productCount} products reference it.`,
        productCount,
      });
    }

    await this.prisma.productLine.delete({ where: { id } });
    return { deleted: true, id };
  }
}
