import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

@Injectable()
export class CatalogItemManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSkuEditable(skuId: string) {
    const sku = await this.prisma.sku.findUnique({ where: { id: skuId }, select: { product: { select: { archivedAt: true } } } });
    if (!sku) throw new NotFoundException('SKU not found');
    if (sku.product.archivedAt) throw new ConflictException('Restore the archived product before changing its SKU');
  }

  async list(page: number, limit: number, q?: string, state?: 'active' | 'archived') {
    const where = {
      ...(state && { archivedAt: state === 'archived' ? { not: null } : null }),
      ...(q && { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { brand: { name: { contains: q, mode: 'insensitive' as const } } },
        { skus: { some: { code: { contains: q, mode: 'insensitive' as const } } } },
      ] }),
    };
    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit, take: limit,
        select: {
          id: true, name: true, description: true, isPublished: true, archivedAt: true,
          brand: { select: { name: true } },
          media: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { url: true, altText: true } },
          skus: { orderBy: { createdAt: 'asc' }, select: { id: true, code: true, variantName: true, isActive: true } },
        },
      }),
    ]);
    return { total, page, limit, items };
  }

  async archive(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id }, select: { id: true, archivedAt: true, isPublished: true } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.archivedAt) return product;
      const archived = await tx.product.update({ where: { id }, data: { archivedAt: new Date(), isPublished: false }, select: { id: true, archivedAt: true, isPublished: true } });
      await tx.sku.updateMany({ where: { productId: id }, data: { isActive: false } });
      return archived;
    });
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true, archivedAt: true, isPublished: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.archivedAt) return product;
    return this.prisma.product.update({ where: { id }, data: { archivedAt: null }, select: { id: true, archivedAt: true, isPublished: true } });
  }

  async setSkuActive(skuId: string, isActive: boolean) {
    const updated = await this.prisma.sku.updateMany({ where: { id: skuId, product: { archivedAt: null } }, data: { isActive } });
    if (!updated.count) {
      await this.ensureSkuEditable(skuId);
      throw new ConflictException('SKU state could not be changed');
    }
    return this.prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { id: true, isActive: true } });
  }
}
