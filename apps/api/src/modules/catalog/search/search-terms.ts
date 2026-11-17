import { normalizeSearchText } from './search-text';

/** Retrieval spellings only. These never establish product identity or medical guidance. */
const SPELLINGS = [
  ['غسول', 'cleanser', 'cleansing'], ['مرطب', 'moisturizer', 'moisturiser', 'moisturizing', 'moisturising'],
  ['كريم', 'cream'], ['سيروم', 'سيرم', 'serum'], ['شامبو', 'shampoo'], ['بلسم', 'conditioner'],
  ['صن بلوك', 'واقي شمس', 'واقي الشمس', 'sunscreen', 'sunblock'], ['تونر', 'toner'],
  ['مل', 'ml', 'milliliter', 'milliliters'], ['جم', 'جرام', 'g', 'gm'],
];
export interface SearchTerm {
  alternatives: string[];
  brandIds: string[];
  intent?: { kind: 'skin' | 'hair' | 'concern' | 'spf' | 'ingredient'; values: string[] };
}
export interface SearchBrandAlias { brandId: string; spellings: string[] }
export interface SearchIngredientAlias { id: string; spellings: string[] }

// Vocabulary translates the customer's constraint; it never assigns a property to a product.
const CONSTRAINTS: Array<{ kind: 'skin' | 'hair' | 'concern'; values: string[]; phrases: string[] }> = [
  ...[
    ['OILY', 'دهنية', 'oily'], ['DRY', 'جافة', 'dry'], ['SENSITIVE', 'حساسة', 'sensitive'],
    ['COMBINATION', 'مختلطة', 'combination'], ['NORMAL', 'عادية', 'normal'],
  ].map(([value, ar, en]) => ({ kind: 'skin' as const, values: [value], phrases: [
    `للبشرة ال${ar}`, `البشرة ال${ar}`, `بشرة ${ar}`, `${en} skin`,
  ] })),
  ...[['DRY', 'جاف', 'dry'], ['OILY', 'دهني', 'oily'], ['CURLY', 'كيرلي', 'curly']].map(([value, ar, en]) =>
    ({ kind: 'hair' as const, values: [value], phrases: [`للشعر ال${ar}`, `الشعر ال${ar}`, `${en} hair`] })),
  { kind: 'concern', values: ['acne', 'acne_blemishes'], phrases: ['حبوب', 'الحبوب', 'للحبوب', 'حب الشباب', 'لحب الشباب', 'acne', 'blemishes'] },
  { kind: 'concern', values: ['dandruff', 'dandruff_scalp'], phrases: ['قشرة', 'القشرة', 'للقشرة', 'dandruff'] },
  { kind: 'concern', values: ['dryness'], phrases: ['جفاف', 'للجفاف', 'dryness'] },
  { kind: 'concern', values: ['hyperpigmentation'], phrases: ['تصبغات', 'للتصبغات', 'التصبغات', 'dark spots', 'hyperpigmentation'] },
];

/** Search shorthand for the exact Paris consumer brand, never an intake identity alias.
 * Native Arabic label: https://www.loreal-paris-me.com/ar/about-us
 */
export function searchBrandSpellings(name: string): string[] {
  const key = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return key === 'lorealparis' ? ['لوريال', 'لوريال باريس', 'loreal', "l'oreal", 'l’oreal', "l'oréal", 'l’oréal'] : [];
}

/** One adjacent-letter swap, with whole-word boundaries; identifiers never enter this path. */
export function transpositionPattern(term: string): string | null {
  if (!/^[\p{L}]{5,24}$/u.test(term)) return null;
  const variants = new Set<string>();
  for (let index = 0; index < term.length - 1; index++) {
    if (term[index] !== term[index + 1]) variants.add(term.slice(0, index) + term[index + 1] + term[index] + term.slice(index + 2));
  }
  return variants.size ? `\\m(${[...variants].join('|')})\\M` : null;
}

/** At most one insertion, deletion, substitution or adjacent swap in a reviewed ingredient spelling. */
function oneSpellingEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    if (left.length > right.length) return left.slice(index + 1) === right.slice(index);
    if (left.length < right.length) return left.slice(index) === right.slice(index + 1);
    return left.slice(index + 1) === right.slice(index + 1) ||
      (left[index] === right[index + 1] && left[index + 1] === right[index] && left.slice(index + 2) === right.slice(index + 2));
  }
  return true;
}

export function searchTerms(query: string, brands: SearchBrandAlias[], ingredients: SearchIngredientAlias[] = []): SearchTerm[] {
  // Keep complete SKU codes/barcodes intact; splitting their digits can match another identity.
  const identifier = normalizeSearchText(query);
  if (/^\d{8,14}$/.test(identifier) || /^(?=.*[-_])(?=.*\d)[\p{L}\p{N}_-]+$/u.test(identifier)) {
    return [{ alternatives: [identifier], brandIds: [] }];
  }
  const q = normalizeSearchText(query).replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2');
  const phrases = new Map<string, SearchTerm>();
  for (const spellings of SPELLINGS) {
    const alternatives = spellings.map(normalizeSearchText);
    for (const spelling of alternatives) phrases.set(spelling, { alternatives: [spelling, ...alternatives.filter(value => value !== spelling)], brandIds: [] });
  }
  for (const constraint of CONSTRAINTS) for (const phrase of constraint.phrases) {
    phrases.set(normalizeSearchText(phrase), { alternatives: [], brandIds: [], intent: { kind: constraint.kind, values: constraint.values } });
  }
  for (const match of q.matchAll(/\bspf\s+(\d{1,3})\b/g)) {
    phrases.set(match[0], { alternatives: [], brandIds: [], intent: { kind: 'spf', values: [match[1]] } });
  }
  for (const ingredient of ingredients) for (const spelling of ingredient.spellings) {
    const key = normalizeSearchText(spelling);
    if (!key) continue;
    const previous = phrases.get(key)?.intent;
    phrases.set(key, { alternatives: [], brandIds: [], intent: { kind: 'ingredient',
      values: [...new Set([...(previous?.kind === 'ingredient' ? previous.values : []), ingredient.id])] } });
  }
  for (const brand of brands) for (const raw of brand.spellings) {
    const spelling = normalizeSearchText(raw).replace(/-/g, ' ');
    if (!spelling) continue;
    const existing = phrases.get(spelling);
    // Ambiguous reviewed aliases retrieve candidates of both brands; never merge them.
    phrases.set(spelling, { alternatives: [], brandIds: [...new Set([...(existing?.brandIds ?? []), brand.brandId])] });
  }
  const words = q.split(/\s+/).filter(Boolean), result: SearchTerm[] = [];
  const ingredientPhrases = [...phrases].filter(([, term]) => term.intent?.kind === 'ingredient');
  for (let index = 0; index < words.length;) {
    let end = words.length, phrase: SearchTerm | undefined;
    for (; end > index; end--) {
      const text = words.slice(index, end).join(' ');
      phrase = phrases.get(text);
      if (!phrase && end - index <= 3 && /^[\p{L} -]{5,50}$/u.test(text)) {
        const matches = ingredientPhrases.filter(([spelling]) => oneSpellingEdit(text, spelling));
        const ids = [...new Set(matches.flatMap(([, term]) => term.intent!.values))];
        // One reviewed spelling may belong to several ontology records. Retrieve their
        // recorded relationships without merging their identities or inventing a claim.
        if (matches.length === 1) phrase = { alternatives: [], brandIds: [], intent: { kind: 'ingredient', values: ids } };
      }
      if (phrase) break;
    }
    if (phrase || !['for', 'with', 'لل', 'للبشرة', 'للبشره', 'للشعر'].includes(words[index])) {
      result.push(phrase ?? { alternatives: [words[index]], brandIds: [] });
    }
    index = phrase ? end : index + 1;
  }
  return result;
}
