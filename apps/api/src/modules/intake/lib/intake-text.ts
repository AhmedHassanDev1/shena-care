import { createHash } from 'crypto';
import { foldIdentityText, identityWords, physicalMeasure } from '../../catalog/public';

/**
 * Cheap, deterministic reading of one supplier or Admin product line: no AI, no web. Normalizes Arabic letters and digits, reads prices, measures, pack
 * counts and barcodes, and produces a price-free identity fingerprint. Anything it cannot read stays null.
 */

/** Arabic-Indic and Persian digits, Arabic decimal and thousands marks, invisible marks, tatweel; whitespace collapsed. Letters are kept as written. */
export function normalizeCell(value: unknown): string {
  return String(value ?? '').normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/٫/g, '.').replace(/٬/g, ',').replace(/ـ/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * A price cell as a number, or null when it is not one plain amount. "1,250.50", "١٬٢٥٠٫٥٠", "250 ج.م", "EGP 250", "250 LE" read; "100-120", "call", "" do not.
 * A lone comma followed by exactly two digits is a decimal comma ("99,50").
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Arabic letters are not \b word characters, so currency words are removed as plain text, then every letter.
  let text = normalizeCell(value).toLowerCase()
    .replace(/egp|l\.e\.?|جنيه[اتى]*|جنية|ج\s*\.\s*م\s*\.?/gu, ' ').replace(/[^\d.,\s-]/g, ' ').trim();
  if (!text || /\d\s*-\s*\d/.test(text)) return null;
  text = text.replace(/\s+/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (/^\d+,\d{2}$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

export function parsePercent(value: unknown): number | null {
  const text = normalizeCell(value).replace('%', '').replace('٪', '');
  const amount = parseAmount(text);
  return amount !== null && amount >= 0 && amount < 100 ? amount : null;
}

export function parseQuantity(value: unknown): number | null {
  const amount = parseAmount(value);
  return amount !== null && Number.isInteger(amount) && amount >= 0 ? amount : null;
}

/** GS1 GTIN lengths and modulo-10 check digit; keep leading zeroes, never repair a damaged code. */
export function parseBarcode(value: unknown): string | null {
  const digits = normalizeCell(value).replace(/[\s-]/g, '');
  if (/^\d+(\.0+)?e\+?\d+$/i.test(digits)) return null; // a spreadsheet turned it into scientific notation: precision is lost
  const plain = digits.replace(/\.0+$/, '');
  if (!/^(?:\d{8}|\d{12,14})$/.test(plain) || /^0+$/.test(plain)) return null;
  let sum = 0;
  for (let i = plain.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(plain[i]) * weight;
  return (10 - sum % 10) % 10 === Number(plain.at(-1)) ? plain : null;
}

export type CanonicalUnit = 'ml' | 'g' | 'l' | 'kg' | 'piece';
const UNIT_WORDS: Array<[RegExp, CanonicalUnit]> = [
  [/^(?:ml|mls|m\.l|milliliters?|millilitres?|cc|مل|ملي|ملل|مللي|ملى|مليلتر|ميلي)$/u, 'ml'],
  [/^(?:l|ltr|liters?|litres?|لتر|ليتر)$/u, 'l'],
  [/^(?:g|gm|gms|gr|grams?|gramme|جم|جرام|غرام|غ|جرامات)$/u, 'g'],
  [/^(?:kg|kgs|كجم|كيلو|كيلوجرام)$/u, 'kg'],
  [/^(?:pcs?|pieces?|قطعه|قطعة|قطع|حبه|حبة)$/u, 'piece'],
];
const unitOf = (word: string): CanonicalUnit | null => UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;

export interface Measure { size: number; unit: CanonicalUnit; text: string }
export interface MeasureReading { measures: Measure[]; packCount: number | null; packText: string | null }

// "200 ml", "200ml", "200مل", "1.5 L", "50 gm"; units may be glued or separated.
const MEASURE = /(?<![\d.,-])((?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(ml|mls|m\.l|milliliters?|millilitres?|cc|مل|ملي|ملل|مللي|ملى|مليلتر|ميلي|ltr|liters?|litres?|لتر|ليتر|l|gms?|gr|grams?|gramme|g|جم|جرام|غرام|جرامات|kgs?|كجم|كيلو(?:جرام)?)(?![\p{L}])/giu;
// "x2", "2x", "2 x 30ml", "عدد 2", "2 قطعه", "pack of 3", "عرض 2"
const PACK = /(?:\b(?:pack|set)\s+of\s+(\d{1,2})\b|(?:^|\s)[x×*]\s*(\d{1,2})(?!\s*(?:ml|g|مل|جم))(?!\d)|\b(\d{1,2})\s*[x×*](?=\s*\d)|(?:عدد|عرض)\s*(\d{1,2})(?!\d)|(?<!\d)(\d{1,2})\s*(?:pcs|pieces|قطعه|قطعة|قطع)(?![\p{L}]))/iu;

/** Sizes, units and pack count a product line states. Several different sizes are all returned; the caller decides what that means. */
export function readMeasures(text: string): MeasureReading {
  const normalized = normalizeCell(text);
  const measures: Measure[] = [];
  for (const match of normalized.matchAll(MEASURE)) {
    const unit = unitOf(match[2].toLowerCase());
    if (/[,]\d{3,}$/.test(match[1])) continue; // Ambiguous decimal/thousands separator: review instead of guessing.
    const size = Number(match[1].replace(',', '.'));
    if (!unit || !Number.isFinite(size) || size <= 0) continue;
    if (!measures.some(m => m.size === size && m.unit === unit)) measures.push({ size, unit, text: match[0] });
  }
  const pack = normalized.match(PACK);
  const count = pack ? Number(pack.slice(1).find(Boolean)) : null;
  return { measures, packCount: count && count >= 2 && count <= 24 ? count : null, packText: pack?.[0]?.trim() ?? null };
}

/** The line with measures, pack wording and stray numbers removed: what is left names the product. */
export function stripMeasures(text: string): string {
  return normalizeCell(text).replace(MEASURE, ' ').replace(PACK, ' ').replace(/[()[\]{}|/\\،,;:_+*"'«»]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The text with sizes and pack wording removed, punctuation kept ("Niacinamide 10% + Zinc 1%" stays readable): for display names. */
export function withoutMeasures(text: string): string {
  return normalizeCell(text).replace(MEASURE, ' ').replace(PACK, ' ').replace(/\s+/g, ' ').replace(/[\s,|\-–:/(]+$/u, '').replace(/^[\s,|\-–:/)]+/u, '').trim();
}

/** Base-unit measure key ("volume:236") so 0.236 l and 236 ml are one size. */
export function measureKey(size: number | null, unit: string | null): string | null {
  const measure = physicalMeasure(size, unit);
  if (measure) return `${measure.dimension}:${Math.round(measure.value * 100) / 100}`;
  return size !== null && unit === 'piece' ? `count:${size}` : null;
}

/** Two stated sizes are one pack when equal within 1% (236 ml and 237 ml are the same 8 fl oz bottle labelled two ways). */
export function sameMeasure(a: { size: number | null; unit: string | null }, b: { size: number | null; unit: string | null }): boolean | null {
  const [x, y] = [physicalMeasure(a.size, a.unit), physicalMeasure(b.size, b.unit)];
  if (!x || !y) return a.unit === 'piece' && b.unit === 'piece' ? a.size === b.size : null;
  if (x.dimension !== y.dimension) return false;
  return Math.abs(x.value - y.value) <= Math.max(x.value, y.value) * 0.01;
}

/** Strength and SPF markers ("10%", "spf50"): two lines stating different ones are different products. */
export function variantMarkers(text: string): { percents: string[]; spf: number[] } {
  const folded = foldIdentityText(normalizeCell(text));
  const percents = [...new Set([...folded.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m => String(Number(m[1]))))];
  const spf = [...new Set([...folded.matchAll(/(?:spf|اس بي اف|اس.بي.اف)\s*\+?\s*(\d{1,3})|(\d{1,3})\s*\+?\s*spf/g)].map(m => Number(m[1] ?? m[2])))];
  return { percents, spf };
}

/** Price-free identity key: folded words in order plus the base-unit measure and pack. The same wording of the same pack always gives the same key. */
export function identityFingerprint(name: string, measure: { size: number | null; unit: string | null } | null, packCount: number | null): string {
  const words = identityWords(stripMeasures(name)).join(' ');
  const key = `${words}|${measure ? measureKey(measure.size, measure.unit) ?? '' : ''}|${packCount ?? 1}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 40);
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
