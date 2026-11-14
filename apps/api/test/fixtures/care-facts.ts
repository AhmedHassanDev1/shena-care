import type { CareProductFacts } from '../../src/modules/catalog/public';
import type { EngineKnowledge, EngineSafetyRule, IngredientVocabulary, Offer } from '../../src/modules/guidance/recommendation/recommendation-engine';

let counter = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface FactOptions {
  name: string; type: string; area?: 'skin' | 'hair'; role?: string; rank?: number; skinTypes?: string[]; spf?: number
  fragranceFree?: boolean | null; usage?: string | null; concerns?: string[]
  /** [slug, family, isOntologyActive, concentrationValue?] */
  ingredients?: Array<[string, string | null, boolean, number?]>
  periodEligibility?: string | null; statedPeriod?: string
  warnings?: Array<{ kind: string; condition: string }>
}

/** A published product's verified facts, shaped exactly as CatalogService.getCareProductFacts returns them. */
export function facts(options: FactOptions): CareProductFacts {
  const n = ++counter;
  const productId = uuid(n * 10);
  const skuId = uuid(n * 10 + 1);
  const area = options.area ?? 'skin';
  const ingredients = options.ingredients ?? [];
  return {
    productId, name: options.name, brandName: 'Brand', slug: options.name.toLowerCase().replace(/\s+/g, '-'), brandSlug: 'brand',
    productType: options.type, productSubtype: null, concerns: options.concerns ?? [], usageText: options.usage === undefined ? 'Use as directed on the pack.' : options.usage,
    warningsText: null, description: null, categorySlug: null, categoryName: null, departmentSlug: area === 'skin' ? 'skin-care' : 'hair-care', productLine: null,
    targetArea: area === 'skin' ? 'FACE' : 'HAIR', texture: null, suitableSkinTypes: options.skinTypes ?? [], suitableHairTypes: [],
    spf: options.spf ?? null, broadSpectrum: null, uvFilterType: null, waterResistanceMinutes: null,
    isFragranceFree: options.fragranceFree ?? null, isNonComedogenic: null, claimsEvidence: null, factVersion: 1, lastReviewedAt: null,
    skus: [{ id: skuId, size: 50, sizeUnit: 'ml', isActive: true }], imageUrl: 'https://cdn.fixtures.test/p.png',
    actives: [],
    productIngredients: ingredients.map(([slug, family, active, concentration], index) => ({
      ingredientId: uuid(900000 + n * 100 + index), skuId: null, ingredientSlug: slug, familySlug: family, isKeyActive: active,
      concentrationValue: concentration ?? null, concentrationUnit: concentration ? '%' : null,
      ingredientName: slug.replace(/-/g, ' '), isOntologyActive: active, concentrationStatus: concentration ? 'STATED' : 'UNKNOWN', sortOrder: index,
    })),
    ingredientIds: ingredients.map((_, index) => uuid(900000 + n * 100 + index)),
    ingredientSlugs: ingredients.map(([slug]) => slug),
    ingredientFamilies: [...new Set(ingredients.map(([, family]) => family).filter((f): f is string => !!f))],
    safetyWarnings: (options.warnings ?? []).map((w, index) => ({ id: uuid(800000 + n * 10 + index), skuId: null, kind: w.kind, condition: w.condition, descriptionEn: 'Manufacturer warning', descriptionAr: 'تحذير من الشركة' })),
    usageRules: [],
    variants: [{
      skuId, code: `SKU-${n}`, variantName: '50 ml', size: 50, sizeUnit: 'ml',
      routine: {
        primaryRole: options.role ?? options.type.toUpperCase(), routineDomain: area.toUpperCase(), stepOrder: options.rank ?? 5,
        routinePeriod: options.statedPeriod ?? 'UNKNOWN', periodEligibility: options.periodEligibility ?? null, rinseMode: 'UNKNOWN', cadenceUnit: 'UNKNOWN', cadenceMin: null, cadenceMax: null,
        activeIngredients: [], featuredIngredients: [], cautions: [],
      },
    }],
  };
}

export const skuOf = (product: CareProductFacts) => product.variants[0].skuId;

export function offersFor(products: CareProductFacts[], overrides: Record<string, Partial<Offer>> = {}): Map<string, Offer> {
  return new Map(products.map(product => {
    const skuId = skuOf(product);
    return [skuId, { skuId, canOrder: true, price: { amount: 200, currency: 'EGP', compareAtAmount: null }, ...(overrides[product.name] ?? {}) }];
  }));
}

let knowledgeCounter = 0;
export function relevance(subjectType: 'PRODUCT_TYPE' | 'INGREDIENT' | 'INGREDIENT_FAMILY', subjectKey: string, concernSlug: string, strength: 'PRIMARY' | 'SUPPORTIVE', careArea: 'skin' | 'hair' = 'skin'): EngineKnowledge {
  const n = ++knowledgeCounter;
  return {
    id: uuid(700000 + n), key: `k${n}`, subjectType, subjectKey, topic: 'CONCERN_RELEVANCE', concernSlug, careArea, strength,
    statementEn: `${subjectKey} is relevant to ${concernSlug}.`, statementAr: `${subjectKey} مناسب لـ ${concernSlug}.`,
    evidenceClass: 'EVIDENCE_SUPPORTED', reviewStatus: 'PENDING_PROFESSIONAL_REVIEW', sourceTitle: 'Test source', sourceUrl: 'https://example.test/source',
  };
}

export function precaution(subjectType: 'INGREDIENT' | 'INGREDIENT_FAMILY', subjectKey: string): EngineKnowledge {
  return { ...relevance(subjectType, subjectKey, 'none', 'PRIMARY'), topic: 'PRECAUTION', concernSlug: null, strength: null, statementEn: `${subjectKey} precaution.`, statementAr: `احتياط ${subjectKey}.` };
}

export const RETINOID_PREGNANCY_RULE: EngineSafetyRule = {
  key: 'retinoids-pregnancy', subjectType: 'FAMILY', subject: 'retinoids', condition: 'PREGNANT', noteAr: 'الريتينويدات مش بتتقترح أثناء الحمل.', sourceTitle: 'AAD', sourceUrl: 'https://example.test/aad',
};

export const VOCABULARY: IngredientVocabulary[] = [
  { id: uuid(600001), slug: 'niacinamide', name: 'Niacinamide', aliases: ['Nicotinamide'], familySlug: 'niacinamide' },
  { id: uuid(600002), slug: 'retinol', name: 'Retinol', aliases: [], familySlug: 'retinoids' },
  { id: uuid(600003), slug: 'ascorbic-acid', name: 'Ascorbic Acid', aliases: ['L-Ascorbic Acid'], familySlug: 'vitamin-c' },
  { id: uuid(600004), slug: 'sodium-ascorbyl-phosphate', name: 'Sodium Ascorbyl Phosphate', aliases: [], familySlug: 'vitamin-c' },
  { id: uuid(600005), slug: 'salicylic-acid', name: 'Salicylic Acid', aliases: ['BHA'], familySlug: 'hydroxy-acids' },
];
