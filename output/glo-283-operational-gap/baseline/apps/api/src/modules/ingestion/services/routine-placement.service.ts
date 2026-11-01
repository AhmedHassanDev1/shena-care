import { Injectable, Logger } from '@nestjs/common';
import {
  ApplicationSite,
  GenericGuidance,
  RinseType,
  RoutineCategory,
  RoutinePlacementResult,
  RoutineStepType,
  RoutineTiming,
  UsageFrequency,
  UsageRule,
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

const NUMBER_WORDS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  'مرة': 1, 'مره': 1, 'مرتين': 2, 'ثلاث': 3, 'اربع': 4, 'خمس': 5,
};
const NUM = '(\\d+|one|two|three|four|five|six|seven)';
const WEEK = '(?:a|per|each)\\s*week|weekly|(?:في|ف)?\\s*(?:الاسبوع|اسبوعيا|اسبوعيًا)';
const asNumber = (token: string) => NUMBER_WORDS[token] ?? Number(token);

@Injectable()
export class RoutinePlacementService {
  private readonly logger = new Logger(RoutinePlacementService.name);

  /**
   * GLO-279: proposes a routine ROLE (step type, phase, area) from name/category, and reads USAGE only from the product's
   * own directions. Timing, rinse mode and frequency are never filled in from the product type: when the directions do
   * not state them they are UNKNOWN and the frequency is held for review. Ingredient-class cautions are generic
   * guidance for the reviewer, not product warnings.
   */
  determineRoutinePlacement(input: DeterminePlacementInput): RoutinePlacementResult {
    const nameLower = input.productName.toLowerCase();
    const categoryLower = (input.category || '').toLowerCase();
    const descLower = (input.description || '').toLowerCase();
    const usageLines = input.usage?.length ? input.usage : input.directions ? [input.directions] : [];
    const usageText = usageLines.join(' ').toLowerCase();
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
      /body lotion|body wash|hand cream|foot cream|لوشن للجسم|غسول الجسم|كريم اليدين/i.test(fullText) &&
      !/face|facial|وجه/i.test(nameLower)
    ) {
      category = RoutineCategory.BODY_CARE;
    }

    // 2. Role proposal (heuristic, labelled as such): step type, broad phase and area of use
    let stepType = RoutineStepType.MOISTURIZER;
    let stepOrder = 5;
    let siteOfUse = ApplicationSite.FACE;
    let isPhotosensitizing = false;
    let requiresDaytimeSunscreen = false;
    const compatibleConcerns: string[] = [];
    const genericGuidance: GenericGuidance[] = [];
    const guidance = (text: string) => genericGuidance.push({ text, basis: 'INGREDIENT_CLASS', requiresReview: true });
    let reasoning = '';

    if (category === RoutineCategory.HAIR_CARE) {
      if (/shampoo|cleanser|شامبو/i.test(fullText)) {
        [stepType, stepOrder, siteOfUse] = [RoutineStepType.HAIR_SHAMPOO, 1, ApplicationSite.SCALP];
        reasoning = 'Proposed role: shampoo (cleansing phase of a hair routine)';
      } else if (/conditioner|بلسم/i.test(fullText) && !/leave-in/i.test(fullText)) {
        [stepType, stepOrder, siteOfUse] = [RoutineStepType.HAIR_CONDITIONER, 2, ApplicationSite.HAIR_LENGTHS];
        reasoning = 'Proposed role: conditioner (after cleansing, on lengths)';
      } else if (/mask|masque|ماسك/i.test(fullText)) {
        [stepType, stepOrder, siteOfUse] = [RoutineStepType.HAIR_MASK, 3, ApplicationSite.HAIR_LENGTHS];
        reasoning = 'Proposed role: hair mask (treatment phase)';
      } else if (/leave-in|heat protectant|بديل الزيت/i.test(fullText)) {
        [stepType, stepOrder, siteOfUse] = [RoutineStepType.HAIR_LEAVE_IN, 4, ApplicationSite.HAIR_LENGTHS];
        reasoning = 'Proposed role: leave-in (after washing, before styling)';
      } else {
        [stepType, stepOrder, siteOfUse] = [RoutineStepType.SCALP_TREATMENT, 5, ApplicationSite.SCALP];
        reasoning = 'Proposed role: scalp treatment';
      }
    } else if (/cleanser|face wash|cleansing foam|micellar|cleansing balm|غسول|منظف/i.test(fullText)) {
      [stepType, stepOrder] = [RoutineStepType.CLEANSER, 1];
      reasoning = 'Proposed role: cleanser (cleansing phase comes first)';
    } else if (/toner|essence|facial mist|تونر/i.test(fullText)) {
      [stepType, stepOrder] = [RoutineStepType.TONER, 2];
      reasoning = 'Proposed role: toner/essence (after cleansing)';
    } else if (/peeling solution|chemical peel|exfoliating scrub|exfoliant|resurfacing peel|مقشر/i.test(fullText)) {
      [stepType, stepOrder] = [RoutineStepType.EXFOLIANT, 2];
      isPhotosensitizing = true;
      requiresDaytimeSunscreen = true;
      compatibleConcerns.push('skin_texture', 'hyperpigmentation', 'pores');
      guidance('Chemical exfoliants can increase sun sensitivity; confirm the product directions on daytime sunscreen');
      reasoning = 'Proposed role: exfoliant (treatment phase after cleansing)';
    } else if (/eye cream|eye serum|eye contour|كريم العين|محيط العين/i.test(fullText)) {
      [stepType, stepOrder, siteOfUse] = [RoutineStepType.EYE_CARE, 4, ApplicationSite.EYE_CONTOUR];
      reasoning = 'Proposed role: eye care (before heavier moisturizers)';
    } else if (/sunscreen|sun cream|uv fluid|sun block|واقي شمس/i.test(fullText) || /\bspf\b/i.test(nameLower)) {
      [stepType, stepOrder] = [RoutineStepType.SUNSCREEN, 6];
      compatibleConcerns.push('sun_protection', 'anti_aging', 'hyperpigmentation_prevention');
      reasoning = 'Proposed role: sun protection (last skincare phase)';
    } else if (
      /serum|ampoule|booster|سيروم/i.test(fullText) || categoryLower.includes('serum') || categoryLower.includes('treatment') ||
      /c e ferulic/i.test(fullText) ||
      (ingredientsUpper.some((i) => i.includes('ASCORB') || i.includes('RETIN')) && !/cream|lotion|cleanser|wash/i.test(nameLower))
    ) {
      [stepType, stepOrder] = [RoutineStepType.TREATMENT_SERUM, 3];
      const hasRetinoid = /retinol|retinal|retinoid|tretinoin|ريتينول/i.test(fullText) || ingredientsUpper.some((i) => i.includes('RETIN'));
      const hasAhaBha = /glycolic|salicylic|lactic|mandelic|حمض الساليسيليك|حمض الجليكوليك/i.test(fullText) ||
        ingredientsUpper.some((i) => i.includes('GLYCOLIC') || i.includes('SALICYLIC'));
      const hasVitC = /vitamin c|ascorbic|فيتامين سي/i.test(fullText) || ingredientsUpper.some((i) => i.includes('ASCORB'));
      if (hasRetinoid) {
        isPhotosensitizing = true;
        requiresDaytimeSunscreen = true;
        compatibleConcerns.push('anti_aging', 'fine_lines', 'pores', 'acne');
        guidance('Retinoids are commonly introduced gradually and paired with daytime sunscreen; use the product directions');
      } else if (hasAhaBha && !hasVitC) {
        isPhotosensitizing = true;
        requiresDaytimeSunscreen = true;
        compatibleConcerns.push('acne', 'pores', 'skin_texture');
        guidance('AHA/BHA can increase sun sensitivity; confirm the product directions on daytime sunscreen');
      } else if (hasVitC) {
        compatibleConcerns.push('hyperpigmentation', 'dullness', 'antioxidant_defense');
      } else {
        compatibleConcerns.push('hydration', 'barrier_repair');
      }
      reasoning = 'Proposed role: treatment serum (treatment phase after cleansing)';
    } else if (/oil|زيت الوجه/i.test(fullText) && !/cleansing oil/i.test(fullText)) {
      [stepType, stepOrder] = [RoutineStepType.FACE_OIL, 7];
      reasoning = 'Proposed role: face oil (applied over lighter layers)';
    } else {
      compatibleConcerns.push('barrier_repair', 'dryness');
      reasoning = 'Proposed role: moisturizer';
    }

    // 3. Usage facts — evidence only, from the product's own directions
    const usageRules = this.parseUsageRules(usageLines);
    const regular = usageRules.find((rule) => rule.condition === null) ?? usageRules[0];
    const rinseModes = new Set(usageRules.map((rule) => rule.rinseMode).filter((mode) => mode !== 'UNKNOWN'));
    const rinseType = rinseModes.size === 1 ? (rinseModes.has('RINSE_OFF') ? RinseType.RINSE_OFF : RinseType.LEAVE_ON) : RinseType.UNKNOWN;
    const timing = !regular ? RoutineTiming.UNKNOWN
      : regular.frequencyUnit === 'AS_NEEDED' ? RoutineTiming.AS_NEEDED
      : ({ AM: RoutineTiming.AM_ONLY, PM: RoutineTiming.PM_ONLY, BOTH: RoutineTiming.AM_PM, UNKNOWN: RoutineTiming.UNKNOWN } as const)[regular.routinePeriod];
    let frequency = this.legacyFrequency(regular);
    let frequencyStatus: 'CONFIRMED' | 'HELD_FOR_REVIEW' = frequency === UsageFrequency.UNCLEAR_HELD ? 'HELD_FOR_REVIEW' : 'CONFIRMED';

    const hasAmbiguousUsage =
      /use as directed|consult (?:your )?physician|specialist advice/i.test(usageText) ||
      (input.conflictingDistributorUsage !== undefined && input.conflictingDistributorUsage.toLowerCase() !== usageText);
    if (hasAmbiguousUsage) {
      frequency = UsageFrequency.UNCLEAR_HELD;
      frequencyStatus = 'HELD_FOR_REVIEW';
    }
    if (frequencyStatus === 'HELD_FOR_REVIEW') {
      reasoning += ` [HELD_FOR_REVIEW: ${hasAmbiguousUsage ? 'ambiguous or conflicting source directions'
        : usageLines.length ? 'directions do not state a frequency' : 'no product directions supplied'}]`;
    }

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
      roleSource: 'NAME_AND_CATEGORY_HEURISTIC',
      usageRules,
      compatibleConcerns,
      warnings: this.warningsFromDirections(usageLines, usageRules),
      genericGuidance,
      evidenceSummary: {
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        extractedUsageText: usageLines.join('; ') || undefined,
        contradictionsFound: Boolean(input.conflictingDistributorUsage),
      },
    };
  }

  /**
   * Splits directions into sentences and reads what each one states. Sentences describing the same area and condition
   * with no contradiction are merged; differing areas (face vs scalp) or an introductory schedule stay separate rules.
   */
  parseUsageRules(lines: string[]): UsageRule[] {
    const sentences = lines.join('. ')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .split(/(?<=[.!?؟])\s+|[;\n•،]+/)
      .map((s) => s.trim().replace(/[.!?؟]+$/, ''))
      .filter(Boolean);
    const areaOf = (s: string): UsageRule['targetArea'] =>
      /scalp|فروة/i.test(s) ? 'SCALP' : /\bhair\b|شعر/i.test(s) ? 'HAIR' : /\beyes?\b|eye contour|العين/i.test(s) ? 'EYE_CONTOUR'
        : /\blips?\b|شفاه/i.test(s) ? 'LIPS' : /\bbody\b|جسم/i.test(s) ? 'BODY' : /\bface\b|\bneck\b|وجه|رقبة/i.test(s) ? 'FACE' : null;
    const allAreas = new Set(sentences.map(areaOf).filter(Boolean));
    const documentArea = allAreas.size === 1 ? [...allAreas][0] : null;

    const parsed: UsageRule[] = [];
    let pendingArea: UsageRule['targetArea'] = null;
    for (const sentence of sentences) {
      // Match on a normalized copy (alef/hamza forms, tashkeel/tanween); the evidence keeps the original wording.
      const s = sentence.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/[ً-ٟـ]/g, '');
      const rule: UsageRule = {
        targetArea: areaOf(s), routinePeriod: 'UNKNOWN', rinseMode: 'UNKNOWN', frequencyUnit: 'UNKNOWN',
        usesMin: null, usesMax: null, contactMinutes: null, contactIsMaximum: false,
        condition: /beginner|first[- ]time|start(?:ing)? with|introduc|للمبتدئين|في البداية|ابدأ/i.test(s) ? 'INTRODUCTORY' : null,
        evidenceText: sentence,
      };
      const range = s.match(new RegExp(`${NUM}\\s*(?:-|–|to|or|إلى|الى|او|أو)\\s*${NUM}\\s*(?:times?|مرات?)?\\s*(?:${WEEK})`));
      const perWeek = s.match(new RegExp(`(once|twice|${NUM.slice(1, -1)})\\s*(?:times?)?\\s*(?:${WEEK})|(مرة|مره|مرتين|\\d+\\s*مرات?)\\s*(?:واحدة)?\\s*(?:${WEEK})`));
      if (/as needed|when needed|whenever needed|عند الحاجة/.test(s)) {
        rule.frequencyUnit = 'AS_NEEDED';
      } else if (range) {
        [rule.frequencyUnit, rule.usesMin, rule.usesMax] = ['WEEK', asNumber(range[1]), asNumber(range[2])];
      } else if (perWeek) {
        const token = (perWeek[1] ?? perWeek[2]).replace(/\s*مرات?$/, '');
        rule.frequencyUnit = 'WEEK';
        rule.usesMin = rule.usesMax = asNumber(token);
      } else if (/\bweekly\b|اسبوعيا/.test(s)) {
        [rule.frequencyUnit, rule.usesMin, rule.usesMax] = ['WEEK', 1, 1];
      } else if (/twice\s*(?:a|per|each)?\s*day|twice daily|two times\s*(?:a|per)\s*day|مرتين\s*(?:في\s*)?(?:اليوم|يوميا)/.test(s)) {
        [rule.frequencyUnit, rule.usesMin, rule.usesMax] = ['DAY', 2, 2];
      } else if (/once\s*(?:a|per|each)?\s*day|once daily|every day|\bdaily\b|يوميا|مرة\s*(?:واحدة\s*)?(?:في\s*)?اليوم/.test(s)) {
        [rule.frequencyUnit, rule.usesMin, rule.usesMax] = ['DAY', 1, 1];
      }
      const morning = /\bmorning\b|\bam\b|صباح/.test(s);
      const evening = /\bevening\b|\bnight\b|\bpm\b|bedtime|مساء|ليل|قبل النوم/.test(s);
      rule.routinePeriod = morning && evening ? 'BOTH' : morning ? 'AM' : evening ? 'PM' : 'UNKNOWN';
      if (morning && evening && rule.frequencyUnit === 'UNKNOWN') [rule.frequencyUnit, rule.usesMin, rule.usesMax] = ['DAY', 2, 2];
      if (/do not rinse|don't rinse|no need to rinse|leave-in|without rinsing|بدون شطف|لا تشطف|لا يشطف/.test(s)) rule.rinseMode = 'LEAVE_ON';
      else if (/\brinse|wash off|اشطف|يشطف|شطف/.test(s)) rule.rinseMode = 'RINSE_OFF';
      const contact = s.match(/(no more than|not more than|maximum of|up to|لا تزيد عن|بحد اقصى)?\s*(\d+)\s*(?:minutes?|mins?|دقائق|دقيقة)/);
      if (contact) {
        rule.contactMinutes = Number(contact[2]);
        rule.contactIsMaximum = Boolean(contact[1]);
      }
      const informative = rule.frequencyUnit !== 'UNKNOWN' || rule.routinePeriod !== 'UNKNOWN' ||
        rule.rinseMode !== 'UNKNOWN' || rule.contactMinutes !== null;
      if (informative) {
        if (!rule.targetArea && pendingArea) [rule.targetArea, pendingArea] = [pendingArea, null];
        parsed.push(rule);
      } else if (rule.targetArea) {
        // "Apply to face and neck." belongs to the neighbouring instruction that names no area.
        const previous = parsed[parsed.length - 1];
        if (previous && !previous.targetArea) previous.targetArea = rule.targetArea;
        else pendingArea = rule.targetArea;
      }
    }

    // Merge compatible sentences into one rule; keep area/condition-specific instructions separate.
    const rules: UsageRule[] = [];
    for (const rule of parsed) {
      const area = rule.targetArea ?? documentArea;
      const target = rules.find((r) => (r.targetArea ?? documentArea) === area && r.condition === rule.condition &&
        (r.frequencyUnit === 'UNKNOWN' || rule.frequencyUnit === 'UNKNOWN') &&
        (r.routinePeriod === 'UNKNOWN' || rule.routinePeriod === 'UNKNOWN' || r.routinePeriod === rule.routinePeriod) &&
        (r.rinseMode === 'UNKNOWN' || rule.rinseMode === 'UNKNOWN' || r.rinseMode === rule.rinseMode));
      if (!target) {
        rules.push({ ...rule, targetArea: area });
        continue;
      }
      if (target.frequencyUnit === 'UNKNOWN') Object.assign(target, { frequencyUnit: rule.frequencyUnit, usesMin: rule.usesMin, usesMax: rule.usesMax });
      if (target.routinePeriod === 'UNKNOWN') target.routinePeriod = rule.routinePeriod;
      if (target.rinseMode === 'UNKNOWN') target.rinseMode = rule.rinseMode;
      if (target.contactMinutes === null) Object.assign(target, { contactMinutes: rule.contactMinutes, contactIsMaximum: rule.contactIsMaximum });
      target.evidenceText = `${target.evidenceText}. ${rule.evidenceText}`;
    }
    return rules;
  }

  /** Legacy single-value summary of the regular-use rule; anything not explicitly stated is held. */
  private legacyFrequency(rule?: UsageRule): UsageFrequency {
    if (!rule) return UsageFrequency.UNCLEAR_HELD;
    if (rule.frequencyUnit === 'AS_NEEDED') return UsageFrequency.AS_NEEDED;
    if (rule.frequencyUnit === 'DAY' && rule.usesMax === 1) return UsageFrequency.DAILY;
    if (rule.frequencyUnit === 'DAY' && rule.usesMin === 2 && rule.usesMax === 2) return UsageFrequency.TWICE_DAILY;
    if (rule.frequencyUnit === 'WEEK' && rule.usesMax !== null && rule.usesMax <= 2) return UsageFrequency.WEEKLY_1_2_TIMES;
    return UsageFrequency.UNCLEAR_HELD;
  }

  /** Warnings the product's own directions state (sun protection, contact limits, avoid eyes/broken skin, patch test). */
  private warningsFromDirections(lines: string[], rules: UsageRule[]): string[] {
    const warnings = rules.filter((r) => r.contactIsMaximum && r.contactMinutes !== null)
      .map((r) => `Do not leave on for more than ${r.contactMinutes} minutes (manufacturer directions)`);
    for (const sentence of lines.join('. ').split(/(?<=[.!?؟])\s+|[;\n•]+/)) {
      if (/sunscreen|\bspf\b|sun protection|avoid (?:contact with )?(?:the )?eyes?|broken skin|irritated skin|patch test|external use only|discontinue use|واقي شمس|تجنب ملامسة العين|اختبار حساسية|للاستخدام الخارجي|توقف عن الاستخدام/i.test(sentence)) {
        warnings.push(sentence.trim());
      }
    }
    return [...new Set(warnings)];
  }
}
