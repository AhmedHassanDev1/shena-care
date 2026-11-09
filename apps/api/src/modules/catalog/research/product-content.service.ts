import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../services/catalog.service';
import { isTrustedMediaSource } from '../../../platform/security/media-review';

export interface PublishedContent {
  language: 'ar';
  name: string | null;
  description: string | null;
  ingredients: string | null;
  usage: string | null;
  warnings: string | null;
  verifiedFacts: Array<{ skuId: string; field: string; value: string; sourceUrl: string; sourceType: string; verifiedAt: string }>;
}

@Injectable()
export class ProductContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async getPublishedContent(skuIds: string[]): Promise<Map<string, PublishedContent>> {
    const result = new Map<string, PublishedContent>();
    if (!skuIds.length) return result;
    const items = await this.prisma.ingestionItem.findMany({
      where: { status: 'published', matchedSkuId: { in: skuIds } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const identities = new Map(await Promise.all(skuIds.map(async id => [id, await this.catalog.getSkuIdentity(id)] as const)));
    for (const item of items) {
      const review = (item.enrichment as Record<string, unknown> | null)?.contentReview as {
        language?: string;
        fields?: Array<{ field: string; value: unknown; sourceUrl?: string }>;
        identity?: { barcode?: string | null; name?: string; brand?: string; size?: number; sizeUnit?: string; variantName?: string };
      } | undefined;
      const sku = identities.get(item.matchedSkuId!);
      if (!sku?.isActive || result.has(sku.id) || !review || review.language !== 'ar' || !Array.isArray(review.fields) ||
        review.identity?.barcode !== sku.barcode || review.identity.name !== item.name || review.identity.brand !== item.brand ||
        review.identity.size !== sku.size || review.identity.sizeUnit !== sku.sizeUnit || review.identity.variantName !== sku.variantName) continue;
      const fields = review.fields.filter(f => ['name', 'description', 'ingredients', 'usage', 'warnings'].includes(f.field) &&
        typeof f.value === 'string' && typeof f.sourceUrl === 'string' && isTrustedMediaSource(f.sourceUrl));
      if (!fields.length) continue;
      const value = (field: string): string | null => (fields.find(f => f.field === field)?.value as string) ?? null;
      const verifiedFacts = fields.map(f => ({
        skuId: sku.id,
        field: f.field,
        value: String(f.value),
        sourceUrl: f.sourceUrl ?? '',
        sourceType: 'OFFICIAL_MANUFACTURER',
        verifiedAt: new Date().toISOString(),
      }));
      result.set(sku.id, {
        language: 'ar',
        name: value('name'),
        description: value('description'),
        ingredients: value('ingredients'),
        usage: value('usage'),
        warnings: value('warnings'),
        verifiedFacts,
      });
    }
    return result;
  }
}
