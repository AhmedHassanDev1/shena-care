import { Injectable } from '@nestjs/common';
import { ProductFactStatus } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService } from '../services/catalog.service';
import { isTrustedMediaSource } from '../../../platform/security/media-review';

export interface PublishedKeyIngredient {
  name: string;
  function: string | null;
}

export interface PublishedContent {
  language: 'ar' | 'en';
  name: string | null;
  description: string | null;
  ingredients: string | null;
  keyIngredients?: PublishedKeyIngredient[];
  benefits?: string[];
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
    const legacySkuIds = [...new Set(items.map(item => item.matchedSkuId).filter((id): id is string => Boolean(id)))];
    const identities = new Map(await Promise.all(legacySkuIds.map(async id => [id, await this.catalog.getSkuIdentity(id)] as const)));
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
    const missing = skuIds.filter(id => !result.has(id));
    if (!missing.length) return result;
    const facts = await this.prisma.productFactProposal.findMany({
      where: { skuId: { in: missing }, status: ProductFactStatus.APPLIED,
        field: { in: ['marketing.description', 'usage.instructions', 'safety.warnings', 'composition.inci', 'composition.keyIngredients', 'claims.manufacturerStated'] } },
      orderBy: { appliedAt: 'desc' },
    });
    for (const skuId of missing) {
      const own = facts.filter(fact => fact.skuId === skuId);
      if (!own.length) continue;
      const field = (name: string) => own.find(fact => fact.field === name);
      const list = (name: string): string | null => {
        const value = field(name)?.value;
        return Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join('\n') : null;
      };
      const rawKeyIngredients = field('composition.keyIngredients')?.value;
      const keyIngredients: PublishedKeyIngredient[] = Array.isArray(rawKeyIngredients)
        ? rawKeyIngredients.flatMap(item =>
            item && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string' && item.name.trim()
              ? [{
                  name: item.name.trim(),
                  function: typeof item.function === 'string' && item.function.trim() ? item.function.trim() : null,
                }]
              : [],
          )
        : [];
      const keys = keyIngredients.map(item => item.name).join(', ') || null;
      const rawBenefits = field('claims.manufacturerStated')?.value;
      const benefits = Array.isArray(rawBenefits)
        ? rawBenefits.filter((item): item is string => typeof item === 'string' && item.trim().length >= 4 && item.trim().length <= 180)
            .map(item => item.trim())
        : [];
      const verifiedFacts = own.flatMap(fact => {
        const evidence = (fact.evidence as Array<{ sourceUrl?: string; sourceTier?: string }> | null)?.[0];
        if (!evidence?.sourceUrl) return [];
        return [{ skuId, field: fact.field, value: typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value),
          sourceUrl: evidence.sourceUrl, sourceType: evidence.sourceTier ?? 'UNKNOWN', verifiedAt: fact.appliedAt?.toISOString() ?? fact.createdAt.toISOString() }];
      });
      result.set(skuId, { language: 'en', name: null,
        description: typeof field('marketing.description')?.value === 'string' ? field('marketing.description')!.value as string : null,
        ingredients: list('composition.inci') ?? keys,
        keyIngredients,
        benefits,
        usage: list('usage.instructions'), warnings: list('safety.warnings'), verifiedFacts });
    }
    return result;
  }
}
