import { identityWords } from './identity-text';

/**
 * Deterministic product-type reading for Arabic (MSA and Egyptian colloquial) and English product names. A bounded vocabulary, not a guess:
 * a name it cannot read has no type, and a name that states two different types is reported as such, never resolved by preference.
 *
 * The type is what the product is (a shampoo, a cleanser). It is used to place a row in the approved leaf category when the supplier's
 * category cell is missing or reads differently from the ShinaCare taxonomy. It never proves identity.
 */
export const PRODUCT_TYPE_RULE_VERSION = 'product-type@1';

export type ProductDomain = 'HAIR' | 'SKIN' | 'BODY';
export interface ProductTypeRule {
  key: string;
  domain: ProductDomain;
  /** Phrases that state this type on their own. Folded with identityWords, so Arabic letter variants and the definite article are handled. */
  terms: string[];
  /** Taxonomy leaf names (or aliases) this type belongs to, most precise first. The first one present in the taxonomy is the type's leaf. */
  leaves: string[];
  /** Precise subtype, when the phrase that matched says it (e.g. foaming cleanser). */
  subtypes?: Record<string, string[]>;
}

const HAIR_TREATMENT_LEAVES = ['hair treatments & styling', 'hair treatments and styling', 'hair treatments', 'hair treatment', 'علاجات الشعر', 'علاج الشعر'];

export const PRODUCT_TYPES: ProductTypeRule[] = [
  { key: 'shampoo', domain: 'HAIR', terms: ['shampoo', 'shampoos', 'dry shampoo', 'شامبو', 'شامبوه', 'شامبوهات', 'شمبو', 'شامبوا'],
    leaves: ['shampoos', 'shampoo', 'شامبو'], subtypes: { dry: ['dry shampoo'], 'anti-dandruff': ['anti dandruff shampoo', 'شامبو ضد القشره', 'شامبو قشره'] } },
  { key: 'conditioner', domain: 'HAIR', terms: ['conditioner', 'conditioners', 'hair conditioner', 'rinse out conditioner', 'cleansing conditioner', 'بلسم', 'بلسام', 'بلسم شعر', 'كوندشنر', 'كونديشنر', 'كونديشينر', 'منعم شعر'],
    leaves: ['conditioners', 'conditioner', 'بلسم'] },
  { key: 'leave-in', domain: 'HAIR', terms: ['leave in', 'leave in conditioner', 'leave in cream', 'leave in hair mask', 'leave in mask', 'leave on mask', 'leavein', 'ليف ان', 'ليف ان كونديشنر', 'كريم شعر بدون شطف', 'بلسم بدون شطف', 'كريم ليف ان'],
    leaves: ['leave in conditioners', 'leave in treatments', ...HAIR_TREATMENT_LEAVES] },
  { key: 'hair-mask', domain: 'HAIR', terms: ['hair mask', 'hair masque', 'mask for hair', 'masque capillaire', 'ماسك شعر', 'ماسك للشعر', 'ماسك الشعر', 'قناع شعر', 'قناع للشعر', 'حمام كريم', 'حمام زيت', 'هير ماسك'],
    leaves: ['hair masks', 'hair mask', ...HAIR_TREATMENT_LEAVES] },
  { key: 'hair-oil', domain: 'HAIR', terms: ['hair oil', 'oil for hair', 'زيت شعر', 'زيت للشعر', 'زيت الشعر', 'هير اويل'], leaves: ['hair oils', 'hair oil', ...HAIR_TREATMENT_LEAVES] },
  { key: 'hair-serum', domain: 'HAIR', terms: ['hair serum', 'serum for hair', 'سيروم شعر', 'سيروم للشعر', 'سيروم الشعر', 'هير سيروم'], leaves: ['hair serums', 'hair serum', ...HAIR_TREATMENT_LEAVES] },
  { key: 'hair-styling', domain: 'HAIR', terms: ['hair gel', 'hair spray', 'hair wax', 'styling cream', 'styling gel', 'hair cream', 'curl cream', 'جل شعر', 'جل للشعر', 'سبراي شعر', 'هير سبراي', 'واكس', 'كريم شعر', 'كريم للشعر', 'كريم تصفيف', 'كريم فرد', 'كيرلي كريم', 'كريم كيرلي'],
    leaves: ['hair styling', 'styling', ...HAIR_TREATMENT_LEAVES] },
  { key: 'makeup-remover', domain: 'SKIN', terms: ['makeup remover', 'make up remover', 'micellar water', 'micellar', 'cleansing water', 'مزيل مكياج', 'مزيل المكياج', 'مزيل ميك اب', 'ميسيلار', 'ميسلار', 'ماء ميسيلار', 'مياه ميسيلار', 'ميسيلار ووتر'],
    leaves: ['makeup removers', 'makeup remover', 'micellar waters', 'cleansers', 'cleanser', 'غسول'] },
  { key: 'cleanser', domain: 'SKIN', terms: ['cleanser', 'cleansers', 'face wash', 'facial wash', 'facial cleanser', 'cleansing gel', 'cleansing foam', 'cleansing lotion', 'cleansing cream', 'cleansing oil', 'cleansing balm', 'foaming cleanser', 'foam cleanser', 'gel cleanser', 'cream cleanser', 'cream to foam cleanser', 'foaming gel', 'foaming face gel', 'foaming facial gel',
    'غسول', 'غسول وجه', 'غسول للوجه', 'غسول الوجه', 'منظف', 'منظف وجه', 'منظف للوجه', 'كلينزر', 'فيس واش', 'فوم وجه', 'غسول رغوي', 'جل منظف'],
    leaves: ['cleansers', 'cleanser', 'غسول', 'منظفات'],
    subtypes: { foaming: ['foaming cleanser', 'foam cleanser', 'cleansing foam', 'foaming gel', 'foaming face gel', 'foaming facial gel', 'غسول رغوي', 'فوم وجه'], gel: ['gel cleanser', 'cleansing gel', 'جل منظف'], cream: ['cream cleanser', 'cleansing cream', 'cream to foam cleanser'], oil: ['cleansing oil'], balm: ['cleansing balm'] } },
  { key: 'body-wash', domain: 'BODY', terms: ['body wash', 'shower gel', 'shower cream', 'bath gel', 'شاور جل', 'غسول جسم', 'غسول للجسم', 'جل استحمام', 'بودي واش'], leaves: ['body wash', 'body washes', 'shower gels', 'body cleansers'] },
  { key: 'toner', domain: 'SKIN', terms: ['toner', 'toners', 'facial toner', 'تونر', 'تونر وجه'], leaves: ['toners', 'toner', 'تونر'] },
  { key: 'serum', domain: 'SKIN', terms: ['serum', 'serums', 'face serum', 'facial serum', 'ampoule', 'booster serum', 'سيروم', 'سيرم', 'سيروم وجه', 'سيروم للوجه', 'امبول'], leaves: ['serums & treatments', 'serums and treatments', 'serums', 'serum', 'سيروم'] },
  { key: 'sunscreen', domain: 'SKIN', terms: ['sunscreen', 'sun screen', 'sunblock', 'sun block', 'sun cream', 'sun fluid', 'sun protection', 'uv fluid', 'واقي شمس', 'واقي الشمس', 'واقي من الشمس', 'صن بلوك', 'صن سكرين', 'سن بلوك', 'سن سكرين', 'كريم حمايه من الشمس'],
    leaves: ['sunscreens', 'sunscreen', 'sun care', 'واقي شمس'] },
  { key: 'eye-care', domain: 'SKIN', terms: ['eye cream', 'eye gel', 'eye serum', 'under eye', 'كريم عين', 'كريم العين', 'كريم تحت العين', 'كريم للعين', 'سيروم عين', 'سيروم العين'], leaves: ['eye care', 'eye creams', 'eye treatments'] },
  { key: 'exfoliant', domain: 'SKIN', terms: ['scrub', 'exfoliator', 'exfoliant', 'peeling', 'مقشر', 'سكراب', 'سكرب', 'بيلينج', 'تقشير'], leaves: ['exfoliators', 'exfoliants', 'scrubs'] },
  { key: 'face-mask', domain: 'SKIN', terms: ['face mask', 'facial mask', 'clay mask', 'sheet mask', 'mud mask', 'ماسك وجه', 'ماسك للوجه', 'ماسك الوجه', 'قناع وجه', 'ماسك طين'], leaves: ['face masks', 'masks', 'mask'] },
  { key: 'moisturizer', domain: 'SKIN', terms: ['moisturizer', 'moisturiser', 'moisturizers', 'moisturisers', 'moisturizing cream', 'moisturising cream', 'moisturizing lotion', 'moisturising lotion', 'moisturising gel', 'moisturizing gel', 'face cream', 'facial cream', 'day cream', 'night cream', 'gel cream', 'cream gel', 'face lotion', 'facial lotion', 'day gel', 'night gel', 'mattifying gel',
    'كريم مرطب', 'لوشن مرطب', 'مرطب وجه', 'مرطب للوجه', 'مويسترايزر', 'كريم وجه', 'كريم للوجه', 'كريم نهاري', 'كريم ليلي', 'كريم نهار', 'كريم ليل'],
    leaves: ['moisturizers', 'moisturisers', 'moisturizer', 'مرطبات', 'مرطب'] },
  { key: 'body-moisturizer', domain: 'BODY', terms: ['body lotion', 'body cream', 'body butter', 'hand cream', 'foot cream', 'لوشن جسم', 'لوشن للجسم', 'كريم جسم', 'كريم للجسم', 'كريم يد', 'كريم ايدين', 'كريم قدم', 'بودي لوشن', 'زبده جسم'],
    leaves: ['body moisturizers', 'body lotions', 'moisturizers', 'moisturisers'] },
  { key: 'lip-care', domain: 'SKIN', terms: ['lip balm', 'lip care', 'lip mask', 'مرطب شفايف', 'مرطب شفاه', 'زبده شفايف', 'ليب بالم'], leaves: ['lip care', 'lip balms'] },
];

/** Generic words that name a type only when nothing more precise was said, and only with the context that disambiguates them. */
const WEAK: Array<{ words: string[]; resolve: (area: Set<string>) => string | null }> = [
  { words: ['cream', 'creme', 'كريم', 'كريمه'], resolve: area => area.has('hair') ? 'hair-styling' : area.has('body') || area.has('hand') ? 'body-moisturizer' : area.has('eye') ? 'eye-care' : 'moisturizer' },
  { words: ['lotion', 'لوشن'], resolve: area => area.has('hair') ? null : area.has('body') || area.has('hand') ? 'body-moisturizer' : 'moisturizer' },
  { words: ['مرطب', 'مرطبه'], resolve: area => area.has('hair') ? null : area.has('body') ? 'body-moisturizer' : 'moisturizer' },
  { words: ['mask', 'masque', 'ماسك', 'قناع'], resolve: area => area.has('hair') ? 'hair-mask' : 'face-mask' },
  { words: ['oil', 'زيت'], resolve: area => area.has('hair') ? 'hair-oil' : null },
  { words: ['wash', 'واش'], resolve: area => area.has('body') ? 'body-wash' : area.has('face') ? 'cleanser' : null },
  { words: ['spf'], resolve: () => 'sunscreen' },
];
/** Weak words that only name a texture. */
const TEXTURE_ONLY = new Set(['cream', 'creme', 'lotion', 'كريم', 'كريمه', 'لوشن'].flatMap(word => identityWords(word)));
const AREA_WORDS: Record<string, string[]> = {
  hair: ['hair', 'شعر', 'هير', 'capillaire'], face: ['face', 'facial', 'وجه', 'فيس'], body: ['body', 'جسم', 'بودي'], eye: ['eye', 'eyes', 'عين', 'عيون'], hand: ['hand', 'hands', 'يد', 'ايدين'],
};

interface Phrase { words: string[]; type: string; subtype: string | null }
const PHRASES: Phrase[] = PRODUCT_TYPES.flatMap(rule => rule.terms.map(term => {
  const subtype = Object.entries(rule.subtypes ?? {}).find(([, phrases]) => phrases.includes(term))?.[0] ?? null;
  return { words: identityWords(term), type: rule.key, subtype };
})).sort((a, b) => b.words.length - a.words.length);
const WEAK_WORDS = new Map(WEAK.flatMap((entry, index) => entry.words.flatMap(word => identityWords(word)).map(word => [word, index] as const)));
const AREA_INDEX = new Map(Object.entries(AREA_WORDS).flatMap(([area, words]) => words.flatMap(word => identityWords(word)).map(word => [word, area] as const)));
const RULES = new Map(PRODUCT_TYPES.map(rule => [rule.key, rule]));

export interface ProductTypeReading {
  /** Distinct types the text states, most specific phrase first. Empty when nothing was read. */
  types: Array<{ key: string; domain: ProductDomain; subtype: string | null; matched: string; strength: 'STATED' | 'CONTEXT' }>;
  /** Areas named in the text (hair, face, body, eye, hand). */
  areas: string[];
}

/** Reads the product type(s) a name states. Longest phrase wins over its own words ("hair mask" is not also a face "mask"). */
export function readProductType(...texts: Array<string | null | undefined>): ProductTypeReading {
  // "SPF50+" states the same as "SPF 50": the number is never glued to the word it qualifies (regression from the real Dermactive list, 2026-11-07).
  const words = texts.filter((text): text is string => Boolean(text)).flatMap(text => identityWords(text.replace(/\b(spf)(?=\d)/gi, '$1 ')));
  const used = new Array(words.length).fill(false);
  const areas = new Set<string>();
  for (const word of words) { const area = AREA_INDEX.get(word); if (area) areas.add(area); }
  const types: ProductTypeReading['types'] = [];
  const add = (key: string, subtype: string | null, matched: string, strength: 'STATED' | 'CONTEXT') => {
    const existing = types.find(type => type.key === key);
    if (existing) { if (!existing.subtype && subtype) existing.subtype = subtype; return; }
    types.push({ key, domain: RULES.get(key)!.domain, subtype, matched, strength });
  };
  for (const phrase of PHRASES) {
    for (let i = 0; i + phrase.words.length <= words.length; i++) {
      if (used.slice(i, i + phrase.words.length).some(Boolean)) continue;
      if (!phrase.words.every((word, offset) => words[i + offset] === word)) continue;
      for (let k = i; k < i + phrase.words.length; k++) used[k] = true;
      add(phrase.type, phrase.subtype, phrase.words.join(' '), 'STATED');
    }
  }
  if (!types.length) {
    for (let i = 0; i < words.length; i++) {
      if (used[i]) continue;
      const weak = WEAK_WORDS.get(words[i]);
      if (weak === undefined) continue;
      const key = WEAK[weak].resolve(areas);
      if (key) add(key, null, words[i], 'CONTEXT');
    }
    // Only weak words were read: a stated protection factor is more specific than a texture word ("SPF50+ Melting Cream" is a sunscreen cream). A moisturiser
    // with SPF says so ("Moisturizing Lotion SPF 30") and is read from that stated phrase above, never here.
    const spf = types.find(type => type.key === 'sunscreen' && type.matched === 'spf');
    if (spf && types.every(type => type === spf || (type.key === 'moisturizer' && TEXTURE_ONLY.has(type.matched)))) return { types: [spf], areas: [...areas] };
  }
  return { types, areas: [...areas] };
}

export function productTypeRule(key: string): ProductTypeRule | undefined {
  return RULES.get(key);
}
