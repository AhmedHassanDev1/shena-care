import { parseIdentityTitle } from './identity-text';
import { hasMedicalClaim, rinseMode } from './catalog-decision-engine';
import { UsageRule } from './contracts/routine-placement.contract';
import { instructionSentences } from './product-fact-extractor';

/**
 * Routine-ready metadata for one SKU, from its verified facts and a deterministic product-type rule set. Pure: same inputs, same profile.
 *
 * Four kinds of value, never mixed:
 *  - VERIFIED: stated by the manufacturer or a trusted distributor, with evidence (instructions, INCI, warnings, stated concentrations).
 *  - RULE_DERIVED: what the system's own routine rules say about this product type (role, step order, sequencing, ingredient-class guidance). Never a product claim.
 *  - UNKNOWN: nobody credible stated it. Frequencies, AM/PM and concentrations are never filled in from the type.
 *  - CONFLICT: credible sources, or the instructions and the product type, disagree. A critical conflict is reported, never resolved here.
 */
export const ROUTINE_RULE_VERSION = 'routine-profile@1';

export type FieldState = 'VERIFIED' | 'RULE_DERIVED' | 'UNKNOWN' | 'CONFLICT';
export type RoutineRole =
  | 'MAKEUP_REMOVER' | 'CLEANSER' | 'EXFOLIANT' | 'TONER' | 'FACE_MASK' | 'SERUM' | 'TREATMENT' | 'EYE_CARE' | 'MOISTURIZER' | 'SUNSCREEN' | 'LIP_CARE'
  | 'HAIR_WASH' | 'CONDITIONER' | 'HAIR_MASK' | 'LEAVE_IN' | 'HAIR_TREATMENT' | 'HAIR_STYLING'
  | 'BODY_WASH' | 'BODY_MOISTURIZER';
type Rinse = 'RINSE_OFF' | 'LEAVE_ON';

interface RoleRule { role: RoutineRole; domain: 'SKIN' | 'HAIR' | 'BODY'; order: number; expectedRinse: Rinse | null; area: string; periodEligibility?: 'AM' | 'PM' }
/** Product type -> canonical routine role. Step order is the thin-to-thick sequence within each domain. */
export const ROLE_BY_TYPE: Record<string, RoleRule> = {
  'makeup-remover': { role: 'MAKEUP_REMOVER', domain: 'SKIN', order: 1, expectedRinse: null, area: 'FACE' },
  cleanser: { role: 'CLEANSER', domain: 'SKIN', order: 2, expectedRinse: 'RINSE_OFF', area: 'FACE' },
  exfoliant: { role: 'EXFOLIANT', domain: 'SKIN', order: 3, expectedRinse: null, area: 'FACE' },
  toner: { role: 'TONER', domain: 'SKIN', order: 4, expectedRinse: 'LEAVE_ON', area: 'FACE' },
  'face-mask': { role: 'FACE_MASK', domain: 'SKIN', order: 5, expectedRinse: null, area: 'FACE' },
  serum: { role: 'SERUM', domain: 'SKIN', order: 6, expectedRinse: 'LEAVE_ON', area: 'FACE' },
  'eye-care': { role: 'EYE_CARE', domain: 'SKIN', order: 7, expectedRinse: 'LEAVE_ON', area: 'EYE_CONTOUR' },
  moisturizer: { role: 'MOISTURIZER', domain: 'SKIN', order: 8, expectedRinse: 'LEAVE_ON', area: 'FACE' },
  sunscreen: { role: 'SUNSCREEN', domain: 'SKIN', order: 9, expectedRinse: 'LEAVE_ON', area: 'FACE', periodEligibility: 'AM' },
  'lip-care': { role: 'LIP_CARE', domain: 'SKIN', order: 10, expectedRinse: 'LEAVE_ON', area: 'LIPS' },
  shampoo: { role: 'HAIR_WASH', domain: 'HAIR', order: 1, expectedRinse: 'RINSE_OFF', area: 'HAIR' },
  conditioner: { role: 'CONDITIONER', domain: 'HAIR', order: 2, expectedRinse: 'RINSE_OFF', area: 'HAIR' },
  'hair-mask': { role: 'HAIR_MASK', domain: 'HAIR', order: 3, expectedRinse: 'RINSE_OFF', area: 'HAIR' },
  'leave-in': { role: 'LEAVE_IN', domain: 'HAIR', order: 4, expectedRinse: 'LEAVE_ON', area: 'HAIR' },
  'hair-serum': { role: 'HAIR_TREATMENT', domain: 'HAIR', order: 5, expectedRinse: 'LEAVE_ON', area: 'HAIR' },
  'hair-oil': { role: 'HAIR_TREATMENT', domain: 'HAIR', order: 5, expectedRinse: null, area: 'HAIR' },
  'hair-styling': { role: 'HAIR_STYLING', domain: 'HAIR', order: 6, expectedRinse: 'LEAVE_ON', area: 'HAIR' },
  'body-wash': { role: 'BODY_WASH', domain: 'BODY', order: 1, expectedRinse: 'RINSE_OFF', area: 'BODY' },
  'body-moisturizer': { role: 'BODY_MOISTURIZER', domain: 'BODY', order: 2, expectedRinse: 'LEAVE_ON', area: 'BODY' },
};

/** Functional active families, read from the verified INCI. Presence is not potency: a concentration is VERIFIED only when the manufacturer states it. */
const ACTIVE_FAMILIES: Array<{ family: string; pattern: RegExp; exfoliating?: boolean; photosensitizing?: boolean; nightPreferred?: boolean }> = [
  { family: 'RETINOID', pattern: /\b(retinol|retinal|retinaldehyde|retinyl [a-z]+|hydroxypinacolone retinoate|adapalene|tretinoin)\b/i, photosensitizing: true, nightPreferred: true },
  { family: 'AHA', pattern: /\b(glycolic acid|mandelic acid|lactobionic acid)\b/i, exfoliating: true, photosensitizing: true },
  { family: 'BHA', pattern: /\b(salicylic acid|betaine salicylate)\b/i, exfoliating: true },
  { family: 'BENZOYL_PEROXIDE', pattern: /\bbenzoyl peroxide\b/i },
  { family: 'AZELAIC_ACID', pattern: /\b(azelaic acid|potassium azeloyl diglycinate)\b/i },
  { family: 'VITAMIN_C', pattern: /\b(ascorbic acid|ascorbyl glucoside|sodium ascorbyl phosphate|magnesium ascorbyl phosphate|ethyl ascorbic acid|3-o-ethyl ascorbic acid|tetrahexyldecyl ascorbate)\b/i },
  { family: 'NIACINAMIDE', pattern: /\bniacinamide\b/i },
  { family: 'TRANEXAMIC_ACID', pattern: /\btranexamic acid\b/i },
];
/** Title concepts (identity-text vocabulary) -> the INCI that proves a featured ingredient is really in the formula. */
const FEATURED: Record<string, RegExp> = {
  ceramide: /\bceramide/i, hyaluronic: /\b(hyaluronic acid|sodium hyaluronate|hydrolyzed hyaluronic acid)\b/i, niacinamide: /\bniacinamide\b/i, salicylic: /\bsalicylic acid\b/i,
  'vitamin-c': ACTIVE_FAMILIES.find(f => f.family === 'VITAMIN_C')!.pattern, retinol: /\bretinol\b/i, glycolic: /\bglycolic acid\b/i, argan: /\bargania spinosa/i, keratin: /\bkeratin\b/i,
  biotin: /\bbiotin\b/i, collagen: /\bcollagen\b/i, peptide: /peptide/i, urea: /\burea\b/i, caffeine: /\bcaffeine\b/i, zinc: /\bzinc\b/i, 'vitamin-e': /\btocopher/i,
};

/** Concerns a manufacturer may say a product addresses, read from its own claims. Bounded vocabulary; a claim, not proven efficacy. */
const CONCERNS: Array<[string, RegExp]> = [
  ['dryness', /\b(dry(?:ness)?|dehydrat\w*|hydrat\w*|moisturi[sz]\w*|retains? (?:skin's )?(?:natural )?moisture)\b|ترطيب|جفاف/i],
  ['barrier', /\b(skin(?:'s)? (?:natural )?barrier|barrier)\b/i],
  ['sensitivity', /\b(sensitive|soothing|calming|irritation)\b|حساس/i],
  ['acne_blemishes', /\b(acne|blemish\w*|breakouts?|pimples?|clogged pores)\b|حبوب/i],
  ['rough_texture', /\b(rough|bumpy|uneven texture|smoothing|exfoliat\w*)\b/i],
  ['oiliness', /\b(oily|excess oil|sebum|shine control)\b|دهن/i],
  ['hyperpigmentation', /\b(dark spots?|pigmentation|brighten\w*|uneven (?:skin )?tone)\b|تفتيح/i],
  ['aging', /\b(wrinkles?|fine lines|firm\w*|anti[- ]?ag(?:e|ing))\b|تجاعيد/i],
  ['hair_loss_thinning', /\b(hair (?:loss|fall|thinning)|thinning hair|thinning|dormant (?:hair )?follicles?)\b|تساقط/i],
  ['breakage_strength', /\b(breakage|split[- ]ends?|strengthen\w*|weak hair|resilien\w*)\b|تقصف/i],
  ['dandruff_scalp', /\b(dandruff|flak\w*|scalp (?:health|balance|care)|itchy scalp)\b|قشرة/i],
  ['frizz', /\b(frizz\w*)\b|هيشان/i],
  ['damage_repair', /\b(damaged hair|repair\w*|damage)\b/i],
];

export interface VerifiedText { lines: string[]; sourceUrl: string | null; sourceTier: string | null }

/**
 * Where a step sits relative to another role. VERIFIED when the manufacturer's own instruction says so ("after shampooing", "instead of conditioner"),
 * RULE_DERIVED when it follows from the product's type, subtype, rinse mode, area or functional ingredients, UNKNOWN when neither says (e.g. whether a hair mask
 * goes before conditioner, replaces it or follows it). A verified constraint always wins over a rule-derived one about the same role.
 */
export type PlacementRelation = 'AFTER' | 'BEFORE' | 'REPLACES' | 'UNDETERMINED';
export interface PlacementConstraint { relation: PlacementRelation; role: RoutineRole; status: FieldState; basis: string; excerpt?: string }

/** Instruction phrases that place a step; read only from verified manufacturer instructions. */
const STATED_PLACEMENT: Array<{ pattern: RegExp; relation: PlacementRelation; role: RoutineRole }> = [
  { pattern: /\b(instead of|in place of|replaces?|as an alternative to) (?:your |a |the )?conditioner\b/i, relation: 'REPLACES', role: 'CONDITIONER' },
  { pattern: /\b(before|prior to) (?:using |applying )?(?:your |a |the )?conditioner\b|\b(?:then|followed by|follow (?:up )?with) (?:your |a |the )?conditioner\b/i, relation: 'BEFORE', role: 'CONDITIONER' },
  { pattern: /\bafter (?:using |applying )?(?:your |the )?conditioner\b|\bafter conditioning\b/i, relation: 'AFTER', role: 'CONDITIONER' },
  { pattern: /\bafter (?:shampooing|washing(?: your)? hair|(?:using |applying )?(?:the |your |a )?(?:[a-z]+ )?shampoo)\b|\bon (?:clean|freshly washed),? (?:damp |wet |towel[- ]dried )?hair\b|\bwash your hair with\b/i, relation: 'AFTER', role: 'HAIR_WASH' },
  { pattern: /\b(before|prior to) (?:shampooing|washing(?: your)? hair|(?:your |the )?shampoo)\b|\bpre[- ]?(?:wash|shampoo)\b/i, relation: 'BEFORE', role: 'HAIR_WASH' },
  { pattern: /\bafter (?:cleansing|(?:using |applying )?(?:your |a |the )?cleanser)\b|\bon (?:clean|cleansed|freshly cleansed),? (?:dry |damp )?(?:skin|face)\b/i, relation: 'AFTER', role: 'CLEANSER' },
  { pattern: /\b(?:before|prior to) (?:applying |using )?(?:your |a |the )?moisturi[sz](?:er|ing)\b|\b(?:then|followed by|follow (?:up )?with) (?:your |a |the )?moisturi[sz]er\b/i, relation: 'BEFORE', role: 'MOISTURIZER' },
  { pattern: /\bafter (?:applying |using )?(?:your |a |the )?moisturi[sz]er\b/i, relation: 'AFTER', role: 'MOISTURIZER' },
  { pattern: /\b(?:before|prior to) (?:applying |using )?(?:your |a |the )?sunscreen\b/i, relation: 'BEFORE', role: 'SUNSCREEN' },
  { pattern: /\bafter (?:applying |using )?(?:your |a |the )?(?:toner|toning)\b/i, relation: 'AFTER', role: 'TONER' },
];

/**
 * The general placement rules, by role and what is known of the product. Only placements every product of that kind follows are rules; anything that depends on
 * the formula (a hair mask against conditioner, a hair oil before or after washing) is left UNDETERMINED unless the instructions say.
 */
function rulePlacement(role: RoutineRole, rinse: Rinse | null, hasExfoliatingActive: boolean): PlacementConstraint[] {
  const rule = (relation: PlacementRelation, target: RoutineRole, basis: string): PlacementConstraint => ({ relation, role: target, status: 'RULE_DERIVED', basis });
  const unknown = (target: RoutineRole, basis: string): PlacementConstraint => ({ relation: 'UNDETERMINED', role: target, status: 'UNKNOWN', basis });
  switch (role) {
    case 'CLEANSER': return [rule('AFTER', 'MAKEUP_REMOVER', 'FIRST_CLEANSE_BEFORE_SECOND')];
    case 'EXFOLIANT':
      // A rinse-off scrub belongs to the cleansing phase; a leave-on exfoliating treatment goes on cleansed skin before serums and moisturiser.
      if (rinse === 'RINSE_OFF') return [rule('AFTER', 'CLEANSER', 'RINSE_OFF_EXFOLIANT_IN_CLEANSING_PHASE'), rule('BEFORE', 'TONER', 'RINSE_OFF_EXFOLIANT_IN_CLEANSING_PHASE')];
      if (rinse === 'LEAVE_ON' || hasExfoliatingActive) return [rule('AFTER', 'CLEANSER', 'LEAVE_ON_EXFOLIANT_ON_CLEANSED_SKIN'), rule('AFTER', 'TONER', 'THIN_BEFORE_THICK'), rule('BEFORE', 'SERUM', 'LEAVE_ON_EXFOLIANT_BEFORE_TREATMENTS'), rule('BEFORE', 'MOISTURIZER', 'LEAVE_ON_EXFOLIANT_BEFORE_TREATMENTS')];
      return [rule('AFTER', 'CLEANSER', 'EXFOLIATE_CLEANSED_SKIN'), unknown('SERUM', 'RINSE_MODE_UNKNOWN')];
    case 'TONER': return [rule('AFTER', 'CLEANSER', 'TONER_ON_CLEANSED_SKIN'), rule('BEFORE', 'SERUM', 'THIN_BEFORE_THICK'), rule('BEFORE', 'MOISTURIZER', 'THIN_BEFORE_THICK')];
    case 'FACE_MASK':
      if (rinse === 'RINSE_OFF') return [rule('AFTER', 'CLEANSER', 'RINSE_OFF_MASK_ON_CLEANSED_SKIN'), rule('BEFORE', 'SERUM', 'RINSE_OFF_MASK_BEFORE_LEAVE_ON_STEPS'), rule('BEFORE', 'MOISTURIZER', 'RINSE_OFF_MASK_BEFORE_LEAVE_ON_STEPS')];
      if (rinse === 'LEAVE_ON') return [rule('AFTER', 'MOISTURIZER', 'LEAVE_ON_MASK_SEALS_THE_ROUTINE')];
      return [rule('AFTER', 'CLEANSER', 'MASK_ON_CLEANSED_SKIN'), unknown('MOISTURIZER', 'RINSE_MODE_UNKNOWN')];
    case 'SERUM': case 'TREATMENT': return [rule('AFTER', 'CLEANSER', 'TREATMENT_ON_CLEANSED_SKIN'), rule('AFTER', 'TONER', 'THIN_BEFORE_THICK'), rule('BEFORE', 'MOISTURIZER', 'THIN_BEFORE_THICK')];
    case 'EYE_CARE': return [rule('AFTER', 'CLEANSER', 'ON_CLEANSED_SKIN'), rule('BEFORE', 'SUNSCREEN', 'SUNSCREEN_LAST')];
    case 'MOISTURIZER': return [rule('AFTER', 'CLEANSER', 'ON_CLEANSED_SKIN'), rule('AFTER', 'SERUM', 'THIN_BEFORE_THICK'), rule('BEFORE', 'SUNSCREEN', 'SUNSCREEN_LAST')];
    case 'SUNSCREEN': return [rule('AFTER', 'MOISTURIZER', 'SUNSCREEN_LAST'), rule('AFTER', 'SERUM', 'SUNSCREEN_LAST')];
    case 'LIP_CARE': return [];
    case 'HAIR_WASH': return [];
    case 'CONDITIONER': return [rule('AFTER', 'HAIR_WASH', 'CONDITION_WASHED_HAIR')];
    case 'HAIR_MASK':
      // Masks differ: some are used before conditioner, some replace it, some follow it. Only the instructions can say which.
      return [rule('AFTER', 'HAIR_WASH', 'MASK_ON_WASHED_HAIR'), unknown('CONDITIONER', 'MASK_VS_CONDITIONER_DEPENDS_ON_FORMULA')];
    case 'LEAVE_IN': return [rule('AFTER', 'HAIR_WASH', 'LEAVE_IN_ON_WASHED_HAIR'), rule('AFTER', 'CONDITIONER', 'LEAVE_ON_AFTER_RINSE_OFF'), rule('AFTER', 'HAIR_MASK', 'LEAVE_ON_AFTER_RINSE_OFF')];
    case 'HAIR_TREATMENT':
      if (rinse === 'LEAVE_ON') return [rule('AFTER', 'HAIR_WASH', 'LEAVE_ON_AFTER_RINSE_OFF'), rule('AFTER', 'CONDITIONER', 'LEAVE_ON_AFTER_RINSE_OFF')];
      return [unknown('HAIR_WASH', 'PRE_WASH_OR_LEAVE_ON_DEPENDS_ON_FORMULA')];
    case 'HAIR_STYLING': return [rule('AFTER', 'CONDITIONER', 'STYLE_LAST'), rule('AFTER', 'LEAVE_IN', 'STYLE_LAST')];
    case 'BODY_MOISTURIZER': return [rule('AFTER', 'BODY_WASH', 'MOISTURISE_AFTER_WASHING')];
    default: return [];
  }
}
export interface RoutineProfileInput {
  productName: string;
  productType: string | null;
  productSubtype: string | null;
  /** APPLIED manufacturer/distributor instructions; null when none is verified. */
  instructions: VerifiedText | null;
  /** Instructions are in conflict between sources (open critical exception or CONFLICT facts). */
  instructionsConflict: boolean;
  /** Usage rules a person or the pipeline already reviewed (catalog ProductUsageRule). They outrank parsing. */
  reviewedUsageRules: Array<{ routinePeriod: string; rinseMode: string; frequencyUnit: string; usesMin: number | null; usesMax: number | null; contactMinutes: number | null; evidenceText: string; sourceUrl: string }>;
  /** Usage rules parsed from the verified instruction text (RoutinePlacementService). */
  parsedUsageRules: UsageRule[];
  /** Verified INCI in label order, with the ingredient master's function when known. */
  inci: Array<{ inci: string; function: string | null; family: string | null; concentration: { value: number; unit: string } | null; concentrationStatus: string }>;
  inciConflict: boolean;
  /** Catalog target area set from a verified fact, if any. */
  verifiedTargetArea: string | null;
  verifiedSpf: number | null;
  warnings: Array<{ text: string; sourceUrl: string | null; sourceType: string | null }>;
  skinTypes: { values: string[]; verified: boolean };
  hairTypes: { values: string[]; verified: boolean };
  claims: string[];
  /** Key ingredients the manufacturer names, with its stated function (applied fact), and where it was read. */
  keyIngredients?: { items: Array<{ name: string; function: string | null; functionWithheld?: string }>; sourceUrl: string | null } | null;
  claimsSource?: string | null;
  /** Fields in CONFLICT among sources (from research). */
  conflictFields: string[];
}

export interface Valued<T> { value: T; status: FieldState; basis: string; source?: string | null; excerpt?: string | null }
export interface RoutineProfile {
  ruleVersion: string;
  productType: string | null;
  routineDomain: 'SKIN' | 'HAIR' | 'BODY' | null;
  primaryRole: Valued<RoutineRole | null>;
  secondaryRoles: Array<{ role: RoutineRole; status: FieldState; basis: string }>;
  stepOrder: Valued<number | null>;
  routinePeriod: Valued<'AM' | 'PM' | 'BOTH' | 'UNKNOWN'>;
  periodEligibility: Valued<'AM' | 'PM' | 'BOTH' | null>;
  cadence: Valued<{ unit: 'DAY' | 'WEEK' | 'AS_NEEDED' | 'UNKNOWN'; min: number | null; max: number | null }>;
  rinseMode: Valued<'RINSE_OFF' | 'LEAVE_ON' | 'UNKNOWN'>;
  expectedRinseMode: Rinse | null;
  contactMinutes: Valued<number | null>;
  targetArea: Valued<string | null>;
  activeIngredients: Array<{ inci: string; family: string; function: string | null; featured: boolean; concentration: { value: number; unit: string } | null; concentrationStatus: FieldState; status: FieldState }>;
  featuredIngredients: Array<{ concept: string; inci: string | null; status: FieldState; basis: string; function?: string | null; kind?: 'NAMED_IN_TITLE' | 'MANUFACTURER_KEY_INGREDIENT' }>;
  /** Whether the verified INCI looks like a complete formula (opens with its water base) or is a list as the source stated it. */
  inciCompleteness: 'FULL_FORMULA' | 'AS_STATED_POSSIBLY_PARTIAL' | 'NONE';
  /** Placement relative to other roles: verified instruction or general rule, per role. Persisted in `prerequisites`. */
  prerequisites: PlacementConstraint[];
  sequencingRules: Array<{ rule: string; detail: string; status: 'RULE_DERIVED'; requiresReview: boolean; basis: string }>;
  cautions: Array<{ kind: string; text: string; status: FieldState; source: string | null; uncertainty: string }>;
  suitability: {
    skinTypes: Valued<string[]>; hairTypes: Valued<string[]>;
    /** What the manufacturer says the product addresses. Claims, not proven efficacy; treatment wording is flagged and never published as a product claim. */
    concerns: Array<{ concern: string; status: 'MANUFACTURER_CLAIM'; medicalClaim: boolean; excerpt: string; source: string | null }>;
    benefits: Array<{ text: string; status: 'MANUFACTURER_CLAIM'; medicalClaim: boolean }>;
  };
  conflicts: Array<{ field: string; reason: string; severity: 'CRITICAL' | 'HIGH' }>;
  fieldStatus: Record<string, FieldState>;
}

const unknown = <T>(value: T, basis = 'NOT_STATED_BY_A_CREDIBLE_SOURCE'): Valued<T> => ({ value, status: 'UNKNOWN', basis });

export function buildRoutineProfile(input: RoutineProfileInput): RoutineProfile {
  const rule = input.productType ? ROLE_BY_TYPE[input.productType] : undefined;
  const conflicts: RoutineProfile['conflicts'] = [];
  const instructionSource = input.instructions?.sourceUrl ?? null;

  // ── Ingredients ──
  const inciText = input.inci.map(item => item.inci);
  const titleConcepts = [...parseIdentityTitle(input.productName).facts.active];
  const claimConcepts = input.claims.flatMap(claim => [...parseIdentityTitle(claim).facts.active]);
  const featuredConcepts = [...new Set([...titleConcepts, ...claimConcepts])];
  const featuredIngredients: RoutineProfile['featuredIngredients'] = featuredConcepts.map(concept => {
    const pattern = FEATURED[concept];
    const hit = pattern ? inciText.find(inci => pattern.test(inci)) ?? null : null;
    if (!input.inci.length) return { concept, inci: null, status: 'UNKNOWN' as FieldState, basis: 'NO_VERIFIED_INCI' };
    if (input.inciConflict) return { concept, inci: hit, status: 'CONFLICT' as FieldState, basis: 'INCI_CONFLICT' };
    return hit ? { concept, inci: hit, status: 'VERIFIED' as FieldState, basis: 'NAMED_AND_PRESENT_IN_VERIFIED_INCI' }
      : { concept, inci: null, status: 'CONFLICT' as FieldState, basis: 'NAMED_BUT_ABSENT_FROM_VERIFIED_INCI' };
  });
  for (const key of input.keyIngredients?.items ?? []) {
    featuredIngredients.push({ concept: key.name, inci: null, status: 'VERIFIED', basis: 'STATED_BY_MANUFACTURER_AS_KEY_INGREDIENT', function: key.function, kind: 'MANUFACTURER_KEY_INGREDIENT' });
  }
  for (const item of featuredIngredients) if (item.basis === 'NAMED_BUT_ABSENT_FROM_VERIFIED_INCI') conflicts.push({ field: 'composition.featured', reason: `The product names ${item.concept} but the verified INCI does not list it`, severity: 'HIGH' });
  const featuredInci = new Set(featuredIngredients.map(item => item.inci).filter(Boolean));
  const activeIngredients: RoutineProfile['activeIngredients'] = [];
  for (const item of input.inci) {
    const family = ACTIVE_FAMILIES.find(f => f.pattern.test(item.inci));
    if (!family) continue;
    activeIngredients.push({ inci: item.inci, family: family.family, function: item.function, featured: featuredInci.has(item.inci),
      concentration: item.concentrationStatus === 'VERIFIED' || item.concentrationStatus === 'STATED' ? item.concentration : null,
      concentrationStatus: (item.concentrationStatus === 'VERIFIED' || item.concentrationStatus === 'STATED') && item.concentration ? 'VERIFIED' : 'UNKNOWN',
      status: input.inciConflict ? 'CONFLICT' : 'VERIFIED' });
  }
  // An active counts as the product's treatment only when the product features it or states its strength; a trace in the INCI is not a treatment claim.
  const treatmentActives = activeIngredients.filter(active => active.featured || active.concentrationStatus === 'VERIFIED');

  // ── Usage (verified only) ──
  const regularReviewed = input.reviewedUsageRules[0];

  // Only sentences that instruct count: a description stored as "usage" by an older rule never yields a rinse mode, period or frequency.
  const verifiedLines = (input.instructions?.lines ?? []).filter(line => instructionSentences(line).length > 0);
  const parsedRules = verifiedLines.length === (input.instructions?.lines ?? []).length ? input.parsedUsageRules : [];
  const regularParsed = parsedRules.find(r => r.condition === null) ?? parsedRules[0];
  const textMode = verifiedLines.length ? rinseMode(verifiedLines) : 'UNKNOWN';
  let rinse: RoutineProfile['rinseMode'] = unknown('UNKNOWN' as const);
  if (input.instructionsConflict || textMode === 'CONTRADICTORY') {
    rinse = { value: 'UNKNOWN', status: 'CONFLICT', basis: input.instructionsConflict ? 'SOURCES_DISAGREE_ON_INSTRUCTIONS' : 'INSTRUCTIONS_STATE_BOTH_RINSE_AND_LEAVE_ON', source: instructionSource };
    conflicts.push({ field: 'usage.rinseMode', reason: rinse.basis, severity: 'CRITICAL' });
  } else if (textMode === 'RINSE_OFF' || textMode === 'LEAVE_ON') {
    rinse = { value: textMode, status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS', source: instructionSource, excerpt: verifiedLines.join(' ').slice(0, 240) };
  }
  if (rule?.expectedRinse && rinse.status === 'VERIFIED' && rinse.value !== rule.expectedRinse) {
    conflicts.push({ field: 'routine.role', reason: `The instructions say ${rinse.value} but a ${input.productType} is ${rule.expectedRinse} by type`, severity: 'CRITICAL' });
  }

  const periodFrom = (value: string | undefined) => (value === 'AM' || value === 'PM' || value === 'BOTH' ? value : null);
  const reviewedPeriod = periodFrom(regularReviewed?.routinePeriod);
  const parsedPeriod = periodFrom(regularParsed?.routinePeriod);
  const routinePeriod: RoutineProfile['routinePeriod'] = input.instructionsConflict ? { value: 'UNKNOWN', status: 'CONFLICT', basis: 'SOURCES_DISAGREE_ON_INSTRUCTIONS' }
    : reviewedPeriod ? { value: reviewedPeriod, status: 'VERIFIED', basis: 'REVIEWED_USAGE_RULE', source: regularReviewed.sourceUrl, excerpt: regularReviewed.evidenceText }
    : parsedPeriod && verifiedLines.length ? { value: parsedPeriod, status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS', source: instructionSource, excerpt: regularParsed!.evidenceText }
    : unknown('UNKNOWN' as const);

  const cadenceOf = (r: { frequencyUnit: string; usesMin: number | null; usesMax: number | null } | undefined) =>
    r && (r.frequencyUnit === 'DAY' || r.frequencyUnit === 'WEEK' || r.frequencyUnit === 'AS_NEEDED') ? { unit: r.frequencyUnit as 'DAY' | 'WEEK' | 'AS_NEEDED', min: r.usesMin, max: r.usesMax } : null;
  const reviewedCadence = cadenceOf(regularReviewed);
  const parsedCadence = verifiedLines.length ? cadenceOf(regularParsed) : null;
  const cadence: RoutineProfile['cadence'] = input.instructionsConflict ? { value: { unit: 'UNKNOWN', min: null, max: null }, status: 'CONFLICT', basis: 'SOURCES_DISAGREE_ON_INSTRUCTIONS' }
    : reviewedCadence ? { value: reviewedCadence, status: 'VERIFIED', basis: 'REVIEWED_USAGE_RULE', source: regularReviewed.sourceUrl, excerpt: regularReviewed.evidenceText }
    : parsedCadence ? { value: parsedCadence, status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS', source: instructionSource, excerpt: regularParsed!.evidenceText }
    : unknown({ unit: 'UNKNOWN' as const, min: null, max: null });
  const contact = regularReviewed?.contactMinutes ?? (verifiedLines.length ? regularParsed?.contactMinutes ?? null : null);
  const contactMinutes: RoutineProfile['contactMinutes'] = contact !== null && contact !== undefined && !input.instructionsConflict
    ? { value: contact, status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS', source: instructionSource } : unknown(null);

  // ── Role, order and sequencing (rule-derived) ──
  const roleConflict = conflicts.some(c => c.field === 'routine.role');
  const primaryRole: RoutineProfile['primaryRole'] = !rule ? unknown(null, input.productType ? 'NO_ROUTINE_ROLE_FOR_TYPE' : 'PRODUCT_TYPE_UNKNOWN')
    : { value: rule.role, status: roleConflict ? 'CONFLICT' : 'RULE_DERIVED', basis: `PRODUCT_TYPE:${input.productType}` };
  const secondaryRoles: RoutineProfile['secondaryRoles'] = [];
  if (rule && rule.expectedRinse === 'LEAVE_ON' && rule.role !== 'TREATMENT' && rule.domain === 'SKIN') {
    for (const active of treatmentActives) if (!secondaryRoles.some(r => r.role === 'TREATMENT')) {
      secondaryRoles.push({ role: 'TREATMENT', status: 'RULE_DERIVED', basis: `${active.featured ? 'FEATURED' : 'STATED_STRENGTH'}_ACTIVE:${active.family}` });
    }
  }
  if (rule?.role === 'MOISTURIZER' && input.verifiedSpf) secondaryRoles.push({ role: 'SUNSCREEN', status: 'RULE_DERIVED', basis: `VERIFIED_SPF:${input.verifiedSpf}` });
  if (rule?.role === 'MAKEUP_REMOVER') secondaryRoles.push({ role: 'CLEANSER', status: 'RULE_DERIVED', basis: 'MAKEUP_REMOVER_IS_A_FIRST_CLEANSE' });
  // A default rank inside the domain, used only to break ties between steps no constraint relates. Placement constraints decide the order.
  const stepOrder: RoutineProfile['stepOrder'] = rule ? { value: rule.order, status: 'RULE_DERIVED', basis: `DEFAULT_${rule.domain}_RANK_CONSTRAINTS_WIN` } : unknown(null, 'NO_ROUTINE_ROLE');

  const nightActive = treatmentActives.find(active => ACTIVE_FAMILIES.find(f => f.family === active.family)?.nightPreferred);
  const periodEligibility: RoutineProfile['periodEligibility'] = rule?.periodEligibility ? { value: rule.periodEligibility, status: 'RULE_DERIVED', basis: `ROLE:${rule.role}` }
    : nightActive ? { value: 'PM', status: 'RULE_DERIVED', basis: `INGREDIENT_CLASS:${nightActive.family}` } : { value: null, status: 'RULE_DERIVED', basis: 'NO_RULE_RESTRICTS_TIME_OF_DAY' };
  if (routinePeriod.status === 'VERIFIED' && periodEligibility.value && routinePeriod.value !== 'BOTH' && routinePeriod.value !== periodEligibility.value) {
    conflicts.push({ field: 'usage.routinePeriod', reason: `The manufacturer says ${routinePeriod.value}; the routine rule for this product says ${periodEligibility.value}. The manufacturer's instruction stands; the rule is guidance`, severity: 'HIGH' });
  }

  // Placement: what the manufacturer's instructions state, then the general rules for this role and rinse mode for every role they leave open.
  const stated: PlacementConstraint[] = [];
  if (!input.instructionsConflict) for (const line of verifiedLines) for (const sentence of instructionSentences(line)) for (const phrase of STATED_PLACEMENT) {
    if (rule && phrase.role === rule.role) continue;
    if (phrase.pattern.test(sentence) && !stated.some(c => c.role === phrase.role)) stated.push({ relation: phrase.relation, role: phrase.role, status: 'VERIFIED', basis: 'MANUFACTURER_INSTRUCTIONS', excerpt: sentence.slice(0, 200) });
  }
  const knownRinse: Rinse | null = rinse.status === 'VERIFIED' && rinse.value !== 'UNKNOWN' ? rinse.value : rule?.expectedRinse ?? null;
  const exfoliating = activeIngredients.some(active => ACTIVE_FAMILIES.find(f => f.family === active.family)?.exfoliating);
  const general = rule ? rulePlacement(rule.role, knownRinse, exfoliating) : [];
  const prerequisites: RoutineProfile['prerequisites'] = [...stated, ...general.filter(c => !stated.some(s => s.role === c.role))];
  const sequencingRules: RoutineProfile['sequencingRules'] = [];
  if (rule?.role === 'SUNSCREEN') sequencingRules.push({ rule: 'LAST_MORNING_STEP', detail: 'Sunscreen is the last step of a morning routine', status: 'RULE_DERIVED', requiresReview: false, basis: 'ROLE:SUNSCREEN' });
  const families = new Set(treatmentActives.map(active => active.family));
  if (families.has('RETINOID') && (families.has('AHA') || families.has('BHA') || families.has('BENZOYL_PEROXIDE'))) {
    sequencingRules.push({ rule: 'COMBINED_ACTIVES', detail: 'Retinoid with an exfoliating acid or benzoyl peroxide in one product: introduce gradually (general ingredient-class guidance)', status: 'RULE_DERIVED', requiresReview: true, basis: 'INGREDIENT_CLASS' });
  }
  for (const family of families) if (family === 'RETINOID' || family === 'AHA' || family === 'BHA' || family === 'BENZOYL_PEROXIDE') {
    sequencingRules.push({ rule: 'AVOID_LAYERING_WITH', detail: `${family}: avoid layering with other retinoid / exfoliating-acid / benzoyl peroxide steps in the same routine (general ingredient-class guidance)`, status: 'RULE_DERIVED', requiresReview: true, basis: `INGREDIENT_CLASS:${family}` });
  }

  // ── Cautions ──
  const cautions: RoutineProfile['cautions'] = input.warnings.map(warning => ({
    kind: /patch test/i.test(warning.text) ? 'PATCH_TEST' : /pregnan|breast[- ]?feeding|children|under \d+ years|broken|damaged skin|wounds|irritated skin/i.test(warning.text) ? 'CONTRAINDICATION' : /eyes?\b/i.test(warning.text) ? 'AVOID_EYE_CONTACT' : 'MANUFACTURER_WARNING',
    text: warning.text, status: 'VERIFIED' as FieldState, source: warning.sourceUrl, uncertainty: 'AS_STATED_BY_SOURCE',
  }));
  const photo = treatmentActives.find(active => ACTIVE_FAMILIES.find(f => f.family === active.family)?.photosensitizing);
  if (photo) cautions.push({ kind: 'SUN_SENSITIVITY_GUIDANCE', text: `${photo.family} can make skin more sensitive to the sun; daytime sun protection is general guidance, not a manufacturer statement for this product`,
    status: 'RULE_DERIVED', source: null, uncertainty: 'INGREDIENT_CLASS_GENERAL_GUIDANCE' });

  // ── Area and suitability ──
  const targetArea: RoutineProfile['targetArea'] = input.verifiedTargetArea ? { value: input.verifiedTargetArea, status: 'VERIFIED', basis: 'VERIFIED_FACT' }
    : rule ? { value: rule.area, status: 'RULE_DERIVED', basis: `PRODUCT_TYPE:${input.productType}` } : unknown(null);
  const suitability: RoutineProfile['suitability'] = {
    concerns: [], benefits: [],
    skinTypes: input.skinTypes.verified && input.skinTypes.values.length ? { value: input.skinTypes.values, status: 'VERIFIED' as FieldState, basis: 'VERIFIED_FACT' } : unknown([] as string[]),
    hairTypes: input.hairTypes.verified && input.hairTypes.values.length ? { value: input.hairTypes.values, status: 'VERIFIED' as FieldState, basis: 'VERIFIED_FACT' } : unknown([] as string[]),
  };
  const claimTexts = input.claims.filter(text => text.length <= 400);
  const concernsFound = new Map<string, RoutineProfile['suitability']['concerns'][number]>();
  for (const text of claimTexts) for (const [concern, pattern] of CONCERNS) {
    if (!concernsFound.has(concern) && pattern.test(text)) concernsFound.set(concern, { concern, status: 'MANUFACTURER_CLAIM', medicalClaim: hasMedicalClaim(text), excerpt: text.slice(0, 200), source: input.claimsSource ?? null });
  }
  suitability.concerns = [...concernsFound.values()];
  suitability.benefits = [...new Set(claimTexts)].slice(0, 12).map(text => ({ text, status: 'MANUFACTURER_CLAIM' as const, medicalClaim: hasMedicalClaim(text) }));
  for (const field of input.conflictFields) if (!conflicts.some(c => c.field === field)) {
    conflicts.push({ field, reason: 'Trusted sources disagree', severity: ['identity.size', 'identity.gtin', 'composition.inci', 'composition.activeConcentrations', 'usage.instructions', 'safety.warnings'].includes(field) ? 'CRITICAL' : 'HIGH' });
  }

  const fieldStatus: Record<string, FieldState> = {
    primaryRole: primaryRole.status, stepOrder: stepOrder.status, routinePeriod: routinePeriod.status, periodEligibility: periodEligibility.status, cadence: cadence.status,
    rinseMode: rinse.status, contactMinutes: contactMinutes.status, targetArea: targetArea.status,
    instructions: input.instructionsConflict ? 'CONFLICT' : verifiedLines.length ? 'VERIFIED' : 'UNKNOWN',
    inci: input.inciConflict ? 'CONFLICT' : input.inci.length ? 'VERIFIED' : 'UNKNOWN',
    activeConcentrations: activeIngredients.some(a => a.concentrationStatus === 'VERIFIED') ? 'VERIFIED' : 'UNKNOWN',
    warnings: input.warnings.length ? 'VERIFIED' : 'UNKNOWN', skinTypes: suitability.skinTypes.status, hairTypes: suitability.hairTypes.status,
    placement: prerequisites.some(c => c.status === 'VERIFIED') ? 'VERIFIED' : prerequisites.length ? 'RULE_DERIVED' : 'UNKNOWN',
    keyIngredients: input.keyIngredients?.items.length ? 'VERIFIED' : 'UNKNOWN',
    concerns: suitability.concerns.length ? 'VERIFIED' : 'UNKNOWN',
  };
  const inciCompleteness: RoutineProfile['inciCompleteness'] = !input.inci.length ? 'NONE' : /^(aqua|water|eau)\b/i.test(input.inci[0].inci) ? 'FULL_FORMULA' : 'AS_STATED_POSSIBLY_PARTIAL';
  return { ruleVersion: ROUTINE_RULE_VERSION, productType: input.productType, routineDomain: rule?.domain ?? null, primaryRole, secondaryRoles, stepOrder, routinePeriod, periodEligibility,
    cadence, rinseMode: rinse, expectedRinseMode: rule?.expectedRinse ?? null, contactMinutes, targetArea, activeIngredients, featuredIngredients, inciCompleteness, prerequisites, sequencingRules,
    cautions, suitability, conflicts, fieldStatus };
}

export interface RoutineStepInput {
  id: string; role: RoutineRole | null; domain: 'SKIN' | 'HAIR' | 'BODY' | null; rank: number | null; constraints: PlacementConstraint[];
  /** Manufacturer-stated period (VERIFIED) and the system's time-of-day rule; either may exclude the step from a morning or evening routine. */
  routinePeriod?: { value: string; status: string }; periodEligibility?: string | null;
}
export interface OrderedRoutine<T> {
  steps: T[];
  excluded: Array<{ step: T; reason: string }>;
  /** Placements nobody states (e.g. hair mask vs conditioner), alternatives (one step replaces another) and contradictions between constraints. */
  notes: Array<{ kind: 'UNDETERMINED' | 'ALTERNATIVES' | 'CONSTRAINT_CYCLE'; roles: RoutineRole[]; detail: string }>;
}

/**
 * Orders the steps of one routine by their placement constraints (verified before rule-derived), breaking ties by the default rank. For a period, steps whose
 * verified period or time-of-day rule excludes them are left out with the reason. A constraint about a role not in the routine has no effect.
 */
export function orderRoutine<T extends RoutineStepInput>(input: T[], period?: 'AM' | 'PM'): OrderedRoutine<T> {
  const excluded: OrderedRoutine<T>['excluded'] = [];
  const notes: OrderedRoutine<T>['notes'] = [];
  const steps = input.filter(step => {
    if (!step.role) { excluded.push({ step, reason: 'NO_ROUTINE_ROLE' }); return false; }
    if (period && step.routinePeriod?.status === 'VERIFIED' && step.routinePeriod.value !== 'BOTH' && step.routinePeriod.value !== period) { excluded.push({ step, reason: `MANUFACTURER_SAYS_${step.routinePeriod.value}` }); return false; }
    if (period && step.periodEligibility && step.periodEligibility !== 'BOTH' && step.periodEligibility !== period) { excluded.push({ step, reason: `RULE_${step.periodEligibility}_ONLY` }); return false; }
    return true;
  });
  const byRole = (role: RoutineRole) => steps.filter(step => step.role === role);
  const edges = new Map<string, Set<string>>(steps.map(step => [step.id, new Set<string>()]));
  const edge = (from: T, to: T) => { if (from.id !== to.id && from.domain === to.domain) edges.get(from.id)!.add(to.id); };
  for (const step of steps) {
    const verifiedRoles = new Set(step.constraints.filter(c => c.status === 'VERIFIED').map(c => c.role));
    for (const c of step.constraints) {
      if (c.status !== 'VERIFIED' && verifiedRoles.has(c.role)) continue;
      const others = byRole(c.role);
      if (!others.length) continue;
      if (c.relation === 'AFTER') others.forEach(other => edge(other, step));
      else if (c.relation === 'BEFORE') others.forEach(other => edge(step, other));
      else if (c.relation === 'REPLACES') notes.push({ kind: 'ALTERNATIVES', roles: [step.role!, c.role], detail: `${step.role} replaces ${c.role} (${c.status}); a routine uses one of them per session` });
      else notes.push({ kind: 'UNDETERMINED', roles: [step.role!, c.role], detail: `Order of ${step.role} and ${c.role} is not stated (${c.basis}); default rank used` });
    }
  }
  const indegree = new Map(steps.map(step => [step.id, 0]));
  for (const targets of edges.values()) for (const target of targets) indegree.set(target, indegree.get(target)! + 1);
  const domainOrder = { SKIN: 0, HAIR: 1, BODY: 2 } as Record<string, number>;
  const key = (step: T) => [domainOrder[step.domain ?? 'SKIN'] ?? 3, step.rank ?? 99, step.id] as const;
  const compare = (a: T, b: T) => { const [x, y] = [key(a), key(b)]; return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); };
  const ready = steps.filter(step => indegree.get(step.id) === 0).sort(compare);
  const ordered: T[] = [];
  while (ready.length) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const target of edges.get(next.id)!) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) { ready.push(steps.find(step => step.id === target)!); ready.sort(compare); }
    }
  }
  const stuck = steps.filter(step => !ordered.includes(step));
  if (stuck.length) {
    notes.push({ kind: 'CONSTRAINT_CYCLE', roles: stuck.map(step => step.role!), detail: 'Constraints contradict each other; these steps keep their default rank' });
    ordered.push(...stuck.sort(compare));
  }
  return { steps: ordered, excluded, notes };
}
