import type { CareProductFacts } from '../../catalog/public';

/**
 * Recommendation engine V1 (GLO-302): pure and deterministic. Given what the customer needs and the verified facts of the
 * published catalog, it decides which products are eligible, which are excluded and why, and ranks the rest by reasons a
 * person can read. No model is involved and nothing is inferred about a product: a missing fact is reported as unknown.
 *
 * Every reason names its basis:
 *   VERIFIED  a manufacturer / label fact stored in Catalog for this product
 *   EVIDENCE  sourced care knowledge (care.knowledge_entries) applied to a verified property of the product
 *   RULE      store logic (the product's type, routine order); never a claim about the product
 */
export const RECOMMENDATION_ENGINE_VERSION = 'recommendation-engine/1';

export type TriState = 'YES' | 'NO' | 'UNKNOWN';
export type Basis = 'VERIFIED' | 'EVIDENCE' | 'RULE';
export type SafetyCondition = 'PREGNANT' | 'BREASTFEEDING' | 'PRESCRIPTION_TOPICAL' | 'ORAL_RETINOID';

export interface SafetyAnswers { pregnant: TriState; breastfeeding: TriState; prescriptionTopical: TriState; oralRetinoid: TriState }
export const UNKNOWN_SAFETY: SafetyAnswers = { pregnant: 'UNKNOWN', breastfeeding: 'UNKNOWN', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN' };

export interface RecommendationQuery {
  careArea?: 'skin' | 'hair' | null;
  concerns: string[];
  productTypes: string[];
  skinType?: string | null;
  hairType?: string | null;
  fragranceFree?: boolean | null;
  budgetMax?: number | null;
  safety: SafetyAnswers;
  /** Ingredient ids the customer reacts to (resolved from their words). */
  avoidIngredientIds: string[];
  /** Words the customer used for a sensitivity that matched no known ingredient: reported, never guessed. */
  unresolvedAvoidTerms: string[];
  excludeProductIds?: string[];
  limit?: number;
  /** At most this many products of one type (keeps a mixed answer varied). Null = no cap. */
  perTypeLimit?: number | null;
}

export interface EngineKnowledge {
  id: string; key: string; subjectType: string; subjectKey: string; topic: string; concernSlug: string | null; careArea: string | null
  strength: string | null; statementEn: string; statementAr: string; evidenceClass: string; reviewStatus: string
  sourceTitle: string; sourceUrl: string | null
}

export interface EngineSafetyRule {
  key: string; subjectType: 'FAMILY' | 'INGREDIENT'; subject: string; condition: string; noteAr: string | null; sourceTitle: string; sourceUrl: string | null
}

export interface IngredientVocabulary { id: string; slug: string; name: string; aliases: string[]; familySlug: string | null }

export interface Offer { skuId: string; canOrder: boolean; price: { amount: number; currency: string; compareAtAmount: number | null } | null }

export interface Reason {
  code: 'TYPE_REQUESTED' | 'CONCERN_TAG' | 'TYPE_FOR_CONCERN' | 'ACTIVE_FOR_CONCERN' | 'SKIN_TYPE' | 'HAIR_TYPE' | 'FRAGRANCE_FREE' | 'SUN_PROTECTION'
  basis: Basis
  textAr: string
  textEn: string
  knowledgeId?: string
  concernSlug?: string
  weight: number
}

export interface Caution { code: string; basis: Basis; textAr: string; textEn: string; knowledgeId?: string }
export interface Unknown { code: 'INGREDIENT_LIST' | 'FRAGRANCE_STATUS' | 'SKIN_TYPE_SUITABILITY' | 'USAGE' | 'SENSITIVITY_TERM'; textAr: string; textEn: string }

/** How sure we are that an active really characterises the product. */
export type ActiveLevel = 'STATED' | 'FEATURED' | 'NAMED' | 'LISTED';
export interface ProductActive { slug: string; familySlug: string | null; name: string; level: ActiveLevel; concentration: string | null }

export interface RankedProduct {
  productId: string; skuId: string; productType: string | null; role: string | null; careArea: 'skin' | 'hair' | null
  score: number; matchLevel: 'STRONG' | 'GOOD' | 'BASIC'
  reasons: Reason[]; cautions: Caution[]; unknowns: Unknown[]; actives: ProductActive[]
  price: Offer['price']
}

export type ExclusionCode = 'UNAVAILABLE' | 'OVER_BUDGET' | 'SAFETY_CONDITION' | 'SAFETY_UNANSWERED' | 'AVOIDED_INGREDIENT' | 'CONTAINS_FRAGRANCE' | 'PRODUCT_WARNING';
export interface ExcludedProduct { productId: string; name: string; code: ExclusionCode; textAr: string; textEn: string; ruleKey?: string; condition?: SafetyCondition }

export interface EngineResult {
  engineVersion: string
  ranked: RankedProduct[]
  excluded: ExcludedProduct[]
  /** Safety questions whose answer would change the result (a relevant product is held back until answered). */
  needsSafetyAnswer: SafetyCondition[]
  consideredCount: number
}

const SKIN_TYPE_AR: Record<string, string> = { normal: 'العادية', dry: 'الجافة', oily: 'الدهنية', combination: 'المختلطة', sensitive: 'الحساسة' };
const TYPE_AR: Record<string, string> = {
  cleanser: 'غسول', moisturizer: 'مرطب', serum: 'سيروم', sunscreen: 'واقي شمس', shampoo: 'شامبو', conditioner: 'بلسم', toner: 'تونر',
  mask: 'ماسك', exfoliant: 'مقشّر', 'eye-care': 'عناية بالعين', 'hair-treatment': 'علاج للشعر', 'hair-mask': 'ماسك للشعر', 'hair-oil': 'زيت للشعر',
};
const CONDITION_AR: Record<SafetyCondition, string> = {
  PREGNANT: 'الحمل', BREASTFEEDING: 'الرضاعة', PRESCRIPTION_TOPICAL: 'استخدام علاج موضعي بروشتة', ORAL_RETINOID: 'استخدام ريتينويد بالفم (زي الرواكتان)',
};
const CONDITION_EN: Record<SafetyCondition, string> = {
  PREGNANT: 'pregnancy', BREASTFEEDING: 'breastfeeding', PRESCRIPTION_TOPICAL: 'a prescription topical', ORAL_RETINOID: 'an oral retinoid',
};
const LEVEL_NOTE_AR: Record<ActiveLevel, string> = {
  STATED: 'بتركيز مذكور من الشركة', FEATURED: 'مكوّن أساسي موثّق في التركيبة', NAMED: 'مذكور في اسم المنتج؛ قائمة المكونات الكاملة غير موثّقة عندنا',
  LISTED: 'موجود في قائمة المكونات والتركيز غير مذكور',
};
const LEVEL_NOTE_EN: Record<ActiveLevel, string> = {
  STATED: 'at a concentration the manufacturer states', FEATURED: 'a verified featured ingredient', NAMED: 'named in the product name; the full ingredient list is not verified',
  LISTED: 'present in the ingredient list, amount not stated',
};
const LEVEL_FACTOR: Record<ActiveLevel, number> = { STATED: 1, FEATURED: 1, NAMED: 0.7, LISTED: 0.2 };

const norm = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
const hasWord = (haystack: string, needle: string) => needle.length >= 4 && ` ${haystack} `.includes(` ${needle} `);

export function productCareArea(product: CareProductFacts): 'skin' | 'hair' | null {
  const domain = product.variants.map(v => v.routine?.routineDomain).find(Boolean)?.toLowerCase();
  if (domain === 'skin' || domain === 'hair') return domain;
  if (product.departmentSlug === 'skin-care') return 'skin';
  if (product.departmentSlug === 'hair-care') return 'hair';
  if (product.targetArea === 'HAIR' || product.targetArea === 'SCALP') return 'hair';
  return product.targetArea ? 'skin' : null;
}

/** The actives that characterise a product, each with how we know. Never reads a marketing description. */
export function productActives(product: CareProductFacts, vocabulary: IngredientVocabulary[]): ProductActive[] {
  const bySlug = new Map<string, ProductActive>();
  const put = (active: ProductActive) => {
    const current = bySlug.get(active.slug);
    const order: ActiveLevel[] = ['LISTED', 'NAMED', 'FEATURED', 'STATED'];
    if (!current || order.indexOf(active.level) > order.indexOf(current.level)) bySlug.set(active.slug, active);
  };
  const inci = product.productIngredients ?? [];
  const inciVerified = inci.length > 0;
  const name = norm(product.name);
  const pipelineFeatured = new Set(product.variants.flatMap(v => [...(v.routine?.activeIngredients ?? []), ...(v.routine?.featuredIngredients ?? [])])
    .map(entry => norm(String(entry.inci ?? entry.name ?? ''))).filter(Boolean));

  for (const row of inci) {
    if (!row.isOntologyActive) continue;
    const stated = row.concentrationValue !== null && row.concentrationValue !== undefined;
    const display = row.ingredientName ?? row.ingredientSlug;
    const featured = pipelineFeatured.has(norm(display)) || hasWord(name, norm(display)) || (!!row.familySlug && hasWord(name, norm(row.familySlug.replace(/-/g, ' '))));
    put({
      slug: row.ingredientSlug, familySlug: row.familySlug, name: display,
      level: stated ? 'STATED' : featured ? 'FEATURED' : 'LISTED',
      concentration: stated ? `${row.concentrationValue}${row.concentrationUnit ?? '%'}` : null,
    });
  }
  if (!inciVerified) {
    // The identity name is a manufacturer statement, so an active it names is reported, flagged as not INCI-verified.
    for (const entry of vocabulary) {
      const terms = [entry.name, ...entry.aliases, entry.familySlug ? entry.familySlug.replace(/-/g, ' ') : ''].map(norm).filter(Boolean);
      if (terms.some(term => hasWord(name, term))) {
        const familyTerm = entry.familySlug ? norm(entry.familySlug.replace(/-/g, ' ')) : '';
        // When only the family is named ("Vitamin C serum"), report the family once, not every member of it.
        const viaFamilyOnly = !!familyTerm && hasWord(name, familyTerm) && !hasWord(name, norm(entry.name)) && !entry.aliases.some(a => hasWord(name, norm(a)));
        const slug = viaFamilyOnly ? `family:${entry.familySlug}` : entry.slug;
        put({ slug, familySlug: entry.familySlug, name: viaFamilyOnly ? entry.familySlug!.replace(/-/g, ' ') : entry.name, level: 'NAMED', concentration: null });
      }
    }
  }
  return [...bySlug.values()];
}

function safetyAnswer(safety: SafetyAnswers, condition: string): TriState | null {
  switch (condition) {
    case 'PREGNANT': return safety.pregnant;
    case 'BREASTFEEDING': return safety.breastfeeding;
    case 'PRESCRIPTION_TOPICAL': return safety.prescriptionTopical;
    case 'ORAL_RETINOID': return safety.oralRetinoid;
    default: return null; // age and other conditions are not asked in a consultation
  }
}

function ruleMatches(rule: EngineSafetyRule, product: CareProductFacts, actives: ProductActive[]): boolean {
  if (rule.subjectType === 'FAMILY') {
    return product.ingredientFamilies.includes(rule.subject) || actives.some(active => active.familySlug === rule.subject);
  }
  return product.ingredientSlugs.includes(rule.subject) || actives.some(active => active.slug === rule.subject);
}

function matchSkinType(stated: string[], wanted: string): 'match' | 'mismatch' | 'unknown' {
  const values = stated.map(value => value.toLowerCase().trim()).filter(Boolean);
  if (!values.length) return 'unknown';
  if (values.some(value => value === 'all' || value === 'all skin types' || value === wanted)) return 'match';
  // "acne-prone" travels with oily / combination skin on a label; anything else stated is a different type.
  if ((wanted === 'oily' || wanted === 'combination') && values.includes('acne-prone')) return 'match';
  return 'mismatch';
}

export function recommend(
  query: RecommendationQuery,
  products: CareProductFacts[],
  offers: Map<string, Offer>,
  knowledge: EngineKnowledge[],
  safetyRules: EngineSafetyRule[],
  vocabulary: IngredientVocabulary[],
): EngineResult {
  const ranked: RankedProduct[] = [];
  const excluded: ExcludedProduct[] = [];
  const needsSafetyAnswer = new Set<SafetyCondition>();
  const skip = new Set(query.excludeProductIds ?? []);
  const wantedTypes = new Set(query.productTypes.map(type => type.toLowerCase()));
  const relevance = knowledge.filter(k => k.topic === 'CONCERN_RELEVANCE' && k.evidenceClass !== 'CONFLICT' && k.reviewStatus !== 'REJECTED');
  const precautions = knowledge.filter(k => k.topic === 'PRECAUTION' && k.reviewStatus !== 'REJECTED');
  let considered = 0;

  for (const product of products) {
    if (skip.has(product.productId)) continue;
    const area = productCareArea(product);
    if (query.careArea && area && area !== query.careArea) continue;
    const type = product.productType?.toLowerCase() ?? null;
    if (wantedTypes.size && (!type || !wantedTypes.has(type))) continue;

    const actives = productActives(product, vocabulary);
    const inciVerified = (product.productIngredients?.length ?? 0) > 0;
    const reasons: Reason[] = [];
    const cautions: Caution[] = [];
    const unknowns: Unknown[] = [];

    if (type && wantedTypes.has(type)) {
      reasons.push({ code: 'TYPE_REQUESTED', basis: 'RULE', weight: 40,
        textAr: `نوع المنتج اللي طلبتيه: ${TYPE_AR[type] ?? type}`, textEn: `The product type you asked for: ${type}` });
    }

    for (const concern of query.concerns) {
      if (product.concerns.includes(concern)) {
        reasons.push({ code: 'CONCERN_TAG', basis: 'RULE', concernSlug: concern, weight: 25,
          textAr: 'مصنّف في الكتالوج ضمن المنتجات المناسبة للاهتمام ده', textEn: 'Listed in the catalogue for this concern' });
      }
      for (const entry of relevance) {
        if (entry.concernSlug !== concern) continue;
        if (entry.careArea && area && entry.careArea !== area) continue;
        if (entry.subjectType === 'PRODUCT_TYPE' && type && entry.subjectKey === type) {
          reasons.push({ code: 'TYPE_FOR_CONCERN', basis: 'EVIDENCE', concernSlug: concern, knowledgeId: entry.id,
            weight: entry.strength === 'PRIMARY' ? 22 : 12, textAr: entry.statementAr, textEn: entry.statementEn });
        }
        if (entry.subjectType === 'INGREDIENT' || entry.subjectType === 'INGREDIENT_FAMILY') {
          const active = actives.find(a => entry.subjectType === 'INGREDIENT' ? a.slug === entry.subjectKey : a.familySlug === entry.subjectKey);
          if (!active) continue;
          const base = entry.strength === 'PRIMARY' ? 30 : 16;
          reasons.push({ code: 'ACTIVE_FOR_CONCERN', basis: 'EVIDENCE', concernSlug: concern, knowledgeId: entry.id,
            weight: Math.round(base * LEVEL_FACTOR[active.level]),
            textAr: `فيه ${active.name}${active.concentration ? ` ${active.concentration}` : ''} (${LEVEL_NOTE_AR[active.level]}). ${entry.statementAr}`,
            textEn: `Contains ${active.name}${active.concentration ? ` ${active.concentration}` : ''} (${LEVEL_NOTE_EN[active.level]}). ${entry.statementEn}` });
        }
      }
    }

    // Relevance gate: with a concern and no type asked for, a product needs a real link to the concern. An ingredient that
    // is merely listed (a trace of salicylic acid in a moisture shampoo) is not such a link.
    const concernLinked = reasons.some(r => r.code === 'CONCERN_TAG' || r.code === 'TYPE_FOR_CONCERN' || (r.code === 'ACTIVE_FOR_CONCERN' && r.weight >= 10));
    if (query.concerns.length && !wantedTypes.size && !concernLinked) continue;
    considered++;

    if (product.spf && (type === 'sunscreen' || query.concerns.includes('sun-protection'))) {
      reasons.push({ code: 'SUN_PROTECTION', basis: 'VERIFIED', weight: product.spf >= 30 ? 10 : 4,
        textAr: `SPF ${product.spf} مذكور من الشركة${product.broadSpectrum ? '، واسع الطيف' : ''}`,
        textEn: `SPF ${product.spf} stated by the manufacturer${product.broadSpectrum ? ', broad spectrum' : ''}` });
    }

    let penalty = 0;
    if (query.skinType && area !== 'hair') {
      const fit = matchSkinType(product.suitableSkinTypes ?? [], query.skinType);
      const label = SKIN_TYPE_AR[query.skinType] ?? query.skinType;
      if (fit === 'match') {
        reasons.push({ code: 'SKIN_TYPE', basis: 'VERIFIED', weight: 12,
          textAr: `الشركة المصنّعة بتذكر إنه مناسب للبشرة ${label}`, textEn: `The manufacturer states it suits ${query.skinType} skin` });
      } else if (fit === 'mismatch') {
        penalty += 15;
        cautions.push({ code: 'SKIN_TYPE_MISMATCH', basis: 'VERIFIED',
          textAr: `الشركة بتذكره لبشرة: ${(product.suitableSkinTypes ?? []).join('، ')} — مش لنوع بشرتك تحديدًا`,
          textEn: `The manufacturer lists it for: ${(product.suitableSkinTypes ?? []).join(', ')} — not specifically your skin type` });
      } else {
        unknowns.push({ code: 'SKIN_TYPE_SUITABILITY', textAr: 'الشركة مش محددة نوع البشرة المناسب للمنتج ده', textEn: 'The manufacturer does not state which skin type it is for' });
      }
    }
    if (query.hairType && area === 'hair') {
      const stated = (product.suitableHairTypes ?? []).map(v => v.toLowerCase());
      if (stated.some(v => v === 'all' || v.includes(query.hairType!.toLowerCase()))) {
        reasons.push({ code: 'HAIR_TYPE', basis: 'VERIFIED', weight: 10,
          textAr: `الشركة المصنّعة بتذكر إنه مناسب للشعر ${query.hairType}`, textEn: `The manufacturer states it suits ${query.hairType} hair` });
      }
    }

    // ── Hard exclusions: preference, sensitivity, safety ──
    const containsFragrance = product.ingredientFamilies.includes('fragrance') || product.ingredientSlugs.includes('fragrance');
    if (query.fragranceFree === true) {
      if (product.isFragranceFree === false || containsFragrance) {
        excluded.push({ productId: product.productId, name: product.name, code: 'CONTAINS_FRAGRANCE',
          textAr: 'فيه عطر، وانتي طلبتي من غير عطر', textEn: 'Contains fragrance and you asked for fragrance-free' });
        continue;
      }
      if (product.isFragranceFree === true) {
        reasons.push({ code: 'FRAGRANCE_FREE', basis: 'VERIFIED', weight: 8, textAr: 'الشركة بتذكر إنه خالي من العطر', textEn: 'The manufacturer states it is fragrance-free' });
      } else if (inciVerified) {
        reasons.push({ code: 'FRAGRANCE_FREE', basis: 'VERIFIED', weight: 6, textAr: 'قائمة المكونات الموثّقة مفيهاش عطر', textEn: 'The verified ingredient list has no fragrance' });
      } else {
        penalty += 4;
        unknowns.push({ code: 'FRAGRANCE_STATUS', textAr: 'مش موثّق عندنا إذا كان فيه عطر ولا لأ؛ راجعي العبوة', textEn: 'Whether it contains fragrance is not verified; check the pack' });
      }
    }

    const avoided = (product.productIngredients ?? []).find(row => query.avoidIngredientIds.includes(row.ingredientId));
    if (avoided) {
      excluded.push({ productId: product.productId, name: product.name, code: 'AVOIDED_INGREDIENT',
        textAr: `فيه ${avoided.ingredientName ?? avoided.ingredientSlug} اللي قلتي إنه بيتعبك`, textEn: `Contains ${avoided.ingredientName ?? avoided.ingredientSlug}, which you said you react to` });
      continue;
    }
    if ((query.avoidIngredientIds.length || query.unresolvedAvoidTerms.length) && !inciVerified) {
      unknowns.push({ code: 'INGREDIENT_LIST', textAr: 'قائمة المكونات الكاملة غير موثّقة عندنا؛ مع الحساسية راجعي المكونات على العبوة قبل الاستخدام',
        textEn: 'The full ingredient list is not verified here; with a sensitivity, check the ingredients on the pack first' });
    }

    const warning = (product.safetyWarnings ?? []).find(w => w.kind === 'CONTRAINDICATION' && w.condition && safetyAnswer(query.safety, w.condition) === 'YES');
    if (warning) {
      excluded.push({ productId: product.productId, name: product.name, code: 'PRODUCT_WARNING', condition: warning.condition as SafetyCondition,
        textAr: warning.descriptionAr ?? 'الشركة المصنّعة بتحذّر من استخدامه في حالتك', textEn: warning.descriptionEn });
      continue;
    }

    const unansweredWarning = (product.safetyWarnings ?? []).find(w => w.kind === 'CONTRAINDICATION' && w.condition && safetyAnswer(query.safety, w.condition) === 'UNKNOWN');
    if (unansweredWarning) {
      const condition = unansweredWarning.condition as SafetyCondition;
      needsSafetyAnswer.add(condition);
      excluded.push({ productId: product.productId, name: product.name, code: 'SAFETY_UNANSWERED', condition,
        textAr: `محتاجين نعرف الأول بخصوص ${CONDITION_AR[condition]} قبل ما نرشّحه`, textEn: `We need to know about ${CONDITION_EN[condition]} before suggesting it` });
      continue;
    }

    let held = false;
    // The condition rules (pregnancy, breastfeeding, oral isotretinoin) come from guidance on leave-on facial and body
    // treatments; a hair wash that lists an acid in its INCI is not what they are about. Hair products are judged by their
    // own manufacturer warnings (above), not by these skin rules.
    for (const rule of area === 'hair' ? [] : safetyRules) {
      const answer = safetyAnswer(query.safety, rule.condition);
      if (answer === null || answer === 'NO' || !ruleMatches(rule, product, actives)) continue;
      const condition = rule.condition as SafetyCondition;
      if (answer === 'YES') {
        excluded.push({ productId: product.productId, name: product.name, code: 'SAFETY_CONDITION', ruleKey: rule.key, condition,
          textAr: rule.noteAr ?? `مش بيتقترح مع ${CONDITION_AR[condition]} (${rule.sourceTitle})`,
          textEn: `Not suggested with ${CONDITION_EN[condition]} (${rule.sourceTitle})` });
      } else {
        // UNKNOWN is never read as NO: the product waits for the answer.
        needsSafetyAnswer.add(condition);
        excluded.push({ productId: product.productId, name: product.name, code: 'SAFETY_UNANSWERED', ruleKey: rule.key, condition,
          textAr: `محتاجين نعرف الأول بخصوص ${CONDITION_AR[condition]} قبل ما نرشّحه`, textEn: `We need to know about ${CONDITION_EN[condition]} before suggesting it` });
      }
      held = true;
      break;
    }
    if (held) continue;

    const sensitiveCondition = (['PREGNANT', 'BREASTFEEDING', 'ORAL_RETINOID'] as SafetyCondition[]).find(c => safetyAnswer(query.safety, c) === 'YES');
    if (sensitiveCondition && !inciVerified && area === 'skin' && type !== 'sunscreen' && type !== 'cleanser') {
      cautions.push({ code: 'UNVERIFIED_INCI_WITH_CONDITION', basis: 'RULE',
        textAr: `قائمة مكوناته الكاملة غير موثّقة عندنا؛ مع ${CONDITION_AR[sensitiveCondition]} راجعي المكونات مع الدكتور أو الصيدلي قبل الاستخدام`,
        textEn: `Its full ingredient list is not verified here; with ${CONDITION_EN[sensitiveCondition]}, check the ingredients with your doctor or pharmacist first` });
    }

    for (const entry of precautions) {
      const active = actives.find(a => a.level !== 'LISTED' && (entry.subjectType === 'INGREDIENT' ? a.slug === entry.subjectKey : a.familySlug === entry.subjectKey));
      if (active && cautions.length < 3) cautions.push({ code: 'INGREDIENT_PRECAUTION', basis: 'EVIDENCE', knowledgeId: entry.id, textAr: entry.statementAr, textEn: entry.statementEn });
    }

    // ── Availability and price: Commerce decides, never the engine ──
    const orderable = product.variants.map(v => offers.get(v.skuId)).filter((o): o is Offer => !!o && o.canOrder && !!o.price);
    if (!orderable.length) {
      excluded.push({ productId: product.productId, name: product.name, code: 'UNAVAILABLE', textAr: 'مش متاح للطلب دلوقتي', textEn: 'Not available to order right now' });
      continue;
    }
    const affordable = query.budgetMax ? orderable.filter(o => o.price!.amount <= query.budgetMax!) : orderable;
    if (!affordable.length) {
      excluded.push({ productId: product.productId, name: product.name, code: 'OVER_BUDGET', textAr: 'سعره أعلى من الميزانية اللي حددتيها', textEn: 'Priced above the budget you set' });
      continue;
    }
    const offer = [...affordable].sort((a, b) => a.price!.amount - b.price!.amount)[0];

    if (!product.usageText && !product.usageRules.length) {
      unknowns.push({ code: 'USAGE', textAr: 'طريقة الاستخدام غير موثّقة عندنا؛ اتبعي المكتوب على العبوة', textEn: 'Usage directions are not verified here; follow the pack' });
    }

    const score = reasons.reduce((sum, r) => sum + r.weight, 0) - penalty + (inciVerified ? 3 : 0) + (product.usageRules.length ? 2 : 0);
    const strongActive = reasons.some(r => r.code === 'ACTIVE_FOR_CONCERN' && r.weight >= 21);
    const primaryType = reasons.some(r => r.code === 'TYPE_FOR_CONCERN' && r.weight >= 22);
    const verifiedFit = reasons.some(r => r.basis === 'VERIFIED');
    const matchLevel = strongActive || (primaryType && verifiedFit) ? 'STRONG' : (concernLinked || reasons.some(r => r.code === 'TYPE_REQUESTED')) && (verifiedFit || primaryType) ? 'GOOD' : 'BASIC';
    const variant = product.variants.find(v => v.skuId === offer.skuId);
    ranked.push({
      productId: product.productId, skuId: offer.skuId, productType: type, role: variant?.routine?.primaryRole ?? null, careArea: area,
      score, matchLevel, reasons: reasons.sort((a, b) => b.weight - a.weight), cautions, unknowns, actives, price: offer.price,
    });
  }

  if (query.unresolvedAvoidTerms.length) {
    for (const item of ranked) {
      if (!item.unknowns.some(u => u.code === 'INGREDIENT_LIST')) {
        item.unknowns.push({ code: 'SENSITIVITY_TERM', textAr: `مقدرناش نطابق «${query.unresolvedAvoidTerms.join('، ')}» بمكوّن معروف؛ راجعي المكونات على العبوة`,
          textEn: `We could not match “${query.unresolvedAvoidTerms.join(', ')}” to a known ingredient; check the pack` });
      }
    }
  }

  const names = new Map(products.map(p => [p.productId, p.name]));
  ranked.sort((a, b) => b.score - a.score || (names.get(a.productId) ?? '').localeCompare(names.get(b.productId) ?? ''));

  const perType = query.perTypeLimit === undefined ? (wantedTypes.size === 1 ? null : 2) : query.perTypeLimit;
  const limit = query.limit ?? 6;
  const taken: RankedProduct[] = [];
  const counts = new Map<string, number>();
  for (const item of ranked) {
    const key = item.productType ?? 'other';
    if (perType !== null && (counts.get(key) ?? 0) >= perType) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    taken.push(item);
    if (taken.length >= limit) break;
  }

  return { engineVersion: RECOMMENDATION_ENGINE_VERSION, ranked: taken, excluded, needsSafetyAnswer: [...needsSafetyAnswer], consideredCount: considered };
}
