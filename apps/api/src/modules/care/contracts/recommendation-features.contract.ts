import {
  ConcentrationStatus,
  ProductTexture,
  SafetyWarningKind,
  UsageFrequencyUnit,
  UsageRinseMode,
  UsageRoutinePeriod,
  UsageTargetArea,
  UvFilterType,
} from '../../catalog/public';
import type { RoutineProductFacts, RoutineActiveFact } from '../../catalog/public';
import type { EngineContext, SafetyAnswers, Tier, AgeBand } from '../engine/routine-engine';

/**
 * GLO-284 Priority C: Typed Feature Representation for the Recommendation Engine (GLO-287).
 * Pure, deterministic, evidence-backed domain features extracted directly from reviewed schema facts.
 * Avoids duplicate sources of truth or permanently stored stale feature vectors.
 */

export interface FeatureActivesFact {
  ingredientId: string;
  ingredientSlug: string;
  familySlug: string | null;
  /** Explicit typed concentration percentage or value; null if unstated. Never inferred. */
  concentrationValue: number | null;
  concentrationUnit: string | null;
  concentrationStatus: ConcentrationStatus;
  concentrationVerified: boolean;
  reviewedAt: string | null;
}

export interface FeatureSafetyWarning {
  id: string;
  kind: SafetyWarningKind;
  condition: string | null;
  skuId: string | null;
  descriptionEn: string;
}

export interface FeatureUsageRule {
  skuId: string | null;
  targetArea: string | null;
  routinePeriod: UsageRoutinePeriod;
  rinseMode: UsageRinseMode;
  frequencyUnit: UsageFrequencyUnit;
  usesMin: number | null;
  usesMax: number | null;
  applicationQuantity: number | null;
  applicationUnit: string | null;
  isIntroductory: boolean;
  phaseOrder: number | null;
  condition: string | null;
}

export interface RecommendationProductFeatures {
  productId: string;
  skuId: string | null;
  name: string;
  brandName: string;
  formulaIdentity: {
    factVersion: number;
    lastReviewedAt: string | null;
  };
  photoprotection: {
    spf: number | null;
    broadSpectrum: boolean | null;
    uvFilterType: UvFilterType | null;
    waterResistanceMinutes: number | null;
  };
  galenic: {
    texture: ProductTexture | null;
    targetArea: UsageTargetArea | null;
    suitableSkinTypes: string[];
    suitableHairTypes: string[];
  };
  claims: {
    /** Tri-state: true = verified free, false = contains fragrance, null = unverified. Never silently converted to false. */
    isFragranceFree: boolean | null;
    /** Tri-state: true = verified non-comedogenic, false = comedogenic, null = unverified. */
    isNonComedogenic: boolean | null;
    claimsEvidence: Record<string, unknown> | null;
  };
  actives: FeatureActivesFact[];
  ingredientIds: string[];
  ingredientSlugs: string[];
  ingredientFamilies: string[];
  safetyWarnings: FeatureSafetyWarning[];
  usageRules: FeatureUsageRule[];
  commerce: {
    isSellable: boolean;
    price: number | null;
    currency: string;
    estimatedDaysOfUse: number | null;
  };
}

export interface RecommendationCustomerFeatures {
  customerId: string;
  careProfileId: string;
  primaryConcern: string;
  severity: number | null;
  dermatologicalProfile: {
    skinType: string | null;
    hairType: string | null;
    ageBand: AgeBand | null;
    experienceLevel: 'BEGINNER' | 'EXPERIENCED' | null;
  };
  constraints: {
    hardSafety: SafetyAnswers;
    allergyIngredientIds: string[];
    fragranceFreePreference: boolean | null;
  };
  budget: {
    maxBudget: number | null;
    targetTier: Tier | null;
  };
}

/**
 * Extracts deterministic, typed mathematical features from catalog facts for a specific SKU.
 * Scopes safety warnings and usage rules to the selected SKU (or product-wide rules if un-scoped).
 */
export function extractProductFeatures(
  facts: RoutineProductFacts,
  selectedSkuId?: string | null,
  offer?: { price: number | null; currency: string; sellable: boolean },
): RecommendationProductFeatures {
  const targetSkuId = selectedSkuId ?? facts.skus[0]?.id ?? null;
  const skuInfo = facts.skus.find(s => s.id === targetSkuId);

  // Scoped safety warnings: warning applies if product-wide (skuId == null) or matching target SKU
  const scopedWarnings = (facts.safetyWarnings ?? []).filter(
    w => !w.skuId || w.skuId === targetSkuId,
  );

  // Scoped usage rules: rule applies if product-wide or matching target SKU
  const scopedRules = (facts.usageRules ?? []).filter(
    r => !r.skuId || r.skuId === targetSkuId,
  );

  return {
    productId: facts.productId,
    skuId: targetSkuId,
    name: facts.name,
    brandName: facts.brandName,
    formulaIdentity: {
      factVersion: facts.factVersion ?? 1,
      lastReviewedAt: facts.lastReviewedAt ?? null,
    },
    photoprotection: {
      spf: facts.spf ?? null,
      broadSpectrum: facts.broadSpectrum ?? null,
      uvFilterType: (facts.uvFilterType as UvFilterType) ?? null,
      waterResistanceMinutes: facts.waterResistanceMinutes ?? null,
    },
    galenic: {
      texture: (facts.texture as ProductTexture) ?? null,
      targetArea: (facts.targetArea as UsageTargetArea) ?? null,
      suitableSkinTypes: facts.suitableSkinTypes ?? [],
      suitableHairTypes: facts.suitableHairTypes ?? [],
    },
    claims: {
      isFragranceFree: facts.isFragranceFree ?? null,
      isNonComedogenic: facts.isNonComedogenic ?? null,
      claimsEvidence: facts.claimsEvidence ?? null,
    },
    actives: facts.actives.map((a: RoutineActiveFact) => ({
      ingredientId: a.ingredientId,
      ingredientSlug: a.ingredientSlug,
      familySlug: a.familySlug,
      concentrationValue: a.concentrationValue,
      concentrationUnit: a.concentrationUnit,
      concentrationStatus: a.concentrationValue !== null ? ConcentrationStatus.STATED : ConcentrationStatus.UNKNOWN,
      concentrationVerified: a.concentrationVerified,
      reviewedAt: a.concentrationReviewedAt,
    })),
    ingredientIds: facts.ingredientIds,
    ingredientSlugs: facts.ingredientSlugs,
    ingredientFamilies: facts.ingredientFamilies,
    safetyWarnings: scopedWarnings.map(w => ({
      id: w.id,
      kind: w.kind as SafetyWarningKind,
      condition: w.condition,
      skuId: w.skuId ?? null,
      descriptionEn: w.descriptionEn,
    })),
    usageRules: scopedRules.map(r => ({
      skuId: r.skuId,
      targetArea: r.targetArea,
      routinePeriod: r.routinePeriod as UsageRoutinePeriod,
      rinseMode: r.rinseMode as UsageRinseMode,
      frequencyUnit: r.frequencyUnit as UsageFrequencyUnit,
      usesMin: r.usesMin,
      usesMax: r.usesMax,
      applicationQuantity: r.applicationQuantity,
      applicationUnit: r.applicationUnit,
      isIntroductory: r.isIntroductory,
      phaseOrder: r.phaseOrder,
      condition: r.condition,
    })),
    commerce: {
      isSellable: offer ? offer.sellable : (skuInfo?.isActive ?? false),
      price: offer ? offer.price : null,
      currency: offer ? offer.currency : 'EGP',
      estimatedDaysOfUse: skuInfo?.estimatedDaysOfUse ?? null,
    },
  };
}

/**
 * Extracts structured customer constraint features from customer care context.
 */
export function extractCustomerFeatures(
  customerId: string,
  careProfileId: string,
  primaryConcern: string,
  ctx: EngineContext,
): RecommendationCustomerFeatures {
  return {
    customerId,
    careProfileId,
    primaryConcern,
    severity: ctx.severity,
    dermatologicalProfile: {
      skinType: ctx.skinType,
      hairType: null,
      ageBand: ctx.ageBand,
      experienceLevel: ctx.experienceLevel,
    },
    constraints: {
      hardSafety: ctx.safety,
      allergyIngredientIds: ctx.allergyIngredientIds,
      fragranceFreePreference: ctx.fragranceFree,
    },
    budget: {
      maxBudget: ctx.budget,
      targetTier: ctx.tier,
    },
  };
}
