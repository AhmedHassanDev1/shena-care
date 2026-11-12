import type { IconName } from '@/components/ui/icon-paths';
import { formatNumber } from '@/lib/i18n/format';
import type { Messages } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/messages';
import type {
  ProductDetail,
  PublicKeyIngredient,
  PublicMedia,
  PublicVariant,
} from '../api/discovery';

/**
 * Turns the reviewed catalog fields of GET /products/:slug/detail into what the product page shows. Nothing here
 * invents a claim: a highlight exists only when the backend sent the fact, and free text (ingredients, usage,
 * warnings) is only split into the parts its author already wrote, never rewritten.
 */

export interface ProductFactFields {
  targetArea?: string | null;
  texture?: string | null;
  suitableSkinTypes?: string[];
  suitableHairTypes?: string[];
  spf?: number | null;
  broadSpectrum?: boolean | null;
  waterResistanceMinutes?: number | null;
  isFragranceFree?: boolean | null;
  isNonComedogenic?: boolean | null;
}

export type HighlightKind = 'spf' | 'texture' | 'area' | 'fragrance-free' | 'non-comedogenic' | 'water';

export interface Highlight {
  kind: HighlightKind;
  /** Enum value or number from the catalog; the page turns it into words. */
  value: string | number | null;
}

/** Catalog enums the storefront has words for (prisma ProductTexture / UsageTargetArea, care SkinType). */
export const TEXTURES = ['GEL', 'CREAM', 'GEL_CREAM', 'LOTION', 'EMULSION', 'SERUM', 'OIL', 'BALM', 'FOAM', 'LIQUID', 'SPRAY', 'PASTE', 'STICK', 'POWDER'] as const;
export const TARGET_AREAS = ['FACE', 'EYE_CONTOUR', 'LIPS', 'BODY', 'SCALP', 'HAIR'] as const;
export const SKIN_TYPES = ['normal', 'dry', 'oily', 'combination', 'sensitive'] as const;
export type Texture = (typeof TEXTURES)[number];
export type TargetArea = (typeof TARGET_AREAS)[number];
export type SkinType = (typeof SKIN_TYPES)[number];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** At-a-glance highlights, in a fixed order, only for facts the catalog actually carries. */
export function productHighlights(facts: ProductFactFields): Highlight[] {
  const out: Highlight[] = [];
  if (typeof facts.spf === 'number' && facts.spf > 0) out.push({ kind: 'spf', value: facts.spf });
  if (isOneOf(TEXTURES, facts.texture)) out.push({ kind: 'texture', value: facts.texture });
  if (isOneOf(TARGET_AREAS, facts.targetArea)) out.push({ kind: 'area', value: facts.targetArea });
  if (facts.isFragranceFree === true) out.push({ kind: 'fragrance-free', value: null });
  if (facts.isNonComedogenic === true) out.push({ kind: 'non-comedogenic', value: null });
  if (typeof facts.waterResistanceMinutes === 'number' && facts.waterResistanceMinutes > 0) out.push({ kind: 'water', value: facts.waterResistanceMinutes });
  return out;
}

/** Skin types the storefront can name, de-duplicated, in the taxonomy's order. Unknown values are dropped, not shown raw. */
export function knownSkinTypes(values: string[] | undefined): SkinType[] {
  const set = new Set((values ?? []).map((v) => v.trim().toLowerCase()));
  return SKIN_TYPES.filter((type) => set.has(type));
}

/**
 * Splits an ingredient list (INCI, comma / Arabic comma / semicolon / line separated) into its entries. Returns null
 * when the text does not read as a list (fewer than 3 entries or a long sentence), so the page shows it as written.
 */
export function splitIngredients(text: string | null | undefined): string[] | null {
  const raw = text?.trim();
  if (!raw) return null;
  const parts = raw
    .replace(/^(ingredients|inci|المكونات)\s*[:：]\s*/i, '')
    .split(/[,،;؛\n]+/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter(Boolean);
  if (parts.length < 3 || parts.some((part) => part.length > 80)) return null;
  return parts;
}

/**
 * Splits usage directions into the steps their author wrote: one per line (leading «1.», «-», «•» removed), or one
 * per sentence when the text is a single paragraph. A single step is returned as one entry.
 */
export function splitSteps(text: string | null | undefined): string[] {
  const raw = text?.trim();
  if (!raw) return [];
  const clean = (part: string) => part.replace(/^\s*(?:[-•*]|\d+[.)-]|[٠-٩]+[.)-])\s*/, '').trim();
  const lines = raw.split(/\n+/).map(clean).filter(Boolean);
  if (lines.length > 1) return lines;
  const sentences = raw
    .split(/(?<=[.!؟?])\s+/)
    .map(clean)
    .filter(Boolean);
  return sentences.length > 1 && sentences.length <= 6 ? sentences : [clean(raw)];
}

/**
 * Index of the ingredient the product title itself names (e.g. «Hyaluronic Acid Facial Serum» → «Sodium Hyaluronate»),
 * matched on 7-letter stems of the title's long words so salts and derivatives count; -1 when none matches. This is
 * derived from the catalog's own strings, never from outside knowledge of what an ingredient does.
 */
export function featuredIngredientIndex(list: string[], productName: string): number {
  const stems = productName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 7)
    .map((word) => word.slice(0, 7));
  if (!stems.length) return -1;
  return list.findIndex((item) => stems.some((stem) => item.toLowerCase().includes(stem)));
}

export interface HeroFeatureBadge {
  id: string;
  icon: IconName;
  label: string;
}

export function resolveHeroFeatureBadges(product: ProductDetail, m: Messages): HeroFeatureBadge[] {
  const out: HeroFeatureBadge[] = [];
  const highlights = productHighlights(product);

  for (const h of highlights) {
    if (out.length >= 3) break;
    if (h.kind === 'spf' && h.value != null) {
      out.push({ id: 'spf', icon: 'sun', label: fillMessage(m.pdpHlSpf, { n: String(h.value) }) });
    } else if (h.kind === 'texture' && h.value != null) {
      const key = `texture${h.value}` as keyof Messages;
      out.push({ id: 'texture', icon: 'droplet', label: (m[key] as string) || String(h.value) });
    } else if (h.kind === 'fragrance-free') {
      out.push({ id: 'fragrance-free', icon: 'sparkles', label: m.pdpHlFragranceFree });
    } else if (h.kind === 'non-comedogenic') {
      out.push({ id: 'non-comedogenic', icon: 'shield', label: m.pdpHlNonComedogenic });
    } else if (h.kind === 'area' && h.value != null) {
      const key = `area${h.value}` as keyof Messages;
      out.push({ id: 'area', icon: 'target', label: (m[key] as string) || String(h.value) });
    } else if (h.kind === 'water' && h.value != null) {
      out.push({ id: 'water', icon: 'droplet', label: fillMessage(m.pdpHlWaterBody, { n: String(h.value) }) });
    }
  }

  if (out.length < 3) {
    const skins = knownSkinTypes(product.suitableSkinTypes);
    if (skins.length > 0) {
      const primarySkin = skins[0];
      const cap = `${primarySkin[0].toUpperCase()}${primarySkin.slice(1)}`;
      const skinKey = `skinType${cap}` as keyof Messages;
      const skinWord = (m[skinKey] as string) || primarySkin;
      out.push({
        id: 'skin-type',
        icon: 'leaf',
        label: fillMessage(m.pdpSuitableSkin, { type: skinWord }),
      });
    }
  }

  return out.slice(0, 3);
}

export interface RoutineTimelineStep {
  number: string;
  label: string;
  icon: IconName;
  isCurrent: boolean;
}

export interface ResolvedRoutinePosition {
  confirmed: boolean;
  steps: RoutineTimelineStep[];
  summaryLine: string;
}

const SKIN_ROLE_STEP_INDEX: Record<string, { index: number; labelKey?: keyof Messages }> = {
  CLEANSER: { index: 0 },
  WASH: { index: 0 },
  MICELLAR: { index: 0 },
  EXFOLIATING_CLEANSER: { index: 0 },
  TONER: { index: 1, labelKey: 'pdpRoutineStepTone' },
  ESSENCE: { index: 1, labelKey: 'pdpRoutineStepTone' },
  EXFOLIANT: { index: 1, labelKey: 'pdpRoutineStepExfoliate' },
  MASK: { index: 1, labelKey: 'pdpRoutineStepMask' },
  EYE_CARE: { index: 1, labelKey: 'pdpRoutineStepEye' },
  SERUM: { index: 1, labelKey: 'pdpRoutineStepTreat' },
  TREATMENT: { index: 1, labelKey: 'pdpRoutineStepTreat' },
  SPOT_TREATMENT: { index: 1, labelKey: 'pdpRoutineStepTreat' },
  RETINOID: { index: 1, labelKey: 'pdpRoutineStepTreat' },
  VITAMIN_C: { index: 1, labelKey: 'pdpRoutineStepTreat' },
  MOISTURIZER: { index: 2 },
  CREAM: { index: 2 },
  LOTION: { index: 2 },
  GEL_CREAM: { index: 2 },
  BALM: { index: 2 },
  OIL: { index: 2 },
  BARRIER_CREAM: { index: 2 },
  NIGHT_CREAM: { index: 2 },
  SUNSCREEN: { index: 3 },
  SPF: { index: 3 },
  SUN_PROTECTION: { index: 3 },
  SUNBLOCK: { index: 3 },
};

const HAIR_ROLE_STEP_INDEX: Record<string, number> = {
  SHAMPOO: 0,
  SCALP_CLEANSER: 0,
  CLEANSER: 0,
  CONDITIONER: 1,
  MASK: 1,
  SERUM: 2,
  TREATMENT: 2,
  OIL: 2,
  LEAVE_IN: 2,
  ESSENCE: 2,
  STYLING: 3,
  HEAT_PROTECTION: 3,
  SPF: 3,
  SUNSCREEN: 3,
};

export function resolveRoutinePosition(
  product: ProductDetail,
  variant: PublicVariant,
  m: Messages,
): ResolvedRoutinePosition {
  const profile = variant.routineProfile ?? product.routineProfile;
  const roleRaw = profile?.primaryRole?.trim().toUpperCase() ?? '';
  const roleStatus = profile?.primaryRoleStatus ?? 'UNKNOWN';
  const roleConfirmed = Boolean(roleRaw && roleStatus !== 'UNKNOWN' && roleStatus !== 'AMBIGUOUS');

  if (!roleConfirmed) {
    const manualPlacement = product.routinePlacements?.[0];
    if (manualPlacement?.step?.title) {
      return {
        confirmed: true,
        steps: [
          {
            number: `0${Math.max(1, manualPlacement.step.order || 1)}`.slice(-2),
            label: manualPlacement.step.title,
            icon: 'layers',
            isCurrent: true,
          },
        ],
        summaryLine: manualPlacement.step.instructions || manualPlacement.routine.title,
      };
    }
    return {
      confirmed: false,
      steps: [],
      summaryLine: m.pdpRoutinePending,
    };
  }

  const domain = (profile?.routineDomain ?? '').toUpperCase();
  const isHair = domain === 'HAIR' || roleRaw === 'SHAMPOO' || roleRaw === 'SCALP_CLEANSER' || roleRaw === 'CONDITIONER' || roleRaw === 'STYLING' || roleRaw === 'HEAT_PROTECTION';

  if (isHair) {
    const activeIdx = HAIR_ROLE_STEP_INDEX[roleRaw] ?? -1;
    if (activeIdx < 0) {
      return { confirmed: false, steps: [], summaryLine: m.pdpRoutinePending };
    }
    const baseSteps: Array<{ number: string; label: string; icon: IconName }> = [
      { number: '01', label: m.pdpRoutineStepWash, icon: 'droplet' },
      { number: '02', label: m.pdpRoutineStepCondition, icon: 'sparkles' },
      { number: '03', label: m.pdpRoutineStepHairTreat, icon: 'pipette' },
      { number: '04', label: m.pdpRoutineStepStyle, icon: 'shield' },
    ];
    const steps = baseSteps.map((step, i) => ({ ...step, isCurrent: i === activeIdx }));
    const summaryLine =
      activeIdx === 0
        ? fillMessage(m.pdpRoutineFirstStep, { next: steps[1].label })
        : activeIdx === steps.length - 1
          ? fillMessage(m.pdpRoutineLastStep, { prev: steps[activeIdx - 1].label })
          : fillMessage(m.pdpRoutineBetweenRoles, {
              prev: steps[activeIdx - 1].label,
              next: steps[activeIdx + 1].label,
            });
    return { confirmed: true, steps, summaryLine };
  }

  const mapped = SKIN_ROLE_STEP_INDEX[roleRaw];
  if (!mapped) {
    return { confirmed: false, steps: [], summaryLine: m.pdpRoutinePending };
  }

  const slot2Label = mapped.labelKey ? (m[mapped.labelKey] as string) : m.pdpRoutineStepTreat;
  const baseSteps: Array<{ number: string; label: string; icon: IconName }> = [
    { number: '01', label: m.pdpRoutineStepCleanse, icon: 'droplet' },
    { number: '02', label: slot2Label, icon: 'pipette' },
    { number: '03', label: m.pdpRoutineStepMoisturize, icon: 'layers' },
    { number: '04', label: m.pdpRoutineStepProtect, icon: 'sun' },
  ];
  const steps = baseSteps.map((step, i) => ({ ...step, isCurrent: i === mapped.index }));
  const summaryLine =
    mapped.index === 0
      ? fillMessage(m.pdpRoutineFirstStep, { next: steps[1].label })
      : mapped.index === steps.length - 1
        ? fillMessage(m.pdpRoutineLastStep, { prev: steps[mapped.index - 1].label })
        : fillMessage(m.pdpRoutineBetweenRoles, {
            prev: steps[mapped.index - 1].label,
            next: steps[mapped.index + 1].label,
          });

  return { confirmed: true, steps, summaryLine };
}

export interface ResolvedUsageGuide {
  showMorning: boolean;
  showEvening: boolean;
  frequencyChips: string[];
  instructionsText: string | null;
  warningsText: string | null;
  textureMedia: PublicMedia | null;
}

export function resolveUsageGuide(
  product: ProductDetail,
  variant: PublicVariant,
  locale: 'ar' | 'en',
  m: Messages,
): ResolvedUsageGuide {
  const rules = variant.usageRules ?? [];
  const profile = variant.routineProfile ?? product.routineProfile;

  let period = 'UNKNOWN';
  for (const r of rules) {
    if (r.routinePeriod && r.routinePeriod !== 'UNKNOWN') {
      period = r.routinePeriod.toUpperCase();
      break;
    }
  }
  if (period === 'UNKNOWN' && profile) {
    if (profile.routinePeriodStatus !== 'UNKNOWN' && profile.routinePeriod && profile.routinePeriod !== 'UNKNOWN') {
      period = profile.routinePeriod.toUpperCase();
    } else if (profile.periodEligibility && profile.periodEligibility !== 'UNKNOWN') {
      const elig = profile.periodEligibility.toUpperCase();
      if (elig === 'AM_ONLY' || elig === 'AM') period = 'AM';
      else if (elig === 'PM_ONLY' || elig === 'PM') period = 'PM';
      else if (elig === 'BOTH' || elig === 'AM_AND_PM' || elig === 'AM_PM') period = 'BOTH';
    }
  }

  const showMorning = period === 'AM' || period === 'BOTH' || period === 'AM_PM' || period === 'DAY_NIGHT';
  const showEvening = period === 'PM' || period === 'BOTH' || period === 'AM_PM' || period === 'DAY_NIGHT';

  const frequencyChips: string[] = [];
  const primaryRule = rules[0];
  const cadenceUnit =
    primaryRule && primaryRule.frequencyUnit !== 'UNKNOWN'
      ? primaryRule.frequencyUnit
      : profile && profile.cadenceStatus !== 'UNKNOWN' && profile.cadenceUnit !== 'UNKNOWN'
        ? profile.cadenceUnit
        : 'UNKNOWN';
  const cMin = primaryRule?.usesMin ?? (profile?.cadenceStatus !== 'UNKNOWN' ? profile?.cadenceMin : null) ?? null;
  const cMax = primaryRule?.usesMax ?? (profile?.cadenceStatus !== 'UNKNOWN' ? profile?.cadenceMax : null) ?? null;

  if (cadenceUnit === 'DAY' && cMin != null) {
    if (cMax != null && cMax > cMin) {
      frequencyChips.push(
        fillMessage(m.pdpCadenceRangeDaily, {
          min: formatNumber(cMin, locale),
          max: formatNumber(cMax, locale),
        }),
      );
    } else if (cMin === 1) {
      frequencyChips.push(m.pdpCadenceDailyOnce);
    } else {
      frequencyChips.push(fillMessage(m.pdpCadenceDaily, { n: formatNumber(cMin, locale) }));
    }
  } else if (cadenceUnit === 'DAY') {
    frequencyChips.push(m.pdpCadenceDailyGeneral);
  } else if (cadenceUnit === 'WEEK' && cMin != null) {
    frequencyChips.push(
      cMax != null && cMax > cMin
        ? fillMessage(m.pdpCadenceRangeWeekly, {
            min: formatNumber(cMin, locale),
            max: formatNumber(cMax, locale),
          })
        : fillMessage(m.pdpCadenceWeekly, { n: formatNumber(cMin, locale) }),
    );
  }

  const rinseMode =
    primaryRule && primaryRule.rinseMode !== 'UNKNOWN'
      ? primaryRule.rinseMode
      : profile && profile.rinseModeStatus !== 'UNKNOWN' && profile.rinseMode !== 'UNKNOWN'
        ? profile.rinseMode
        : 'UNKNOWN';
  if (rinseMode === 'RINSE_OFF') frequencyChips.push(m.pdpRinseRinseOff);
  else if (rinseMode === 'LEAVE_ON') frequencyChips.push(m.pdpRinseLeaveOn);

  const instructionsJoined =
    variant.content?.usage?.trim() ||
    product.usage?.trim() ||
    rules
      .map((r) => r.evidenceText.trim())
      .filter(Boolean)
      .join(' ') ||
    null;
  const instructionsText = instructionsJoined ? formatReadableCopy(instructionsJoined).join(' ') : null;

  const warningLines: string[] = [];
  const pushWarn = (txt: string | null | undefined) => {
    const clean = txt?.trim();
    if (clean && !warningLines.includes(clean)) warningLines.push(clean);
  };
  for (const sw of variant.safetyWarnings ?? product.safetyWarnings ?? []) {
    pushWarn(locale === 'ar' ? sw.descriptionAr || sw.descriptionEn : sw.descriptionEn);
  }
  for (const c of profile?.cautions ?? []) {
    if (c.status === 'VERIFIED') pushWarn(c.text);
  }
  pushWarn(variant.content?.warnings ?? product.warnings);

  const allMedia = [...(variant.media ?? []), ...(product.media ?? [])];
  const textureMedia =
    allMedia.find((mItem) => {
      const role = (mItem.role ?? '').toUpperCase();
      return role === 'TEXTURE_SWATCH' || role === 'TEXTURE' || role === 'SWATCH';
    }) ?? null;

  return {
    showMorning,
    showEvening,
    frequencyChips,
    instructionsText,
    warningsText: warningLines.length > 0 ? warningLines.join(' ') : null,
    textureMedia,
  };
}

/**
 * Determines natural block direction for server-provided text without altering page layout dir.
 */
export function resolveTextDirection(text: string | null | undefined): 'ltr' | 'rtl' | undefined {
  if (!text) return undefined;
  if (/[\u0600-\u06FF]/.test(text)) return 'rtl';
  if (/[A-Za-z]/.test(text)) return 'ltr';
  return undefined;
}

/**
 * Non-destructively restores spacing on mashed scraped prose (`word.Next`, `Label:Value`),
 * deduplicates repeated adjacent sentences, and splits labeled sections into readable paragraphs.
 */
export function formatReadableCopy(text: string | null | undefined): string[] {
  const raw = text?.replace(/\r\n?/g, '\n').trim();
  if (!raw) return [];

  const withSpacing = raw
    .replace(/([a-z0-9])([.:;])([A-Z])/g, '$1$2 $3')
    .replace(/([a-z])([A-Z][a-z]{3,})/g, '$1. $2')
    .replace(
      /\s+((?:Key Benefits|Benefits|Multi-Purpose|Skin Rejuvenation|Deep Hydration|How to [Uu]se|Directions|Suitable for|Ideal for)\s*:)/g,
      '\n$1'
    );

  const blocks = withSpacing
    .split(/\n+/)
    .map((b) => b.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean);

  const dedupedBlocks: string[] = [];
  for (const block of blocks) {
    const sentences = block
      .split(/(?<=[.!؟?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const uniqueSentences: string[] = [];
    const seen = new Set<string>();
    for (const s of sentences) {
      const norm = s.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      uniqueSentences.push(s);
    }
    const rebuilt = uniqueSentences.join(' ');
    if (rebuilt && !dedupedBlocks.includes(rebuilt)) {
      dedupedBlocks.push(rebuilt);
    }
  }

  return dedupedBlocks;
}

/**
 * Produces a word-boundary truncated preview for long formatted copy without chopping mid-word.
 */
export function truncateReadableExcerpt(
  paragraphs: string[],
  maxChars = 240,
): { preview: string; isLong: boolean } {
  const full = paragraphs.join(' ');
  if (!full) return { preview: '', isLong: false };
  if (full.length <= maxChars && paragraphs.length <= 2) {
    return { preview: full, isLong: false };
  }
  const firstBlock = paragraphs[0] ?? full;
  if (firstBlock.length <= maxChars) {
    return {
      preview: firstBlock,
      isLong: paragraphs.length > 1 || full.length > firstBlock.length,
    };
  }
  const slice = firstBlock.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(maxChars * 0.6) ? slice.slice(0, lastSpace) : slice;
  return {
    preview: `${cut.replace(/[,:;.\-–—]+$/, '')}…`,
    isLong: true,
  };
}

/**
 * Orders primary packshot first and removes duplicate identical image URLs while preserving distinct angles.
 */
export function dedupeGalleryMedia(media: PublicMedia[] | null | undefined): PublicMedia[] {
  if (!media?.length) return [];
  const sorted = [...media].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
  const seenUrls = new Set<string>();
  const unique: PublicMedia[] = [];
  for (const item of sorted) {
    const key = item.url?.trim();
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    unique.push(item);
  }
  return unique;
}

export function resolveKeyIngredients(
  product: ProductDetail,
  variant: PublicVariant,
): PublicKeyIngredient[] {
  const raw =
    (variant.keyIngredients?.length ? variant.keyIngredients : product.keyIngredients) ??
    variant.content?.keyIngredients?.map((item) => ({
      name: item.name,
      function: item.function,
      sourceType: 'MANUFACTURER_KEY_INGREDIENT' as const,
    })) ??
    [];
  const seen = new Set<string>();
  const out: PublicKeyIngredient[] = [];
  for (const ing of raw) {
    const key = ing.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ing);
  }
  return out;
}

export function resolveFullInciList(
  product: ProductDetail,
  variant: PublicVariant,
  locale: 'ar' | 'en',
): string[] {
  const structured = variant.inciIngredients?.length ? variant.inciIngredients : product.inciIngredients;
  if (structured && structured.length > 0) {
    return [...structured]
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
      .map((item) => (locale === 'ar' ? item.nameAr || item.inciName || item.name : item.inciName || item.name))
      .filter(Boolean);
  }
  return splitIngredients(variant.content?.ingredients) ?? [];
}
