import { createHash } from 'crypto';
import { isValidGtin } from '../../../platform/security/gtin';
import { readProductType } from './product-type';
import { rinseMode } from './catalog-decision-engine';

/**
 * Deterministic extraction of product facts from one fetched page. Everything returned is literally on that page and carries the excerpt that states it; anything else
 * stays unknown. Versioned because a stored proposal must say which rules produced it.
 */
export const RESEARCH_SCHEMA_VERSION = 3;

export type FactField =
  | 'identity.name' | 'identity.brand' | 'identity.gtin' | 'identity.size'
  | 'composition.inci' | 'composition.activeConcentrations' | 'composition.fragrance' | 'composition.keyIngredients'
  | 'attributes.texture' | 'usage.instructions' | 'usage.routinePeriod' | 'usage.targetArea'
  | 'suitability.skinTypes' | 'suitability.hairTypes' | 'safety.warnings' | 'marketing.description' | 'claims.manufacturerStated' | 'media.sourceImages'
  // Schema fields of catalog.products that only a page can state (2026-11-07): never inferred from the product type.
  | 'attributes.spf' | 'attributes.broadSpectrum' | 'attributes.waterResistanceMinutes' | 'attributes.uvFilterType' | 'attributes.nonComedogenic'
  | 'merchandising.productLine';

export const ALL_FACT_FIELDS: readonly FactField[] = [
  'identity.name', 'identity.brand', 'identity.gtin', 'identity.size', 'composition.inci', 'composition.activeConcentrations', 'composition.fragrance', 'composition.keyIngredients',
  'attributes.texture', 'usage.instructions', 'usage.routinePeriod', 'usage.targetArea', 'suitability.skinTypes', 'suitability.hairTypes', 'safety.warnings',
  'marketing.description', 'claims.manufacturerStated', 'media.sourceImages',
  'attributes.spf', 'attributes.broadSpectrum', 'attributes.waterResistanceMinutes', 'attributes.uvFilterType', 'attributes.nonComedogenic', 'merchandising.productLine',
];

/** Facts a reviewer must settle before a product can go live. */
export const CRITICAL_FACT_PREFIXES = ['identity.', 'composition.', 'safety.'];

export interface ExtractedFact { field: FactField; value: unknown; excerpt: string }
export interface SkuExpectation { brand: string; brandAliases?: string[]; productName: string; size: number | null; sizeUnit: string | null; barcode: string | null }
export interface PageExtraction {
  facts: ExtractedFact[];
  rejected: Array<{ field: string; reason: string; detail?: string }>;
  /** False when the page is about something else: nothing from it may describe this SKU. */
  identityMatched: boolean;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', reg: '®', trade: '™', copy: '©', eacute: 'é', egrave: 'è', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };
const decode = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);

/** Marks where a page's own heading starts, so a section can't run into whatever follows it. */
const HEADING_BOUNDARY = '\u0001';
const BLOCK_TAGS = /<\/?(p|div|li|ul|ol|br|h[1-6]|tr|td|th|table|section|article|header|footer|dd|dt|dl|summary|details|button)\b[^>]*>/gi;

export function htmlToLines(html: string): string[] {
  return structuredLines(html).filter(line => line !== HEADING_BOUNDARY);
}

function structuredLines(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Bazaarvoice's itemReviewed often names an older size than the current
    // selected product. A review aggregate is not identity evidence.
    .replace(/<([a-z][a-z0-9]*)\b[^>]*\bclass=["'][^"']*\bbvseo-itemReviewed\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h[1-6]\b/gi, match => `\n${HEADING_BOUNDARY}\n${match}`)
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(body).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function jsonLdNodes(html: string, wanted: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    if (type === wanted || (Array.isArray(type) && type.includes(wanted))) found.push(record);
    if (record['@graph']) visit(record['@graph']);
    if (record.mainEntity) visit(record.mainEntity);
  };
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch { /* a broken block is not evidence */ }
  }
  return found;
}
const jsonLdProducts = (html: string) => jsonLdNodes(html, 'Product');

/** Breadcrumb names from structured data, in order. */
function breadcrumbNames(html: string): string[] {
  return jsonLdNodes(html, 'BreadcrumbList').flatMap(list => (Array.isArray(list.itemListElement) ? list.itemListElement : []) as Array<Record<string, unknown>>)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map(item => item.name ?? (item.item as { name?: unknown } | undefined)?.name)
    .filter((name): name is string => typeof name === 'string').map(name => decode(name).replace(/\s+/g, ' ').trim());
}

/** Navigation words a breadcrumb or "Collection:" label uses that are never a product line. */
const NOT_A_LINE = /^(home|shop|store|all|all products|products?|brands?|collections?|categories|catalog|skin ?care|hair ?care|body ?care|face ?care|face|body|hair|makeup|beauty|new|new arrivals|best ?sellers?|sale|offers?|deals|gifts?|الرئيسيه|الرئيسية|المتجر|المنتجات|منتجات|العروض|الماركات)$/i;
/** Marketing adjectives that describe a product and are not the name of a range (shared meaning with BrandEnrichmentService). */
const MARKETING_WORDS = new Set(['whitening', 'moisturizing', 'moisturising', 'hydrating', 'anti', 'aging', 'ageing', 'brightening', 'acne', 'smoothing', 'cleansing', 'repairing', 'daily', 'gentle',
  'intensive', 'sunscreen', 'glow', 'matte', 'nourishing', 'natural', 'organic', 'professional', 'original', 'تفتيح', 'ترطيب', 'تنقية', 'اشراقة', 'يومي', 'لطيف', 'اصلاح', 'مغذي']);
const LINE_LABEL = /^(?:product )?(?:line|range|collection|series)\s*[:：]\s*(.{2,40})$|^(?:المجموعة|السلسلة|خط المنتج|الخط)\s*[:：]\s*(.{2,40})$/i;

const SPF_PATTERN = /\bSPF\s?-?(\d{1,3})\s?\+?(?!\d)|عامل (?:ال)?حماية\s*(\d{1,3})/gi;
/** Qualifiers that name a different product of the same range. Each is checked in both directions (row ↔ page title). */
const VARIANT_QUALIFIERS: Array<[string, RegExp]> = [
  ['tinted', /\b(tinted|tint|teint[ée]e?)\b|ملون|بلون/i], ['night', /\bnight\b|ليلي|ليلى/i], ['day', /\bday\b|نهاري|نهارى/i],
  ['men', /\b(men|for him)\b|للرجال|رجالي/i], ['kids', /\b(kids?|children|baby|babies|junior)\b|للاطفال|للأطفال|بيبي/i], ['refill', /\brefill\b/i],
];
const BROAD_SPECTRUM = /\bbroad[- ]spectrum\b|واسع(?:ة)? الطيف/i;
const WATER_RESISTANCE = /\bwater[- ]resistan(?:t|ce)\b[^.\n]{0,25}?\(?(\d{2,3})\s*(?:min|minutes)\b|(\d{2,3})\s*(?:min|minutes)\b[^.\n]{0,20}?water[- ]resistan/i;
const NON_COMEDOGENIC = /\bnon[- ]?comedogenic\b|لا يسد المسام|غير مسبب لانسداد المسام/i;
/** UV filters by INCI name. Only read from a single ingredient list of a product that states an SPF. */
const MINERAL_FILTERS = /^(zinc oxide|titanium dioxide|ci 77947|ci 77891)(\s*\(nano\))?$/i;
const CHEMICAL_FILTERS = /^(butyl methoxydibenzoylmethane|avobenzone|ethylhexyl methoxycinnamate|octinoxate|octocrylene|homosalate|ethylhexyl salicylate|octisalate|benzophenone-3|oxybenzone|bis-ethylhexyloxyphenol methoxyphenyl triazine|bemotrizinol|methylene bis-benzotriazolyl tetramethylbutylphenol(\s*\(nano\))?|diethylamino hydroxybenzoyl hexyl benzoate|ethylhexyl triazone|diethylhexyl butamido triazone|drometrizole trisiloxane|terephthalylidene dicamphor sulfonic acid|phenylbenzimidazole sulfonic acid|ensulizole|isoamyl p-methoxycinnamate|polysilicone-15|4-methylbenzylidene camphor|tris-biphenyl triazine(\s*\(nano\))?|disodium phenyl dibenzimidazole tetrasulfonate)$/i;

const meta = (html: string, name: string): string | null => {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(pattern)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).trim() : null;
};
const headingText = (html: string) => decode((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const titleText = (html: string) => decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (value: string) => fold(value).split(' ').filter(token => token.length > 2);

// Units in any letter case ("30 Ml", "50 GM": regression from the real Eva shop titles, 2026-11-07).
const SIZE_PATTERN = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s?(ml|mL|ML|Ml|fl\.?\s?oz|FL\.?\s?OZ|oz|OZ|g|G|gm|Gm|GM|gr|Gr|GR|kg|Kg|KG|l|L|مل|ملل|جم|جرام|غ)(?![\p{L}\p{N}])/gu;
function canonicalUnit(unit: string): string | null {
  const folded = unit.toLowerCase().replace(/[.\s]/g, '');
  if (folded === 'ml' || folded === 'مل' || folded === 'ملل') return 'ml';
  if (folded === 'g' || folded === 'gm' || folded === 'gr' || folded === 'جم' || folded === 'جرام' || folded === 'غ') return 'g';
  if (folded === 'floz' || folded === 'oz') return 'oz';
  if (folded === 'l') return 'l';
  if (folded === 'kg') return 'kg';
  return null;
}
const BASE_UNITS: Record<string, { dimension: 'volume' | 'mass'; factor: number }> = { ml: { dimension: 'volume', factor: 1 }, l: { dimension: 'volume', factor: 1000 }, g: { dimension: 'mass', factor: 1 }, kg: { dimension: 'mass', factor: 1000 } };
export function sameSize(page: { value: number; unit: string }, size: number | null, unit: string): boolean {
  if (size === null) return false;
  const want = BASE_UNITS[unit];
  if (!want) return page.value === size && page.unit === unit;
  const target = size * want.factor;
  if (page.unit === 'oz') return Math.abs(page.value * (want.dimension === 'volume' ? 29.5735 : 28.3495) - target) <= target * 0.02;
  const base = BASE_UNITS[page.unit];
  return Boolean(base && base.dimension === want.dimension && Math.abs(page.value * base.factor - target) <= target * 0.01);
}

function sizesIn(text: string): Array<{ value: number; unit: string }> {
  const sizes = new Map<string, { value: number; unit: string }>();
  for (const match of text.matchAll(SIZE_PATTERN)) {
    const unit = canonicalUnit(match[2]);
    const value = Number(match[1].replace(',', '.'));
    if (unit && value > 0) sizes.set(`${value}${unit}`, { value, unit });
  }
  return [...sizes.values()];
}

const HEADING_MAX = 60;
const SECTION_HEADINGS = {
  ingredients: /^(full |complete |all )?(ingredients?|ingredient list|ingredients list|inci|composition|المكونات|مكونات)(\s*list)?\s*:?$/i,
  usage: /^(how to use|how to apply|directions?( for use)?|usage|application|instructions?( for use)?|طريقة الاستخدام|الاستخدام|طريقة الاستعمال)\s*:?$/i,
  warnings: /^(warnings?|cautions?|precautions?|safety information|تحذيرات?|احتياطات)\s*:?$/i,
  benefits: /^((key )?benefits|what it does|ideal for|product features ?(?:&|\+|and)? ?benefits|features (?:&|\+|and) benefits|تعمل على|الفوائد)\s*:?$/i,
};
const ANY_HEADING = new RegExp(Object.values(SECTION_HEADINGS).map(pattern => pattern.source).join('|'), 'i');
const INCI_OPENING = /^(aqua|water|eau)\b/i;
const MIN_UNHEADED_INCI = 8;
const INLINE_INCI = /^(?:full |complete )?(?:ingredients?|inci|composition|المكونات)\s*:\s*(.+)$/i;

function sectionLines(lines: string[], heading: RegExp, limit: number): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = [];
  lines.forEach((line, index) => {
    if (line.length > HEADING_MAX || !heading.test(line)) return;
    for (let i = index + 1; i < Math.min(lines.length, index + 1 + limit); i++) {
      if (lines[i] === HEADING_BOUNDARY || (lines[i].length <= HEADING_MAX && ANY_HEADING.test(lines[i]))) break;
      out.push({ text: lines[i], index: i });
    }
  });
  return out;
}

function parseInci(raw: string): string[] | null {
  const cleaned = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\.\s*$/, '');
  const parts = cleaned.split(/\s*(?:[,،](?!\d)|•)\s*/).map(part => part.replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim()).filter(Boolean);
  if (parts.length < 3) return null;
  // Prose has long clauses and verbs between its commas; an ingredient list does not.
  const ingredientLike = parts.filter(part => part.length <= 70 && part.split(' ').length <= 6);
  if (ingredientLike.length / parts.length < 0.9) return null;
  const capitalised = parts.filter(part => /^[\p{Lu}\d]/u.test(part));
  if (capitalised.length / parts.length < 0.7) return null;
  return parts;
}

const KNOWN_ACTIVES = ['niacinamide', 'zinc pca', 'zinc', 'salicylic acid', 'bha', 'aha', 'pha', 'glycolic acid', 'lactic acid', 'mandelic acid', 'azelaic acid', 'retinol', 'retinal', 'retinaldehyde', 'bakuchiol', 'vitamin c', 'ascorbic acid', 'hyaluronic acid', 'sodium hyaluronate', 'urea', 'benzoyl peroxide', 'tranexamic acid', 'arbutin', 'alpha arbutin', 'kojic acid', 'panthenol', 'caffeine', 'adenosine', 'squalane', 'propolis extract', 'snail secretion filtrate'].sort((a, b) => b.length - a.length);
const TEXTURES: Array<[RegExp, string]> = [
  [/\bgel[- ]cream\b/i, 'GEL_CREAM'], [/\bcream\b|\bcreme\b|\bcrème\b/i, 'CREAM'], [/\bgel\b/i, 'GEL'], [/\blotion\b/i, 'LOTION'], [/\bemulsion\b/i, 'EMULSION'],
  [/\bserum\b/i, 'SERUM'], [/\b(face |facial |body |hair )?oil\b/i, 'OIL'], [/\bbalm\b|\bbaume\b/i, 'BALM'], [/\bfoam\b|\bmousse\b/i, 'FOAM'], [/\bspray\b|\bmist\b/i, 'SPRAY'],
  [/\bpaste\b/i, 'PASTE'], [/\bstick\b/i, 'STICK'], [/\bpowder\b/i, 'POWDER'],
];
/** The state the skin or hair should be in when the product is applied; never a skin type. */
const APPLICATION_SURFACE = /\b(?:(?:clean|cleansed|washed|damp|wet|freshly\s+\w+|towel[- ]dried)\s*(?:,|and|or|&)?\s*)+(?:(?:dry|clean|damp)\s*(?:,|and|or|&)?\s*)*(?:skin|hair)\b|\b(?:apply|applied|applying|use|massage)\b[^.\n]{0,40}\b(?:on|to|onto|over)\s+(?:clean\s*,?\s*)?dry\s+(?:skin|hair)\b/gi;
const SKIN_TYPES: Array<[RegExp, string]> = [
  [/\b(all|every) skin types?\b/i, 'all'], [/\bnormal(?: to [a-z]+)? skin\b/i, 'normal'], [/\b(?:very )?dry(?: to [a-z ]+)? skin\b/i, 'dry'], [/\boily(?: to [a-z]+)? skin\b/i, 'oily'],
  [/\bcombination skin\b/i, 'combination'], [/\bsensitive skin\b/i, 'sensitive'], [/\bacne[- ]prone skin\b/i, 'acne-prone'], [/\bmature skin\b/i, 'mature'],
];
const HAIR_TYPES: Array<[RegExp, string]> = [
  [/\ball hair types?\b/i, 'all'], [/\bdry hair\b/i, 'dry'], [/\boily hair\b/i, 'oily'], [/\bcurly hair\b/i, 'curly'], [/\bcoloured hair\b|\bcolored hair\b|\bcolor[- ]treated hair\b/i, 'color-treated'], [/\bdamaged hair\b/i, 'damaged'], [/\bfine hair\b/i, 'fine'],
];
const TARGET_AREAS: Array<[RegExp, string]> = [[/\bface\b|\bfacial\b/i, 'FACE'], [/\beye (?:area|contour|cream)\b/i, 'EYE_CONTOUR'], [/\blips?\b/i, 'LIPS'], [/\bbody\b/i, 'BODY'], [/\bscalp\b/i, 'SCALP'], [/\bhair\b/i, 'HAIR']];
/** A line under "how to use" or "warnings" only counts if it reads like one; navigation and promotions often sit there. */
const USAGE_SIGNAL = /\b(apply|use|massage|rinse|shake|dispense|pump|smooth|spread|wash|wet|lather|leave|soak|cleanse|morning|evening|night|daily|twice|week)\w*\b|ضع|يوضع|استخدم|يستخدم|دلك|اشطف|صباح|مساء/i;
const NO_RINSE_INSTRUCTION = /^no need to rinse(?:[- ]off)?\b/i;
const WARNING_SIGNAL = /\b(avoid|external|caution|discontinue|irritation|consult|keep out|keep away|eyes|children|pregnan|breastfeed|do not|don't|stop use|sun|broken skin|allerg|doctor|physician)\w*\b|تجنب|الخارجي|بعيد|الأطفال|الحمل|الطبيب|توقف/i;
const SUITABILITY_STATEMENT = /\b(suitable|ideal|recommended|designed|formulated)\b|\b(?:skin|hair) types?\s*:|\bfor (all|normal|dry|oily|combination|sensitive|acne[- ]prone|mature|curly|damaged|fine)\b/i;
const CAUTION_LINE = /\b(irritation|consult|cease use|discontinue|patch test|keep out|keep away|external use|avoid contact|unbroken skin)\b/i;
const NOT_AN_INSTRUCTION = /\?\s*$|^\*|\?\s/;
/**
 * A direction is an instruction only when a sentence of it tells the user what to do: it starts with an imperative ("Apply", "Use 1-2 times a week", "Rinse") or
 * names an application act ("massage into wet hair"). Marketing copy under a "How to use" heading ("A hydrating lotion for normal to dry skin", "this daily foaming
 * cleanser") states no instruction, so no rinse mode, period or frequency is ever read from it (regression from the real CeraVe pages, 2026-11-06).
 */
const IMPERATIVE_START = /^(?:(?:for (?:best|optimal) results|to use|then|next|after (?:shampooing|cleansing|washing)|morning and (?:evening|night)|(?:in the )?(?:morning|evening)|at night|daily|gently|once|twice)[,:]?\s+)*(apply|use|massage|rinse|shake|dispense|pump|smooth|spread|wash|leave|wet|lather|pat|squeeze|work|remove|reapply|cleanse|avoid|do not|don't|start|finish|follow|wipe|soak|saturate|comb|distribute|towel|blot)\b/i;
const APPLICATION_ACT = /\b(apply|massage|rinse (?:off|out|thoroughly|well)|dispense|lather|reapply|wet (?:skin|face|hair)|onto (?:wet|damp|dry|clean))\b/i;
const ARABIC_INSTRUCTION = /(^|\s)(ضع|ضعي|يوضع|استخدم|استخدمي|يستخدم|دلك|دلكي|اشطف|اشطفي|وزع|وزعي|يطبق|طبقي|اتركي|اترك)(\s|$)/;
export function instructionSentences(line: string): string[] {
  return line.split(/(?<=[.!؟])\s+|\n+/).map(sentence => sentence.trim().replace(/^[-•*\d.)\s]+/, '')).filter(sentence =>
    sentence.length >= 4 && (IMPERATIVE_START.test(sentence) || APPLICATION_ACT.test(sentence) || ARABIC_INSTRUCTION.test(sentence)));
}
export const isInstructionLine = (line: string) => instructionSentences(line).length > 0;
/** Where a page stops describing this product: related products, bundles and reviews describe others. */
const RELATED_SECTION = /^(products? you may (?:also )?like|you may also like|related products|frequently bought together|customers also|recently viewed|reviews?\b|منتجات (?:مشابهة|ذات صلة))/i;
/** Ingredient names a brand features by name (feature headings, "Key ingredient:" lines). A bounded vocabulary: other words are never read as ingredients. */
const KEY_INGREDIENT_NAME = /\b(ceramides?|hyaluronic|sodium hyaluronate|niacinamide|retinol|retinal|salicylic|glycolic|lactic|mandelic|azelaic|vitamin [a-z]\d?|panthenol|procapil|capixyl|redensyl|keravis|keratin|biotin|argan|peptides?|caffeine|urea|zinc|squalane|aloe|tea tree|rosemary|collagen|green coffee|jojoba|centella|cica|allantoin|bakuchiol|arginine|saw palmetto|thyme|green tea|shea|probiotics?)\b/i;

export function isNavigationIngredientName(value: string): boolean {
  return /^(?:learn|read|discover|shop|explore|find out)\b/i.test(value.trim());
}
const MORNING = /\bmorning\b|\bAM\b|صباح/;
const EVENING = /\bevening\b|\bnight\b|\bbedtime\b|\bPM\b|مساء|ليل/;

const excerptAround = (text: string, needle: string, radius = 90) => {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2);
  return text.slice(Math.max(0, at - radius), Math.min(text.length, at + needle.length + radius)).trim();
};

export function hashFactValue(field: string, value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
    return typeof input === 'string' ? input.normalize('NFKC').trim().toLowerCase() : input;
  };
  return createHash('sha256').update(`${field}|${JSON.stringify(stable(value))}`).digest('hex');
}

function gtinOf(product: Record<string, unknown>): string | null {
  for (const key of ['gtin13', 'gtin', 'gtin14', 'gtin12', 'gtin8', 'ean']) {
    const value = product[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const digits = String(value).trim();
      const declaredLength = key.match(/^gtin(8|12|13|14)$/)?.[1];
      if (isValidGtin(digits) && (!declaredLength || digits.length === Number(declaredLength))) return digits;
    }
  }
  return null;
}

export function extractProductFacts(html: string, pageUrl: string, sku: SkuExpectation): PageExtraction {
  const allSections = structuredLines(html);
  const relatedSection = allSections.findIndex(line => RELATED_SECTION.test(line));
  const sections = relatedSection < 0 ? allSections : allSections.slice(0, relatedSection);
  const lines = sections.filter(line => line !== HEADING_BOUNDARY);
  const text = lines.join('\n');
  const relatedAt = lines.findIndex(line => RELATED_SECTION.test(line));
  const productLines = relatedAt < 0 ? lines : lines.slice(0, relatedAt);
  const products = jsonLdProducts(html);
  // Several Product entries (related items, bundles): only the one the page's own heading names describes this page; none matching → no structured facts.
  const heading = headingText(html) || meta(html, 'og:title') || titleText(html);
  const nodeName = (node: Record<string, unknown>) => (typeof node.name === 'string' ? fold(decode(node.name)) : '');
  const product = products.length <= 1 ? products[0] ?? null
    : products.find(node => { const name = nodeName(node); const head = fold(heading); return Boolean(name) && (name === head || head.includes(name) || name.includes(head)); }) ?? null;
  const facts: ExtractedFact[] = [];
  const rejected: PageExtraction['rejected'] = [];
  const add = (field: FactField, value: unknown, excerpt: string) => facts.push({ field, value, excerpt: excerpt.slice(0, 400) });

  const title = (typeof product?.name === 'string' ? decode(product.name) : '') || headingText(html) || meta(html, 'og:title') || titleText(html);
  const identityText = `${title} ${headingText(html)} ${titleText(html)}`;
  const brandName = typeof product?.brand === 'string' ? product.brand : (product?.brand as { name?: string } | undefined)?.name;

  const wanted = tokens(sku.productName);
  const seen = new Set(tokens(identityText));
  const overlap = wanted.length ? wanted.filter(token => seen.has(token)).length / wanted.length : 0;
  const brandEvidence = fold(`${identityText} ${brandName ?? ''} ${pageUrl}`);
  const brandFound = [sku.brand, ...(sku.brandAliases ?? [])].some(name =>
    brandEvidence.includes(fold(name)) || tokens(name).every(token => brandEvidence.includes(token)));
  // Words that make a different product of the same range (tinted vs not, day vs night, an SPF number): the row and the page must agree on each, whichever side
  // states it. Half the words in common is not enough when the half that differs is one of these (regression from the real Bobai "Tinted" row, 2026-11-07).
  const variantClash = VARIANT_QUALIFIERS.find(([, pattern]) => pattern.test(sku.productName) !== pattern.test(identityText));
  const spfOf = (value: string) => [...new Set([...value.matchAll(SPF_PATTERN)].map(match => Number(match[1] ?? match[2])))];
  const [rowSpf, pageSpf] = [spfOf(sku.productName), spfOf(identityText)];
  const spfClash = rowSpf.length === 1 && pageSpf.length === 1 && rowSpf[0] !== pageSpf[0];
  const identityMatched = overlap >= 0.5 && brandFound && !variantClash && !spfClash;
  if (!identityMatched) {
    const why = variantClash ? ` (${variantClash[0]}: stated by ${variantClash[1].test(sku.productName) ? 'the row' : 'the page'} only)` : spfClash ? ` (SPF ${rowSpf[0]} vs ${pageSpf[0]})` : '';
    rejected.push({ field: '*', reason: 'IDENTITY_MISMATCH', detail: `Page is about "${title.slice(0, 120)}", not ${sku.brand} ${sku.productName}${why}` });
    return { facts: [], rejected, identityMatched: false };
  }

  // Size decides which SKU a page describes. A page that only names another size is another SKU's page.
  const titleSizes = sizesIn(identityText);
  const bodySizes = titleSizes.length ? [] : sizesIn(text);
  const wantedUnit = (sku.sizeUnit ?? '').toLowerCase();
  // The same pack stated another way: 236 ml vs 237 ml (1%), or a US page's "8 fl oz" for 236 ml (imperial conversion, 2%). Different packs are never that close.
  const stated = (size: { value: number; unit: string }) => sameSize(size, sku.size, wantedUnit);
  // Sizes named only in the body are ambiguous; the SKU's own size among them confirms it, and their absence stays unknown rather than a mismatch.
  const pageSizes = titleSizes.length ? titleSizes : bodySizes.filter(stated);
  const matchesSize = sku.size === null || !titleSizes.length || titleSizes.some(stated);
  if (sku.size !== null && !titleSizes.length && !pageSizes.length) rejected.push({ field: 'identity.size', reason: 'SIZE_NOT_CONFIRMED_BY_PAGE', detail: `The page's title names no size and its text does not state ${sku.size}${sku.sizeUnit}` });
  if (!matchesSize) {
    rejected.push({ field: '*', reason: 'SIZE_MISMATCH', detail: `Page states ${pageSizes.map(size => `${size.value}${size.unit}`).join(', ')}; this SKU is ${sku.size}${sku.sizeUnit}` });
    return { facts: [], rejected, identityMatched: false };
  }

  add('identity.name', title, title);
  if (brandName) add('identity.brand', decode(String(brandName)).trim(), `brand: ${brandName}`);
  // A confirmed equivalent is recorded in the SKU's own unit, so a page in fl oz never contradicts the catalog's ml.
  if (sku.size !== null && pageSizes.length === 1) add('identity.size', stated(pageSizes[0]) ? { value: sku.size, unit: wantedUnit } : pageSizes[0], excerptAround(text, `${pageSizes[0].value}`));
  // A product page offering several sizes, this SKU's among them, confirms this variant exists; the confirmation is recorded in the SKU's own size.
  else if (sku.size !== null && pageSizes.length > 1 && pageSizes.some(stated)) add('identity.size', { value: sku.size, unit: wantedUnit }, excerptAround(text, `${pageSizes.find(stated)!.value}`));
  else if (sku.size === null && pageSizes.length === 1) add('identity.size', pageSizes[0], excerptAround(text, `${pageSizes[0].value}`));
  else if (sku.size === null && pageSizes.length > 1) rejected.push({ field: 'identity.size', reason: 'AMBIGUOUS_SIZE', detail: pageSizes.map(size => `${size.value}${size.unit}`).join(', ') });

  // GTIN only from structured data of a page with a single product and size; never from free text, where it could belong to any variant.
  const unambiguousSize = sku.size !== null && (titleSizes.length ? titleSizes : bodySizes).length > 0
    && (titleSizes.length ? titleSizes : bodySizes).every(stated);
  const gtin = product && products.length === 1 && unambiguousSize ? gtinOf(product) : null;
  if (gtin) add('identity.gtin', gtin, `structured data gtin: ${gtin}`);

  // INCI
  const inciCandidates: Array<{ list: string[]; raw: string }> = [];
  for (const line of lines) {
    const inline = line.match(INLINE_INCI);
    if (inline) { const list = parseInci(inline[1]); if (list) inciCandidates.push({ list, raw: inline[1] }); }
  }
  for (const entry of sectionLines(sections, SECTION_HEADINGS.ingredients, 4)) {
    const list = parseInci(entry.text);
    if (list) inciCandidates.push({ list, raw: entry.text });
  }
  if (!inciCandidates.length) {
    // A full formula is recognisable on its own: a long list opening with its water base.
    for (const line of lines) {
      if (!INCI_OPENING.test(line)) continue;
      const list = parseInci(line);
      if (list && list.length >= MIN_UNHEADED_INCI) inciCandidates.push({ list, raw: line });
    }
  }
  const distinctInci = [...new Map(inciCandidates.map(candidate => [hashFactValue('inci', candidate.list), candidate])).values()];
  if (distinctInci.length === 1) add('composition.inci', distinctInci[0].list, distinctInci[0].raw);
  else if (distinctInci.length > 1) {
    // Several formulas on one page usually means variants; choosing one would mix SKUs.
    rejected.push({ field: 'composition.inci', reason: 'MULTIPLE_FORMULAS_ON_PAGE', detail: `${distinctInci.length} different lists` });
  }

  // Stated percentages only: "10% Niacinamide" or "Niacinamide 10%".
  const concentrations = new Map<string, { ingredient: string; percent: number }>();
  const inciFolded = (inciCandidates[0]?.list ?? []).map(fold);
  const addConcentration = (ingredient: string, percent: string) => {
    const value = Number(percent.replace(',', '.'));
    const phrase = fold(ingredient);
    const known = KNOWN_ACTIVES.find(active => ` ${phrase} `.includes(` ${active} `)) ?? inciFolded.find(item => item.length > 3 && ` ${phrase} `.includes(` ${item} `));
    if (!(value > 0 && value <= 100) || !known) return;
    // A percentage for something this formula does not contain belongs to another product on the page. The product's own title is the exception: it names the formula.
    const inFormula = !inciFolded.length || inciFolded.some(item => ` ${item} `.includes(` ${known} `)) || fold(title).includes(known);
    if (!inFormula) { rejected.push({ field: 'composition.activeConcentrations', reason: 'NOT_IN_THIS_FORMULA', detail: `${ingredient} ${percent}%` }); return; }
    const written = ingredient.match(new RegExp(known.split(' ').join('[\\s-]+'), 'i'))?.[0] ?? known;
    concentrations.set(known, { ingredient: written.replace(/\s+/g, ' '), percent: value });
  };
  for (const line of [title, ...lines.filter(line => line.length <= 160)]) {
    for (const match of line.matchAll(/(\d{1,2}(?:[.,]\d+)?)\s?%\s+([\p{Lu}][\p{L}-]+(?:\s[\p{Lu}][\p{L}-]+){0,3})/gu)) addConcentration(match[2], match[1]);
    for (const match of line.matchAll(/([\p{Lu}][\p{L}-]+(?:\s[\p{Lu}][\p{L}-]+){0,3})\s+(\d{1,2}(?:[.,]\d+)?)\s?%/gu)) addConcentration(match[1], match[2]);
  }
  if (concentrations.size) add('composition.activeConcentrations', [...concentrations.values()], excerptAround(text, '%'));

  // Fragrance: the ingredient list outranks a claim; if they disagree, a person decides.
  const inciList = distinctInci.length === 1 ? distinctInci[0].list : [];
  const hasFragrance = inciList.some(item => /^(parfum|fragrance|aroma)$/i.test(item) || /\b(parfum|fragrance)\b/i.test(item));
  // A "fragrance-free" claim counts only in this product's own words: its title, description, feature and benefit text, its own sections, or a short claim line that
  // names no other product (a site-wide tile such as "Unscented Deodorant 50 ml" is another product; regression from the real e-majestic page, 2026-11-06).
  const ownText = [title, (typeof product?.description === 'string' ? decode(product.description) : '') || meta(html, 'og:description') || '',
    ...[SECTION_HEADINGS.benefits, SECTION_HEADINGS.usage, SECTION_HEADINGS.ingredients, SECTION_HEADINGS.warnings].flatMap(heading => sectionLines(sections, heading, 8).map(entry => entry.text)),
    ...productLines.filter(line => line.length <= 60 && !sizesIn(line).length)].join('\n');
  const FREE_CLAIM = /\b(fragrance[- ]free|perfume[- ]free|without fragrance|no fragrance|sans parfum|unscented)\b/i;
  const claimsFree = FREE_CLAIM.test(ownText);
  if (inciList.length && hasFragrance) add('composition.fragrance', 'PRESENT', excerptAround(distinctInci[0].raw, 'parfum') || 'INCI lists fragrance');
  if (claimsFree) add('composition.fragrance', 'FREE', excerptAround(ownText, ownText.match(FREE_CLAIM)![0]));

  const texture = TEXTURES.find(([pattern]) => pattern.test(title));
  if (texture) add('attributes.texture', texture[1], title);
  const area = TARGET_AREAS.find(([pattern]) => pattern.test(title));
  if (area) add('usage.targetArea', area[1], title);

  // Sun protection, in this product's own words: the title first, else its description and its own sections. Short page lines are left out here, because other
  // products' tiles ("Sun Fluid SPF 30") sit among them. Nothing is inferred from the product type: a sunscreen whose page states no SPF keeps it unknown.
  const ownProse = [title, (typeof product?.description === 'string' ? decode(product.description) : '') || meta(html, 'og:description') || '',
    ...[SECTION_HEADINGS.benefits, SECTION_HEADINGS.usage, SECTION_HEADINGS.ingredients, SECTION_HEADINGS.warnings].flatMap(heading => sectionLines(sections, heading, 8).map(entry => entry.text))].join('\n');
  const spfIn = (value: string) => [...new Set([...value.matchAll(SPF_PATTERN)].map(match => Number(match[1] ?? match[2])).filter(n => n >= 2 && n <= 100))];
  const spfs = spfIn(title).length ? spfIn(title) : spfIn(ownProse);
  if (spfs.length === 1) add('attributes.spf', spfs[0], excerptAround(ownProse, `${spfs[0]}`));
  else if (spfs.length > 1) rejected.push({ field: 'attributes.spf', reason: 'SEVERAL_SPF_VALUES', detail: spfs.join(', ') });
  if (spfs.length === 1) {
    const broad = ownProse.match(BROAD_SPECTRUM);
    if (broad) add('attributes.broadSpectrum', true, excerptAround(ownProse, broad[0]));
    const water = ownProse.match(WATER_RESISTANCE);
    const minutes = water ? Number(water[1] ?? water[2]) : null;
    if (minutes && minutes >= 20 && minutes <= 240) add('attributes.waterResistanceMinutes', minutes, excerptAround(ownProse, water![0]));
    // The filter type is what the one ingredient list contains: mineral filters only, organic filters only, or both. Without a list it stays unknown.
    if (inciList.length) {
      const mineral = inciList.some(item => MINERAL_FILTERS.test(item.trim()));
      const chemical = inciList.some(item => CHEMICAL_FILTERS.test(item.trim()));
      if (mineral || chemical) add('attributes.uvFilterType', mineral && chemical ? 'HYBRID' : mineral ? 'MINERAL' : 'CHEMICAL',
        inciList.filter(item => MINERAL_FILTERS.test(item.trim()) || CHEMICAL_FILTERS.test(item.trim())).join(', '));
    }
  }
  const comedogenic = ownText.match(NON_COMEDOGENIC);
  if (comedogenic) add('attributes.nonComedogenic', true, excerptAround(ownText, comedogenic[0]));

  // Product line (range): a breadcrumb step whose words are part of this product's own name, or an explicit "Collection: …" label. Brand, category, product-type,
  // navigation and marketing words are never a line. Two different readings stay unknown.
  const titleWords = ` ${fold(title)} `;
  const brandKeys = new Set([sku.brand, ...(sku.brandAliases ?? [])].map(fold));
  const lines_ = new Map<string, { value: string; excerpt: string }>();
  const considerLine = (raw: string, excerpt: string, mustBeInName: boolean) => {
    const value = raw.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
    const key = fold(value);
    const words = key.split(' ').filter(Boolean);
    if (value.length < 2 || value.length > 40 || !words.length || words.length > 4 || key === fold(title) || brandKeys.has(key)) return;
    if (NOT_A_LINE.test(key) || words.every(word => MARKETING_WORDS.has(word) || brandKeys.has(word)) || sizesIn(value).length || /\d{2,}/.test(value)) return;
    if (readProductType(value).types.length) return;
    if (mustBeInName && !titleWords.includes(` ${key} `)) return;
    lines_.set(key, { value, excerpt });
  };
  const crumbs = breadcrumbNames(html);
  for (const crumb of crumbs) considerLine(crumb, `breadcrumb: ${crumbs.join(' > ')}`, true);
  for (const line of productLines) { const label = line.match(LINE_LABEL); if (label) considerLine(label[1] ?? label[2], line, false); }
  if (lines_.size === 1) { const [only] = lines_.values(); add('merchandising.productLine', only.value, only.excerpt); }
  else if (lines_.size > 1) rejected.push({ field: 'merchandising.productLine', reason: 'SEVERAL_LINE_READINGS', detail: [...lines_.values()].map(item => item.value).join(', ') });

  // Brands often put cautions under "Directions": those lines are warnings, not steps.
  // Short time/area badges can precede actual steps; section boundaries still stop us.
  const directionLines = sectionLines(sections, SECTION_HEADINGS.usage, 12).map(entry => entry.text).filter(line => line.length >= 12 && line.length <= 600 && !NOT_AN_INSTRUCTION.test(line));
  const cautionsInDirections = directionLines.filter(line => CAUTION_LINE.test(line));
  let usage = directionLines.filter(line => USAGE_SIGNAL.test(line) && !CAUTION_LINE.test(line) && (isInstructionLine(line) || NO_RINSE_INSTRUCTION.test(line)));
  if (!usage.length && sectionLines(sections, SECTION_HEADINGS.usage, 1).length) {
    // Tabbed layouts list the tab labels first and the tab contents later: the instruction is on the page but not under its label. Only a line that states an
    // application act, before any related-products section, counts (regression from the real CeraVe Africa pages, 2026-11-06).
    usage = productLines.filter(line => line.length >= 12 && line.length <= 400 && !CAUTION_LINE.test(line) && !NOT_AN_INSTRUCTION.test(line)
      && instructionSentences(line).some(sentence => APPLICATION_ACT.test(sentence))).slice(0, 4);
  }
  if (rinseMode(usage) === 'CONTRADICTORY') {
    const productTypes = [...sku.productName.matchAll(/\b(cleanser|conditioner|shampoo|serum|lotion|sunscreen|cream|gel)\b/gi)].map(match => match[1].toLowerCase());
    const namedDirections = usage.filter(line => productTypes.some(type => new RegExp(`\\b${type}\\b`, 'i').test(line)));
    if (namedDirections.length && !['UNKNOWN', 'CONTRADICTORY'].includes(rinseMode(namedDirections))) usage = namedDirections;
  }
  if (usage.length) {
    add('usage.instructions', [...new Set(usage)], usage.join(' ').slice(0, 400));
    const joined = usage.join(' ');
    const morning = MORNING.test(joined);
    const evening = EVENING.test(joined);
    if (morning || evening) add('usage.routinePeriod', morning && evening ? 'BOTH' : morning ? 'AM' : 'PM', joined.slice(0, 300));
  }
  const warnings = [...sectionLines(sections, SECTION_HEADINGS.warnings, 5).map(entry => entry.text).filter(line => line.length >= 10 && line.length <= 600 && WARNING_SIGNAL.test(line)), ...cautionsInDirections];
  if (warnings.length) add('safety.warnings', [...new Set(warnings)], warnings.join(' ').slice(0, 400));

  const pageDescription = (typeof product?.description === 'string' ? decode(product.description) : '') || meta(html, 'og:description') || meta(html, 'description') || '';
  // "Apply to clean, dry skin" says what the product goes on, not whom it suits: those surface phrases are removed before skin and hair types are read
  // (found on three real pages, whose meta description carries the whole "How to use" text, 2026-11-08).
  const statedSuitability = [pageDescription, ...lines.filter(line => line.length <= 200 && SUITABILITY_STATEMENT.test(line))].join('\n').replace(APPLICATION_SURFACE, ' ');
  const skinTypes = SKIN_TYPES.filter(([pattern]) => pattern.test(statedSuitability)).map(([, value]) => value);
  if (skinTypes.length) add('suitability.skinTypes', skinTypes, excerptAround(statedSuitability, 'skin'));
  const hairTypes = HAIR_TYPES.filter(([pattern]) => pattern.test(statedSuitability)).map(([, value]) => value);
  if (hairTypes.length) add('suitability.hairTypes', hairTypes, excerptAround(statedSuitability, 'hair'));

  const description = (typeof product?.description === 'string' ? decode(product.description) : '') || meta(html, 'og:description') || meta(html, 'description');
  // Some sites encode their meta description twice ("face &amp;amp; body"): one more pass when entities are still left, so no "&amp;" reaches the catalog.
  const plain = description ? (/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i.test(decode(description)) ? decode(decode(description)) : decode(description)) : '';
  if (/\bcleanser\b/i.test(title) && /\blotion\b/i.test(plain.slice(0, 100)) && /\buntil fully absorbed\b/i.test(plain)) {
    rejected.push({ field: 'marketing.description', reason: 'PRODUCT_TYPE_CONFLICT', detail: 'Cleanser page contains leave-on lotion copy' });
  } else if (plain && plain.length >= 30) add('marketing.description', plain.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000), plain);
  // Feature cards: a short heading followed by one line ("3 Essential Ceramides" / "To help protect the natural skin barrier"), within the product's own part of the page.
  const pairs: Array<{ heading: string; body: string }> = [];
  const relatedSectionAt = sections.findIndex(line => RELATED_SECTION.test(line));
  const productSections = relatedSectionAt < 0 ? sections : sections.slice(0, relatedSectionAt);
  for (let i = 0; i + 2 < productSections.length; i++) {
    if (productSections[i] !== HEADING_BOUNDARY) continue;
    const [heading, body] = [productSections[i + 1], productSections[i + 2]];
    if (body === HEADING_BOUNDARY || heading.length > 50 || body.length < 8 || body.length > 200 || ANY_HEADING.test(heading) || heading === title || ANY_HEADING.test(body)) continue;
    pairs.push({ heading: heading.replace(/[™®]/g, '').replace(/\s+/g, ' ').trim(), body });
  }
  const benefits = [...sectionLines(sections, SECTION_HEADINGS.benefits, 8).map(entry => entry.text).filter(line => line.length >= 8 && line.length <= 300 && !ANY_HEADING.test(line)),
    ...pairs.map(pair => `${pair.heading}: ${pair.body}`)];
  if (benefits.length) add('claims.manufacturerStated', [...new Set(benefits)].slice(0, 16), benefits.join(' ').slice(0, 400));

  // Key ingredients the manufacturer names, with what it says each does. A short ingredient list that is not a full INCI is exactly this, never a formula.
  const keyIngredients = new Map<string, { name: string; function: string | null }>();
  const addKey = (name: string, fn: string | null) => {
    const clean = name.replace(/[™®]/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 3 || clean.length > 40 || !KEY_INGREDIENT_NAME.test(clean) || isNavigationIngredientName(clean)) return;
    const key = fold(clean);
    if (!keyIngredients.has(key) || (fn && !keyIngredients.get(key)!.function)) keyIngredients.set(key, { name: clean, function: fn });
  };
  for (const line of productLines) {
    const stated = line.match(/^key ingredients?\s*:\s*(.{3,200})$/i);
    if (stated) for (const name of stated[1].split(/\s*(?:,|،|\band\b|&)\s*/i)) addKey(name, null);
  }
  if (!distinctInci.length) {
    for (const entry of sectionLines(sections, SECTION_HEADINGS.ingredients, 10)) if (entry.text.split(' ').length <= 4 && !/\d{2,}/.test(entry.text)) addKey(entry.text, null);
  }
  for (const pair of pairs) if (pair.heading.split(' ').length <= 4) addKey(pair.heading.replace(/^\d+\s+(?:essential\s+)?/i, ''), pair.body);
  if (keyIngredients.size) {
    const list = [...keyIngredients.values()].slice(0, 12);
    add('composition.keyIngredients', list, list.map(item => (item.function ? `${item.name}: ${item.function}` : item.name)).join('; '));
  }

  const images = new Set<string>();
  const addImage = (value: unknown) => {
    if (typeof value === 'string') {
      try {
        const url = new URL(value, pageUrl);
        // Named campaign/infographic directories cannot establish a primary
        // packshot, even when a manufacturer embeds them on its product page.
        if (!/\/(?:infographics?|homepage|campaigns?|banners?)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) images.add(url.toString());
      } catch { /* not a URL */ }
    }
    else if (Array.isArray(value)) value.forEach(addImage);
    else if (value && typeof value === 'object') addImage((value as { url?: unknown; contentUrl?: unknown }).url ?? (value as { contentUrl?: unknown }).contentUrl);
  };
  if (product) addImage(product.image);
  const og = meta(html, 'og:image');
  if (og && !images.size) addImage(og);
  // A product page may expose a small hero image but a usable alternate in its gallery.
  // Keep only gallery files in the hero image's exact directory; other folders can be related products or campaign art.
  const hero = [...images][0];
  if (hero) {
    const heroUrl = new URL(hero);
    // L'Oreal galleries expose native zoom originals in a different locale folder
    // from their small OG thumbnail. Keep them as candidates, never identity proof.
    const galleryWords = fold(sku.productName).split(/[^a-z0-9]+/).filter(word => word.length >= 2 && !['the', 'and', 'for', 'with', 'of'].includes(word));
    const relatedHeading = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
      .find(match => RELATED_SECTION.test(htmlToLines(match[1]).join(' ')));
    const productHtml = relatedHeading ? html.slice(0, relatedHeading.index) : html;
    for (const match of productHtml.matchAll(/<img\b[^>]*>/gi)) {
      const classes = match[0].match(/\bclass=["']([^"']*)["']/i)?.[1].split(/\s+/) ?? [];
      const src = match[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (!classes.includes('xzoom') || !src || galleryWords.length < 2) continue;
      try {
        const url = new URL(decode(src), pageUrl);
        const filename = fold(decode(url.pathname.slice(url.pathname.lastIndexOf('/') + 1))).replace(/[^a-z0-9]/g, '');
        if (url.protocol === 'https:' && url.hostname === heroUrl.hostname && galleryWords.every(word => filename.includes(word))) images.add(url.toString());
      } catch { /* invalid gallery URL */ }
    }
    const directory = heroUrl.pathname.slice(0, heroUrl.pathname.lastIndexOf('/') + 1);
    for (const match of html.matchAll(/(?:data-)?srcset=["']([^"']+)["']/gi)) {
      const options = match[1].replace(/&amp;/g, '&').split(',').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]);
      const best = options.sort((a, b) => (Number.parseInt(b[1] ?? '0', 10) || 0) - (Number.parseInt(a[1] ?? '0', 10) || 0))[0];
      try {
        const url = new URL(best[0], pageUrl);
        if (url.protocol === 'https:' && url.hostname === heroUrl.hostname && url.pathname.startsWith(directory) &&
            url.pathname.slice(directory.length).indexOf('/') === -1) images.add(url.toString());
      } catch { /* invalid gallery URL */ }
    }
  }
  // AEM configurable product pages bind each size to its own assets. Their generic
  // OG/gallery hero can be another size (real Sensibio 250 ml -> default 500 ml).
  const variantForms = [...html.matchAll(/<form\b[^>]*\bdata-product-variants=["']([^"']*)["'][^>]*>/gi)]
    .filter(match => /\bdata-product-sku=/.test(match[0]));
  if (variantForms.length) {
    images.clear();
    try {
      const variants: unknown = JSON.parse(decode(variantForms[0][1]));
      if (variantForms.length === 1 && Array.isArray(variants) && variants.length <= 200 && sku.size !== null) {
        const matching = variants.filter(variant => {
          if (!variant || typeof variant.name !== 'string') return false;
          const sizes = sizesIn(variant.name), words = new Set(tokens(variant.name));
          const dimensions = variant.variantAttributes;
          return sizes.length === 1 && stated(sizes[0]) && wanted.length > 0 && wanted.filter(word => words.has(word)).length / wanted.length >= 0.5
            && (!dimensions || (typeof dimensions === 'object' && Object.keys(dimensions).every(key => key === 'volume')))
            && !VARIANT_QUALIFIERS.some(([, pattern]) => pattern.test(sku.productName) !== pattern.test(variant.name));
        });
        if (matching.length === 1 && Array.isArray(matching[0].assets)) {
          const primary = matching[0].assets.filter((asset: { type?: string; position?: number; videoUrl?: string; path?: string }) =>
            asset && asset.type === 'image' && asset.position === 0 && !asset.videoUrl && typeof asset.path === 'string');
          if (primary.length === 1) addImage(primary[0].path);
        }
      }
    } catch { /* malformed variant data cannot establish an image/size association */ }
    if (!images.size) rejected.push({ field: 'media.sourceImages', reason: 'VARIANT_IMAGE_NOT_CONFIRMED', detail: 'No unique primary asset is bound to this exact variant' });
  } else {
    // SFCC size selectors expose every offered size while their hero/JSON-LD
    // describes only the selected one (real Cetaphil 236 ml -> default 1 L).
    const selectors = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
      .filter(match => /\bclass=["'][^"']*\bselect-size\b[^"']*["']/i.test(match[1]));
    if (selectors.length) {
      const selected = selectors.flatMap(selector => [...selector[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
        .filter(option => /(?:^|\s)selected(?:\s|=|$)/i.test(option[1]))
        .flatMap(option => sizesIn(htmlToLines(option[2]).join(' '))));
      if (selectors.length !== 1 || selected.length !== 1 || !stated(selected[0])) images.clear();
      else for (const image of images) {
        try {
          const namedSizes = sizesIn(decodeURIComponent(new URL(image).pathname));
          if (namedSizes.some(size => !stated(size))) images.delete(image);
        } catch { images.delete(image); }
      }
      if (!images.size) rejected.push({ field: 'media.sourceImages', reason: 'VARIANT_IMAGE_NOT_CONFIRMED', detail: 'The selected size does not bind a primary image to this exact SKU' });
    }
  }
  const imageList = [...images].filter(url => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } }).slice(0, 8);
  if (imageList.length) add('media.sourceImages', imageList, imageList[0]);

  return { facts, rejected, identityMatched: true };
}
