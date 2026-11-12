import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto';
import { slugify } from '../utils/slug.util';
import { findPolicyReferences } from './catalog-policy.service';

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface CategoryChildNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  directProductCount: number;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  directProductCount: number;
  totalProductCount: number;
  // children هنا عشان نبني الشجرة الهرمية
  // مثلاً: Moisturizers → [Face Creams, Body Lotions, Night Creams]
  children: CategoryChildNode[];
}

export interface CategoryDetail extends CategoryNode {
  products: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCategoryProductCounts(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!this.prisma.product?.groupBy) return map;
    const rows = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { archivedAt: null },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.categoryId) {
        map.set(row.categoryId, row._count._all);
      }
    }
    return map;
  }

  // جيب الـ root categories فقط مع أولادها
  // parentId: null = root level (مثلاً: Cleansers, Moisturizers, Serums)
  async getCategories(includeInactive = false): Promise<CategoryNode[]> {
    const [categories, countMap] = await Promise.all([
      this.prisma.category.findMany({
        where: includeInactive
          ? { parentId: null }
          : { isActive: true, parentId: null },
        include: {
          children: {
            where: includeInactive ? {} : { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.getCategoryProductCounts(),
    ]);

    return categories.map((c) => this.mapToNode(c, countMap));
  }

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // جيب تصنيف واحد بالـ slug أو الـ id مع المنتجات بتاعته
  async getCategory(slugOrId: string): Promise<CategoryDetail | null> {
    const isId = this.isUuid(slugOrId);
    const [category, countMap] = await Promise.all([
      this.prisma.category.findFirst({
        where: isId ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
        include: {
          children: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
          // المنتجات المربوطة بالتصنيف ده
          products: {
            where: { isPublished: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      this.getCategoryProductCounts(),
    ]);

    if (!category) return null;

    return {
      ...this.mapToNode(category, countMap),
      products: category.products,
    };
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryNode> {
    const name = dto.name.trim();
    const slug = dto.slug ? dto.slug.toLowerCase() : slugify(name);

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
        select: { id: true, parentId: true },
      });
      if (!parent) {
        throw new NotFoundException(`Parent category not found: ${dto.parentId}`);
      }
      if (parent.parentId !== null) {
        throw new BadRequestException({
          code: 'CATEGORY_MAX_DEPTH',
          message: 'Categories support at most two levels (root parent and child subcategory).',
        });
      }
    }

    const existingName = await this.prisma.category.findFirst({
      where: { name },
    });
    if (existingName) {
      throw new ConflictException(`A category with name '${name}' already exists`);
    }

    const existingSlug = await this.prisma.category.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new ConflictException(`A category with slug '${slug}' already exists`);
    }

    const created = await this.prisma.category.create({
      data: {
        name,
        slug,
        description: dto.description?.trim() || null,
        parentId: dto.parentId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      include: { children: true },
    });

    return this.mapToNode(created, new Map());
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryNode> {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      include: { children: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
    if (!existing) {
      throw new NotFoundException(`Category not found with id: ${id}`);
    }

    const nextName = dto.name !== undefined ? dto.name.trim() : existing.name;
    let nextSlug = existing.slug;
    if (dto.slug !== undefined) {
      nextSlug = dto.slug.toLowerCase();
    } else if (dto.name !== undefined && nextName !== existing.name) {
      nextSlug = slugify(nextName);
    }

    if (nextName !== existing.name) {
      const takenName = await this.prisma.category.findFirst({
        where: { name: nextName, NOT: { id } },
      });
      if (takenName) {
        throw new ConflictException(`A category with name '${nextName}' already exists`);
      }
    }

    if (nextSlug !== existing.slug) {
      const takenSlug = await this.prisma.category.findFirst({
        where: { slug: nextSlug, NOT: { id } },
      });
      if (takenSlug) {
        throw new ConflictException(`A category with slug '${nextSlug}' already exists`);
      }
    }

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }
      if (dto.parentId !== null) {
        if (existing.children.length > 0) {
          throw new ConflictException({
            code: 'CATEGORY_HAS_CHILDREN',
            message: 'Cannot nest a root category that already contains subcategories.',
          });
        }
        const parent = await this.prisma.category.findUnique({
          where: { id: dto.parentId },
          select: { id: true, parentId: true },
        });
        if (!parent) {
          throw new NotFoundException(`Parent category not found: ${dto.parentId}`);
        }
        if (parent.parentId !== null) {
          throw new BadRequestException({
            code: 'CATEGORY_MAX_DEPTH',
            message: 'Categories support at most two levels (root parent and child subcategory).',
          });
        }
      }
    }

    const [updated, countMap] = await Promise.all([
      this.prisma.category.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: nextName }),
          ...(nextSlug !== existing.slug && { slug: nextSlug }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        include: {
          children: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        },
      }),
      this.getCategoryProductCounts(),
    ]);

    return this.mapToNode(updated, countMap);
  }

  async deleteCategory(id: string): Promise<{ deleted: true; id: string }> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!category) {
      throw new NotFoundException(`Category not found with id: ${id}`);
    }

    const [childrenCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);

    if (childrenCount > 0 || productCount > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_DEPENDENCIES',
        message: `Cannot delete category '${category.name}' because it has ${productCount} linked products and ${childrenCount} subcategories.`,
        productCount,
        childrenCount,
      });
    }

    const policyRefs = await findPolicyReferences(this.prisma, { categoryId: id });
    if (policyRefs.length > 0) {
      throw new ConflictException({
        code: 'CATEGORY_IN_ALLOWLIST_POLICY',
        message: `Cannot delete category '${category.name}' because the current Allowlist policy has a rule for it (${policyRefs.join(', ')}). Remove the rule and save a new policy version first.`,
        policyReferences: policyRefs,
      });
    }

    await this.prisma.category.delete({ where: { id } });
    return { deleted: true, id };
  }

  // ─── Private Mapper ─────────────────────────────────────────────────────────

  private mapToNode(
    category: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      parentId?: string | null;
      sortOrder: number;
      isActive?: boolean;
      children: Array<{
        id: string;
        name: string;
        slug: string;
        description?: string | null;
        parentId?: string | null;
        sortOrder: number;
        isActive?: boolean;
      }>;
    },
    countMap: Map<string, number>,
  ): CategoryNode {
    const directProductCount = countMap.get(category.id) ?? 0;
    const children: CategoryChildNode[] = category.children.map((ch) => ({
      id: ch.id,
      name: ch.name,
      slug: ch.slug,
      description: ch.description ?? null,
      parentId: ch.parentId ?? category.id,
      sortOrder: ch.sortOrder,
      isActive: ch.isActive ?? true,
      directProductCount: countMap.get(ch.id) ?? 0,
    }));
    const childrenCount = children.reduce((acc, ch) => acc + ch.directProductCount, 0);

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      parentId: category.parentId ?? null,
      sortOrder: category.sortOrder,
      isActive: category.isActive ?? true,
      directProductCount,
      totalProductCount: directProductCount + childrenCount,
      children,
    };
  }
}
