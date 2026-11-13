/** The reviewed Arabic/English brand spelling dictionary. A leaf file (no imports) so Catalog services can read it without an import cycle through public.ts. */
export const BRAND_ALIASES: Record<string, { canonicalName: string; slug: string }> = {
  'سيرافي': { canonicalName: 'CeraVe', slug: 'cerave' },
  'cerave': { canonicalName: 'CeraVe', slug: 'cerave' },
  'cera-ve': { canonicalName: 'CeraVe', slug: 'cerave' },
  'بيوديرما': { canonicalName: 'Bioderma', slug: 'bioderma' },
  'bioderma': { canonicalName: 'Bioderma', slug: 'bioderma' },
  'لاروش بوزيه': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'لاروش-بوزيه': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'la roche posay': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'la-roche-posay': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'يوسيرين': { canonicalName: 'Eucerin', slug: 'eucerin' },
  'eucerin': { canonicalName: 'Eucerin', slug: 'eucerin' },
  'اورجيناري': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'the ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'the-ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'ordinary': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'فيشي': { canonicalName: 'Vichy', slug: 'vichy' },
  'vichy': { canonicalName: 'Vichy', slug: 'vichy' },
  'سيتافيل': { canonicalName: 'Cetaphil', slug: 'cetaphil' },
  'cetaphil': { canonicalName: 'Cetaphil', slug: 'cetaphil' },
  'ستارفيل': { canonicalName: 'Starville', slug: 'starville' },
  'starville': { canonicalName: 'Starville', slug: 'starville' },
  'افين': { canonicalName: 'Avène', slug: 'avene' },
  'avene': { canonicalName: 'Avène', slug: 'avene' },
  'نيتروجينا': { canonicalName: 'Neutrogena', slug: 'neutrogena' },
  'neutrogena': { canonicalName: 'Neutrogena', slug: 'neutrogena' },
  'بانوكسيل': { canonicalName: 'PanOxyl', slug: 'panoxyl' },
  'panoxyl': { canonicalName: 'PanOxyl', slug: 'panoxyl' },
  'كوسركس': { canonicalName: 'COSRX', slug: 'cosrx' },
  'cosrx': { canonicalName: 'COSRX', slug: 'cosrx' },
  'ايزدين': { canonicalName: 'ISDIN', slug: 'isdin' },
  // Added 2026-11-09 for Catalog Intake: spellings seen in Egyptian distributor price lists.
  'سيرافى': { canonicalName: 'CeraVe', slug: 'cerave' },
  'ذا اورديناري': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'ذي اورديناري': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'اورديناري': { canonicalName: 'The Ordinary', slug: 'the-ordinary' },
  'فيشى': { canonicalName: 'Vichy', slug: 'vichy' },
  'سيتافل': { canonicalName: 'Cetaphil', slug: 'cetaphil' },
  'يوسرين': { canonicalName: 'Eucerin', slug: 'eucerin' },
  'لا روش بوزيه': { canonicalName: 'La Roche-Posay', slug: 'la-roche-posay' },
  'جارنييه': { canonicalName: 'Garnier', slug: 'garnier' },
  'جارنيه': { canonicalName: 'Garnier', slug: 'garnier' },
  'غارنييه': { canonicalName: 'Garnier', slug: 'garnier' },
  'garnier': { canonicalName: 'Garnier', slug: 'garnier' },
  'نيفيا': { canonicalName: 'NIVEA', slug: 'nivea' },
  'nivea': { canonicalName: 'NIVEA', slug: 'nivea' },
  'isdin': { canonicalName: 'ISDIN', slug: 'isdin' },
};

/** Folding used for every alias key; the same function backs the resolver and the pure lookup below. */
export function normalizeBrandKey(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\p{Cf}/gu, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)+/g, '');
}

/** The reviewed Arabic/English dictionary entry for a spelling, if there is one. Read-only: creates nothing. */
/** Every reviewed spelling of one brand (by its canonical name, case- and punctuation-insensitive), for matching supplier wording. */
export function curatedSpellings(brandName: string): string[] {
  const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return Object.entries(BRAND_ALIASES).filter(([, entry]) => key(entry.canonicalName) === key(brandName)).map(([spelling]) => spelling);
}

const NORMALIZED_BRAND_ALIASES = new Map(Object.entries(BRAND_ALIASES).map(([alias, brand]) => [normalizeBrandKey(alias), brand]));

export function curatedBrandAlias(raw: string): { canonicalName: string; slug: string } | null {
  return NORMALIZED_BRAND_ALIASES.get(normalizeBrandKey(raw ?? '')) ?? null;
}
