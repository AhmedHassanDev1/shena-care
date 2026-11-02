export type PolicyEffect = 'ALLOW' | 'DENY';
export interface EligibilityDocument {
  /** Absent on historical snapshots: retain the original exact-label semantics. */
  resolutionVersion?: number;
  brands: Array<{ id: string; name: string; isActive: boolean; effect: PolicyEffect | null; aliases: string[] }>;
  categories: Array<{ id: string; name: string; parentId: string | null; isActive: boolean; effect: PolicyEffect | null; aliases?: string[] }>;
  mappings: Array<{ supplierId: string; label: string; categoryIds: string[] }>;
}
export interface BrandSuggestion { brandId: string; name: string; matchedLabel: string; score: number; effect: PolicyEffect | null }
export interface EligibilityDecision {
  outcome: 'ALLOW' | 'SKIP' | 'HOLD'; reason: string; policyId: string | null; version: number | null;
  brandId?: string; brandName?: string; categoryId?: string;
}
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
  'brand', 'original', 'imported', 'products', 'cream', 'cleanser', 'moisturizer', 'lotion', 'serum', 'shampoo', 'conditioner', 'gel', 'foam', 'face', 'wash',
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
  for (const b of doc?.brands ?? []) for (const label of [b.name, ...b.aliases]) {
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
  const evaluate = (supplierId: string, brand: string, category: string): EligibilityDecision => {
      const decision = (outcome: EligibilityDecision['outcome'], reason: string, extra = {}): EligibilityDecision =>
        ({ outcome, reason, policyId: policy?.id ?? null, version: policy?.version ?? null, ...extra });
      if (!policy) return decision('HOLD', 'POLICY_NOT_CONFIGURED');
      const bs = resolveBrand(brand);
      const cs = mappings.get(`${supplierId}:${key(category)}`) ?? categories.get(key(category));
      const b = bs?.size === 1 ? byBrand.get([...bs][0]) : undefined;
      const c = cs?.size === 1 ? byCategory.get([...cs][0]) : undefined;
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
      if (c && !parents.has(c.id) && c.effect !== 'ALLOW') return decision('SKIP', 'CATEGORY_NOT_ALLOWED');
      if (!b) return decision('HOLD', bs?.size ? 'BRAND_AMBIGUOUS' : 'BRAND_UNKNOWN');
      if (!c) return decision('HOLD', cs?.size ? 'CATEGORY_AMBIGUOUS' : 'CATEGORY_UNKNOWN');
      if (parents.has(c.id)) return decision('HOLD', 'CATEGORY_REQUIRES_LEAF');
      return decision('ALLOW', 'BRAND_AND_LEAF_APPROVED', { brandId: b.id, brandName: b.name, categoryId: c.id });
  };
  const memo = new Map<string, EligibilityDecision>();
  return {
    id: policy?.id ?? null,
    evaluate(supplierId: string, brand: string, category: string): EligibilityDecision {
      const cacheKey = JSON.stringify([supplierId, eligibilityLabel(brand), key(category)]);
      const cached = memo.get(cacheKey);
      if (cached) return cached;
      const decision = Object.freeze(evaluate(supplierId, brand, category));
      if (memo.size >= 2048) memo.delete(memo.keys().next().value!);
      memo.set(cacheKey, decision);
      return decision;
    },
    /** Retrieval only. This method is never used by evaluate(), matching or SKU association. */
    suggestBrands(label: string): BrandSuggestion[] {
      const query = trigrams(eligibilityMappingKey(label.slice(0, 200)));
      const candidates = new Set<string>();
      for (const gram of query) for (const candidate of gramIndex.get(gram) ?? []) candidates.add(candidate);
      const best = new Map<string, BrandSuggestion>();
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
