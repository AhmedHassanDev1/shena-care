/**
 * GLO-285: deterministic checks between a research provider and persistence. A fact survives only if the fetched page
 * states it; everything else stays unknown. A provider's or model's confidence is never evidence.
 */
export interface ExtractedConcentration { ingredient: string; percent: number }

export interface ValidatedFacts {
  normalizedTitle?: string;
  brand?: string;
  productLine?: string;
  category?: string;
  texture?: string;
  description?: string;
  size?: { value: number; unit: string };
  ingredients?: string[];
  concentrations?: ExtractedConcentration[];
  usage?: string[];
  benefits?: string[];
  warnings?: string[];
  concerns?: string[];
  skinTypes?: string[];
  hairTypes?: string[];
}

export interface RejectedFact { field: string; value: unknown; reason: string }

const SIZE_UNITS = new Set(['ml', 'g', 'kg', 'l', 'oz']);
const MAX_LIST_ITEMS = 100;
const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 2000;
/** Sentences may be reflowed by a model but must keep nearly all of the page's own words. */
const MIN_SENTENCE_WORD_OVERLAP = 0.8;

const LITERAL_FIELDS = ['normalizedTitle', 'brand', 'productLine', 'category', 'texture'] as const;
const LITERAL_LIST_FIELDS = ['ingredients', 'concerns', 'skinTypes', 'hairTypes'] as const;
const SENTENCE_LIST_FIELDS = ['usage', 'benefits', 'warnings'] as const;

export function foldEvidenceText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    // A dot belongs to a number ("1.5"), not to the word that happens to end a sentence.
    .replace(/(?<!\p{N})\.|\.(?!\p{N})/gu, ' ')
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ').trim();
}

const words = (value: string) => foldEvidenceText(value).split(' ').filter(word => word.length > 1);

function statedLiterally(page: string, value: string): boolean {
  const needle = foldEvidenceText(value);
  return needle.length >= 2 && ` ${page} `.includes(` ${needle} `);
}

function statedBySentence(pageWords: Set<string>, value: string): boolean {
  const list = words(value);
  return list.length > 0 && list.filter(word => pageWords.has(word)).length / list.length >= MIN_SENTENCE_WORD_OVERLAP;
}

export function statedSize(page: string, size: { value: number; unit: string }): boolean {
  const unit = size.unit.toLowerCase();
  return new RegExp(`(^|[^\\p{N}.])${String(size.value).replace('.', '\\.')}\\s*${unit}(?![\\p{L}\\p{N}])`, 'u').test(page);
}

function statedConcentration(page: string, item: ExtractedConcentration): boolean {
  const number = String(item.percent).replace('.', '\\.');
  const name = foldEvidenceText(item.ingredient).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The figure must sit beside the ingredient it is claimed for, in either order.
  return new RegExp(`${name}[^%]{0,40}(^|[^\\p{N}.])${number}\\s*%|(^|[^\\p{N}.])${number}\\s*%[^%]{0,40}${name}`, 'u').test(page);
}

/** Validates untrusted provider output against the fetched page. Unknown shapes and unstated values are dropped and reported. */
export function validateExtractedFacts(raw: unknown, pageContent: string): { facts: ValidatedFacts; rejected: RejectedFact[] } {
  const facts: ValidatedFacts = {};
  const rejected: RejectedFact[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { facts, rejected: [{ field: '*', value: typeof raw, reason: 'output_is_not_an_object' }] };
  }
  const input = raw as Record<string, unknown>;
  const page = foldEvidenceText(pageContent);
  const pageWords = new Set(words(pageContent));
  const reject = (field: string, value: unknown, reason: string) => { rejected.push({ field, value, reason }); };

  for (const field of LITERAL_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > MAX_SHORT_TEXT) reject(field, value, 'invalid_shape');
    else if (!statedLiterally(page, value)) reject(field, value, 'not_stated_on_source_page');
    else facts[field] = value.trim();
  }

  if (input.description !== undefined && input.description !== null && input.description !== '') {
    const value = input.description;
    if (typeof value !== 'string' || value.length > MAX_LONG_TEXT) reject('description', value, 'invalid_shape');
    else if (!statedBySentence(pageWords, value)) reject('description', value, 'not_stated_on_source_page');
    else facts.description = value.trim();
  }

  if (input.size !== undefined && input.size !== null) {
    const size = input.size as { value?: unknown; unit?: unknown };
    const unit = typeof size.unit === 'string' ? size.unit.trim().toLowerCase() : '';
    if (typeof size.value !== 'number' || !Number.isFinite(size.value) || size.value <= 0 || !SIZE_UNITS.has(unit)) reject('size', input.size, 'invalid_shape');
    else if (!statedSize(page, { value: size.value, unit })) reject('size', input.size, 'not_stated_on_source_page');
    else facts.size = { value: size.value, unit };
  }

  const list = (field: string): unknown[] | null => {
    const value = input[field];
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) { reject(field, value, 'invalid_shape'); return null; }
    return value;
  };
  for (const field of LITERAL_LIST_FIELDS) {
    const values = list(field);
    if (!values) continue;
    const kept: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim() || value.length > MAX_SHORT_TEXT) reject(field, value, 'invalid_shape');
      else if (!statedLiterally(page, value)) reject(field, value, 'not_stated_on_source_page');
      else kept.push(value.trim());
    }
    facts[field] = kept;
  }
  for (const field of SENTENCE_LIST_FIELDS) {
    const values = list(field);
    if (!values) continue;
    const kept: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim() || value.length > MAX_LONG_TEXT) reject(field, value, 'invalid_shape');
      else if (!statedBySentence(pageWords, value)) reject(field, value, 'not_stated_on_source_page');
      else kept.push(value.trim());
    }
    facts[field] = kept;
  }

  const concentrations = list('concentrations');
  if (concentrations) {
    const kept: ExtractedConcentration[] = [];
    for (const value of concentrations) {
      const item = value as Partial<ExtractedConcentration> | null;
      if (typeof item?.ingredient !== 'string' || !item.ingredient.trim() || typeof item.percent !== 'number' || !(item.percent > 0 && item.percent <= 100)) reject('concentrations', value, 'invalid_shape');
      else if (!statedConcentration(page, { ingredient: item.ingredient, percent: item.percent })) reject('concentrations', value, 'not_stated_on_source_page');
      else kept.push({ ingredient: item.ingredient.trim(), percent: item.percent });
    }
    facts.concentrations = kept;
  }
  return { facts, rejected };
}

/** The page's own words around a fact, so a reviewer can check the claim without re-fetching. */
export function evidenceExcerpt(pageContent: string, value: string): string {
  const flat = pageContent.replace(/\s+/g, ' ');
  const index = flat.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return flat.slice(0, 160);
  return flat.slice(Math.max(0, index - 60), index + value.length + 60);
}

const SECOND_LEVEL_SUFFIXES = new Set(['com', 'co', 'org', 'net', 'edu', 'gov']);

/** The domain a site owner registered, so that sub-domains of someone else's site cannot pose as the manufacturer. */
export function registrableLabel(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 2) return labels[0] ?? '';
  const ccSecondLevel = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL_SUFFIXES.has(labels[labels.length - 2]);
  return labels[labels.length - (ccSecondLevel ? 3 : 2)];
}

/** A host is the manufacturer only when its registered name is the brand; containing the brand somewhere proves nothing. */
export function hostIsBrandDomain(hostname: string, brand: string): boolean {
  const brandKey = brand.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // The regional site is the verified official L'Oréal Paris catalog for Egypt.
  if (brandKey === 'lorealparis' && hostname.toLowerCase().replace(/^www\./, '') === 'loreal-paris-me.com') return true;
  return brandKey.length >= 3 && registrableLabel(hostname).replace(/[^a-z0-9]/g, '') === brandKey;
}
