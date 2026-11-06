import { createHash } from 'crypto';

/**
 * Deterministic extraction of product facts from one fetched page. Everything returned is literally on that page and carries the excerpt that states it; anything else
 * stays unknown. Versioned because a stored proposal must say which rules produced it.
 */
export const RESEARCH_SCHEMA_VERSION = 1;

export type FactField =
  | 'identity.name' | 'identity.brand' | 'identity.gtin' | 'identity.size'
  | 'composition.inci' | 'composition.activeConcentrations' | 'composition.fragrance'
  | 'attributes.texture' | 'usage.instructions' | 'usage.routinePeriod' | 'usage.targetArea'
  | 'suitability.skinTypes' | 'suitability.hairTypes' | 'safety.warnings' | 'marketing.description' | 'claims.manufacturerStated' | 'media.sourceImages';

export const ALL_FACT_FIELDS: readonly FactField[] = [
  'identity.name', 'identity.brand', 'identity.gtin', 'identity.size', 'composition.inci', 'composition.activeConcentrations', 'composition.fragrance',
  'attributes.texture', 'usage.instructions', 'usage.routinePeriod', 'usage.targetArea', 'suitability.skinTypes', 'suitability.hairTypes', 'safety.warnings',
  'marketing.description', 'claims.manufacturerStated', 'media.sourceImages',
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

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', copy: '©', eacute: 'é', egrave: 'è', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };
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
    .replace(/<(script|style|noscript|svg|nav|footer|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h[1-6]\b/gi, match => `\n${HEADING_BOUNDARY}\n${match}`)
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(body).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function jsonLdProducts(html: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) found.push(record);
    if (record['@graph']) visit(record['@graph']);
    if (record.mainEntity) visit(record.mainEntity);
  };
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch { /* a broken block is not evidence */ }
  }
  return found;
}

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

const SIZE_PATTERN = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s?(ml|mL|ML|fl\.?\s?oz|oz|g|gm|kg|l|L|مل|جم|جرام)(?![\p{L}\p{N}])/gu;
function canonicalUnit(unit: string): string | null {
  const folded = unit.toLowerCase().replace(/[.\s]/g, '');
  if (folded === 'ml' || folded === 'مل') return 'ml';
  if (folded === 'g' || folded === 'gm' || folded === 'جم' || folded === 'جرام') return 'g';
  if (folded === 'floz' || folded === 'oz') return 'oz';
  if (folded === 'l') return 'l';
  if (folded === 'kg') return 'kg';
  return null;
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
  benefits: /^((key )?benefits|what it does|تعمل على|الفوائد)\s*:?$/i,
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
  const parts = cleaned.split(/\s*[,،](?!\d)\s*/).map(part => part.replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim()).filter(Boolean);
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
const SKIN_TYPES: Array<[RegExp, string]> = [
  [/\b(all|every) skin types?\b/i, 'all'], [/\bnormal(?: to [a-z]+)? skin\b/i, 'normal'], [/\b(?:very )?dry(?: to [a-z ]+)? skin\b/i, 'dry'], [/\boily(?: to [a-z]+)? skin\b/i, 'oily'],
  [/\bcombination skin\b/i, 'combination'], [/\bsensitive skin\b/i, 'sensitive'], [/\bacne[- ]prone skin\b/i, 'acne-prone'], [/\bmature skin\b/i, 'mature'],
];
const HAIR_TYPES: Array<[RegExp, string]> = [
  [/\ball hair types?\b/i, 'all'], [/\bdry hair\b/i, 'dry'], [/\boily hair\b/i, 'oily'], [/\bcurly hair\b/i, 'curly'], [/\bcoloured hair\b|\bcolored hair\b|\bcolor[- ]treated hair\b/i, 'color-treated'], [/\bdamaged hair\b/i, 'damaged'], [/\bfine hair\b/i, 'fine'],
];
const TARGET_AREAS: Array<[RegExp, string]> = [[/\bface\b|\bfacial\b/i, 'FACE'], [/\beye (?:area|contour|cream)\b/i, 'EYE_CONTOUR'], [/\blips?\b/i, 'LIPS'], [/\bbody\b/i, 'BODY'], [/\bscalp\b/i, 'SCALP'], [/\bhair\b/i, 'HAIR']];
/** A line under "how to use" or "warnings" only counts if it reads like one; navigation and promotions often sit there. */
const USAGE_SIGNAL = /\b(apply|use|massage|rinse|shake|dispense|pump|smooth|spread|wash|leave|morning|evening|night|daily|twice|week)\w*\b|ضع|يوضع|استخدم|يستخدم|دلك|اشطف|صباح|مساء/i;
const WARNING_SIGNAL = /\b(avoid|external|caution|discontinue|irritation|consult|keep out|keep away|eyes|children|pregnan|breastfeed|do not|don't|stop use|sun|broken skin|allerg|doctor|physician)\w*\b|تجنب|الخارجي|بعيد|الأطفال|الحمل|الطبيب|توقف/i;
const SUITABILITY_STATEMENT = /\b(suitable|ideal|recommended|designed|formulated|skin types?:|hair types?:)\b|\bfor (all|normal|dry|oily|combination|sensitive|acne[- ]prone|mature|curly|damaged|fine)\b/i;
const CAUTION_LINE = /\b(irritation|consult|cease use|discontinue|patch test|keep out|keep away|external use|avoid contact|unbroken skin)\b/i;
const NOT_AN_INSTRUCTION = /\?\s*$|^\*|\?\s/;
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
      const digits = String(value).replace(/\D/g, '');
      if ([8, 12, 13, 14].includes(digits.length)) return digits;
    }
  }
  return null;
}

export function extractProductFacts(html: string, pageUrl: string, sku: SkuExpectation): PageExtraction {
  const sections = structuredLines(html);
  const lines = sections.filter(line => line !== HEADING_BOUNDARY);
  const text = lines.join('\n');
  const products = jsonLdProducts(html);
  const product = products[0] ?? null;
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
  const identityMatched = overlap >= 0.5 && brandFound;
  if (!identityMatched) {
    rejected.push({ field: '*', reason: 'IDENTITY_MISMATCH', detail: `Page is about "${title.slice(0, 120)}", not ${sku.brand} ${sku.productName}` });
    return { facts: [], rejected, identityMatched: false };
  }

  // Size decides which SKU a page describes. A page that only names another size is another SKU's page.
  const titleSizes = sizesIn(identityText);
  const bodySizes = titleSizes.length ? [] : sizesIn(text);
  const wantedUnit = (sku.sizeUnit ?? '').toLowerCase();
  const stated = (size: { value: number; unit: string }) => size.value === sku.size && size.unit === wantedUnit;
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
  if (sku.size !== null && pageSizes.length === 1) add('identity.size', pageSizes[0], excerptAround(text, `${pageSizes[0].value}`));
  else if (sku.size === null && pageSizes.length === 1) add('identity.size', pageSizes[0], excerptAround(text, `${pageSizes[0].value}`));
  else if (sku.size === null && pageSizes.length > 1) rejected.push({ field: 'identity.size', reason: 'AMBIGUOUS_SIZE', detail: pageSizes.map(size => `${size.value}${size.unit}`).join(', ') });

  // GTIN only from structured data of a page with a single product and size; never from free text, where it could belong to any variant.
  const gtin = product && products.length === 1 ? gtinOf(product) : null;
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
  const claimsFree = /\b(fragrance[- ]free|perfume[- ]free|without fragrance|no fragrance|sans parfum|unscented)\b/i.test(text);
  if (inciList.length && hasFragrance) add('composition.fragrance', 'PRESENT', excerptAround(distinctInci[0].raw, 'parfum') || 'INCI lists fragrance');
  if (claimsFree) add('composition.fragrance', 'FREE', excerptAround(text, 'fragrance'));

  const texture = TEXTURES.find(([pattern]) => pattern.test(title));
  if (texture) add('attributes.texture', texture[1], title);
  const area = TARGET_AREAS.find(([pattern]) => pattern.test(title));
  if (area) add('usage.targetArea', area[1], title);

  // Brands often put cautions under "Directions": those lines are warnings, not steps.
  const directionLines = sectionLines(sections, SECTION_HEADINGS.usage, 6).map(entry => entry.text).filter(line => line.length >= 12 && line.length <= 600 && !NOT_AN_INSTRUCTION.test(line));
  const cautionsInDirections = directionLines.filter(line => CAUTION_LINE.test(line));
  const usage = directionLines.filter(line => USAGE_SIGNAL.test(line) && !CAUTION_LINE.test(line));
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
  const statedSuitability = [pageDescription, ...lines.filter(line => line.length <= 200 && SUITABILITY_STATEMENT.test(line))].join('\n');
  const skinTypes = SKIN_TYPES.filter(([pattern]) => pattern.test(statedSuitability)).map(([, value]) => value);
  if (skinTypes.length) add('suitability.skinTypes', skinTypes, excerptAround(statedSuitability, 'skin'));
  const hairTypes = HAIR_TYPES.filter(([pattern]) => pattern.test(statedSuitability)).map(([, value]) => value);
  if (hairTypes.length) add('suitability.hairTypes', hairTypes, excerptAround(statedSuitability, 'hair'));

  const description = (typeof product?.description === 'string' ? decode(product.description) : '') || meta(html, 'og:description') || meta(html, 'description');
  if (description && description.length >= 30) add('marketing.description', description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000), description);
  const benefits = sectionLines(sections, SECTION_HEADINGS.benefits, 6).map(entry => entry.text).filter(line => line.length >= 25 && line.length <= 300);
  if (benefits.length) add('claims.manufacturerStated', [...new Set(benefits)], benefits.join(' ').slice(0, 400));

  const images = new Set<string>();
  const addImage = (value: unknown) => {
    if (typeof value === 'string') { try { images.add(new URL(value, pageUrl).toString()); } catch { /* not a URL */ } }
    else if (Array.isArray(value)) value.forEach(addImage);
    else if (value && typeof value === 'object') addImage((value as { url?: unknown; contentUrl?: unknown }).url ?? (value as { contentUrl?: unknown }).contentUrl);
  };
  if (product) addImage(product.image);
  const og = meta(html, 'og:image');
  if (og) addImage(og);
  const imageList = [...images].filter(url => url.startsWith('https://')).slice(0, 8);
  if (imageList.length) add('media.sourceImages', imageList, imageList[0]);

  return { facts, rejected, identityMatched: true };
}
