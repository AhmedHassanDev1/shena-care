import { createHash } from 'crypto';
import type { SkuReference } from '../../catalog/public';

/**
 * Routine JSON import (GLO-312), documented schema `shinacare.routine/v1`. This file only reads and validates the document: it never
 * fetches a URL, never touches the catalog and never persists anything. Limits are enforced by construction (fixed shapes, bounded
 * arrays and strings), so there is no recursive walk of untrusted input.
 */
export const ROUTINE_IMPORT_SCHEMA = 'shinacare.routine/v1';
export const IMPORT_TIMINGS = ['AM', 'PM', 'AS_NEEDED'] as const;
export type ImportTiming = (typeof IMPORT_TIMINGS)[number];

export const IMPORT_LIMITS = { bytes: 64 * 1024, steps: 30, alternatives: 5, references: 10, title: 120, description: 600, usage: 400, stepTitle: 80 } as const;

export interface ImportIssue { path: string; code: string; message: string; severity: 'error' | 'warning' }

export interface ParsedProductRef { path: string; ref: SkuReference; expect: { variant?: string; size?: number; sizeUnit?: string } | null }
export interface ParsedStep { index: number; timing: ImportTiming; title: string; usage: string | null; optional: boolean; product: ParsedProductRef; alternatives: ParsedProductRef[] }
export interface ParsedRoutine {
  title: string; titleEn: string | null; concern: string; careArea: 'skin' | 'hair'; description: string | null
  references: Array<{ title: string; url: string }>; steps: ParsedStep[]
}

export const EXAMPLE_ROUTINE_DOCUMENT = {
  schema: ROUTINE_IMPORT_SCHEMA,
  title: { ar: 'روتين البشرة الدهنية', en: 'Oily skin routine' },
  concern: 'oily-skin',
  careArea: 'skin',
  description: 'روتين بسيط صباحًا ومساءً لبشرة دهنية.',
  references: [{ title: 'AAD — Skin care basics', url: 'https://www.aad.org/public/everyday-care/skin-care-secrets' }],
  steps: [
    { timing: 'AM', title: 'غسول', usage: 'دلّكي على بشرة مبللة ثم اشطفي.', product: { sku: 'SKU-CODE-1' }, alternatives: [{ barcode: '6001234567890' }] },
    { timing: 'AM', title: 'واقي الشمس', product: { sku: 'SKU-CODE-2', expect: { variant: '50 ml' } } },
    { timing: 'PM', title: 'مرطّب', optional: true, product: { skuId: '00000000-0000-4000-8000-000000000000' } },
  ],
} as const;

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MARKUP = /<\s*\/?\s*[a-z!]/i;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

class Reader {
  readonly issues: ImportIssue[] = [];
  error(path: string, code: string, message: string) { this.issues.push({ path, code, message, severity: 'error' }); }
  warn(path: string, code: string, message: string) { this.issues.push({ path, code, message, severity: 'warning' }); }

  /** Rejects keys outside the documented schema so a typo is an error instead of a silently ignored field. */
  only(path: string, value: Obj, allowed: readonly string[]) {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.error(`${path}.${key}`, 'UNKNOWN_FIELD', `«${key}» is not part of ${ROUTINE_IMPORT_SCHEMA}`);
  }

  text(path: string, value: unknown, max: number, options: { required?: boolean } = {}): string | null {
    if (value === undefined || value === null) {
      if (options.required) this.error(path, 'REQUIRED', 'This field is required');
      return null;
    }
    if (typeof value !== 'string') { this.error(path, 'WRONG_TYPE', 'Expected text'); return null; }
    const text = value.trim();
    if (!text) { if (options.required) this.error(path, 'REQUIRED', 'This field is required'); return null; }
    if (text.length > max) { this.error(path, 'TOO_LONG', `At most ${max} characters`); return null; }
    if (CONTROL.test(text) || MARKUP.test(text)) { this.error(path, 'MARKUP_NOT_ALLOWED', 'Plain text only'); return null; }
    return text;
  }
}

function productRef(reader: Reader, path: string, value: unknown): ParsedProductRef | null {
  if (!isObj(value)) { reader.error(path, 'WRONG_TYPE', 'Expected an object with one of skuId, sku or barcode'); return null; }
  reader.only(path, value, ['skuId', 'sku', 'barcode', 'expect']);
  const given = ['skuId', 'sku', 'barcode'].filter(key => value[key] !== undefined);
  if (given.length !== 1) { reader.error(path, 'PRODUCT_REFERENCE', 'Give exactly one of skuId, sku or barcode'); return null; }
  const key = given[0];
  const raw = value[key];
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 64 || CONTROL.test(raw)) { reader.error(`${path}.${key}`, 'PRODUCT_REFERENCE', 'Invalid product identifier'); return null; }
  if (key === 'skuId' && !UUID.test(raw)) { reader.error(`${path}.skuId`, 'PRODUCT_REFERENCE', 'skuId must be a UUID'); return null; }
  let expect: ParsedProductRef['expect'] = null;
  if (value.expect !== undefined) {
    if (!isObj(value.expect)) { reader.error(`${path}.expect`, 'WRONG_TYPE', 'Expected an object'); return null; }
    reader.only(`${path}.expect`, value.expect, ['variant', 'size', 'sizeUnit']);
    expect = {};
    if (value.expect.variant !== undefined) {
      if (typeof value.expect.variant !== 'string' || value.expect.variant.length > 80) reader.error(`${path}.expect.variant`, 'WRONG_TYPE', 'Expected short text');
      else expect.variant = value.expect.variant.trim();
    }
    if (value.expect.size !== undefined) {
      if (typeof value.expect.size !== 'number' || !Number.isFinite(value.expect.size) || value.expect.size <= 0) reader.error(`${path}.expect.size`, 'WRONG_TYPE', 'Expected a positive number');
      else expect.size = value.expect.size;
    }
    if (value.expect.sizeUnit !== undefined) {
      if (typeof value.expect.sizeUnit !== 'string' || value.expect.sizeUnit.length > 12) reader.error(`${path}.expect.sizeUnit`, 'WRONG_TYPE', 'Expected a unit');
      else expect.sizeUnit = value.expect.sizeUnit.trim().toLowerCase();
    }
  }
  const ref: SkuReference = key === 'skuId' ? { skuId: raw.trim() } : key === 'sku' ? { skuCode: raw.trim() } : { barcode: raw.trim() };
  return { path, ref, expect };
}

export function parseRoutineDocument(input: unknown): { parsed: ParsedRoutine | null; issues: ImportIssue[] } {
  const reader = new Reader();
  if (!isObj(input)) { reader.error('$', 'WRONG_TYPE', 'The file must contain one JSON object'); return { parsed: null, issues: reader.issues }; }
  reader.only('$', input, ['schema', 'title', 'concern', 'careArea', 'description', 'references', 'steps']);
  if (input.schema !== ROUTINE_IMPORT_SCHEMA) reader.error('$.schema', 'UNSUPPORTED_VERSION', `Expected schema "${ROUTINE_IMPORT_SCHEMA}"`);

  let title: string | null = null; let titleEn: string | null = null;
  if (typeof input.title === 'string') title = reader.text('$.title', input.title, IMPORT_LIMITS.title, { required: true });
  else if (isObj(input.title)) {
    reader.only('$.title', input.title, ['ar', 'en']);
    title = reader.text('$.title.ar', input.title.ar, IMPORT_LIMITS.title, { required: true });
    titleEn = reader.text('$.title.en', input.title.en, IMPORT_LIMITS.title);
  } else reader.error('$.title', 'REQUIRED', 'A title (text, or { ar, en }) is required');

  const concern = typeof input.concern === 'string' && SLUG.test(input.concern.trim()) ? input.concern.trim() : null;
  if (!concern) reader.error('$.concern', 'INVALID_CONCERN', 'Use the concern slug, e.g. oily-skin');
  const careArea = input.careArea === 'skin' || input.careArea === 'hair' ? input.careArea : null;
  if (!careArea) reader.error('$.careArea', 'INVALID_CARE_AREA', 'careArea must be "skin" or "hair"');
  const description = reader.text('$.description', input.description, IMPORT_LIMITS.description);

  const references: ParsedRoutine['references'] = [];
  if (input.references !== undefined) {
    if (!Array.isArray(input.references)) reader.error('$.references', 'WRONG_TYPE', 'Expected a list');
    else if (input.references.length > IMPORT_LIMITS.references) reader.error('$.references', 'TOO_MANY', `At most ${IMPORT_LIMITS.references} references`);
    else input.references.forEach((entry, index) => {
      const path = `$.references[${index}]`;
      if (!isObj(entry)) { reader.error(path, 'WRONG_TYPE', 'Expected { title, url }'); return; }
      reader.only(path, entry, ['title', 'url']);
      const refTitle = reader.text(`${path}.title`, entry.title, 200, { required: true });
      const url = typeof entry.url === 'string' ? entry.url.trim() : '';
      // Stored as text only; the system never opens a reference URL.
      if (!/^https?:\/\/[^\s<>"']{3,480}$/i.test(url)) reader.error(`${path}.url`, 'INVALID_URL', 'An http(s) URL is required');
      else if (refTitle) references.push({ title: refTitle, url });
    });
  }

  const steps: ParsedStep[] = [];
  if (!Array.isArray(input.steps) || input.steps.length === 0) reader.error('$.steps', 'REQUIRED', 'At least one step is required');
  else if (input.steps.length > IMPORT_LIMITS.steps) reader.error('$.steps', 'TOO_MANY', `At most ${IMPORT_LIMITS.steps} steps`);
  else input.steps.forEach((entry, index) => {
    const path = `$.steps[${index}]`;
    if (!isObj(entry)) { reader.error(path, 'WRONG_TYPE', 'Expected an object'); return; }
    reader.only(path, entry, ['timing', 'title', 'usage', 'optional', 'product', 'alternatives']);
    const timing = IMPORT_TIMINGS.find(value => value === entry.timing);
    if (!timing) reader.error(`${path}.timing`, 'UNSUPPORTED_TIMING', 'timing must be AM, PM or AS_NEEDED');
    const stepTitle = reader.text(`${path}.title`, entry.title, IMPORT_LIMITS.stepTitle, { required: true });
    const usage = reader.text(`${path}.usage`, entry.usage, IMPORT_LIMITS.usage);
    if (entry.optional !== undefined && typeof entry.optional !== 'boolean') reader.error(`${path}.optional`, 'WRONG_TYPE', 'Expected true or false');
    const product = productRef(reader, `${path}.product`, entry.product);
    const alternatives: ParsedProductRef[] = [];
    if (entry.alternatives !== undefined) {
      if (!Array.isArray(entry.alternatives)) reader.error(`${path}.alternatives`, 'WRONG_TYPE', 'Expected a list');
      else if (entry.alternatives.length > IMPORT_LIMITS.alternatives) reader.error(`${path}.alternatives`, 'TOO_MANY', `At most ${IMPORT_LIMITS.alternatives} alternatives`);
      else entry.alternatives.forEach((alt, altIndex) => {
        const parsed = productRef(reader, `${path}.alternatives[${altIndex}]`, alt);
        if (parsed) alternatives.push(parsed);
      });
    }
    if (timing && stepTitle && product) steps.push({ index, timing, title: stepTitle, usage, optional: entry.optional === true, product, alternatives });
  });

  if (reader.issues.some(issue => issue.severity === 'error') || !title || !concern || !careArea) return { parsed: null, issues: reader.issues };
  return { parsed: { title, titleEn, concern, careArea, description, references, steps }, issues: reader.issues };
}

/** Same content → same fingerprint, so one file can create one draft only. Key order and surrounding whitespace do not matter. */
export function fingerprintOf(parsed: ParsedRoutine): string {
  const ref = (item: ParsedProductRef) => ({ ...item.ref, expect: item.expect });
  const canonical = {
    title: parsed.title, titleEn: parsed.titleEn, concern: parsed.concern, careArea: parsed.careArea, description: parsed.description,
    references: parsed.references,
    steps: parsed.steps.map(step => ({ timing: step.timing, title: step.title, usage: step.usage, optional: step.optional, product: ref(step.product), alternatives: step.alternatives.map(ref) })),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
