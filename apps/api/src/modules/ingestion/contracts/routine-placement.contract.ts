export enum RoutineCategory {
  SKIN_CARE = 'SKIN_CARE',
  HAIR_CARE = 'HAIR_CARE',
  BODY_CARE = 'BODY_CARE',
}

export enum RoutineStepType {
  // Skincare steps
  CLEANSER = 'CLEANSER',
  TONER = 'TONER',
  EXFOLIANT = 'EXFOLIANT',
  TREATMENT_SERUM = 'TREATMENT_SERUM',
  EYE_CARE = 'EYE_CARE',
  MOISTURIZER = 'MOISTURIZER',
  SUNSCREEN = 'SUNSCREEN',
  FACE_OIL = 'FACE_OIL',

  // Haircare steps
  HAIR_SHAMPOO = 'HAIR_SHAMPOO',
  HAIR_CONDITIONER = 'HAIR_CONDITIONER',
  HAIR_MASK = 'HAIR_MASK',
  HAIR_LEAVE_IN = 'HAIR_LEAVE_IN',
  SCALP_TREATMENT = 'SCALP_TREATMENT',
}

export enum RoutineTiming {
  AM_ONLY = 'AM_ONLY',
  PM_ONLY = 'PM_ONLY',
  AM_PM = 'AM_PM',
  AS_NEEDED = 'AS_NEEDED',
  /** The product's own directions do not say (GLO-279: never defaulted). */
  UNKNOWN = 'UNKNOWN',
}

export enum ApplicationSite {
  FACE = 'FACE',
  EYE_CONTOUR = 'EYE_CONTOUR',
  LIPS = 'LIPS',
  BODY = 'BODY',
  SCALP = 'SCALP',
  HAIR_LENGTHS = 'HAIR_LENGTHS',
}

export enum RinseType {
  RINSE_OFF = 'RINSE_OFF',
  LEAVE_ON = 'LEAVE_ON',
  /** The product's own directions do not say. */
  UNKNOWN = 'UNKNOWN',
}

/**
 * One product-specific usage instruction, parsed from the product's own directions with its evidence sentence
 * (GLO-279 UsageRuleSet). A product may carry several conditional rules (face vs scalp, introductory vs regular).
 * Every field the text does not state is null/UNKNOWN — never filled from the product type.
 */
export interface UsageRule {
  targetArea: 'FACE' | 'EYE_CONTOUR' | 'LIPS' | 'BODY' | 'SCALP' | 'HAIR' | null;
  routinePeriod: 'AM' | 'PM' | 'BOTH' | 'UNKNOWN';
  rinseMode: 'RINSE_OFF' | 'LEAVE_ON' | 'UNKNOWN';
  frequencyUnit: 'DAY' | 'WEEK' | 'AS_NEEDED' | 'UNKNOWN';
  usesMin: number | null;
  usesMax: number | null;
  /** Contact time stated by the manufacturer (minutes); `contactIsMaximum` when worded as a limit ("no more than 10"). */
  contactMinutes: number | null;
  contactIsMaximum: boolean;
  condition: 'INTRODUCTORY' | null;
  evidenceText: string;
}

/** Ingredient-class guidance (e.g. retinoids and sun sensitivity): not a product claim; needs editorial review. */
export interface GenericGuidance {
  text: string;
  basis: 'INGREDIENT_CLASS';
  requiresReview: true;
}

export enum UsageFrequency {
  DAILY = 'DAILY',
  TWICE_DAILY = 'TWICE_DAILY',
  WEEKLY_1_2_TIMES = 'WEEKLY_1_2_TIMES',
  AS_NEEDED = 'AS_NEEDED',
  UNCLEAR_HELD = 'UNCLEAR_HELD',
}

export interface RoutinePlacementResult {
  category: RoutineCategory;
  stepOrder: number; // 1-7 for skin, 1-5 for hair
  stepType: RoutineStepType;
  timing: RoutineTiming;
  siteOfUse: ApplicationSite;
  rinseType: RinseType;
  frequency: UsageFrequency;
  frequencyStatus: 'CONFIRMED' | 'HELD_FOR_REVIEW';
  isPhotosensitizing: boolean;
  requiresDaytimeSunscreen: boolean;
  reasoning: string;
  /** stepType/stepOrder/siteOfUse are a role proposal from name and category, not usage evidence. */
  roleSource: 'NAME_AND_CATEGORY_HEURISTIC';
  /** Typed, evidence-linked usage rules from the product's own directions (empty when none were supplied). */
  usageRules: UsageRule[];
  compatibleConcerns: string[];
  /** Product-specific warnings taken from the product's own directions only. */
  warnings: string[];
  genericGuidance: GenericGuidance[];
  evidenceSummary: {
    sourceType?: string;
    sourceUrl?: string;
    extractedUsageText?: string;
    contradictionsFound: boolean;
  };
}

export interface SourceContradiction {
  field: string;
  officialValue: unknown;
  distributorValue: unknown;
  winningSource: 'OFFICIAL_MANUFACTURER' | 'TRUSTED_DISTRIBUTOR';
  reason: string;
}
