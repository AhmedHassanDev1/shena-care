import type { CareProductFacts } from '../../catalog/public';

/**
 * One set of compatibility rules for every routine surface: Make Your Routine, My Routine, an AI proposal and the Studio.
 * Pure: it reads the ingredient rules (care.ingredient_rules, each with its source), the verified facts of the products
 * and the customer's safety answers, and reports issues. It never rearranges or removes anything by itself.
 *
 *   BLOCK  the routine should not be used as it is (a rule excludes a product for this customer, or two of one family)
 *   WARN   usable after a change the issue names (move a product to the other time of day)
 *   INFO   worth knowing; includes what could not be checked because a fact is not verified
 */
export const COMPATIBILITY_VERSION = 'routine-compatibility/1';

export type Slot = 'AM' | 'PM' | 'AS_NEEDED';
export type TriState = 'YES' | 'NO' | 'UNKNOWN';
export interface CompatibilitySafety { pregnant: TriState; breastfeeding: TriState; prescriptionTopical: TriState; oralRetinoid: TriState }

export interface CompatibilityRule {
  key: string
  kind: 'SEPARATE_TIMES' | 'COMPATIBLE' | 'MAX_ONE_PER_AREA' | 'EXCLUDE_CONDITION'
  subjectType: 'FAMILY' | 'INGREDIENT'; subject: string
  otherType: 'FAMILY' | 'INGREDIENT' | null; other: string | null
  condition: string | null; noteAr: string | null; sourceTitle: string; sourceUrl: string | null
}

export interface CompatibilityStep { skuId: string; slot: Slot }

export interface CompatibilityIssue {
  code: 'SAFETY_CONDITION' | 'SAFETY_UNANSWERED' | 'MAX_ONE_PER_AREA' | 'SEPARATE_TIMES' | 'PERIOD_MISMATCH' | 'DUPLICATE_ROLE'
    | 'SUNSCREEN_ADVISED' | 'INGREDIENTS_UNVERIFIED' | 'PRODUCT_UNAVAILABLE' | 'PRODUCT_UNKNOWN'
  severity: 'BLOCK' | 'WARN' | 'INFO'
  textAr: string
  textEn: string
  skuIds: string[]
  ruleKey?: string
  source?: { title: string; url: string | null }
}

export interface CompatibilityResult {
  version: string
  ok: boolean
  issues: CompatibilityIssue[]
  /** Suggested application order inside each time of day (by the catalog's routine roles); the steps given, nothing added. */
  order: Record<Slot, string[]>
}

interface StepFacts { skuId: string; slot: Slot; product: CareProductFacts; role: string | null; rank: number | null; periodEligibility: string | null; statedPeriod: string | null; available: boolean }

const CONDITION_AR: Record<string, string> = { PREGNANT: 'الحمل', BREASTFEEDING: 'الرضاعة', PRESCRIPTION_TOPICAL: 'علاج موضعي بروشتة', ORAL_RETINOID: 'ريتينويد بالفم' };
const CONDITION_EN: Record<string, string> = { PREGNANT: 'pregnancy', BREASTFEEDING: 'breastfeeding', PRESCRIPTION_TOPICAL: 'a prescription topical', ORAL_RETINOID: 'an oral retinoid' };

function answer(safety: CompatibilitySafety, condition: string | null): TriState | null {
  switch (condition) {
    case 'PREGNANT': return safety.pregnant;
    case 'BREASTFEEDING': return safety.breastfeeding;
    case 'PRESCRIPTION_TOPICAL': return safety.prescriptionTopical;
    case 'ORAL_RETINOID': return safety.oralRetinoid;
    default: return null;
  }
}

const has = (product: CareProductFacts, type: 'FAMILY' | 'INGREDIENT' | null, subject: string | null) =>
  !!subject && (type === 'FAMILY' ? product.ingredientFamilies.includes(subject) : product.ingredientSlugs.includes(subject));

const label = (product: CareProductFacts) => `${product.brandName} ${product.name}`;
const SUN_SENSITISING = ['retinoids', 'hydroxy-acids'];

export function checkRoutine(
  steps: CompatibilityStep[],
  products: Map<string, CareProductFacts>,
  availability: Map<string, boolean>,
  rules: CompatibilityRule[],
  safety: CompatibilitySafety,
): CompatibilityResult {
  const issues: CompatibilityIssue[] = [];
  const facts: StepFacts[] = [];

  for (const step of steps) {
    const product = products.get(step.skuId);
    if (!product) {
      issues.push({ code: 'PRODUCT_UNKNOWN', severity: 'BLOCK', skuIds: [step.skuId], textAr: 'منتج مش موجود في الكتالوج', textEn: 'This product is not in the catalogue' });
      continue;
    }
    const routine = product.variants.find(v => v.skuId === step.skuId)?.routine ?? null;
    const available = availability.get(step.skuId) === true;
    facts.push({ skuId: step.skuId, slot: step.slot, product, role: routine?.primaryRole ?? null, rank: routine?.stepOrder ?? null,
      periodEligibility: routine?.periodEligibility ?? null, statedPeriod: routine && routine.routinePeriod !== 'UNKNOWN' ? routine.routinePeriod : null, available });
    if (!available) {
      issues.push({ code: 'PRODUCT_UNAVAILABLE', severity: 'WARN', skuIds: [step.skuId],
        textAr: `${label(product)} مش متاح للطلب دلوقتي`, textEn: `${label(product)} is not available to order right now` });
    }
  }

  // One issue per product, however many times it appears in the routine.
  const unique = [...new Map(facts.map(f => [f.product.productId, f])).values()];

  for (const rule of rules.filter(r => r.kind === 'EXCLUDE_CONDITION')) {
    const state = answer(safety, rule.condition);
    if (state === null || state === 'NO') continue;
    for (const f of unique.filter(item => has(item.product, rule.subjectType, rule.subject))) {
      const source = { title: rule.sourceTitle, url: rule.sourceUrl };
      if (state === 'YES') {
        issues.push({ code: 'SAFETY_CONDITION', severity: 'BLOCK', skuIds: [f.skuId], ruleKey: rule.key, source,
          textAr: `${label(f.product)}: ${rule.noteAr ?? `مش بيتقترح مع ${CONDITION_AR[rule.condition!] ?? rule.condition}`}`,
          textEn: `${label(f.product)} is not suggested with ${CONDITION_EN[rule.condition!] ?? rule.condition}` });
      } else {
        issues.push({ code: 'SAFETY_UNANSWERED', severity: 'INFO', skuIds: [f.skuId], ruleKey: rule.key, source,
          textAr: `${label(f.product)} فيه مكوّن بيتأثر بـ${CONDITION_AR[rule.condition!] ?? rule.condition}؛ جاوبي على السؤال ده عشان نتأكد إنه مناسب`,
          textEn: `${label(f.product)} has an ingredient affected by ${CONDITION_EN[rule.condition!] ?? rule.condition}; answer that question so we can confirm it suits you` });
      }
    }
  }

  for (const rule of rules.filter(r => r.kind === 'MAX_ONE_PER_AREA')) {
    const carriers = unique.filter(item => has(item.product, rule.subjectType, rule.subject));
    if (carriers.length > 1) {
      issues.push({ code: 'MAX_ONE_PER_AREA', severity: 'BLOCK', skuIds: carriers.map(c => c.skuId), ruleKey: rule.key, source: { title: rule.sourceTitle, url: rule.sourceUrl },
        textAr: `${rule.noteAr ?? 'منتج واحد بس من النوع ده'} (${carriers.map(c => label(c.product)).join(' + ')})`,
        textEn: `Only one product of the ${rule.subject} family at a time (${carriers.map(c => label(c.product)).join(' + ')})` });
    }
  }

  for (const rule of rules.filter(r => r.kind === 'SEPARATE_TIMES')) {
    for (const slot of ['AM', 'PM'] as const) {
      const inSlot = facts.filter(f => f.slot === slot);
      const first = inSlot.find(f => has(f.product, rule.subjectType, rule.subject));
      const second = inSlot.find(f => f !== first && f.product.productId !== first?.product.productId && has(f.product, rule.otherType, rule.other));
      if (first && second) {
        issues.push({ code: 'SEPARATE_TIMES', severity: 'WARN', skuIds: [first.skuId, second.skuId], ruleKey: rule.key, source: { title: rule.sourceTitle, url: rule.sourceUrl },
          textAr: `${label(first.product)} و${label(second.product)}: ${rule.noteAr ?? 'واحد الصبح والتاني بالليل'}`,
          textEn: `${label(first.product)} and ${label(second.product)} should be used at different times of day` });
      }
    }
  }

  for (const f of facts) {
    if (f.slot === 'AS_NEEDED') continue;
    const period = f.statedPeriod && f.statedPeriod !== 'BOTH' ? f.statedPeriod : f.periodEligibility && f.periodEligibility !== 'BOTH' ? f.periodEligibility : null;
    if (period && period !== f.slot) {
      const stated = !!f.statedPeriod && f.statedPeriod !== 'BOTH';
      issues.push({ code: 'PERIOD_MISMATCH', severity: stated ? 'WARN' : 'INFO', skuIds: [f.skuId],
        textAr: `${label(f.product)} ${stated ? 'الشركة بتذكر إنه' : 'في العادة'} خطوة ${period === 'AM' ? 'صباحية' : 'مسائية'}`,
        textEn: `${label(f.product)} is ${stated ? 'stated by the manufacturer as' : 'normally'} a ${period === 'AM' ? 'morning' : 'evening'} step` });
    }
  }

  for (const slot of ['AM', 'PM'] as const) {
    const byRole = new Map<string, StepFacts[]>();
    for (const f of facts.filter(item => item.slot === slot && item.role)) byRole.set(f.role!, [...(byRole.get(f.role!) ?? []), f]);
    for (const [role, group] of byRole) {
      if (new Set(group.map(g => g.product.productId)).size > 1) {
        issues.push({ code: 'DUPLICATE_ROLE', severity: 'INFO', skuIds: group.map(g => g.skuId),
          textAr: `في أكتر من منتج لنفس الخطوة (${role.toLowerCase()}) في روتين ${slot === 'AM' ? 'الصبح' : 'المساء'}؛ واحد كفاية في المرة`,
          textEn: `More than one product for the same step (${role.toLowerCase()}) in the ${slot === 'AM' ? 'morning' : 'evening'} routine; one per session is enough` });
      }
    }
  }

  const sensitising = unique.filter(f => SUN_SENSITISING.some(family => f.product.ingredientFamilies.includes(family)));
  const hasSunscreen = facts.some(f => f.slot === 'AM' && (f.role === 'SUNSCREEN' || f.product.productType === 'sunscreen'));
  if (sensitising.length && !hasSunscreen) {
    issues.push({ code: 'SUNSCREEN_ADVISED', severity: 'WARN', skuIds: sensitising.map(s => s.skuId),
      textAr: 'الروتين فيه مكوّن بيزوّد حساسية البشرة للشمس ومفيهوش واقي شمس الصبح', textEn: 'The routine has an ingredient that raises sun sensitivity and no morning sunscreen' });
  }

  const unverified = unique.filter(f => !(f.product.productIngredients?.length));
  if (unverified.length) {
    issues.push({ code: 'INGREDIENTS_UNVERIFIED', severity: 'INFO', skuIds: unverified.map(u => u.skuId),
      textAr: `قائمة المكونات غير موثّقة عندنا لـ: ${unverified.map(u => label(u.product)).join('، ')}. التوافق بين المكونات اتراجع للمنتجات الموثّقة بس.`,
      textEn: `Ingredient lists are not verified for: ${unverified.map(u => label(u.product)).join(', ')}. Ingredient compatibility was checked for verified products only.` });
  }

  const order = { AM: [], PM: [], AS_NEEDED: [] } as Record<Slot, string[]>;
  for (const slot of ['AM', 'PM', 'AS_NEEDED'] as const) {
    order[slot] = facts.filter(f => f.slot === slot)
      .map((f, index) => ({ f, index }))
      .sort((a, b) => (a.f.rank ?? 50) - (b.f.rank ?? 50) || a.index - b.index)
      .map(item => item.f.skuId);
  }

  return { version: COMPATIBILITY_VERSION, ok: !issues.some(issue => issue.severity === 'BLOCK'), issues, order };
}
