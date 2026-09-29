import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  // children هنا عشان نبني الشجرة الهرمية
  // مثلاً: Moisturizers → [Face Creams, Body Lotions, Night Creams]
  children: Array<{
    id: string;
    name: string;
    slug: string;
    sortOrder: number;
  }>;
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

  // جيب الـ root categories فقط مع أولادها
  // parentId: null = root level (مثلاً: Cleansers, Moisturizers, Serums)
  async getCategories(): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        isActive: true,
        parentId: null, // ← الفلتر المهم: root categories فقط
      },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return categories.map((c) => this.mapToNode(c));
  }

  private isUuid(val: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
  }

  // جيب تصنيف واحد بالـ slug أو الـ id مع المنتجات بتاعته
  async getCategory(slugOrId: string): Promise<CategoryDetail | null> {
    const isId = this.isUuid(slugOrId);
    const category = await this.prisma.category.findFirst({
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
    });

    if (!category) return null;

    return {
      ...this.mapToNode(category),
      products: category.products,
    };
  }

  // ─── Private Mapper ─────────────────────────────────────────────────────────

  private mapToNode(category: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    sortOrder: number;
    children: Array<{ id: string; name: string; slug: string; sortOrder: number }>;
  }): CategoryNode {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sortOrder,
      children: category.children.map((ch) => ({
        id: ch.id,
        name: ch.name,
        slug: ch.slug,
        sortOrder: ch.sortOrder,
      })),
    };
  }
}
