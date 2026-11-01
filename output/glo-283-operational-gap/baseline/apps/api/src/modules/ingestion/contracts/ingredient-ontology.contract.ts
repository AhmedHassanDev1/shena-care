export enum EvidenceLevel {
  STRONG_CLINICAL = 'STRONG_CLINICAL',
  MODERATE_EVIDENCE = 'MODERATE_EVIDENCE',
  EMERGING_DATA = 'EMERGING_DATA',
  THEORETICAL = 'THEORETICAL',
}

export enum VisualStatus {
  NOT_GENERATED = 'NOT_GENERATED',
  GENERATED_EDUCATIONAL = 'GENERATED_EDUCATIONAL',
  LICENSED_PHOTO = 'LICENSED_PHOTO',
  AWAITING_MEDIA = 'AWAITING_MEDIA',
}

export interface IngredientBenefit {
  concern: string; // e.g. "hyperpigmentation", "acne", "barrier_repair", "anti_aging", "redness", "hydration", "pores"
  description: string;
  evidenceLevel: EvidenceLevel;
  pubmedRef?: string;
}

export interface CanonicalIngredientData {
  id?: string;
  name: string;
  nameAr?: string;
  slug: string;
  inciName: string;
  aliases: string[];
  family?: string;
  familySlug?: string;
  chemicalForm?: string;
  primaryFunction: string;
  functions: string[];
  isActiveIngredient: boolean;
  rating?: 'BEST' | 'GOOD' | 'AVERAGE';
  descriptionEn?: string;
  descriptionAr?: string;
  benefits?: IngredientBenefit[];
  cautions?: string[];
  contraindications?: string[];
  visualStatus?: string;
  visualUrl?: string;
}

export interface ParsedInciIngredient {
  rawTerm: string;
  cleanedInci: string;
  canonicalIngredientId?: string;
  canonicalName?: string;
  family?: string;
  familySlug?: string;
  chemicalForm?: string;
  isActive: boolean;
  isExcipient: boolean;
  concentration?: string;
  confidence: number;
}

export interface ClaimValidationRequest {
  claimText: string;
  productIngredients: {
    ingredientName: string;
    inciName?: string;
    concentration?: string;
  }[];
  hasFinishedProductClinicalEvidence?: boolean;
}

export interface ClaimValidationResult {
  isValid: boolean;
  claimType: 'INGREDIENT_MECHANISM' | 'FINISHED_PRODUCT_CLAIM';
  allowed: boolean;
  reason?: string;
  substantiatedActives: string[];
  requiresClinicalTrialEvidence?: boolean;
}

export interface CandidateIngredientEnrichment {
  actives: {
    id: string;
    name: string;
    nameAr?: string;
    inciName: string;
    family?: string;
    chemicalForm?: string;
    concentration?: string;
    primaryFunction: string;
    benefits: IngredientBenefit[];
    cautions: string[];
  }[];
  excipients: {
    term: string;
    primaryFunction: string;
  }[];
  cautions: string[];
  contraindications: string[];
  benefitsByConcern: Record<string, string[]>;
  unmatchedTerms: string[];
  unknownFacts: string[];
}
