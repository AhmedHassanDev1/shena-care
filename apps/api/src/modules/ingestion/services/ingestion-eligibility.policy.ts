import { identityWords, phoneticSkeleton } from './identity-text';
import { PRODUCT_TYPE_RULE_VERSION, ProductDomain, productTypeRule, readProductType } from './product-type';

export type PolicyEffect = 'ALLOW' | 'DENY';
export interface EligibilityDocument {
  /** Absent on historical snapshots: retain the original exact-label semantics. */
  resolutionVersion?: number;
  /**
   * categoryIds: the exact leaf categories this Brand may bring in. Absent on brands configured before brand scoping,
   * which keep the central leaf ALLOW list. A parent never stands in for its children.
   */
  brands: Array<{ id: string; name: string; isActive: boolean; effect: PolicyEffect | null; aliases: string[]; categoryIds?: string[] }>;
  categories: Array<{ id: string; name: string; parentId: string | null; isActive: boolean; effect: PolicyEffect | null; aliases?: string[] }>;
  mappings: Array<{ supplierId: string; label: string; categoryIds: string[] }>;
  /** Canonical products an Admin keeps out of intake. Applied only once identity has resolved a row to that product. */
  exclusions?: PolicyExclusion[];
}
export interface PolicyExclusion { productId: string; brandId: string; name: string; reason: string; actorId: string; at: string }
export interface BrandSuggestion { brandId: string; name: string; matchedLabel: string; score: number; effect: PolicyEffect | null }
/** How a row's leaf category was settled, kept on every decision for audit. */
export interface CategoryResolution {
  /** STATED_LABEL (the row's category cell), STATED_PARENT_AND_TYPE, PRODUCT_TYPE (read from the name), or NONE. */
  basis: 'STATED_LABEL' | 'STATED_PARENT_AND_TYPE' | 'PRODUCT_TYPE' | 'NONE';
  rule: string;
  stated: string | null;
  productType: string | null;
  productSubtype: string | null;
  /** Leaf ids the reading pointed at when it could not settle on one. */
  candidates?: string[];
}
export interface EligibilityDecision {
  outcome: 'ALLOW' | 'SKIP' | 'HOLD'; reason: string; policyId: string | null; version: number | null;
  brandId?: string; brandName?: string; categoryId?: string; productId?: string;
  category?: CategoryResolution;
}
export interface ResolvedBrandRule { id: string; name: string; effect: PolicyEffect | null; isActive: boolean }
/** Exact reviewed labels only. Normalization never supplies fuzzy identity evidence. */
export function eligibilityLabel(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
/** V2 formatting key; collisions must be reviewed, not resolved by index insertion order. */
export function eligibilityMappingKey(value: string): string {
  return eligibilityLabel(value).replace(/[کی]/g, ch => ch === 'ک' ? 'ك' : 'ي').replace(/ة/g, 'ه').replace(/ /g, '');
}
// Context words qualify a stated brand; unknown words, alternatives and competing brands never corroborate it.
const BRAND_CONTEXT = new Set(['ماركة', 'براند', 'منتجات', 'منتج', 'شركة', 'اصلي', 'مستورد',
  'كريم', 'غسول', 'مرطب', 'لوشن', 'سيروم', 'شامبو', 'بلسم', 'واقي', 'شمس', 'جل', 'فوم', 'للبشرة', 'الدهنية', 'الجافة', 'الحساسة',
  'تونر', 'ماسك', 'مقشر', 'واش', 'فيس', 'للوجه', 'للشعر', 'للجسم',
  'brand', 'original', 'imported', 'products', 'cream', 'cleanser', 'moisturizer', 'lotion', 'serum', 'shampoo', 'conditioner', 'gel', 'foam', 'face', 'wash', 'toner', 'mask', 'scrub', 'sunscreen',
  'ml', 'g', 'kg', 'l', 'مل', 'جم', 'ملي', 'لتر'].map(eligibilityMappingKey));
const MEASUREMENT_UNITS = new Set(['ml', 'g', 'kg', 'l', 'مل', 'جم', 'ملي', 'لتر']);
function isBrandContext(words: string[]): boolean {
  return words.every((word, i) => BRAND_CONTEXT.has(eligibilityMappingKey(word)) ||
    /^\p{N}+(?:ml|g|kg|l|مل|جم|ملي|لتر)$/u.test(word) ||
    (/^\p{N}+$/u.test(word) && (MEASUREMENT_UNITS.has(words[i - 1]) || MEASUREMENT_UNITS.has(words[i + 1]))));
}
const trigrams = (value: string) => {
  const text = `^${value}$`;
  return new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
};
const SPELLING_SUGGESTION_SCORE = 0.5;
/** Whole-label skeleton, word skeletons long enough to mean something, and initials ("LRP"). */
function spellingKeys(label: string): string[] {
  const words = identityWords(label);
  const whole = phoneticSkeleton(words.join(''));
  return [...new Set([...(whole.length >= 3 ? [`s:${whole}`] : []),
    ...words.map(word => phoneticSkeleton(word)).filter(skeleton => skeleton.length >= 3).map(skeleton => `s:${skeleton}`),
    ...(words.length >= 2 ? [`i:${words.map(word => word[0]).join('')}`] : words[0]?.length >= 2 && words[0].length <= 4 ? [`i:${words[0]}`] : [])])];
}
export function compileEligibilityPolicy(policy: { id: string; version: number; document: EligibilityDocument } | null) {
  const brands = new Map<string, Set<string>>();
  const categories = new Map<string, Set<string>>();
  const mappings = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(id);
  };
  const doc = policy?.document;
  const modern = doc?.resolutionVersion === 2;
  const key = modern ? eligibilityMappingKey : eligibilityLabel;
  const byBrand = new Map(doc?.brands.map(b => [b.id, b]) ?? []);
  const byCategory = new Map(doc?.categories.map(c => [c.id, c]) ?? []);
  const parents = new Set(doc?.categories.map(c => c.parentId).filter(Boolean) ?? []);
  const gramIndex = new Map<string, Set<string>>();
  const labelEvidence = new Map<string, { grams: Set<string>; label: string }>();
  const suggestionBrands = new Map<string, Set<string>>();
  // Phonetic and shorthand keys reach across scripts and common spellings. Suggestions only: evaluate() never reads them.
  const spellingIndex = new Map<string, Set<string>>();
  for (const b of doc?.brands ?? []) for (const label of [b.name, ...b.aliases]) {
    for (const spelling of spellingKeys(label)) add(spellingIndex, spelling, eligibilityMappingKey(label));
    add(brands, key(label), b.id);
    const labelKey = eligibilityMappingKey(label);
    add(suggestionBrands, labelKey, b.id);
    labelEvidence.set(labelKey, { grams: trigrams(labelKey), label });
    for (const gram of trigrams(labelKey)) add(gramIndex, gram, labelKey);
  }
  for (const c of doc?.categories ?? []) for (const label of [c.name, ...(modern ? c.aliases ?? [] : [])]) add(categories, key(label), c.id);
  for (const m of doc?.mappings ?? []) for (const id of m.categoryIds) add(mappings, `${m.supplierId}:${key(m.label)}`, id);
  const resolveBrand = (label: string): Set<string> | undefined => {
    if (!modern) return brands.get(key(label));
    const exact = brands.get(key(label));
    if (exact) return exact;
    const words = eligibilityLabel(label).split(' ').filter(Boolean);
    if (words.length > 30) return undefined;
    const found = new Set<string>();
    let verified: Set<string> | undefined;
    for (let start = 0; start < words.length; start++) for (let end = start + 1; end <= Math.min(words.length, start + 8); end++) {
      const phrase = key(words.slice(start, end).join(' '));
      const ids = phrase.length >= 3 ? brands.get(phrase) : undefined;
      if (!ids) continue;
      for (const id of ids) found.add(id);
      if (isBrandContext([...words.slice(0, start), ...words.slice(end)])) verified = ids;
    }
    return found.size > 1 ? found : verified;
  };
  type BrandRule = EligibilityDocument['brands'][number];
  type CategoryRule = EligibilityDocument['categories'][number];
  // Leaves some enabled Brand may bring in. A known leaf outside all of them is a definite exclusion, whatever the brand.
  const scopedLeaves = new Set((doc?.brands ?? []).filter(b => b.effect === 'ALLOW' && b.isActive).flatMap(b => b.categoryIds ?? []));
  const excluded = new Set((doc?.exclusions ?? []).map(e => e.productId));
  const allowedFor = (b: BrandRule, c: CategoryRule) => b.categoryIds ? b.categoryIds.includes(c.id) : c.effect === 'ALLOW';
  const decision = (outcome: EligibilityDecision['outcome'], reason: string, extra = {}): EligibilityDecision =>
    ({ outcome, reason, policyId: policy?.id ?? null, version: policy?.version ?? null, ...extra });
  /** The one rule set, shared by text-stated rows and identity-resolved rows. Undefined means unknown; `ambiguous` says why. */
  const judge = (b: BrandRule | undefined, c: CategoryRule | undefined, ambiguous: { brand: boolean; category: boolean }): EligibilityDecision => {
    if (!policy) return decision('HOLD', 'POLICY_NOT_CONFIGURED');
    // A definite denial is sufficient; unknown evidence cannot turn an explicit exclusion into an allowance.
    if (b && (b.effect === 'DENY' || !b.isActive || b.effect === null)) return decision('SKIP', 'BRAND_NOT_ALLOWED');
    let ancestor = c;
    const visited = new Set<string>();
    while (ancestor) {
      if (visited.has(ancestor.id)) return decision('HOLD', 'CATEGORY_HIERARCHY_AMBIGUOUS');
      visited.add(ancestor.id);
      if (ancestor.effect === 'DENY' || !ancestor.isActive) return decision('SKIP', 'CATEGORY_DENIED');
      if (ancestor.parentId && !byCategory.has(ancestor.parentId)) return decision('HOLD', 'CATEGORY_HIERARCHY_UNKNOWN');
      ancestor = ancestor.parentId ? byCategory.get(ancestor.parentId) : undefined;
    }
    if (c && !parents.has(c.id) && c.effect !== 'ALLOW' && !scopedLeaves.has(c.id)) return decision('SKIP', 'CATEGORY_NOT_ALLOWED');
    if (!b) return decision('HOLD', ambiguous.brand ? 'BRAND_AMBIGUOUS' : 'BRAND_UNKNOWN');
    if (!c) return decision('HOLD', ambiguous.category ? 'CATEGORY_AMBIGUOUS' : 'CATEGORY_UNKNOWN');
    if (parents.has(c.id)) return decision('HOLD', 'CATEGORY_REQUIRES_LEAF');
    if (!allowedFor(b, c)) return decision('SKIP', 'CATEGORY_NOT_ALLOWED_FOR_BRAND');
    return decision('ALLOW', 'BRAND_AND_LEAF_APPROVED', { brandId: b.id, brandName: b.name, categoryId: c.id });
  };
  const evaluate = (supplierId: string, brand: string, category: string): EligibilityDecision => {
    const bs = resolveBrand(brand);
    const cs = mappings.get(`${supplierId}:${key(category)}`) ?? categories.get(key(category));
    const b = bs?.size === 1 ? byBrand.get([...bs][0]) : undefined;
    const c = cs?.size === 1 ? byCategory.get([...cs][0]) : undefined;
    return judge(b, c, { brand: Boolean(bs?.size), category: Boolean(cs?.size) });
  };
  // ─── Leaf category from the product type ─────────────────────────────────
  // The taxonomy's own leaves (name and aliases), so a type maps to whatever leaf this policy's taxonomy calls it; nothing is keyed by id.
  const leafIndex = new Map<string, Set<string>>();
  for (const c of doc?.categories ?? []) if (!parents.has(c.id) && c.isActive) for (const label of [c.name, ...(c.aliases ?? [])]) add(leafIndex, eligibilityMappingKey(label), c.id);
  const rootOf = (c: CategoryRule): CategoryRule => {
    let node = c;
    for (let guard = 0; node.parentId && byCategory.has(node.parentId) && guard < 20; guard++) node = byCategory.get(node.parentId)!;
    return node;
  };
  const DOMAIN_ROOTS: Record<ProductDomain, string[]> = {
    HAIR: ['hair care', 'haircare', 'hair', 'العناية بالشعر', 'عنايه بالشعر', 'شعر'], SKIN: ['skin care', 'skincare', 'skin', 'face', 'العناية بالبشرة', 'عنايه بالبشره', 'بشره'],
    BODY: ['body care', 'bodycare', 'body', 'bath & body', 'العناية بالجسم', 'جسم'],
  };
  const domainOf = (c: CategoryRule): ProductDomain | null => {
    const label = eligibilityMappingKey(rootOf(c).name);
    return (Object.keys(DOMAIN_ROOTS) as ProductDomain[]).find(domain => DOMAIN_ROOTS[domain].some(name => eligibilityMappingKey(name) === label)) ?? null;
  };
  // A body moisturiser may live under skin care; hair never crosses into skin or body.
  const compatible = (type: ProductDomain, leaf: ProductDomain | null) => leaf === null || leaf === type || (type === 'BODY' && leaf === 'SKIN');
  /** The leaf a type belongs to in this taxonomy: the first of its leaf names present, unless that name points at two leaves. */
  const leavesForType = (typeKey: string): { primary: string | null; all: Set<string>; ambiguous: boolean } => {
    const rule = productTypeRule(typeKey);
    const all = new Set<string>();
    let primary: string | null = null;
    let ambiguous = false;
    for (const name of [...(rule?.leaves ?? []), ...(rule?.terms ?? [])]) {
      const ids = [...(leafIndex.get(eligibilityMappingKey(name)) ?? [])].filter(id => compatible(rule!.domain, domainOf(byCategory.get(id)!)));
      for (const id of ids) all.add(id);
      if (primary === null && !ambiguous && ids.length === 1) primary = ids[0];
      else if (primary === null && ids.length > 1) ambiguous = true;
    }
    return { primary, all, ambiguous };
  };
  const descendsFrom = (leafId: string, ancestorId: string) => {
    let node = byCategory.get(leafId);
    for (let guard = 0; node && guard < 20; guard++) { if (node.id === ancestorId) return true; node = node.parentId ? byCategory.get(node.parentId) : undefined; }
    return false;
  };
  /**
   * The row's leaf: its category cell when that names exactly one leaf; otherwise the leaf its product type belongs to (within the stated parent, when the cell names
   * a parent). A cell that names a leaf the product type contradicts is reported, never silently trusted or overridden.
   */
  const resolveCategory = (supplierId: string, stated: string, productName: string) => {
    const statedIds = [...(mappings.get(`${supplierId}:${key(stated)}`) ?? categories.get(key(stated)) ?? [])];
    const reading = readProductType(productName, statedIds.length ? null : stated);
    const typed = reading.types.map(type => ({ ...type, leaves: leavesForType(type.key) }));
    const inferred = [...new Set(typed.map(type => type.leaves.primary).filter((id): id is string => Boolean(id)))];
    const anyAmbiguous = typed.some(type => type.leaves.ambiguous && !type.leaves.primary);
    const everyCandidate = new Set(typed.flatMap(type => [...type.leaves.all]));
    const first = typed[0];
    const base = { rule: PRODUCT_TYPE_RULE_VERSION, stated: stated || null, productType: typed.length === 1 ? first.key : typed.length ? typed.map(t => t.key).join('+') : null,
      productSubtype: typed.length === 1 ? first.subtype : null };
    type Outcome = { c?: CategoryRule; candidates: CategoryRule[]; conflict: boolean; ambiguous: boolean; typeWithoutLeaf: boolean; meta: CategoryResolution };
    const result = (basis: CategoryResolution['basis'], c: CategoryRule | undefined, extra: Partial<Outcome> = {}): Outcome =>
      ({ c, candidates: [], conflict: false, ambiguous: false, typeWithoutLeaf: false, meta: { basis, ...base, ...(extra.candidates?.length && { candidates: extra.candidates.map(x => x.id) }) }, ...extra });
    const statedOne = statedIds.length === 1 ? byCategory.get(statedIds[0]) : undefined;
    if (statedOne && !parents.has(statedOne.id)) {
      // A leaf the cell names stands unless the name states a type that belongs elsewhere in this taxonomy.
      if (everyCandidate.size && !everyCandidate.has(statedOne.id)) {
        return result('STATED_LABEL', undefined, { conflict: true, candidates: [statedOne, ...inferred.map(id => byCategory.get(id)!)] });
      }
      return result('STATED_LABEL', statedOne);
    }
    const scope = statedOne && parents.has(statedOne.id) ? statedOne : undefined;
    const scoped = scope ? inferred.filter(id => descendsFrom(id, scope.id)) : statedIds.length > 1 ? inferred.filter(id => statedIds.includes(id)) : inferred;
    const basis: CategoryResolution['basis'] = scope ? 'STATED_PARENT_AND_TYPE' : 'PRODUCT_TYPE';
    const leafless = typed.filter(type => !type.leaves.primary);
    const all = (ids: Iterable<string>) => [...new Set(ids)].map(id => byCategory.get(id)!).filter(Boolean);
    // Several readings (a 2-in-1, a type whose name fits two leaves, a stated type with no leaf beside one with a leaf): never settled by preference.
    if (scoped.length > 1 || anyAmbiguous || (typed.length > 1 && leafless.length && inferred.length) || (statedIds.length > 1 && scoped.length !== 1)) {
      return result(basis, undefined, { ambiguous: true, candidates: all([...scoped, ...inferred, ...everyCandidate, ...(statedIds.length > 1 && !inferred.length ? statedIds : [])]) });
    }
    if (scoped.length === 1) return result(basis, byCategory.get(scoped[0]));
    if (scope && inferred.length) return result(basis, undefined, { conflict: true, candidates: all([scope.id, ...inferred]) });
    if (scope) return result('STATED_LABEL', scope);
    // A product type this taxonomy has no leaf for: no enabled brand can allow it.
    if (typed.length && !everyCandidate.size) return result('PRODUCT_TYPE', undefined, { typeWithoutLeaf: true });
    return result('NONE', undefined);
  };
  const evaluateRow = (supplierId: string, brand: string, category: string, productName: string): EligibilityDecision => {
    const bs = resolveBrand(brand);
    const b = bs?.size === 1 ? byBrand.get([...bs][0]) : undefined;
    const ambiguousBrand = Boolean(bs?.size);
    const resolved = resolveCategory(supplierId, category, productName);
    const withMeta = (d: EligibilityDecision): EligibilityDecision => ({ ...d, category: resolved.meta });
    if (!policy) return withMeta(decision('HOLD', 'POLICY_NOT_CONFIGURED'));
    if (b && (b.effect === 'DENY' || !b.isActive || b.effect === null)) return withMeta(decision('SKIP', 'BRAND_NOT_ALLOWED'));
    if (resolved.typeWithoutLeaf) return withMeta(decision('SKIP', 'PRODUCT_TYPE_NOT_IN_TAXONOMY'));
    if (resolved.candidates.length > 1 || resolved.conflict || resolved.ambiguous) {
      // Two readings: when every one of them is a definite skip, so is the row. Otherwise a person settles which one it is.
      const verdicts = resolved.candidates.map(c => judge(b, c, { brand: ambiguousBrand, category: false }));
      if (verdicts.length && verdicts.every(v => v.outcome === 'SKIP')) return withMeta({ ...verdicts[verdicts.length - 1], categoryId: undefined });
      return withMeta(decision('HOLD', resolved.conflict ? 'CATEGORY_CONFLICTS_PRODUCT_TYPE' : 'CATEGORY_AMBIGUOUS'));
    }
    return withMeta(judge(b, resolved.c, { brand: ambiguousBrand, category: false }));
  };

  const memo = new Map<string, EligibilityDecision>();
  return {
    id: policy?.id ?? null,
    /**
     * Policy for a row. With a product name, a missing or non-taxonomy category cell is settled from the product type the name states (exact leaf only, never a
     * parent's allowance); without one, the original exact-label semantics apply.
     */
    evaluate(supplierId: string, brand: string, category: string, productName?: string): EligibilityDecision {
      const typeKey = productName === undefined ? null : JSON.stringify(readProductType(productName).types.map(t => [t.key, t.subtype]));
      const cacheKey = JSON.stringify([supplierId, eligibilityLabel(brand), key(category), typeKey]);
      const cached = memo.get(cacheKey);
      if (cached) return cached;
      const decision = Object.freeze(productName === undefined ? evaluate(supplierId, brand, category) : evaluateRow(supplierId, brand, category, productName));
      if (memo.size >= 2048) memo.delete(memo.keys().next().value!);
      memo.set(cacheKey, decision);
      return decision;
    },
    /**
     * The leaf a row would be admitted under, judged without any brand: used when a brand is new to the catalog and is being added for exactly the leaves its
     * rows need. The same category resolution as evaluate(); an explicitly denied or inactive branch is a definite skip, anything unsettled is a hold.
     */
    leafFor(supplierId: string, category: string, productName: string): { outcome: 'ALLOW' | 'SKIP' | 'HOLD'; reason: string; categoryId?: string; category: CategoryResolution } {
      const resolved = resolveCategory(supplierId, category, productName);
      const out = (outcome: 'ALLOW' | 'SKIP' | 'HOLD', reason: string, categoryId?: string) => ({ outcome, reason, ...(categoryId && { categoryId }), category: resolved.meta });
      if (!policy) return out('HOLD', 'POLICY_NOT_CONFIGURED');
      if (resolved.typeWithoutLeaf) return out('SKIP', 'PRODUCT_TYPE_NOT_IN_TAXONOMY');
      if (resolved.conflict) return out('HOLD', 'CATEGORY_CONFLICTS_PRODUCT_TYPE');
      if (resolved.ambiguous || resolved.candidates.length > 1) return out('HOLD', 'CATEGORY_AMBIGUOUS');
      const c = resolved.c;
      if (!c) return out('HOLD', 'CATEGORY_UNKNOWN');
      if (parents.has(c.id)) return out('HOLD', 'CATEGORY_REQUIRES_LEAF');
      const visited = new Set<string>();
      for (let node: CategoryRule | undefined = c; node; node = node.parentId ? byCategory.get(node.parentId) : undefined) {
        if (visited.has(node.id)) return out('HOLD', 'CATEGORY_HIERARCHY_AMBIGUOUS');
        visited.add(node.id);
        if (node.effect === 'DENY' || !node.isActive) return out('SKIP', 'CATEGORY_DENIED');
        if (node.parentId && !byCategory.has(node.parentId)) return out('HOLD', 'CATEGORY_HIERARCHY_UNKNOWN');
      }
      return out('ALLOW', 'LEAF_RESOLVED', c.id);
    },
    /** The single brand rule a label names (name or approved alias), whatever its effect; undefined when none or several. Never a spelling guess. */
    brandOf(label: string): ResolvedBrandRule | undefined {
      const ids = resolveBrand(label);
      const b = ids?.size === 1 ? byBrand.get([...ids][0]) : undefined;
      return b ? { id: b.id, name: b.name, effect: b.effect, isActive: b.isActive } : undefined;
    },
    /**
     * A row whose identity already resolved to a canonical product: that product's own Brand and Category are authoritative,
     * and an explicit exclusion wins over every allowance.
     */
    evaluateIdentity(product: { productId?: string | null; brandId: string | null; categoryId: string | null }): EligibilityDecision {
      if (policy && product.productId && excluded.has(product.productId)) return decision('SKIP', 'PRODUCT_EXCLUDED', { productId: product.productId });
      const b = product.brandId ? byBrand.get(product.brandId) : undefined;
      const c = product.categoryId ? byCategory.get(product.categoryId) : undefined;
      return { ...judge(b, c, { brand: false, category: false }), ...(product.productId ? { productId: product.productId } : {}) };
    },
    isExcluded(productId: string): boolean { return excluded.has(productId); },
    /** Retrieval only. This method is never used by evaluate(), matching or SKU association. */
    suggestBrands(label: string): BrandSuggestion[] {
      const query = trigrams(eligibilityMappingKey(label.slice(0, 200)));
      const candidates = new Set<string>();
      for (const gram of query) for (const candidate of gramIndex.get(gram) ?? []) candidates.add(candidate);
      const best = new Map<string, BrandSuggestion>();
      const spelled = new Set(spellingKeys(label.slice(0, 200)).flatMap(spelling => [...(spellingIndex.get(spelling) ?? [])]));
      for (const candidate of spelled) for (const brandId of suggestionBrands.get(candidate) ?? []) {
        const b = byBrand.get(brandId)!;
        if ((best.get(b.id)?.score ?? 0) < SPELLING_SUGGESTION_SCORE) best.set(b.id, { brandId: b.id, name: b.name, matchedLabel: labelEvidence.get(candidate)!.label, score: SPELLING_SUGGESTION_SCORE, effect: b.effect });
      }
      for (const candidate of candidates) {
        const evidence = labelEvidence.get(candidate)!;
        const overlap = [...query].filter(gram => evidence.grams.has(gram)).length;
        const score = 2 * overlap / (query.size + evidence.grams.size);
        if (score < 0.35) continue;
        for (const brandId of suggestionBrands.get(candidate) ?? []) {
          const b = byBrand.get(brandId)!;
          if ((best.get(b.id)?.score ?? 0) >= score) continue;
          best.set(b.id, { brandId: b.id, name: b.name, matchedLabel: evidence.label, score, effect: b.effect });
        }
      }
      return [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.brandId.localeCompare(b.brandId)).slice(0, 3);
    },
  };
}
