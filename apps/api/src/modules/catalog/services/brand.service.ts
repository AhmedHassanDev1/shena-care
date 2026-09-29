import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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
  isActive: boolean;
}

export interface BrandSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  countryOfOrigin: string | null;
  isActive: boolean;
  productLines: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
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

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  async getBrands(includeInactive = false): Promise<BrandSummary[]> {
    const brands = await this.prisma.brand.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        productLines: {
          where: includeInactive ? {} : { isActive: true },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            isActive: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return brands.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      logoUrl: b.logoUrl,
      websiteUrl: b.websiteUrl,
      countryOfOrigin: b.countryOfOrigin,
      isActive: b.isActive,
      productLines: b.productLines,
    }));
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

    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      description: brand.description,
      logoUrl: brand.logoUrl,
      websiteUrl: brand.websiteUrl,
      countryOfOrigin: brand.countryOfOrigin,
      isActive: brand.isActive,
      productLines: brand.productLines,
      products: brand.products,
    };
  }

  async createBrand(dto: CreateBrandDto): Promise<BrandSummary> {
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

    const brand = await this.prisma.brand.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description ?? null,
        logoUrl: dto.logoUrl ?? null,
        websiteUrl: dto.websiteUrl ?? null,
        countryOfOrigin: dto.countryOfOrigin ?? null,
        isActive: dto.isActive ?? true,
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
      },
      include: {
        productLines: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            isActive: true,
          },
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      logoUrl: updated.logoUrl,
      websiteUrl: updated.websiteUrl,
      countryOfOrigin: updated.countryOfOrigin,
      isActive: updated.isActive,
      productLines: updated.productLines,
    };
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
        isActive: dto.isActive ?? true,
      },
    });

    return {
      id: line.id,
      brandId: line.brandId,
      name: line.name,
      slug: line.slug,
      description: line.description,
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
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return {
      id: updated.id,
      brandId: updated.brandId,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      isActive: updated.isActive,
    };
  }
}
