import type { ConsultContext, ConsultIntent, ConsultTriState } from '../../../platform/ai';

/**
 * The decisions of a consultation that never depend on a model: how context accumulates, when the answer must be
 * "see a professional", how a routine is laid out over the day, and what to say when the AI is unavailable.
 */

export const EMPTY_CONTEXT: ConsultContext = {
  careArea: null, concerns: [], productTypes: [], skinType: null, hairType: null, fragranceFree: null, budgetMax: null,
  sensitivities: [], ownedProducts: [],
  safety: { pregnant: 'UNKNOWN', breastfeeding: 'UNKNOWN', prescriptionTopical: 'UNKNOWN', oralRetinoid: 'UNKNOWN' },
};

const SKIN_TYPES = new Set(['normal', 'dry', 'oily', 'combination', 'sensitive']);
const TRI = new Set(['YES', 'NO', 'UNKNOWN']);
const strings = (value: unknown, max: number, length = 80): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, length)).filter(Boolean))].slice(0, max) : [];

/** Reads a stored or model-produced context defensively: anything malformed falls back to "not known". */
export function readContext(raw: unknown): ConsultContext {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const safety = (value.safety && typeof value.safety === 'object' ? value.safety : {}) as Record<string, unknown>;
  const tri = (v: unknown): ConsultTriState => (typeof v === 'string' && TRI.has(v) ? (v as ConsultTriState) : 'UNKNOWN');
  const budget = typeof value.budgetMax === 'number' && Number.isFinite(value.budgetMax) && value.budgetMax > 0 ? value.budgetMax : null;
  return {
    careArea: value.careArea === 'skin' || value.careArea === 'hair' ? value.careArea : null,
    concerns: strings(value.concerns, 6), productTypes: strings(value.productTypes, 6),
    skinType: typeof value.skinType === 'string' && SKIN_TYPES.has(value.skinType) ? (value.skinType as ConsultContext['skinType']) : null,
    hairType: typeof value.hairType === 'string' && value.hairType.trim() ? value.hairType.trim().slice(0, 40) : null,
    fragranceFree: typeof value.fragranceFree === 'boolean' ? value.fragranceFree : null,
    budgetMax: budget,
    sensitivities: strings(value.sensitivities, 8), ownedProducts: strings(value.ownedProducts, 8, 120),
    safety: { pregnant: tri(safety.pregnant), breastfeeding: tri(safety.breastfeeding), prescriptionTopical: tri(safety.prescriptionTopical), oralRetinoid: tri(safety.oralRetinoid) },
  };
}

/**
 * The model returns the whole context each turn. It may add and correct, but two things are protected: the vocabulary
 * (only known concern slugs and product types survive) and safety answers (a YES/NO the customer gave is never
 * silently turned back into UNKNOWN).
 */
export function mergeContext(known: ConsultContext, proposed: unknown, vocabulary: { concerns: Set<string>; productTypes: Set<string> }): ConsultContext {
  const next = readContext(proposed);
  const keep = (before: ConsultTriState, after: ConsultTriState): ConsultTriState => (after === 'UNKNOWN' ? before : after);
  return {
    ...next,
    careArea: next.careArea ?? known.careArea,
    concerns: next.concerns.filter(slug => vocabulary.concerns.has(slug)),
    productTypes: next.productTypes.filter(type => vocabulary.productTypes.has(type)),
    skinType: next.skinType ?? known.skinType,
    hairType: next.hairType ?? known.hairType,
    fragranceFree: next.fragranceFree ?? known.fragranceFree,
    sensitivities: [...new Set([...known.sensitivities, ...next.sensitivities])].slice(0, 8),
    ownedProducts: [...new Set([...known.ownedProducts, ...next.ownedProducts])].slice(0, 8),
    safety: {
      pregnant: keep(known.safety.pregnant, next.safety.pregnant), breastfeeding: keep(known.safety.breastfeeding, next.safety.breastfeeding),
      prescriptionTopical: keep(known.safety.prescriptionTopical, next.safety.prescriptionTopical), oralRetinoid: keep(known.safety.oralRetinoid, next.safety.oralRetinoid),
    },
  };
}

// ── Escalation: when the honest answer is "see a professional" ────────────────────────────────────────────

export const RED_FLAG_CODES = new Set([
  'SEVERE_OR_PAINFUL', 'INFECTION_SIGNS', 'BLEEDING_OR_OPEN_WOUND', 'SUDDEN_OR_PATCHY_HAIR_LOSS', 'ALLERGIC_REACTION',
  'CHANGING_MOLE_OR_LESION', 'CHILD_UNDER_12', 'PRESCRIPTION_OR_DIAGNOSIS_REQUEST', 'OTHER_MEDICAL',
]);

const ESCALATION_TEXT: Record<string, { ar: string; en: string }> = {
  SEVERE_OR_PAINFUL: { ar: 'الحالة اللي وصفتيها شديدة أو مؤلمة، وده محتاج دكتور جلدية يشوفها.', en: 'What you describe is severe or painful and needs a dermatologist.' },
  INFECTION_SIGNS: { ar: 'فيه علامات ممكن تكون عدوى، ولازم دكتور يشوفها.', en: 'There are possible signs of infection; a doctor should see it.' },
  BLEEDING_OR_OPEN_WOUND: { ar: 'الجلد المفتوح أو اللي بينزف محتاج رعاية طبية مش منتجات عناية.', en: 'Open or bleeding skin needs medical care, not care products.' },
  SUDDEN_OR_PATCHY_HAIR_LOSS: { ar: 'التساقط المفاجئ أو على شكل فراغات محتاج دكتور يعرف السبب.', en: 'Sudden or patchy hair loss needs a doctor to find the cause.' },
  ALLERGIC_REACTION: { ar: 'ده ممكن يكون تفاعل تحسسي: وقّفي المنتج واطلبي رعاية طبية، وبسرعة لو فيه تورم أو صعوبة في التنفس.', en: 'This may be an allergic reaction: stop the product and get medical care, urgently if there is swelling or trouble breathing.' },
  CHANGING_MOLE_OR_LESION: { ar: 'أي شامة أو بقعة بتتغيّر لازم دكتور جلدية يفحصها.', en: 'A mole or spot that is changing must be examined by a dermatologist.' },
  CHILD_UNDER_12: { ar: 'بشرة الأطفال تحت ١٢ سنة محتاجة رأي دكتور أطفال أو جلدية قبل أي منتج.', en: 'For a child under 12, ask a paediatrician or dermatologist before any product.' },
  PRESCRIPTION_OR_DIAGNOSIS_REQUEST: { ar: 'التشخيص والأدوية اللي بروشتة مسؤولية الدكتور؛ أنا مساعد ذكي للعناية والتسوّق.', en: 'Diagnosis and prescription medicines are a doctor’s job; I am an AI assistant for care and shopping.' },
  OTHER_MEDICAL: { ar: 'ده موضوع طبي محتاج دكتور أو صيدلي.', en: 'This is a medical matter for a doctor or pharmacist.' },
};

export interface Escalation { required: boolean; reasons: Array<{ code: string; text: string }> }

export function decideEscalation(redFlags: Array<{ code: string }>, locale: 'ar' | 'en'): Escalation {
  const codes = [...new Set(redFlags.map(flag => flag.code).filter(code => RED_FLAG_CODES.has(code)))];
  return { required: codes.length > 0, reasons: codes.map(code => ({ code, text: ESCALATION_TEXT[code][locale] })) };
}

/**
 * A personalised routine is not generated for a pregnant or breastfeeding customer, or one on an oral retinoid: that
 * routine needs a qualified professional (GLO-313). Product suggestions still work, with the safety exclusions applied.
 */
export function routineBlockedReason(context: ConsultContext, locale: 'ar' | 'en'): string | null {
  const s = context.safety;
  if (s.pregnant === 'YES' || s.breastfeeding === 'YES') {
    return locale === 'ar'
      ? 'مع الحمل أو الرضاعة مش بنجهّز روتين شخصي من غير مراجعة دكتور أو صيدلي؛ أقدر أرشّح منتجات لطيفة وأوضّح المعروف عنها.'
      : 'During pregnancy or breastfeeding we do not build a personal routine without a doctor or pharmacist reviewing it; I can still suggest gentle products.';
  }
  if (s.oralRetinoid === 'YES') {
    return locale === 'ar'
      ? 'مع الريتينويد بالفم الروتين لازم يتراجع مع الدكتور المعالج؛ أقدر أرشّح منتجات لطيفة بس.'
      : 'While on an oral retinoid your routine should be reviewed by your treating doctor; I can suggest gentle products only.';
  }
  return null;
}

// ── Routine layout ───────────────────────────────────────────────────────────────────────────────────────

export type Slot = 'AM' | 'PM' | 'AS_NEEDED';
const SUN_SENSITISING = ['retinoids', 'hydroxy-acids'];

/** Which times of day a product is placed in. The manufacturer's stated period wins; otherwise the role's usual place. */
export function slotsFor(item: { role: string | null; productType: string | null; careArea: string | null; statedPeriod: string | null; periodEligibility: string | null; families: string[] }): Slot[] {
  if (item.careArea === 'hair') return ['AS_NEEDED'];
  if (item.statedPeriod === 'AM') return ['AM'];
  if (item.statedPeriod === 'PM') return ['PM'];
  if (item.statedPeriod === 'BOTH') return ['AM', 'PM'];
  if (item.periodEligibility === 'AM') return ['AM'];
  if (item.periodEligibility === 'PM') return ['PM'];
  if (item.role === 'SUNSCREEN' || item.productType === 'sunscreen') return ['AM'];
  if (SUN_SENSITISING.some(family => item.families.includes(family))) return ['PM'];
  if (item.role === 'CLEANSER' || item.role === 'MOISTURIZER') return ['AM', 'PM'];
  if (item.role === 'SERUM' || item.role === 'TREATMENT') return ['PM'];
  if (item.role === 'MASK' || item.role === 'EXFOLIANT') return ['AS_NEEDED'];
  return ['PM'];
}

// ── Deterministic understanding and wording, used only when the AI is unavailable ────────────────────────

const TYPE_WORDS: Record<string, RegExp> = {
  cleanser: /غسول|منظف|cleanser|face wash/i, moisturizer: /مرطب|مرطّب|كريم ترطيب|moisturi[sz]er/i, serum: /سيروم|serum/i,
  sunscreen: /واقي|صن ?بلوك|sunscreen|sun ?block|spf/i, shampoo: /شامبو|shampoo/i, conditioner: /بلسم|conditioner/i,
};
const SKIN_WORDS: Record<string, RegExp> = { oily: /دهني|oily/i, dry: /جاف|ناشف|dry/i, combination: /مختلط|combination/i, sensitive: /حساس|sensitive/i, normal: /عادي|normal skin/i };

export function fallbackUnderstanding(
  text: string, known: ConsultContext, concerns: Array<{ slug: string; name: string; careArea: 'skin' | 'hair' }>, productTypes: string[],
): { intent: ConsultIntent; context: ConsultContext; needsClarification: boolean; missing: string[] } {
  const lower = text.toLowerCase();
  const context: ConsultContext = JSON.parse(JSON.stringify(known));
  for (const concern of concerns) {
    const parts = concern.name.toLowerCase().split(/\s+و|\s*[()،,]\s*/).map(w => w.trim()).filter(w => w.length >= 4);
    // Arabic attaches prepositions to the article ("للقشرة", "بالقشرة"), so the bare stem is matched too.
    const stems = parts.map(w => w.replace(/^ال/, '')).filter(w => w.length >= 4);
    const words = [concern.slug.replace(/-/g, ' '), concern.name.toLowerCase(), ...parts, ...stems];
    if (words.some(word => word && lower.includes(word)) && !context.concerns.includes(concern.slug)) {
      context.concerns.push(concern.slug);
      context.careArea = context.careArea ?? concern.careArea;
    }
  }
  for (const type of productTypes) {
    if (TYPE_WORDS[type]?.test(text) && !context.productTypes.includes(type)) context.productTypes.push(type);
  }
  for (const [skin, pattern] of Object.entries(SKIN_WORDS)) if (pattern.test(text)) context.skinType = skin as ConsultContext['skinType'];
  if (/شعر|فروة|hair|scalp/i.test(text)) context.careArea = 'hair';
  else if (!context.careArea && /بشر|وش|وجه|skin|face/i.test(text)) context.careArea = 'skin';
  if (context.productTypes.some(t => t === 'shampoo' || t === 'conditioner')) context.careArea = context.careArea ?? 'hair';
  else if (context.productTypes.length) context.careArea = context.careArea ?? 'skin';
  const missing = [...(context.careArea ? [] : ['careArea']), ...(context.concerns.length || context.productTypes.length ? [] : ['concern'])];
  return { intent: /روتين|routine/i.test(text) ? 'build_routine' : 'recommend_products', context, needsClarification: missing.length > 0, missing };
}

const CLARIFY: Record<string, { ar: string; en: string; repliesAr: string[]; repliesEn: string[] }> = {
  careArea: { ar: 'بتدوّري على حاجة للبشرة ولا للشعر؟', en: 'Is this for your skin or your hair?', repliesAr: ['البشرة', 'الشعر'], repliesEn: ['Skin', 'Hair'] },
  concern: { ar: 'إيه أكتر حاجة عايزة تهتمي بيها؟', en: 'What would you most like to take care of?', repliesAr: [], repliesEn: [] },
  skinType: { ar: 'بشرتك نوعها إيه؟', en: 'What is your skin type?', repliesAr: ['دهنية', 'جافة', 'مختلطة', 'حساسة'], repliesEn: ['Oily', 'Dry', 'Combination', 'Sensitive'] },
  pregnancy: { ar: 'عشان السلامة: هل في حمل أو رضاعة؟', en: 'For safety: are you pregnant or breastfeeding?', repliesAr: ['لأ', 'حامل', 'برضّع'], repliesEn: ['No', 'Pregnant', 'Breastfeeding'] },
};

export function fallbackQuestion(missing: string[], locale: 'ar' | 'en'): { question: string; quickReplies: string[] } {
  const entry = CLARIFY[missing.find(key => CLARIFY[key]) ?? 'concern'];
  return { question: entry[locale], quickReplies: locale === 'ar' ? entry.repliesAr : entry.repliesEn };
}

export const FALLBACK_TEXT = {
  unavailable: { ar: 'المساعد الذكي مش متاح دلوقتي، فدي ترشيحات محرّك الكتالوج حسب اللي فهمته من طلبك.', en: 'The AI assistant is unavailable right now, so these are the catalogue engine’s matches for your request.' },
  nothing: { ar: 'المساعد الذكي مش متاح دلوقتي، ومفيش في الكتالوج الحالي منتج مطابق للي فهمته من طلبك. جرّبي تاني بعد شوية أو تصفّحي المنتجات.', en: 'The AI assistant is unavailable right now and nothing in the current catalogue matches what I understood. Try again shortly or browse the products.' },
  clarify: { ar: 'المساعد الذكي مش متاح دلوقتي، بس أقدر أرشّح من الكتالوج لو عرفت:', en: 'The AI assistant is unavailable right now, but I can suggest from the catalogue if I know:' },
  escalate: { ar: 'أنا مساعد ذكي مش دكتور، واللي وصفتيه محتاج متخصص:', en: 'I am an AI assistant, not a doctor, and what you describe needs a professional:' },
};
