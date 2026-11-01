import type { RoutineActiveFact } from '../../catalog/public';

/**
 * Routine engine (docs/project/ROUTINE_SYSTEM.md §7, §8). Pure and deterministic: the same blueprint, candidates and
 * context always give the same proposal. It picks and orders products; the AI never does. No I/O happens here —
 * RoutineEngineService loads the inputs.
 */
export const ENGINE_VERSION = 'routine-engine/1';
/** Reviewed facts older than this stop qualifying a product for a treatment role (§7, incomplete data). */
export const FACT_MAX_AGE_DAYS = 730;

export type TriState = 'YES' | 'NO' | 'UNKNOWN';
export type Tier = 'SMART' | 'COMPLETE' | 'LUXE';
export const TIERS: readonly Tier[] = ['SMART', 'COMPLETE', 'LUXE'];
export type AgeBand = 'UNDER_15' | 'AGE_15_17' | 'ADULT';

export interface EngineRole {
  roleKey: string;
  sortOrder: number;
  titleAr: string;
  isEssential: boolean;
  startWeek: number;
  requiredActives: string[];
  concentrationRanges: Array<{ subject: string; min: number; max: number; unit: string }>;
  usageNoteAr: string | null;
}

export interface EngineBlueprint {
  id: string;
  key: string;
  version: number;
  concernSlug: string;
  careArea: 'skin' | 'hair';
  kind: 'TREATMENT' | 'SUPPORT' | 'MAINTENANCE';
  severityMin: number;
  severityMax: number;
  titleAr: string;
  goalAr: string | null;
  timelineAr: string | null;
  safetyNotesAr: string[];
  roles: EngineRole[];
}

export interface EngineRule {
  key: string;
  kind: 'SEPARATE_TIMES' | 'COMPATIBLE' | 'MAX_ONE_PER_AREA' | 'EXCLUDE_CONDITION';
  subjectType: 'FAMILY' | 'INGREDIENT';
  subject: string;
  otherType: 'FAMILY' | 'INGREDIENT' | null;
  other: string | null;
  condition: string | null;
  noteAr: string | null;
}

export interface EngineCandidate {
  productId: string;
  skuId: string | null;
  name: string;
  brandName: string;
  imageUrl: string | null;
  roleKey: string;
  tier: Tier;
  concernSlugs: string[];
  suitableSkinTypes: string[];
  price: number | null;
  currency: string;
  sellable: boolean;
  actives: RoutineActiveFact[];
  ingredientIds: string[];
  ingredientSlugs: string[];
  ingredientFamilies: string[];
  usageRuleCount: number;
  /** Review dates of the facts that qualify the product (usage rules, stated concentrations). */
  factsReviewedAt: string[];
  /** Structured product safety warnings (GLO-284 §4D). */
  safetyWarnings?: Array<{ kind: string; condition: string | null }>;
}

export interface SafetyAnswers {
  pregnant: TriState;
  breastfeeding: TriState;
  prescriptionTopical: TriState;
  oralRetinoid: TriState;
  fragranceSensitive: TriState;
}

export interface EngineOverrides {
  swaps: Record<string, string>;
  removed: string[];
  upgrades: string[];
}

/** Products already in the customer's other ACTIVE routines, for cross-routine rules (§5.6). */
export interface ActiveRoutineProduct {
  routineId: string;
  careArea: 'skin' | 'hair';
  roleKey: string;
  productId: string;
  subjects: string[];
}

export interface EngineContext {
  severity: number | null;
  skinType: string | null;
  ageBand: AgeBand | null;
  experienceLevel: 'BEGINNER' | 'EXPERIENCED' | null;
  fragranceFree: boolean | null;
  safety: SafetyAnswers;
  allergyIngredientIds: string[];
  tier: Tier | null;
  budget: number | null;
  ownedRoleKeys: string[];
  overrides: EngineOverrides;
  activeRoutineProducts: ActiveRoutineProduct[];
  now: Date;
}

export interface EngineProduct {
  productId: string;
  skuId: string | null;
  name: string;
  brandName: string;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  tier: Tier;
}

export type EngineItemStatus = 'SELECTED' | 'OWNED' | 'REMOVED' | 'UNAVAILABLE' | 'UPGRADE_AVAILABLE';

export interface EngineItem {
  roleKey: string;
  sortOrder: number;
  titleAr: string;
  isEssential: boolean;
  startWeek: number;
  purchasePhase: 'IMMEDIATE' | 'DEFERRED';
  status: EngineItemStatus;
  product: EngineProduct | null;
  alternatives: Array<EngineProduct & { cheaper: boolean }>;
  upgradeOffer: EngineProduct | null;
  reasonCodes: string[];
  usageNoteAr: string | null;
  /** Active ingredient slugs and families the item contributes, for cross-routine checks after saving. */
  subjects: string[];
}

export interface EngineProposal {
  engineVersion: string;
  blueprint: Pick<EngineBlueprint, 'id' | 'key' | 'version' | 'concernSlug' | 'careArea' | 'kind' | 'titleAr' | 'goalAr' | 'timelineAr' | 'safetyNotesAr'>;
  mode: 'STANDARD' | 'GENTLE_BASICS';
  tier: Tier;
  recommendedTier: Tier;
  tiersAvailable: Tier[];
  items: EngineItem[];
  totals: { all: number; immediate: number; deferred: number; currency: string };
  budget: number | null;
  overBudget: boolean;
  warnings: string[];
}

type Exclusion = 'NOT_ELIGIBLE_FOR_CONCERN' | 'SKIN_TYPE' | 'ALLERGY' | 'FRAGRANCE' | 'INCOMPLETE_DATA' | 'STALE_DATA'
  | 'MISSING_REQUIRED_ACTIVE' | 'CONCENTRATION_OUT_OF_RANGE' | `CONDITION:${string}` | `CONFLICT:${string}`;

const SUNSCREEN_ROLE = 'sunscreen';
const FRAGRANCE_SUBJECTS = ['fragrance', 'parfum'];

/** Subjects a product carries for rule matching: every reviewed ingredient slug and family. */
export function subjectsOf(c: Pick<EngineCandidate, 'ingredientSlugs' | 'ingredientFamilies'>): string[] {
  return [...new Set([...c.ingredientSlugs, ...c.ingredientFamilies])].sort();
}

function matchesSubject(subjects: string[], type: 'FAMILY' | 'INGREDIENT' | null, subject: string | null): boolean {
  return !!type && !!subject && subjects.includes(subject);
}

/** YES or UNKNOWN: an unanswered safety question restricts like a yes (§8-ب). */
export function conditionApplies(condition: string, ctx: EngineContext): { applies: boolean; unknown: boolean } {
  const value = ((): TriState => {
    switch (condition) {
      case 'PREGNANT': return ctx.safety.pregnant;
      case 'BREASTFEEDING': return ctx.safety.breastfeeding;
      case 'ORAL_RETINOID': return ctx.safety.oralRetinoid;
      case 'PRESCRIPTION_TOPICAL': return ctx.safety.prescriptionTopical;
      case 'AGE_UNDER_15': return ctx.ageBand === null ? 'UNKNOWN' : ctx.ageBand === 'UNDER_15' ? 'YES' : 'NO';
      case 'AGE_15_17': return ctx.ageBand === null ? 'UNKNOWN' : ctx.ageBand === 'AGE_15_17' ? 'YES' : 'NO';
      default: return 'UNKNOWN';
    }
  })();
  return { applies: value !== 'NO', unknown: value === 'UNKNOWN' };
}

/** The safety path: no treatment roles at all, and a clear doctor recommendation (§8, §8-ج). */
export function gentleBasicsReasons(ctx: EngineContext): string[] {
  const reasons: string[] = [];
  if (ctx.severity === 3) reasons.push('SEVERE_SEE_DOCTOR');
  if (ctx.ageBand === 'UNDER_15') reasons.push('UNDER_15_GENERAL_ONLY');
  if (ctx.safety.oralRetinoid === 'YES') reasons.push('ORAL_RETINOID_SEE_DOCTOR');
  if (ctx.safety.prescriptionTopical === 'YES') reasons.push('PRESCRIPTION_TREATMENT_SEE_DOCTOR');
  return reasons;
}

export function selectBlueprint(blueprints: EngineBlueprint[], concernSlug: string, severity: number | null): EngineBlueprint | null {
  const forConcern = blueprints
    .filter(b => b.concernSlug === concernSlug)
    .sort((a, b) => a.severityMin - b.severityMin || a.key.localeCompare(b.key));
  if (!forConcern.length) return null;
  if (severity === null) return forConcern[0];
  // Severe has no blueprint of its own: the mildest-to-strongest closest one supplies the gentle basic roles.
  return forConcern.find(b => severity >= b.severityMin && severity <= b.severityMax)
    ?? forConcern[forConcern.length - 1];
}

function isTreatmentRole(role: EngineRole) {
  return role.requiredActives.length > 0;
}

function matchedActive(role: EngineRole, c: EngineCandidate): RoutineActiveFact | null {
  return c.actives.find(a => role.requiredActives.includes(a.ingredientSlug)
    || (!!a.familySlug && role.requiredActives.includes(a.familySlug))) ?? null;
}

function rangeFor(role: EngineRole, active: RoutineActiveFact) {
  return role.concentrationRanges.find(r => r.subject === active.ingredientSlug)
    ?? role.concentrationRanges.find(r => r.subject === active.familySlug)
    ?? null;
}

function ageInDays(iso: string, now: Date) {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/** Why a candidate cannot fill a role for this customer, or null when it qualifies (ignoring stock and tier). */
export function exclusionFor(
  c: EngineCandidate, role: EngineRole, bp: EngineBlueprint, ctx: EngineContext, rules: EngineRule[],
  takenSubjects: string[],
): { reason: Exclusion; unknownSafety?: boolean } | null {
  if (c.concernSlugs.length && !c.concernSlugs.includes(bp.concernSlug)) return { reason: 'NOT_ELIGIBLE_FOR_CONCERN' };
  if (ctx.skinType && c.suitableSkinTypes.length && !c.suitableSkinTypes.includes(ctx.skinType)) return { reason: 'SKIN_TYPE' };
  if (c.ingredientIds.some(id => ctx.allergyIngredientIds.includes(id))) return { reason: 'ALLERGY' };
  const subjects = subjectsOf(c);
  if ((ctx.fragranceFree || ctx.safety.fragranceSensitive === 'YES') && subjects.some(s => FRAGRANCE_SUBJECTS.includes(s))) {
    return { reason: 'FRAGRANCE' };
  }

  if (isTreatmentRole(role)) {
    const active = matchedActive(role, c);
    if (!active) return { reason: 'MISSING_REQUIRED_ACTIVE' };
    const range = rangeFor(role, active);
    if (range) {
      if (!active.concentrationVerified || active.concentrationValue === null || active.concentrationUnit !== range.unit) {
        return { reason: 'INCOMPLETE_DATA' };
      }
      if (active.concentrationValue < range.min || active.concentrationValue > range.max) return { reason: 'CONCENTRATION_OUT_OF_RANGE' };
    }
    if (c.usageRuleCount === 0) return { reason: 'INCOMPLETE_DATA' };
    if (c.factsReviewedAt.some(at => ageInDays(at, ctx.now) > FACT_MAX_AGE_DAYS)) return { reason: 'STALE_DATA' };
  }

  if (c.safetyWarnings) {
    for (const warning of c.safetyWarnings) {
      if ((warning.kind === 'CONTRAINDICATION' || warning.kind === 'RESTRICTION') && warning.condition) {
        const { applies, unknown } = conditionApplies(warning.condition, ctx);
        if (applies) return { reason: `CONDITION:${warning.condition}`, unknownSafety: unknown };
      }
    }
  }

  for (const rule of rules) {
    if (rule.kind === 'EXCLUDE_CONDITION' && rule.condition && matchesSubject(subjects, rule.subjectType, rule.subject)) {
      const { applies, unknown } = conditionApplies(rule.condition, ctx);
      if (applies) return { reason: `CONDITION:${rule.condition}`, unknownSafety: unknown };
    }
    if (rule.kind === 'MAX_ONE_PER_AREA' && matchesSubject(subjects, rule.subjectType, rule.subject)
      && takenSubjects.includes(rule.subject)) {
      return { reason: `CONFLICT:${rule.key}` };
    }
  }
  return null;
}

/** Deterministic preference inside one role (§7 step 4). Margin is never an input. */
function rank(role: EngineRole, bp: EngineBlueprint, ctx: EngineContext) {
  const key = (c: EngineCandidate) => {
    const active = isTreatmentRole(role) ? matchedActive(role, c) : null;
    return [
      c.concernSlugs.includes(bp.concernSlug) ? 0 : 1,
      ctx.skinType && c.suitableSkinTypes.includes(ctx.skinType) ? 0 : 1,
      active?.concentrationVerified ? 0 : 1,
      c.price ?? Number.MAX_SAFE_INTEGER,
    ] as const;
  };
  return (a: EngineCandidate, b: EngineCandidate) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.productId.localeCompare(b.productId);
  };
}

function toProduct(c: EngineCandidate): EngineProduct {
  return { productId: c.productId, skuId: c.skuId, name: c.name, brandName: c.brandName, imageUrl: c.imageUrl,
    price: c.price, currency: c.currency, tier: c.tier };
}

function rolesFor(bp: EngineBlueprint, mode: EngineProposal['mode'], tier: Tier) {
  return [...bp.roles]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter(r => mode === 'STANDARD' || !isTreatmentRole(r))
    // «اختيار ذكي» is the essentials only; optional steps come with Complete and Luxe (§3-ج).
    .filter(r => r.isEssential || tier !== 'SMART');
}

function startWeekFor(role: EngineRole, ctx: EngineContext) {
  if (role.roleKey === SUNSCREEN_ROLE) return 1; // never deferred (§5.3)
  if (isTreatmentRole(role) && ctx.experienceLevel !== 'EXPERIENCED') return Math.max(role.startWeek, 2);
  return Math.max(1, role.startWeek);
}

function reasonCodes(c: EngineCandidate, role: EngineRole, bp: EngineBlueprint, ctx: EngineContext, startWeek: number) {
  const codes: string[] = [];
  if (c.concernSlugs.includes(bp.concernSlug)) codes.push('CONCERN_MATCH');
  const active = isTreatmentRole(role) ? matchedActive(role, c) : null;
  if (active) {
    codes.push(active.concentrationVerified && active.concentrationValue !== null
      ? `ACTIVE:${active.ingredientSlug}@${active.concentrationValue}${active.concentrationUnit ?? ''}`
      : `ACTIVE:${active.ingredientSlug}`);
  }
  if (ctx.skinType && c.suitableSkinTypes.includes(ctx.skinType)) codes.push(`SKIN_TYPE_MATCH:${ctx.skinType}`);
  if (startWeek > 1) codes.push(`GENTLE_START:WEEK_${startWeek}`);
  return codes;
}

interface RoleBuild {
  item: EngineItem;
  /** Whether the role can be filled in the tier at all (stock ignored): the tier-availability test. */
  eligibleInTier: boolean;
  unknownSafety: boolean;
}

function buildRole(
  role: EngineRole, bp: EngineBlueprint, ctx: EngineContext, tier: Tier, candidates: EngineCandidate[], rules: EngineRule[],
  takenSubjects: string[],
): RoleBuild {
  const startWeek = startWeekFor(role, ctx);
  const base: EngineItem = {
    roleKey: role.roleKey, sortOrder: role.sortOrder, titleAr: role.titleAr, isEssential: role.isEssential, startWeek,
    purchasePhase: startWeek > 1 ? 'DEFERRED' : 'IMMEDIATE', status: 'UNAVAILABLE', product: null, alternatives: [],
    upgradeOffer: null, reasonCodes: [], usageNoteAr: role.usageNoteAr, subjects: [],
  };

  if (ctx.ownedRoleKeys.includes(role.roleKey)) {
    return { item: { ...base, status: 'OWNED', reasonCodes: ['ALREADY_OWNED'] }, eligibleInTier: true, unknownSafety: false };
  }
  if (!role.isEssential && ctx.overrides.removed.includes(role.roleKey)) {
    return { item: { ...base, status: 'REMOVED' }, eligibleInTier: true, unknownSafety: false };
  }

  let unknownSafety = false;
  const qualified = candidates.filter(c => c.roleKey === role.roleKey).filter(c => {
    const ex = exclusionFor(c, role, bp, ctx, rules, takenSubjects);
    if (ex?.unknownSafety) unknownSafety = true;
    return ex === null;
  }).sort(rank(role, bp, ctx));

  const inTier = qualified.filter(c => c.tier === tier);
  const sellable = qualified.filter(c => c.sellable && c.price !== null);
  const sellableInTier = inTier.filter(c => c.sellable && c.price !== null);

  const swapId = ctx.overrides.swaps[role.roleKey];
  const swapped = swapId ? sellable.find(c => c.productId === swapId) : undefined;
  let chosen: EngineCandidate | undefined = swapped ?? sellableInTier[0];
  let codes: string[] = swapped ? ['CUSTOMER_CHOICE'] : [];
  let status: EngineItemStatus = chosen ? 'SELECTED' : 'UNAVAILABLE';
  let upgradeOffer: EngineCandidate | undefined;

  if (!chosen && inTier.length) {
    // In stock nowhere in this tier: offer the best of a higher tier, with the customer's consent only (§7 5-أ).
    upgradeOffer = sellable.find(c => TIERS.indexOf(c.tier) > TIERS.indexOf(tier));
    if (upgradeOffer && ctx.overrides.upgrades.includes(role.roleKey)) {
      chosen = upgradeOffer;
      codes = ['UPGRADED_WITH_CONSENT'];
      status = 'SELECTED';
      upgradeOffer = undefined;
    } else if (upgradeOffer) {
      status = 'UPGRADE_AVAILABLE';
    }
  }

  const alternatives = chosen
    ? sellable.filter(c => c.productId !== chosen!.productId).slice(0, 2)
      .map(c => ({ ...toProduct(c), cheaper: (c.price ?? 0) < (chosen!.price ?? 0) }))
    : [];

  return {
    item: {
      ...base,
      status,
      product: chosen ? toProduct(chosen) : null,
      alternatives,
      upgradeOffer: upgradeOffer ? toProduct(upgradeOffer) : null,
      reasonCodes: chosen ? [...codes, ...reasonCodes(chosen, role, bp, ctx, startWeek)] : codes,
      subjects: chosen ? subjectsOf(chosen) : [],
    },
    eligibleInTier: inTier.length > 0,
    unknownSafety,
  };
}

function buildTier(bp: EngineBlueprint, ctx: EngineContext, mode: EngineProposal['mode'], tier: Tier, candidates: EngineCandidate[], rules: EngineRule[]) {
  const taken = ctx.activeRoutineProducts.filter(p => p.careArea === bp.careArea).flatMap(p => p.subjects);
  const builds: RoleBuild[] = [];
  for (const role of rolesFor(bp, mode, tier)) {
    const build = buildRole(role, bp, ctx, tier, candidates, rules, taken);
    builds.push(build);
    taken.push(...build.item.subjects);
  }
  const available = builds.every(b => !b.item.isEssential || b.eligibleInTier);
  return { builds, available };
}

function totalsOf(items: EngineItem[], currency: string) {
  const priced = items.filter(i => i.status === 'SELECTED' && i.product?.price !== null && i.product?.price !== undefined);
  const sum = (list: EngineItem[]) => Math.round(list.reduce((acc, i) => acc + (i.product!.price as number), 0) * 100) / 100;
  const immediate = sum(priced.filter(i => i.purchasePhase === 'IMMEDIATE'));
  const all = sum(priced);
  return { all, immediate, deferred: Math.round((all - immediate) * 100) / 100, currency };
}

/** Pairwise timing notes between the selected items and the customer's active routines (§8-أ). */
function separateTimesWarnings(items: EngineItem[], ctx: EngineContext, rules: EngineRule[], careArea: string) {
  const pools = [
    ...items.filter(i => i.status === 'SELECTED').map(i => ({ ref: i.roleKey, subjects: i.subjects })),
    ...ctx.activeRoutineProducts.filter(p => p.careArea === careArea).map(p => ({ ref: `routine:${p.routineId}`, subjects: p.subjects })),
  ];
  const warnings = new Set<string>();
  for (const rule of rules.filter(r => r.kind === 'SEPARATE_TIMES')) {
    const a = pools.filter(p => matchesSubject(p.subjects, rule.subjectType, rule.subject));
    const b = pools.filter(p => matchesSubject(p.subjects, rule.otherType, rule.other));
    if (a.some(x => b.some(y => y.ref !== x.ref))) warnings.add(`SEPARATE_TIMES:${rule.key}`);
  }
  return [...warnings].sort();
}

export function buildProposal(
  bp: EngineBlueprint, candidates: EngineCandidate[], rules: EngineRule[], ctx: EngineContext,
): EngineProposal {
  const gentle = gentleBasicsReasons(ctx);
  const mode: EngineProposal['mode'] = gentle.length ? 'GENTLE_BASICS' : 'STANDARD';
  const currency = candidates.find(c => c.currency)?.currency ?? 'EGP';

  const perTier = new Map(TIERS.map(t => [t, buildTier(bp, ctx, mode, t, candidates, rules)] as const));
  const tiersAvailable = TIERS.filter(t => perTier.get(t)!.available);

  // «الأنسب ليك»: the highest available tier inside the budget, else the smart pick (§3-ج).
  const recommendedTier = (() => {
    if (ctx.budget === null) return tiersAvailable[0] ?? 'SMART';
    const fitting = tiersAvailable.filter(t => totalsOf(perTier.get(t)!.builds.map(b => b.item), currency).all <= ctx.budget!);
    return fitting[fitting.length - 1] ?? tiersAvailable[0] ?? 'SMART';
  })();
  const tier = ctx.tier && tiersAvailable.includes(ctx.tier) ? ctx.tier : recommendedTier;
  const { builds } = perTier.get(tier)!;
  const items = builds.map(b => b.item);
  const totals = totalsOf(items, currency);

  const warnings = new Set<string>(gentle);
  if (builds.some(b => b.unknownSafety)) warnings.add('NEEDS_SAFETY_ANSWERS');
  if (items.some(i => i.isEssential && i.status === 'UNAVAILABLE')) warnings.add('ESSENTIAL_UNAVAILABLE');
  if (items.some(i => i.status === 'UPGRADE_AVAILABLE')) warnings.add('UPGRADE_NEEDS_CONSENT');
  if (ctx.tier && !tiersAvailable.includes(ctx.tier)) warnings.add(`TIER_NOT_AVAILABLE:${ctx.tier}`);
  const overBudget = ctx.budget !== null && totals.all > ctx.budget;
  if (overBudget) warnings.add('OVER_BUDGET');
  for (const w of separateTimesWarnings(items, ctx, rules, bp.careArea)) warnings.add(w);

  return {
    engineVersion: ENGINE_VERSION,
    blueprint: {
      id: bp.id, key: bp.key, version: bp.version, concernSlug: bp.concernSlug, careArea: bp.careArea, kind: bp.kind,
      titleAr: bp.titleAr, goalAr: bp.goalAr, timelineAr: bp.timelineAr, safetyNotesAr: bp.safetyNotesAr,
    },
    mode,
    tier,
    recommendedTier,
    tiersAvailable,
    items,
    totals,
    budget: ctx.budget,
    overBudget,
    warnings: [...warnings].sort(),
  };
}

/** Activation limit by care area (§5.6): one face treatment, one face support, one hair routine. */
export function areaSlot(careArea: 'skin' | 'hair', kind: EngineBlueprint['kind']): string {
  if (careArea === 'hair') return 'HAIR';
  return kind === 'SUPPORT' ? 'FACE_SUPPORT' : 'FACE_TREATMENT';
}

/** MAX_ONE_PER_AREA conflicts between one routine's items and other active routines of the same area. */
export function crossRoutineConflicts(
  careArea: 'skin' | 'hair', items: Array<{ roleKey: string; subjects: string[] }>, others: ActiveRoutineProduct[], rules: EngineRule[],
) {
  const conflicts: Array<{ rule: string; roleKey: string; otherRoutineId: string; otherRoleKey: string }> = [];
  for (const rule of rules.filter(r => r.kind === 'MAX_ONE_PER_AREA')) {
    for (const item of items.filter(i => matchesSubject(i.subjects, rule.subjectType, rule.subject))) {
      for (const other of others.filter(o => o.careArea === careArea && matchesSubject(o.subjects, rule.subjectType, rule.subject))) {
        conflicts.push({ rule: rule.key, roleKey: item.roleKey, otherRoutineId: other.routineId, otherRoleKey: other.roleKey });
      }
    }
  }
  return conflicts;
}
