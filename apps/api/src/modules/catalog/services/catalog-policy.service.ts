import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { UpdateCatalogPolicyDto } from '../dto/policy.dto';
import {
  PolicyBrandCategoryRule,
  PolicyBrandRule,
  PolicyCategoryRule,
  PolicyDocument,
} from './catalog-snapshot.service';

export interface NormalizedPolicyDocument {
  mode: 'OPEN' | 'ALLOWLIST_ONLY';
  brands: PolicyBrandRule[];
  categories: PolicyCategoryRule[];
  brandCategoryRules: PolicyBrandCategoryRule[];
  excludedTerms: string[];
  disabledExcludedClasses: string[];
}

export interface PolicyHistoryEntry {
  id: string;
  version: number | null;
  status: string;
  reason: string;
  actorId: string;
  approvedAt: Date | null;
  createdAt: Date;
}

function dedupeStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const val of values) {
    if (typeof val !== 'string') continue;
    const trimmed = val.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function normalizePolicyDocument(raw: unknown): NormalizedPolicyDocument {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as PolicyDocument;
  return {
    mode: doc.mode === 'ALLOWLIST_ONLY' ? 'ALLOWLIST_ONLY' : 'OPEN',
    brands: Array.isArray(doc.brands)
      ? doc.brands.map((b) => ({
          ...(b.id ? { id: b.id } : {}),
          name: b.name.trim(),
          effect: b.effect === 'DENY' ? 'DENY' : 'ALLOW',
          aliases: dedupeStrings(b.aliases),
          ...(b.note?.trim() ? { note: b.note.trim() } : {}),
        }))
      : [],
    categories: Array.isArray(doc.categories)
      ? doc.categories.map((c) => ({
          id: c.id,
          name: c.name.trim(),
          effect: c.effect === 'DENY' ? 'DENY' : 'ALLOW',
          ...(c.note?.trim() ? { note: c.note.trim() } : {}),
        }))
      : [],
    brandCategoryRules: Array.isArray(doc.brandCategoryRules)
      ? doc.brandCategoryRules.map((bc) => ({
          ...(bc.brandId ? { brandId: bc.brandId } : {}),
          brandName: bc.brandName.trim(),
          categoryId: bc.categoryId,
          categoryName: bc.categoryName.trim(),
          effect: bc.effect === 'DENY' ? 'DENY' : 'ALLOW',
          ...(bc.note?.trim() ? { note: bc.note.trim() } : {}),
        }))
      : [],
    excludedTerms: dedupeStrings(doc.excludedTerms),
    disabledExcludedClasses: dedupeStrings(doc.disabledExcludedClasses),
  };
}

/** Which rules of the current approved policy mention a brand or a category (by canonical id). */
export async function findPolicyReferences(
  prisma: PrismaService,
  target: { brandId?: string; categoryId?: string },
): Promise<string[]> {
  const latest = await prisma.ingestionEligibilityPolicy.findFirst({
    where: { status: 'APPROVED' },
    orderBy: { version: 'desc' },
    select: { document: true, version: true },
  });
  if (!latest) return [];
  const doc = normalizePolicyDocument(latest.document);
  const refs: string[] = [];
  if (target.brandId) {
    if (doc.brands.some((b) => b.id === target.brandId)) refs.push('brand rule');
    if (doc.brandCategoryRules.some((r) => r.brandId === target.brandId)) refs.push('brand + category rule');
  }
  if (target.categoryId) {
    if (doc.categories.some((c) => c.id === target.categoryId)) refs.push('category rule');
    if (doc.brandCategoryRules.some((r) => r.categoryId === target.categoryId)) refs.push('brand + category rule');
  }
  return [...new Set(refs)];
}

@Injectable()
export class CatalogPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicyState(): Promise<{
    current: {
      id: string | null;
      version: number;
      reason: string | null;
      actorId: string | null;
      approvedAt: Date | null;
      document: NormalizedPolicyDocument;
    };
    history: PolicyHistoryEntry[];
  }> {
    const [latest, history] = await Promise.all([
      this.prisma.ingestionEligibilityPolicy.findFirst({
        where: { status: 'APPROVED' },
        orderBy: { version: 'desc' },
      }),
      this.prisma.ingestionEligibilityPolicy.findMany({
        orderBy: { version: 'desc' },
        take: 10,
        select: {
          id: true,
          version: true,
          status: true,
          reason: true,
          actorId: true,
          approvedAt: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      current: {
        id: latest?.id ?? null,
        version: latest?.version ?? 0,
        reason: latest?.reason ?? null,
        actorId: latest?.actorId ?? null,
        approvedAt: latest?.approvedAt ?? null,
        document: normalizePolicyDocument(latest?.document),
      },
      history,
    };
  }

  async updatePolicy(dto: UpdateCatalogPolicyDto, actorId: string) {
    const brandIds = [
      ...new Set(
        [
          ...dto.brands.map((b) => b.id),
          ...dto.brandCategoryRules.map((r) => r.brandId),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const categoryIds = [
      ...new Set([
        ...dto.categories.map((c) => c.id),
        ...dto.brandCategoryRules.map((r) => r.categoryId),
      ]),
    ];

    const [canonicalBrands, canonicalCategories] = await Promise.all([
      brandIds.length
        ? this.prisma.brand.findMany({
            where: { id: { in: brandIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      categoryIds.length
        ? this.prisma.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const brandMap = new Map(canonicalBrands.map((b) => [b.id, b.name]));
    const categoryMap = new Map(canonicalCategories.map((c) => [c.id, c.name]));

    for (const id of brandIds) {
      if (!brandMap.has(id)) {
        throw new BadRequestException({
          code: 'UNKNOWN_BRAND_ID',
          message: `Canonical brand not found for id: ${id}`,
        });
      }
    }
    for (const id of categoryIds) {
      if (!categoryMap.has(id)) {
        throw new BadRequestException({
          code: 'UNKNOWN_CATEGORY_ID',
          message: `Canonical category not found for id: ${id}`,
        });
      }
    }

    const brandSeen = new Set<string>();
    const normalizedBrands: PolicyBrandRule[] = [];
    for (const b of dto.brands) {
      const canonicalName = b.id ? (brandMap.get(b.id) ?? b.name.trim()) : b.name.trim();
      const key = b.id ? `id:${b.id}` : `name:${canonicalName.toLowerCase()}`;
      if (brandSeen.has(key)) continue;
      brandSeen.add(key);
      normalizedBrands.push({
        ...(b.id ? { id: b.id } : {}),
        name: canonicalName,
        effect: b.effect,
        aliases: dedupeStrings(b.aliases),
        ...(b.note?.trim() ? { note: b.note.trim() } : {}),
      });
    }

    const catSeen = new Set<string>();
    const normalizedCategories: PolicyCategoryRule[] = [];
    for (const c of dto.categories) {
      if (catSeen.has(c.id)) continue;
      catSeen.add(c.id);
      normalizedCategories.push({
        id: c.id,
        name: categoryMap.get(c.id) ?? c.name.trim(),
        effect: c.effect,
        ...(c.note?.trim() ? { note: c.note.trim() } : {}),
      });
    }

    const bcSeen = new Set<string>();
    const normalizedBrandCategories: PolicyBrandCategoryRule[] = [];
    for (const r of dto.brandCategoryRules) {
      const brandName = r.brandId
        ? (brandMap.get(r.brandId) ?? r.brandName.trim())
        : r.brandName.trim();
      const categoryName = categoryMap.get(r.categoryId) ?? r.categoryName.trim();
      const key = `${(r.brandId ?? brandName).toLowerCase()}::${r.categoryId}`;
      if (bcSeen.has(key)) continue;
      bcSeen.add(key);
      normalizedBrandCategories.push({
        ...(r.brandId ? { brandId: r.brandId } : {}),
        brandName,
        categoryId: r.categoryId,
        categoryName,
        effect: r.effect,
        ...(r.note?.trim() ? { note: r.note.trim() } : {}),
      });
    }

    const document: NormalizedPolicyDocument = {
      mode: dto.mode,
      brands: normalizedBrands,
      categories: normalizedCategories,
      brandCategoryRules: normalizedBrandCategories,
      excludedTerms: dedupeStrings(dto.excludedTerms),
      disabledExcludedClasses: dedupeStrings(dto.disabledExcludedClasses),
    };

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.ingestionEligibilityPolicy.findFirst({
        where: { version: { not: null } },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const baseVersion = latest?.version ?? 0;
      const nextVersion = baseVersion + 1;
      await tx.ingestionEligibilityPolicy.create({
        data: {
          version: nextVersion,
          baseVersion,
          status: 'APPROVED',
          document: document as unknown as Prisma.InputJsonValue,
          impact: {} as Prisma.InputJsonValue,
          reason: dto.reason.trim(),
          actorId,
          approvedAt: new Date(),
        },
      });
    });

    return this.getPolicyState();
  }
}
