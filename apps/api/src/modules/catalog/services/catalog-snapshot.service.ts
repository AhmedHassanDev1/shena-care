import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { curatedSpellings } from '../research/brand-aliases';

export interface SnapshotBrand {
  id: string;
  name: string;
  /** Every reviewed spelling: the Catalog Policy's aliases, the brand's approved draft aliases and verified profile aliases. */
  aliases: string[];
  websiteUrl: string | null;
  /** ALLOW | DENY | null as the current Catalog Policy states it; null when the policy does not name the brand. */
  policyEffect: 'ALLOW' | 'DENY' | null;
  activeSkuCount: number;
}

export interface SnapshotSku {
  skuId: string;
  productId: string;
  brandId: string;
  productName: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  packCount: number;
  /** The SKU's own barcode and every approved alias barcode. */
  barcodes: string[];
  categoryId: string | null;
  productType: string | null;
  identityStatus: string;
  sourceUrls: string[];
  isPublished: boolean;
}

export type PolicyMode = 'OPEN' | 'ALLOWLIST_ONLY';
export type PolicyRuleEffect = 'ALLOW' | 'DENY';

export interface PolicyBrandRule {
  id?: string;
  name: string;
  effect: PolicyRuleEffect;
  aliases?: string[];
  note?: string;
}

export interface PolicyCategoryRule {
  id: string;
  name: string;
  effect: PolicyRuleEffect;
  note?: string;
}

export interface PolicyBrandCategoryRule {
  brandId?: string;
  brandName: string;
  categoryId: string;
  categoryName: string;
  effect: PolicyRuleEffect;
  note?: string;
}

export interface PolicyDocument {
  mode?: PolicyMode;
  brands?: PolicyBrandRule[];
  categories?: PolicyCategoryRule[];
  brandCategoryRules?: PolicyBrandCategoryRule[];
  excludedTerms?: string[];
  disabledExcludedClasses?: string[];
}

export interface CatalogIdentitySnapshot {
  takenAt: string;
  policyVersion: number | null;
  policyMode?: PolicyMode;
  policyCategories?: PolicyCategoryRule[];
  brandCategoryRules?: PolicyBrandCategoryRule[];
  excludedTerms?: string[];
  disabledExcludedClasses?: string[];
  allowedLabels?: string[];
  brands: SnapshotBrand[];
  /** Policy-denied brand labels the catalog does not hold (a supplier's other brands). */
  deniedLabels: string[];
  categories: Array<{ id: string; name: string; parentId: string | null; isLeaf: boolean; isActive: boolean }>;
  skus: SnapshotSku[];
}

const readAliases = (profile: unknown): string[] => {
  const raw = (profile as { aliases?: unknown } | null)?.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => typeof item === 'string' ? [item]
    : item && typeof item === 'object' && typeof (item as { value?: unknown }).value === 'string' && (item as { status?: string }).status !== 'UNVERIFIED' ? [(item as { value: string }).value] : []);
};

/**
 * The identity facts intake matching needs, read once per batch: active canonical SKUs (identity only, no commercial data), brands with every reviewed spelling,
 * the category tree and the current Catalog Policy effects. Read-only.
 */
@Injectable()
export class CatalogSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async identitySnapshot(): Promise<CatalogIdentitySnapshot> {
    const [policy, brands, drafts, categories, skus, aliases] = await Promise.all([
      this.prisma.ingestionEligibilityPolicy.findFirst({ where: { status: 'APPROVED' }, orderBy: { version: 'desc' }, select: { version: true, document: true } }),
      this.prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true, websiteUrl: true, profile: true } }),
      this.prisma.brandDraft.findMany({ where: { status: 'APPROVED', canonicalBrandId: { not: null } }, select: { canonicalBrandId: true, aliases: true } }),
      this.prisma.category.findMany({ select: { id: true, name: true, parentId: true, isActive: true } }),
      this.prisma.sku.findMany({
        where: { isActive: true, product: { archivedAt: null } },
        select: { id: true, productId: true, variantName: true, size: true, sizeUnit: true, packCount: true, barcode: true, identityStatus: true, identityEvidence: true,
          product: { select: { name: true, brandId: true, categoryId: true, productType: true, isPublished: true } } },
      }),
      this.prisma.skuBarcodeAlias.findMany({ where: { status: 'approved' }, select: { skuId: true, barcode: true } }),
    ]);
    const document = (policy?.document ?? {}) as PolicyDocument;
    const rules = new Map(
      (document.brands ?? []).filter((r): r is PolicyBrandRule & { id: string } => Boolean(r.id)).map(rule => [rule.id, rule]),
    );
    const rulesByName = new Map(
      (document.brands ?? []).map(rule => [rule.name.trim().toLowerCase(), rule]),
    );
    const skuCount = new Map<string, number>();
    for (const sku of skus) skuCount.set(sku.product.brandId, (skuCount.get(sku.product.brandId) ?? 0) + 1);
    const draftAliases = new Map<string, string[]>();
    for (const draft of drafts) draftAliases.set(draft.canonicalBrandId!, [...(draftAliases.get(draft.canonicalBrandId!) ?? []), ...draft.aliases]);
    const aliasBarcodes = new Map<string, string[]>();
    for (const alias of aliases) aliasBarcodes.set(alias.skuId, [...(aliasBarcodes.get(alias.skuId) ?? []), alias.barcode]);
    const heldIds = new Set(brands.map(brand => brand.id));
    const heldNames = new Set(brands.map(brand => brand.name.trim().toLowerCase()));
    const parents = new Set(categories.map(category => category.parentId).filter(Boolean));

    return {
      takenAt: new Date().toISOString(),
      policyVersion: policy?.version ?? null,
      policyMode: document.mode ?? 'OPEN',
      policyCategories: document.categories ?? [],
      brandCategoryRules: document.brandCategoryRules ?? [],
      excludedTerms: document.excludedTerms ?? [],
      disabledExcludedClasses: document.disabledExcludedClasses ?? [],
      allowedLabels: (document.brands ?? [])
        .filter(rule => rule.effect === 'ALLOW' && (!rule.id || !heldIds.has(rule.id)) && !heldNames.has(rule.name.trim().toLowerCase()))
        .flatMap(rule => [rule.name, ...(rule.aliases ?? [])]),
      brands: brands.map(brand => {
        const rule = rules.get(brand.id) ?? rulesByName.get(brand.name.trim().toLowerCase());
        const spellings = [...(rule?.aliases ?? []), ...(draftAliases.get(brand.id) ?? []), ...readAliases(brand.profile), ...curatedSpellings(brand.name)];
        return { id: brand.id, name: brand.name, websiteUrl: brand.websiteUrl, policyEffect: rule?.effect ?? null, activeSkuCount: skuCount.get(brand.id) ?? 0,
          aliases: [...new Set(spellings.map(value => value.trim()).filter(value => value.length >= 2 && value.toLowerCase() !== brand.name.toLowerCase()))] };
      }),
      deniedLabels: (document.brands ?? [])
        .filter(rule => rule.effect === 'DENY' && (!rule.id || !heldIds.has(rule.id)) && !heldNames.has(rule.name.trim().toLowerCase()))
        .flatMap(rule => [rule.name, ...(rule.aliases ?? [])]),
      categories: categories.map(category => ({ ...category, isLeaf: !parents.has(category.id) })),
      skus: skus.map(sku => ({
        skuId: sku.id, productId: sku.productId, brandId: sku.product.brandId, productName: sku.product.name, variantName: sku.variantName,
        size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit, packCount: sku.packCount ?? 1,
        barcodes: [...new Set([...(sku.barcode ? [sku.barcode] : []), ...(aliasBarcodes.get(sku.id) ?? [])])],
        categoryId: sku.product.categoryId, productType: sku.product.productType, identityStatus: sku.identityStatus,
        sourceUrls: ((sku.identityEvidence as { sourceUrls?: string[] } | null)?.sourceUrls ?? []), isPublished: sku.product.isPublished,
      })),
    };
  }

  /** Active leaf categories by (case-insensitive) name, for placing a new draft from its product type. */
  async leafCategoriesByName(): Promise<Map<string, string>> {
    const categories = await this.prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, parentId: true } });
    const parents = new Set(categories.map(category => category.parentId).filter(Boolean));
    return new Map(categories.filter(category => !parents.has(category.id)).map(category => [category.name.trim().toLowerCase(), category.id]));
  }
}
