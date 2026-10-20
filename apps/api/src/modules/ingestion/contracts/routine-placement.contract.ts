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
  compatibleConcerns: string[];
  warnings: string[];
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
