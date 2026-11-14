import { Injectable } from '@nestjs/common';
import { CatalogService, CareProductFacts, IngredientService } from '../../catalog/public';
import { CommerceService } from '../../commerce/public';
import { RoutineCompatibilityService } from '../../care/public';
import { KnowledgeRow, KnowledgeService, toView } from '../knowledge/knowledge.service';
import {
  Basis, EngineResult, EngineSafetyRule, IngredientVocabulary, Offer, RankedProduct, RecommendationQuery, SafetyAnswers, SafetyCondition, UNKNOWN_SAFETY, recommend,
} from './recommendation-engine';

export interface RecommendationInput {
  careArea?: 'skin' | 'hair' | null
  concerns?: string[]
  productTypes?: string[]
  skinType?: string | null
  hairType?: string | null
  fragranceFree?: boolean | null
  budgetMax?: number | null
  safety?: Partial<SafetyAnswers>
  /** The customer's own words for what irritates them; resolved to catalog ingredients here. */
  sensitivities?: string[]
  excludeProductIds?: string[]
  /** Restrict the run to these products (a question about a specific product). */
  onlyProductIds?: string[]
  limit?: number
  perTypeLimit?: number | null
}

export interface RecommendedItem {
  productId: string; skuId: string; slug: string; name: string; brand: string; brandSlug: string
  productType: string | null; role: string | null; careArea: 'skin' | 'hair' | null
  variantName: string | null; sizeLabel: string | null; size: number | null; sizeUnit: string | null; imageUrl: string | null
  category: { slug: string; name: string } | null
  price: { amount: number; currency: string; compareAtAmount: number | null }
  canOrder: true
  matchLevel: 'STRONG' | 'GOOD' | 'BASIC'
  reasons: Array<{ code: string; basis: Basis; text: string; concernSlug?: string; source?: { title: string; url: string | null; professionallyReviewed: boolean } }>
  cautions: Array<{ code: string; basis: Basis; text: string; source?: { title: string; url: string | null; professionallyReviewed: boolean } }>
  unknowns: Array<{ code: string; text: string }>
  keyActives: Array<{ name: string; level: string; concentration: string | null }>
  usage: { text: string | null; period: string | null; verified: boolean }
}

export interface RecommendationResult {
  engineVersion: string
  items: RecommendedItem[]
  excluded: Array<{ productId: string; name: string; code: string; text: string }>
  needsSafetyAnswer: SafetyCondition[]
  unresolvedSensitivities: string[]
  consideredCount: number
  generatedAt: string
}

/** Internal view the consultation uses: the public items plus the engine output and the product facts behind them. */
export interface RecommendationRun { result: RecommendationResult; engine: EngineResult; facts: Map<string, CareProductFacts>; knowledge: Map<string, KnowledgeRow> }

const sizeLabel = (size: number | null, unit: string | null) => (size ? `${Number.isInteger(size) ? size : size.toFixed(1)} ${unit ?? ''}`.trim() : null);

/**
 * Recommendation service (GLO-302): retrieves the published catalog with its verified facts, asks Commerce what can be
 * ordered and at what price, loads the sourced knowledge and the safety rules, and runs the deterministic engine.
 * The same call serves the storefront (Corner, category shelves) and the consultation.
 */
@Injectable()
export class RecommendationService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly ingredients: IngredientService,
    private readonly commerce: CommerceService,
    private readonly compatibility: RoutineCompatibilityService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async run(input: RecommendationInput, locale: 'ar' | 'en' = 'ar'): Promise<RecommendationRun> {
    const department = input.careArea === 'skin' ? 'skin-care' : input.careArea === 'hair' ? 'hair-care' : undefined;
    const [products, vocabulary, knowledge, rules, avoid] = await Promise.all([
      this.catalog.getCareProductFacts(input.onlyProductIds?.length ? { productIds: input.onlyProductIds } : { department }),
      this.catalog.getActiveIngredientVocabulary() as Promise<IngredientVocabulary[]>,
      this.knowledge.forEngine(),
      this.compatibility.rules(),
      this.resolveSensitivities(input.sensitivities ?? []),
    ]);
    // One batch for every active variant: listing + price + catalog status, the same gates as the storefront.
    const terms = await this.commerce.getSellingTermsBatch(products.flatMap(product => product.variants.map(variant => variant.skuId)));
    const offers = new Map<string, Offer>();
    for (const [skuId, term] of terms) if (term) offers.set(skuId, { skuId, canOrder: term.canOrder, price: term.price });

    const query: RecommendationQuery = {
      careArea: input.careArea ?? null,
      concerns: [...new Set(input.concerns ?? [])].slice(0, 6),
      productTypes: [...new Set((input.productTypes ?? []).map(type => type.toLowerCase()))].slice(0, 6),
      skinType: input.skinType ?? null, hairType: input.hairType ?? null,
      fragranceFree: input.fragranceFree ?? null,
      budgetMax: input.budgetMax && input.budgetMax > 0 ? input.budgetMax : null,
      safety: { ...UNKNOWN_SAFETY, ...(input.safety ?? {}) },
      avoidIngredientIds: avoid.ids, unresolvedAvoidTerms: avoid.unresolved,
      excludeProductIds: input.excludeProductIds, limit: Math.min(Math.max(input.limit ?? 6, 1), 24), perTypeLimit: input.perTypeLimit,
    };
    const safetyRules: EngineSafetyRule[] = rules.filter(rule => rule.kind === 'EXCLUDE_CONDITION' && !!rule.condition)
      .map(rule => ({ key: rule.key, subjectType: rule.subjectType, subject: rule.subject, condition: rule.condition!, noteAr: rule.noteAr, sourceTitle: rule.sourceTitle, sourceUrl: rule.sourceUrl }));

    const engine = recommend(query, products, offers, knowledge, safetyRules, vocabulary);
    const facts = new Map(products.map(product => [product.productId, product]));
    const knowledgeById = new Map(knowledge.map(row => [row.id, row as unknown as KnowledgeRow]));
    const items = engine.ranked.map(item => this.toItem(item, facts.get(item.productId)!, knowledgeById, locale));
    return {
      engine, facts, knowledge: knowledgeById,
      result: {
        engineVersion: engine.engineVersion, items,
        excluded: engine.excluded.map(e => ({ productId: e.productId, name: e.name, code: e.code, text: locale === 'ar' ? e.textAr : e.textEn })),
        needsSafetyAnswer: engine.needsSafetyAnswer, unresolvedSensitivities: avoid.unresolved,
        consideredCount: engine.consideredCount, generatedAt: new Date().toISOString(),
      },
    };
  }

  async recommend(input: RecommendationInput, locale: 'ar' | 'en' = 'ar'): Promise<RecommendationResult> {
    return (await this.run(input, locale)).result;
  }

  /**
   * The Corner shelf: every active concern with how many orderable products the engine links to it, from one catalog
   * load. A concern with nothing to show is reported with count 0 so the storefront can hide it (never a dead shelf).
   * Safety answers are unknown here, so products held back for a safety question are not counted.
   */
  async concernShelf(concerns: Array<{ slug: string; name: string; careArea: 'skin' | 'hair' }>) {
    const [products, vocabulary, knowledge, rules] = await Promise.all([
      this.catalog.getCareProductFacts({}),
      this.catalog.getActiveIngredientVocabulary() as Promise<IngredientVocabulary[]>,
      this.knowledge.forEngine(),
      this.compatibility.rules(),
    ]);
    const terms = await this.commerce.getSellingTermsBatch(products.flatMap(product => product.variants.map(variant => variant.skuId)));
    const offers = new Map<string, Offer>();
    for (const [skuId, term] of terms) if (term) offers.set(skuId, { skuId, canOrder: term.canOrder, price: term.price });
    const safetyRules: EngineSafetyRule[] = rules.filter(rule => rule.kind === 'EXCLUDE_CONDITION' && !!rule.condition)
      .map(rule => ({ key: rule.key, subjectType: rule.subjectType, subject: rule.subject, condition: rule.condition!, noteAr: rule.noteAr, sourceTitle: rule.sourceTitle, sourceUrl: rule.sourceUrl }));
    const facts = new Map(products.map(product => [product.productId, product]));
    return concerns.map(concern => {
      const result = recommend({ careArea: concern.careArea, concerns: [concern.slug], productTypes: [], safety: { ...UNKNOWN_SAFETY },
        avoidIngredientIds: [], unresolvedAvoidTerms: [], limit: 24, perTypeLimit: null }, products, offers, knowledge, safetyRules, vocabulary);
      const lead = result.ranked.find(item => facts.get(item.productId)?.imageUrl);
      return {
        slug: concern.slug, name: concern.name, careArea: concern.careArea, productCount: result.ranked.length,
        heldForSafety: result.needsSafetyAnswer.length > 0,
        productTypes: [...new Set(result.ranked.map(item => item.productType).filter((type): type is string => !!type))],
        leadImageUrl: lead ? facts.get(lead.productId)!.imageUrl : null,
      };
    });
  }

  /** The customer's words -> ontology ingredients. A word that matches nothing is returned as unresolved, never guessed. */
  private async resolveSensitivities(terms: string[]): Promise<{ ids: string[]; unresolved: string[] }> {
    const ids: string[] = [];
    const unresolved: string[] = [];
    for (const term of [...new Set(terms.map(t => t.trim()).filter(Boolean))].slice(0, 8)) {
      const match = await this.ingredients.findByInciOrAlias(term);
      if (match) ids.push(match.id); else unresolved.push(term);
    }
    return { ids, unresolved };
  }

  private toItem(item: RankedProduct, product: CareProductFacts, knowledge: Map<string, KnowledgeRow>, locale: 'ar' | 'en'): RecommendedItem {
    const variant = product.variants.find(v => v.skuId === item.skuId) ?? product.variants[0];
    const source = (id?: string) => {
      const row = id ? knowledge.get(id) : undefined;
      if (!row) return undefined;
      const view = toView(row, locale);
      return { title: view.source.title, url: view.source.url, professionallyReviewed: view.professionallyReviewed };
    };
    const rule = product.usageRules.find(r => !r.skuId || r.skuId === item.skuId);
    const routine = variant?.routine;
    const period = rule && rule.routinePeriod !== 'UNKNOWN' ? rule.routinePeriod : routine && routine.routinePeriod !== 'UNKNOWN' ? routine.routinePeriod : routine?.periodEligibility ?? null;
    return {
      productId: product.productId, skuId: item.skuId, slug: product.slug, name: product.name, brand: product.brandName, brandSlug: product.brandSlug,
      productType: item.productType, role: item.role, careArea: item.careArea,
      variantName: variant?.variantName ?? null, sizeLabel: variant ? sizeLabel(variant.size, variant.sizeUnit) : null, size: variant?.size ?? null, sizeUnit: variant?.sizeUnit ?? null,
      imageUrl: product.imageUrl, category: product.categorySlug ? { slug: product.categorySlug, name: product.categoryName ?? product.categorySlug } : null,
      price: item.price!, canOrder: true, matchLevel: item.matchLevel,
      reasons: item.reasons.map(r => ({ code: r.code, basis: r.basis, text: locale === 'ar' ? r.textAr : r.textEn, concernSlug: r.concernSlug, source: source(r.knowledgeId) })),
      cautions: item.cautions.map(c => ({ code: c.code, basis: c.basis, text: locale === 'ar' ? c.textAr : c.textEn, source: source(c.knowledgeId) })),
      unknowns: item.unknowns.map(u => ({ code: u.code, text: locale === 'ar' ? u.textAr : u.textEn })),
      keyActives: item.actives.filter(a => a.level !== 'LISTED').map(a => ({ name: a.name, level: a.level, concentration: a.concentration })),
      // The manufacturer's own directions, verbatim; never rewritten here.
      usage: { text: product.usageText, period, verified: !!rule },
    };
  }
}
