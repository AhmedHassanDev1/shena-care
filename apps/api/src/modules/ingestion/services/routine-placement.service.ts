import { Injectable, Logger } from '@nestjs/common';
import {
  ApplicationSite,
  RinseType,
  RoutineCategory,
  RoutinePlacementResult,
  RoutineStepType,
  RoutineTiming,
  UsageFrequency,
} from '../contracts/routine-placement.contract';
import { SourceType } from './product-research.service';

export interface DeterminePlacementInput {
  productName: string;
  brand: string;
  category?: string;
  usage?: string[];
  directions?: string;
  ingredients?: string[];
  description?: string;
  sourceUrl?: string;
  sourceType?: SourceType;
  conflictingDistributorUsage?: string;
}

@Injectable()
export class RoutinePlacementService {
  private readonly logger = new Logger(RoutinePlacementService.name);

  /**
   * Deterministically calculates truthful routine step placement, timing, site of use,
   * rinse vs leave-on, and frequency based on official evidence, active formulation, and editorial rules.
   */
  determineRoutinePlacement(input: DeterminePlacementInput): RoutinePlacementResult {
    const nameLower = input.productName.toLowerCase();
    const categoryLower = (input.category || '').toLowerCase();
    const descLower = (input.description || '').toLowerCase();
    const usageText = (input.usage?.join(' ') || input.directions || '').toLowerCase();
    const fullText = `${nameLower} ${categoryLower} ${descLower} ${usageText}`;
    const ingredientsUpper = (input.ingredients || []).map((i) => i.toUpperCase());

    // 1. Determine Category (Skin vs Hair vs Body)
    let category = RoutineCategory.SKIN_CARE;
    if (
      /shampoo|conditioner|scalp|leave-in|hair serum|شامبو|بلسم|عناية بالشعر/i.test(fullText) ||
      (/\bhair\b/i.test(fullText) && /mask|oil|treatment|serum/i.test(fullText)) ||
      input.brand.toLowerCase() === 'olaplex'
    ) {
      category = RoutineCategory.HAIR_CARE;
    } else if (
      /body lotion|body wash|hand cream|foot cream|لوشن للجسم|غسول الجسم|كريم اليدين/i.test(
        fullText,
      ) &&
      !/face|facial|وجه/i.test(nameLower)
    ) {
      category = RoutineCategory.BODY_CARE;
    }

    // 2. Skincare Routine Steps & Types
    let stepType = RoutineStepType.MOISTURIZER;
    let stepOrder = 5;
    let siteOfUse = ApplicationSite.FACE;
    let rinseType = RinseType.LEAVE_ON;
    let timing = RoutineTiming.AM_PM;
    let frequency = UsageFrequency.DAILY;
    let frequencyStatus: 'CONFIRMED' | 'HELD_FOR_REVIEW' = 'CONFIRMED';
    let isPhotosensitizing = false;
    let requiresDaytimeSunscreen = false;
    const compatibleConcerns: string[] = [];
    const warnings: string[] = [];
    let reasoning = '';

    if (category === RoutineCategory.HAIR_CARE) {
      // Haircare hierarchy
      if (/shampoo|cleanser|شامبو/i.test(fullText)) {
        stepType = RoutineStepType.HAIR_SHAMPOO;
        stepOrder = 1;
        siteOfUse = ApplicationSite.SCALP;
        rinseType = RinseType.RINSE_OFF;
        timing = RoutineTiming.AS_NEEDED;
        reasoning = 'Hair shampoo is step 1 cleansing, applied to wet scalp and rinsed off';
      } else if (/conditioner|بلسم/i.test(fullText) && !/leave-in/i.test(fullText)) {
        stepType = RoutineStepType.HAIR_CONDITIONER;
        stepOrder = 2;
        siteOfUse = ApplicationSite.HAIR_LENGTHS;
        rinseType = RinseType.RINSE_OFF;
        timing = RoutineTiming.AS_NEEDED;
        reasoning = 'Rinse-out hair conditioner follows shampoo on lengths and ends';
      } else if (/mask|masque|ماسك/i.test(fullText)) {
        stepType = RoutineStepType.HAIR_MASK;
        stepOrder = 3;
        siteOfUse = ApplicationSite.HAIR_LENGTHS;
        rinseType = RinseType.RINSE_OFF;
        frequency = UsageFrequency.WEEKLY_1_2_TIMES;
        timing = RoutineTiming.AS_NEEDED;
        reasoning = 'Deep conditioning hair mask used 1-2 times weekly for intensive repair';
      } else if (/leave-in|heat protectant|بديل الزيت/i.test(fullText)) {
        stepType = RoutineStepType.HAIR_LEAVE_IN;
        stepOrder = 4;
        siteOfUse = ApplicationSite.HAIR_LENGTHS;
        rinseType = RinseType.LEAVE_ON;
        timing = RoutineTiming.AS_NEEDED;
        reasoning = 'Leave-in treatment applied to damp hair before styling';
      } else {
        stepType = RoutineStepType.SCALP_TREATMENT;
        stepOrder = 5;
        siteOfUse = ApplicationSite.SCALP;
        rinseType = RinseType.LEAVE_ON;
        timing = RoutineTiming.AS_NEEDED;
        reasoning = 'Targeted scalp serum or nourishing oil applied directly to scalp';
      }
    } else {
      // Skincare hierarchy
      if (/cleanser|face wash|cleansing foam|micellar|cleansing balm|غسول|منظف/i.test(fullText)) {
        stepType = RoutineStepType.CLEANSER;
        stepOrder = 1;
        siteOfUse = ApplicationSite.FACE;
        rinseType = /micellar/i.test(fullText) ? RinseType.LEAVE_ON : RinseType.RINSE_OFF;
        timing = RoutineTiming.AM_PM;
        frequency = UsageFrequency.TWICE_DAILY;
        reasoning = 'Facial cleanser is the fundamental step 1 preparation in AM and PM routines';
      } else if (/toner|essence|facial mist|تونر/i.test(fullText)) {
        stepType = RoutineStepType.TONER;
        stepOrder = 2;
        siteOfUse = ApplicationSite.FACE;
        rinseType = RinseType.LEAVE_ON;
        timing = RoutineTiming.AM_PM;
        reasoning = 'Toner/essence balances skin hydration immediately following cleansing (step 2)';
      } else if (
        /peeling solution|chemical peel|exfoliating scrub|exfoliant|resurfacing peel|مقشر/i.test(
          fullText,
        )
      ) {
        stepType = RoutineStepType.EXFOLIANT;
        stepOrder = 2;
        siteOfUse = ApplicationSite.FACE;
        rinseType = /peeling solution|scrub|mask/i.test(fullText)
          ? RinseType.RINSE_OFF
          : RinseType.LEAVE_ON;
        timing = RoutineTiming.PM_ONLY;
        frequency = UsageFrequency.WEEKLY_1_2_TIMES;
        isPhotosensitizing = true;
        requiresDaytimeSunscreen = true;
        compatibleConcerns.push('skin_texture', 'hyperpigmentation', 'pores');
        warnings.push('Increases sun sensitivity; broad-spectrum sunscreen is mandatory during daytime');
        if (rinseType === RinseType.RINSE_OFF) {
          warnings.push('Do not leave on skin for more than 10 minutes; rinse thoroughly with lukewarm water');
        }
        reasoning = 'Direct chemical exfoliant or peeling solution used 1-2 times weekly in the PM routine only';
      } else if (/eye cream|eye serum|eye contour|كريم العين|محيط العين/i.test(fullText)) {
        stepType = RoutineStepType.EYE_CARE;
        stepOrder = 4;
        siteOfUse = ApplicationSite.EYE_CONTOUR;
        rinseType = RinseType.LEAVE_ON;
        timing = RoutineTiming.AM_PM;
        reasoning = 'Specialized orbital bone and eye contour treatment applied before heavy facial moisturizers';
      } else if (/sunscreen|sun cream|uv fluid|sun block|واقي شمس/i.test(fullText) || /\bspf\b/i.test(nameLower)) {
        stepType = RoutineStepType.SUNSCREEN;
        stepOrder = 6;
        siteOfUse = ApplicationSite.FACE;
        rinseType = RinseType.LEAVE_ON;
        timing = RoutineTiming.AM_ONLY;
        frequency = UsageFrequency.DAILY;
        requiresDaytimeSunscreen = false; // it is the sunscreen!
        compatibleConcerns.push('sun_protection', 'anti_aging', 'hyperpigmentation_prevention');
        reasoning = 'Broad spectrum sunscreen is strictly step 6 in the AM routine; reapply every 2 hours during sun exposure';
      } else if (
        /serum|ampoule|booster|سيروم/i.test(fullText) ||
        categoryLower.includes('serum') ||
        categoryLower.includes('treatment') ||
        /c e ferulic/i.test(fullText) ||
        (ingredientsUpper.some((i) => i.includes('ASCORB') || i.includes('RETIN')) &&
          !/cream|lotion|cleanser|wash/i.test(nameLower))
      ) {
        stepType = RoutineStepType.TREATMENT_SERUM;
        stepOrder = 3;
        siteOfUse = ApplicationSite.FACE;
        rinseType = RinseType.LEAVE_ON;

        // Inspect actives to determine timing and warnings
        const hasRetinoid =
          /retinol|retinal|retinoid|tretinoin|ريتينول/i.test(fullText) ||
          ingredientsUpper.some((i) => i.includes('RETIN'));

        const hasAhaBha =
          /glycolic|salicylic|lactic|mandelic|حمض الساليسيليك|حمض الجليكوليك/i.test(fullText) ||
          ingredientsUpper.some((i) => i.includes('GLYCOLIC') || i.includes('SALICYLIC'));

        const hasVitC =
          /vitamin c|ascorbic|فيتامين سي/i.test(fullText) ||
          ingredientsUpper.some((i) => i.includes('ASCORB'));

        if (hasRetinoid) {
          timing = RoutineTiming.PM_ONLY;
          isPhotosensitizing = true;
          requiresDaytimeSunscreen = true;
          frequency = UsageFrequency.DAILY;
          compatibleConcerns.push('anti_aging', 'fine_lines', 'pores', 'acne');
          warnings.push('May cause initial flaking or redness; introduce gradually into PM routine');
          warnings.push('Mandatory daily sunscreen application when using topical retinoids');
          reasoning = 'Retinoid serum is strictly a PM active treatment (step 3) to prevent UV degradation and phototoxicity';
        } else if (hasAhaBha && !hasVitC) {
          timing = RoutineTiming.PM_ONLY;
          isPhotosensitizing = true;
          requiresDaytimeSunscreen = true;
          compatibleConcerns.push('acne', 'pores', 'skin_texture');
          warnings.push('Daily sunscreen required due to AHA/BHA keratolytic photo-sensitivity');
          reasoning = 'Direct acid serum is placed at step 3 in PM routine to promote nocturnal desquamation';
        } else if (hasVitC) {
          timing = RoutineTiming.AM_PM;
          compatibleConcerns.push('hyperpigmentation', 'dullness', 'antioxidant_defense');
          reasoning = 'Vitamin C serum is recommended at step 3 in the AM for antioxidant defense under sunscreen';
        } else {
          timing = RoutineTiming.AM_PM;
          compatibleConcerns.push('hydration', 'barrier_repair');
          reasoning = 'Hydrating or soothing treatment serum applied at step 3 in both AM and PM routines';
        }
      } else if (/oil|زيت الوجه/i.test(fullText) && !/cleansing oil/i.test(fullText)) {
        stepType = RoutineStepType.FACE_OIL;
        stepOrder = 7;
        siteOfUse = ApplicationSite.FACE;
        rinseType = RinseType.LEAVE_ON;
        timing = /night|pm/i.test(fullText) ? RoutineTiming.PM_ONLY : RoutineTiming.AM_PM;
        reasoning = 'Pure facial oil acts as an occlusive seal applied over moisturizers';
      } else {
        // Standard Moisturizer / Barrier Cream
        stepType = RoutineStepType.MOISTURIZER;
        stepOrder = 5;
        siteOfUse = ApplicationSite.FACE;
        rinseType = RinseType.LEAVE_ON;
        timing = /night cream|sleeping mask|كريم ليلي/i.test(fullText)
          ? RoutineTiming.PM_ONLY
          : RoutineTiming.AM_PM;
        compatibleConcerns.push('barrier_repair', 'dryness');
        reasoning = 'Moisturizer locks in hydration and reinforces stratum corneum barrier lipids (step 5)';
      }
    }

    // 3. Ambiguity & Frequency Guard
    // If usage directions are ambiguous, conflicting, or missing for high-strength products, hold for review
    const hasAmbiguousUsage =
      /use as directed|consult (?:your )?physician|as needed|specialist advice/i.test(usageText) ||
      (input.conflictingDistributorUsage !== undefined &&
        input.conflictingDistributorUsage !== usageText);

    if (hasAmbiguousUsage && stepType === RoutineStepType.EXFOLIANT) {
      frequency = UsageFrequency.UNCLEAR_HELD;
      frequencyStatus = 'HELD_FOR_REVIEW';
      reasoning += ' [HELD_FOR_REVIEW: Frequency held for editorial review due to ambiguous or conflicting source usage text]';
    }

    const contradictionsFound = Boolean(input.conflictingDistributorUsage);

    return {
      category,
      stepOrder,
      stepType,
      timing,
      siteOfUse,
      rinseType,
      frequency,
      frequencyStatus,
      isPhotosensitizing,
      requiresDaytimeSunscreen,
      reasoning,
      compatibleConcerns,
      warnings,
      evidenceSummary: {
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        extractedUsageText: input.usage?.join('; ') || input.directions,
        contradictionsFound,
      },
    };
  }
}
