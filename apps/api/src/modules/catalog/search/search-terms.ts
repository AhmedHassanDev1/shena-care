import { normalizeSearchText } from './search-text';

/** Retrieval spellings only. These never establish product identity or medical guidance. */
const SPELLINGS = [
  ['غسول', 'cleanser', 'cleansing'], ['مرطب', 'moisturizer', 'moisturiser', 'moisturizing', 'moisturising'],
  ['كريم', 'cream'], ['سيروم', 'serum'], ['شامبو', 'shampoo'], ['بلسم', 'conditioner'],
  ['صن بلوك', 'واقي شمس', 'واقي الشمس', 'sunscreen', 'sunblock'], ['تونر', 'toner'],
  ['حبوب', 'حب الشباب', 'acne'], ['مل', 'ml', 'milliliter', 'milliliters'], ['جم', 'جرام', 'g', 'gm'],
];
export interface SearchTerm { alternatives: string[]; brandIds: string[] }
export interface SearchBrandAlias { brandId: string; spellings: string[] }

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

export function searchTerms(query: string, brands: SearchBrandAlias[]): SearchTerm[] {
  const q = normalizeSearchText(query).replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2');
  const phrases = new Map<string, SearchTerm>();
  for (const spellings of SPELLINGS) {
    const alternatives = spellings.map(normalizeSearchText);
    for (const spelling of alternatives) phrases.set(spelling, { alternatives, brandIds: [] });
  }
  for (const brand of brands) for (const raw of brand.spellings) {
    const spelling = normalizeSearchText(raw).replace(/-/g, ' ');
    if (!spelling) continue;
    const existing = phrases.get(spelling);
    // Ambiguous reviewed aliases retrieve candidates of both brands; never merge them.
    phrases.set(spelling, { alternatives: [], brandIds: [...new Set([...(existing?.brandIds ?? []), brand.brandId])] });
  }
  const words = q.split(/\s+/).filter(Boolean), result: SearchTerm[] = [];
  for (let index = 0; index < words.length;) {
    let end = words.length, phrase: SearchTerm | undefined;
    for (; end > index; end--) {
      phrase = phrases.get(words.slice(index, end).join(' '));
      if (phrase) break;
    }
    result.push(phrase ?? { alternatives: [words[index]], brandIds: [] });
    index = phrase ? end : index + 1;
  }
  return result;
}
