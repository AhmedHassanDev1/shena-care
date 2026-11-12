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
