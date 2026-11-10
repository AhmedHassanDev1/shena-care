// Deterministic identity text for messy Arabic/English supplier titles (GLO-285). A bounded vocabulary, not a parser:
// words it cannot read stay unknown. Vetoes come from stated facts; soft scores only order candidates for a reviewer.

/** NFKC, case, invisible marks, Arabic letter variants and Arabic/Persian digits; punctuation is left to the caller. */
export function foldIdentityText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\p{Cf}/gu, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/٫/g, '.').replace(/٪/g, '%')
    .replace(/[أإآٱ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
    .replace(/[کگ]/g, 'ك').replace(/[یى]/g, 'ي').replace(/ة/g, 'ه').replace(/[پ]/g, 'ب').replace(/[ڤ]/g, 'ف').replace(/[چ]/g, 'ج');
}

/** The folding v1 fingerprints were stored with before GLO-285. Only for finding those stored rows, never for new identity. */
export function legacyFoldIdentityText(value: unknown): string {
  return String(value ?? '').toLowerCase()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىي]/g, 'ي')
    .replace(/[\u064B-\u065F\u0640]/g, '');
}

const ARABIC = /[؀-ۿ]/;
export const hasArabic = (value: string) => ARABIC.test(value);

// Arabic definite/preposition prefixes on a word long enough to survive them. A lone waw is a letter too often.
const stem = (word: string) => {
  if (!hasArabic(word)) return word;
  const bare = word.replace(/^(?:وال|بال|لل|ال)/, '');
  return bare.length >= 3 ? bare : word;
};

export function identityWords(value: unknown): string[] {
  return foldIdentityText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean).map(stem);
}

/**
 * Phonetic consonant skeleton shared by Arabic and Latin spellings (سيرافي / CeraVe -> "srf"). Candidate retrieval and
 * cross-script word comparison only: short skeletons collide, so it is never brand admission or SKU proof.
 */
export function phoneticSkeleton(value: string): string {
  const text = foldIdentityText(value).replace(/[^\p{L}\p{N}]+/gu, '');
  if (hasArabic(text)) {
    const map: Record<string, string> = { ب: 'b', ت: 't', ط: 't', ث: 't', س: 's', ص: 's', ز: 's', ذ: 's', ظ: 's', ج: 'j', غ: 'j',
      ح: 'h', خ: 'h', ه: 'h', د: 'd', ض: 'd', ر: 'r', ش: 'x', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n' };
    return text.replace(/ه$/, '').split('').map(ch => map[ch] ?? (/\d/.test(ch) ? ch : '')).join('').replace(/(.)\1+/g, '$1');
  }
  return text.replace(/x/g, 'ks').replace(/ph/g, 'f').replace(/[sc]h/g, 'x').replace(/th/g, 't').replace(/gh/g, '').replace(/ck/g, 'k').replace(/qu/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/g/g, 'j').replace(/v/g, 'f')
    .replace(/z/g, 's').replace(/p/g, 'b').replace(/[aeiouyw]/g, '').replace(/(.)\1+/g, '$1');
}

type Dimension = 'type' | 'texture' | 'active' | 'target' | 'concern' | 'benefit' | 'time' | 'area';
// Facts in one dimension contradict when they cannot describe one product. `benefit` only counts as corroboration.
const VOCABULARY: Array<[Dimension[], string, string]> = [
  [['type'], 'cleanser', 'cleanser|cleansing|wash|غسول|منظف|كلينزر|واش'],
  [['type'], 'serum', 'serum|سيروم'],
  [['type', 'texture'], 'cream', 'cream|creme|كريم|كريمه'],
  [['type', 'texture'], 'lotion', 'lotion|لوشن'],
  [['type'], 'shampoo', 'shampoo|شامبو'],
  [['type'], 'conditioner', 'conditioner|بلسم|بلسام|كوندشنر|كونديشنر'],
  [['type'], 'toner', 'toner|تونر'],
  [['type'], 'mask', 'mask|ماسك|قناع'],
  [['type'], 'sunscreen', 'sunscreen|sunblock|sun block|sun screen|واقي شمس|واقي|صن بلوك|صن سكرين|سن بلوك|سن سكرين'],
  [['type'], 'scrub', 'scrub|exfoliator|peeling|مقشر|سكراب|بيلينج'],
  [['type'], 'micellar', 'micellar|micellar water|ميسيلار|ميسلار|ماء ميسيلار|ميسيلار ووتر'],
  [['texture'], 'gel', 'gel|جل|جيل'],
  [['texture'], 'foam', 'foam|foaming|فوم|فومنج|فومينج|رغوي|رغويه|رغوه'],
  [['texture'], 'oil', 'oil|زيت'],
  [['texture'], 'balm', 'balm|baume|بالم'],
  [['texture'], 'stick', 'stick|ستيك'],
  [['texture'], 'spray', 'spray|mist|سبراي|بخاخ|ميست'],
  [['active'], 'retinol', 'retinol|ريتينول|ريتنول'],
  [['active'], 'retinal', 'retinal|ريتينال'],
  [['active'], 'niacinamide', 'niacinamide|نياسيناميد|نياسينامايد|نيكوتيناميد'],
  [['active'], 'salicylic', 'salicylic|salicylic acid|bha|ساليسيليك|سالسيليك'],
  [['active'], 'hyaluronic', 'hyaluronic|hyaluronic acid|هيالورونيك|هيالورنيك|هيالورون|هيالورونيك اسيد'],
  [['active'], 'glycolic', 'glycolic|glycolic acid|جليكوليك'],
  [['active'], 'vitamin-c', 'vitamin c|vit c|فيتامين سي|فيتامين c'],
  [['active'], 'vitamin-e', 'vitamin e|vit e|فيتامين اي|فيتامين e'],
  [['active'], 'azelaic', 'azelaic|azelaic acid|ازيليك'],
  [['active'], 'benzoyl', 'benzoyl|benzoyl peroxide|بنزويل'],
  [['active'], 'lactic', 'lactic|lactic acid|لاكتيك'],
  [['active'], 'kojic', 'kojic|kojic acid|كوجيك'],
  [['active'], 'tranexamic', 'tranexamic|tranexamic acid|ترانيكساميك'],
  [['active'], 'zinc', 'zinc|زنك'],
  [['active'], 'ceramide', 'ceramide|ceramides|سيراميد'],
  [['active'], 'collagen', 'collagen|كولاجين'],
  [['active'], 'peptide', 'peptide|peptides|ببتيد'],
  [['active'], 'caffeine', 'caffeine|كافيين'],
  [['active'], 'biotin', 'biotin|بيوتين'],
  [['active'], 'keratin', 'keratin|كيراتين'],
  [['active'], 'argan', 'argan|ارجان'],
  [['active'], 'sulfur', 'sulfur|sulphur|كبريت'],
  [['active'], 'urea', 'urea|يوريا'],
  [['target'], 'oily', 'oily|دهنيه|دهني'],
  [['target'], 'dry', 'dry|جافه|جاف'],
  [['target'], 'sensitive', 'sensitive|حساسه|حساس'],
  [['target'], 'combination', 'combination|combined|مختلطه'],
  [['target'], 'acne', 'acne|blemish|حبوب|حب الشباب'],
  [['target'], 'colored', 'colored|coloured|مصبوغ'],
  [['target'], 'damaged', 'damaged|تالف|متضرر'],
  [['target'], 'curly', 'curly|مجعد|كيرلي'],
  [['concern'], 'brightening', 'brightening|whitening|lightening|تفتيح|مفتح|تبييض|برايتنينج|وايتننج'],
  [['concern'], 'anti-aging', 'anti aging|anti ageing|anti wrinkle|مضاد تجاعيد|ضد تجاعيد|تجاعيد'],
  [['concern'], 'anti-dandruff', 'anti dandruff|dandruff|ضد قشره|قشره|هيشره|انتي داندرف|داندرف'],
  [['concern'], 'anti-hair-fall', 'anti hair fall|hair fall|hair loss|ضد تساقط|تساقط|انتي هير فول|هير فول'],
  [['benefit'], 'hydrating', 'hydrating|hydration|hydra|moisturizer|moisturiser|moisturizing|moisturising|مرطب|مرطبه|ترطيب|هيدراتينج|هيدريتنج|هيدرا|مويسترايزر|مويسترايزينج'],
  [['benefit'], 'nourishing', 'nourishing|nutrition|مغذي|مغذيه|تغذيه|نوريشينج'],
  [['benefit'], 'purifying', 'purifying|منقي|منقيه|تنقيه|بيوريفاينج'],
  [['benefit'], 'antioxidant', 'antioxidant|anti oxidant|مضاد للاكسده|مضاد اكسده'],
  [['benefit'], 'soothing', 'soothing|calming|مهدئ|مهدئه|تهدئه|سوذينج'],
  [['benefit'], 'repair', 'repair|repairing|ريباير|اصلاح|ترميم'],
  [['benefit'], 'renewing', 'renewing|مجدد|رينيوينج'],
  [['benefit'], 'firming', 'firming|شد|فيرمينج'],
  [['benefit'], 'smoothing', 'smoothing|تنعيم|ناعم|سموذينج'],
  [['benefit'], 'gentle', 'gentle|لطيف|لطيفه|جينتل'],
  [['benefit'], 'intensive', 'intensive|مكثف|مكثفه|انتنسيف'],
  [['benefit'], 'daily', 'daily|يومي|يوميه|ديلي'],
  [['time'], 'day', 'day|نهاري|داي'],
  [['time'], 'night', 'night|ليلي|نايت'],
  [['area'], 'face', 'face|facial|وجه|فيس|فيشيال'],
  [['area'], 'body', 'body|جسم|بودي'],
  [['area'], 'hair', 'hair|شعر|هير'],
  [['area'], 'eye', 'eye|eyes|عين|عيون|ايز'],
  [['area'], 'lip', 'lip|lips|شفاه|شفايف'],
  [['area'], 'hand', 'hand|hands|يد|ايدي'],
  [['area'], 'foot', 'foot|feet|قدم|قدمين'],
];
const TERMS = VOCABULARY.flatMap(([dimensions, concept, terms]) => terms.split('|').map(term => ({
  words: identityWords(term), dimensions, concept,
}))).sort((a, b) => b.words.length - a.words.length);
const TERMS_BY_FIRST = new Map<string, typeof TERMS>();
for (const term of TERMS) TERMS_BY_FIRST.set(term.words[0], [...(TERMS_BY_FIRST.get(term.words[0]) ?? []), term]);

// Carry no identity in either direction.
const GENERIC = new Set(`for with to and the of in by on all types type normal skin size original brand product products imported spf version formula acid
  من مع الي في علي عن ل و ذا ذي دي بشره عاديه جميع انواع نوع كل حجم اصلي ماركه براند منتج مستورد عامل حمايه اصدار تركيبه اسيد حمض`.split(/\s+/).map(stem));
// Bare numbers and glued markers (spf30, v2) are compared as measures and formula markers, not as words.
const NUMERIC = /^(?:\d+(?:\.\d+)?|spf\d+|v\d+)$/;

export interface ParsedTitle {
  facts: Record<Dimension, Set<string>>;
  /** Words outside the vocabulary. They are unknown wording, never a contradiction. */
  descriptors: string[];
}

function matchesBrand(words: string[], index: number, brands: BrandShape[]): number {
  for (const brand of brands) {
    if (brand.words.has(words[index]) || (brand.initials.length >= 3 && words[index] === brand.initials)) return 1;
    for (let span = Math.min(3, words.length - index); span >= 1; span--) {
      const skeleton = phoneticSkeleton(words.slice(index, index + span).join(''));
      if (skeleton === brand.skeleton) return span;
      if (span === 1 && skeleton.length >= 2 && brand.skeleton.length >= 4 && brand.skeleton.includes(skeleton)) return 1;
    }
  }
  return 0;
}

interface BrandShape { words: Set<string>; skeleton: string; initials: string }
const brandShape = (label: string): BrandShape => {
  const words = identityWords(label);
  return { words: new Set(words), skeleton: phoneticSkeleton(words.join('')), initials: words.map(w => w[0]).join('') };
};

const parsed = new Map<string, ParsedTitle>();
/** Splits a cleaned title (measures already removed) into stated facts and unknown wording, ignoring the brand. */
export function parseIdentityTitle(title: string, brandLabels: string[] = []): ParsedTitle {
  const key = `${title}\u0000${brandLabels.join('\u0000')}`;
  const cached = parsed.get(key);
  if (cached) return cached;
  const words = identityWords(title);
  const brands = brandLabels.filter(Boolean).map(brandShape);
  const facts: ParsedTitle['facts'] = { type: new Set(), texture: new Set(), active: new Set(), target: new Set(),
    concern: new Set(), benefit: new Set(), time: new Set(), area: new Set() };
  const descriptors: string[] = [];
  for (let i = 0; i < words.length;) {
    const term = TERMS_BY_FIRST.get(words[i])?.find(t => t.words.every((word, offset) => words[i + offset] === word));
    if (term) {
      for (const dimension of term.dimensions) facts[dimension].add(term.concept);
      i += term.words.length;
      continue;
    }
    const brandSpan = matchesBrand(words, i, brands);
    if (brandSpan) { i += brandSpan; continue; }
    if (!GENERIC.has(words[i]) && !NUMERIC.test(words[i])) descriptors.push(words[i]);
    i++;
  }
  const result = { facts, descriptors };
  if (parsed.size >= 5000) parsed.delete(parsed.keys().next().value!);
  parsed.set(key, result);
  return result;
}

const disjoint = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && ![...a].some(x => b.has(x));
const unequal = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && (a.size !== b.size || [...a].some(x => !b.has(x)));

/** Stated facts that cannot describe one product. A fact stated on one side only is unknown, not a conflict. */
export function titleFactConflict(a: ParsedTitle, b: ParsedTitle): boolean {
  return disjoint(a.facts.type, b.facts.type) || disjoint(a.facts.texture, b.facts.texture) ||
    unequal(a.facts.active, b.facts.active) || disjoint(a.facts.target, b.facts.target) ||
    disjoint(a.facts.concern, b.facts.concern) || disjoint(a.facts.time, b.facts.time) || disjoint(a.facts.area, b.facts.area);
}

// Cross-script words are compared by skeleton; two letters are too ambiguous to be evidence.
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (hasArabic(a) === hasArabic(b)) return false;
  const skeleton = phoneticSkeleton(a);
  return skeleton.length >= 3 && skeleton === phoneticSkeleton(b);
}

/**
 * Does the supplier wording describe this canonical title without unexplained words? Used only behind an existing
 * reviewed code or barcode: it decides whether their claim is still believable, and is never a match on its own.
 */
export function wordingSupportsTitle(incoming: ParsedTitle, canonical: ParsedTitle, sharedMarkers: boolean): boolean {
  let distinctive = sharedMarkers ? 1 : 0;
  const counted: Dimension[] = ['type', 'texture', 'active', 'target', 'concern', 'benefit', 'time'];
  for (const dimension of counted) for (const concept of incoming.facts[dimension]) {
    if (!canonical.facts[dimension].has(concept)) {
      // "Cream" is both a type and a texture: stating it once does not need to be restated in the other reading.
      if (dimension === 'texture' && canonical.facts.type.has(concept)) continue;
      return false;
    }
    if (dimension !== 'type' && concept !== 'cream' && concept !== 'lotion') distinctive++;
  }
  // A canonical active the supplier never mentions is a different claim from the supplier's wording.
  if ([...canonical.facts.active].some(active => !incoming.facts.active.has(active))) return false;
  const accounted = new Set<string>();
  for (const word of incoming.descriptors) {
    const hit = canonical.descriptors.find(other => sameWord(word, other));
    if (!hit) return false;
    accounted.add(hit);
    distinctive++;
  }
  if (canonical.descriptors.length && accounted.size / new Set(canonical.descriptors).size < 0.5) return false;
  return distinctive > 0;
}

function editDistanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, previous2[j - 2] + 1);
      row.push(cost);
    }
    previous2 = previous;
    previous = row;
  }
  return previous[b.length] <= limit;
}

function softWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const crossScript = hasArabic(a) !== hasArabic(b);
  if (!crossScript) return a.length >= 4 && editDistanceWithin(a, b, a.length >= 8 ? 2 : 1);
  const [x, y] = [phoneticSkeleton(a), phoneticSkeleton(b)];
  return x.length >= 2 && (x === y || (x.length >= 4 && editDistanceWithin(x, y, 1)));
}

const VOCABULARY_WORDS = [...new Set(TERMS.flatMap(term => term.words))].filter(word => word.length >= 4);
const typoReadings = new Map<ParsedTitle, ParsedTitle>();
/** A second reading with misspelled words replaced by the vocabulary word they resemble. Ranking only: vetoes read the words as written. */
function readThroughTypos(title: ParsedTitle): ParsedTitle {
  const cached = typoReadings.get(title);
  if (cached) return cached;
  const words = title.descriptors.map(word => VOCABULARY_WORDS.find(known => known !== word && hasArabic(known) === hasArabic(word) &&
    word.length >= 4 && editDistanceWithin(word, known, word.length >= 8 ? 2 : 1)) ?? word);
  const reading = parseIdentityTitle(words.join(' '));
  if (typoReadings.size >= 5000) typoReadings.clear();
  typoReadings.set(title, reading);
  return reading;
}

/** Soft 0..1 wording overlap: orders candidates for a reviewer. Tolerates typos, so it can never prove identity. */
export function wordingOverlap(a: ParsedTitle, b: ParsedTitle): number {
  const items = (title: ParsedTitle) => {
    const read = readThroughTypos(title);
    return [...new Set([...[title, read].flatMap(version => (Object.entries(version.facts) as Array<[Dimension, Set<string>]>)
      .flatMap(([dimension, values]) => dimension === 'texture' ? [...values].filter(v => v !== 'cream' && v !== 'lotion').map(v => `#${v}`) :
        dimension === 'area' ? [] : [...values].map(v => `#${v}`))), ...read.descriptors])];
  };
  const [x, y] = [items(a), items(b)];
  if (!x.length || !y.length) return 0;
  const hit = (word: string, others: string[]) => others.some(other => word[0] === '#' || other[0] === '#' ? word === other : softWordMatch(word, other));
  return (x.filter(word => hit(word, y)).length + y.filter(word => hit(word, x)).length) / (x.length + y.length);
}

function factLabel(concept: string): string {
  const options = VOCABULARY.find(([, name]) => name === concept)![2].split('|');
  return [options.find(term => !hasArabic(term)), options.find(hasArabic)].filter(Boolean).join(' · ');
}

const allFacts = (title: ParsedTitle) => [...new Set(Object.values(title.facts).flatMap(values => [...values]))];

/** What a reviewer can read off a title: its stated facts in both languages, and the words no rule understood. */
export function describeTitle(title: ParsedTitle) {
  return { facts: allFacts(title).map(factLabel), unreadWords: [...new Set(title.descriptors)] };
}

/** Why two titles look alike or not, for a reviewer. Explanation only: vetoes and proof never read it. */
export function compareTitles(incoming: ParsedTitle, canonical: ParsedTitle) {
  const [a, b] = [readThroughTypos(incoming), readThroughTypos(canonical)];
  const [factsA, factsB] = [new Set([...allFacts(incoming), ...allFacts(a)]), new Set([...allFacts(canonical), ...allFacts(b)])];
  const [wordsA, wordsB] = [[...new Set(a.descriptors)], [...new Set(b.descriptors)]];
  return {
    shared: [...[...factsA].filter(fact => factsB.has(fact)).map(factLabel), ...wordsA.filter(word => wordsB.some(other => softWordMatch(word, other)))],
    onlySupplier: [...[...factsA].filter(fact => !factsB.has(fact)).map(factLabel), ...wordsA.filter(word => !wordsB.some(other => softWordMatch(word, other)))],
    onlyCatalog: [...[...factsB].filter(fact => !factsA.has(fact)).map(factLabel), ...wordsB.filter(word => !wordsA.some(other => softWordMatch(word, other)))],
    unreadInRow: wordsA.some(word => !wordsB.some(other => softWordMatch(word, other))),
  };
}

/** Text for trigram retrieval: the supplier wording plus the other script's names for the facts it states. */
export function retrievalQuery(title: string, brandLabels: string[]): string {
  const { facts, descriptors } = parseIdentityTitle(title, brandLabels);
  const expansions = VOCABULARY.filter(([dimensions, concept]) => dimensions.some(d => facts[d].has(concept)))
    .map(([, , terms]) => {
      const options = terms.split('|');
      return [...options.filter(term => !hasArabic(term)).slice(0, 2), ...options.filter(hasArabic).slice(0, 2)].join(' ');
    });
  return foldIdentityText([...descriptors, ...expansions].join(' ')).trim() || foldIdentityText(title);
}

const UNITS: Record<string, { dimension: 'volume' | 'mass'; factor: number }> = {
  ml: { dimension: 'volume', factor: 1 }, milliliter: { dimension: 'volume', factor: 1 }, millilitre: { dimension: 'volume', factor: 1 },
  مل: { dimension: 'volume', factor: 1 }, ملي: { dimension: 'volume', factor: 1 }, cc: { dimension: 'volume', factor: 1 },
  l: { dimension: 'volume', factor: 1000 }, liter: { dimension: 'volume', factor: 1000 }, litre: { dimension: 'volume', factor: 1000 }, لتر: { dimension: 'volume', factor: 1000 },
  g: { dimension: 'mass', factor: 1 }, gm: { dimension: 'mass', factor: 1 }, gram: { dimension: 'mass', factor: 1 }, جم: { dimension: 'mass', factor: 1 }, جرام: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 }, كجم: { dimension: 'mass', factor: 1000 }, كيلو: { dimension: 'mass', factor: 1000 },
};

/** Physical quantity in base units, or null when the unit is unknown. */
export function physicalMeasure(size: number | null | undefined, unit: string | null | undefined) {
  const known = UNITS[foldIdentityText(unit ?? '').replace(/[^\p{L}]/gu, '')];
  return size === null || size === undefined || !known ? null : { dimension: known.dimension, value: size * known.factor };
}

/** Numeric GS1 identity: 036000291452 and 0036000291452 are one GTIN; a non-zero indicator digit is a different unit. */
export const gtinKey = (barcode: string) => barcode.replace(/^0+/, '');
export function gtinForms(barcode: string): string[] {
  const key = gtinKey(barcode);
  return [...new Set([barcode, ...(key.length <= 8 ? [key.padStart(8, '0')] : []), ...[12, 13, 14].filter(n => key.length <= n).map(n => key.padStart(n, '0'))])];
}
