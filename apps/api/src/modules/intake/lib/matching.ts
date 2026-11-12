import {
  CatalogIdentitySnapshot, compareTitles, foldIdentityText, gtinForms, gtinKey, hasArabic, identityWords, ParsedTitle, parseIdentityTitle, phoneticSkeleton,
  SnapshotBrand, SnapshotSku, titleFactConflict, wordingOverlap, wordingSupportsTitle,
} from '../../catalog/public';
import { sameMeasure, stripMeasures, variantMarkers } from './intake-text';

export const MATCH_RULE_VERSION = 'intake-match@1';

// ─── Brand detection ──────────────────────────────────────────────────────────

interface BrandLabel { brandId: string; label: string; words: string[]; joined: string; skeleton: string; arabic: boolean }
export interface BrandHit { brandId: string; label: string; basis: 'EXACT' | 'PHONETIC' | 'TYPO'; start: number; end: number }

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Words that state a product fact (cleanser, غسول, cream...) are never read as a brand, whatever their sound. */
const isVocabulary = (words: string[]) => {
  const parsed = parseIdentityTitle(words.join(' '));
  return parsed.descriptors.length === 0;
};

/**
 * Finds the brands a product line names: exact words (any reviewed spelling), the same name in the other script by consonant skeleton (سيرافي / CeraVe), or a
 * one-letter typo of a long Latin name. Skeletons shorter than 3 consonants are never used: they collide.
 */
export class BrandDetector {
  private readonly labels: BrandLabel[];
  constructor(brands: Array<{ id: string; name: string; aliases: string[] }>) {
    // "The Ordinary" is also written without its article ("ذا اورديناري" sounds like "Ordinary" plus an Arabic article the vocabulary ignores).
    const spellings = (brand: { name: string; aliases: string[] }) => [brand.name, ...brand.aliases].flatMap(label => /^the\s+\S/i.test(label) ? [label, label.replace(/^the\s+/i, '')] : [label]);
    this.labels = brands.flatMap(brand => spellings(brand).map(label => {
      const words = identityWords(label);
      const joined = words.join('');
      return { brandId: brand.id, label, words, joined, skeleton: phoneticSkeleton(joined), arabic: hasArabic(label) };
    })).filter(label => label.joined.length >= 2);
    for (const label of this.labels) this.exact.set(label.joined, [...(this.exact.get(label.joined) ?? []), label]);
  }
  private readonly exact = new Map<string, BrandLabel[]>();

  detect(text: string): BrandHit[] {
    const words = identityWords(stripMeasures(text));
    const hits: BrandHit[] = [];
    const push = (hit: BrandHit) => { if (!hits.some(existing => existing.brandId === hit.brandId)) hits.push(hit); };
    for (let start = 0; start < words.length; start++) {
      for (let span = Math.min(4, words.length - start); span >= 1; span--) {
        const slice = words.slice(start, start + span);
        const joined = slice.join('');
        const arabic = hasArabic(joined);
        for (const label of this.exact.get(joined) ?? []) push({ brandId: label.brandId, label: label.label, basis: 'EXACT', start, end: start + span });
        if (span > 3 || isVocabulary(slice)) continue;
        const skeleton = phoneticSkeleton(joined);
        for (const label of this.labels) {
          if (joined === label.joined) continue;
          if (arabic !== label.arabic && label.skeleton.length >= 3) {
            if (skeleton === label.skeleton) push({ brandId: label.brandId, label: label.label, basis: 'PHONETIC', start, end: start + span });
          } else if (!arabic && !label.arabic && label.joined.length >= 6 && Math.abs(joined.length - label.joined.length) <= 1 && editDistance(joined, label.joined) === 1) {
            push({ brandId: label.brandId, label: label.label, basis: 'TYPO', start, end: start + span });
          }
        }
      }
    }
    return hits;
  }
}

// ─── Fast scope gate ──────────────────────────────────────────────────────────

/** Product classes outside a skincare/haircare catalog, by phrases that cannot describe a skincare product. Folded Arabic (ة→ه, أ→ا). */
export const EXCLUDED_CLASSES: Record<string, string[]> = {
  MEDICINE: ['اقراص', 'قرص', 'كبسول', 'كبسولات', 'كبسوله', 'حقن', 'حقنه', 'شراب', 'لبوس', 'فوار', 'قطره عين', 'قطره اذن', 'نقط انف', 'بخاخ انف', 'مضاد حيوي', 'مسكن',
    'tablet', 'tablets', 'tabs', 'capsule', 'capsules', 'caps', 'syrup', 'injection', 'suppositories', 'suppository', 'effervescent', 'eye drops', 'ear drops', 'nasal spray', 'antibiotic'],
  BABY_FEEDING_DIAPERS: ['حفاضات', 'حفاض', 'بامبرز', 'حليب اطفال', 'لبن اطفال', 'ببرونه', 'diaper', 'diapers', 'nappies', 'infant formula', 'baby formula', 'feeding bottle', 'pacifier'],
  MAKEUP: ['روج', 'احمر شفاه', 'ماسكارا', 'كحل', 'ايلاينر', 'فاونديشن', 'كريم اساس', 'كونسيلر', 'طلاء اظافر', 'مانيكير', 'بلاشر', 'ظلال عيون', 'هايلايتر', 'برايمر',
    'lipstick', 'mascara', 'eyeliner', 'eye liner', 'foundation', 'concealer', 'nail polish', 'blusher', 'eyeshadow', 'eye shadow', 'highlighter', 'lip gloss'],
  FRAGRANCE: ['عطر', 'برفان', 'بارفان', 'بارفيوم', 'بودي سبلاش', 'كولونيا', 'perfume', 'parfum', 'eau de toilette', 'eau de parfum', 'body splash', 'cologne', 'body mist'],
  ORAL_CARE: ['معجون اسنان', 'فرشاه اسنان', 'غسول فم', 'خيط اسنان', 'toothpaste', 'toothbrush', 'mouthwash', 'mouth wash', 'dental floss'],
  MEDICAL_DEVICE: ['ترمومتر', 'سرنجه', 'شاش', 'بلاستر', 'جبيره', 'شرائط', 'كمامه', 'قفاز', 'جهاز ضغط', 'جهاز سكر', 'thermometer', 'syringe', 'gauze', 'plaster', 'test strips', 'surgical mask', 'gloves', 'glucometer', 'condom', 'condoms'],
  SHAVING: ['موس حلاقه', 'شفرات', 'شفره', 'ماكينه حلاقه', 'razor', 'razors', 'blades', 'shaving foam', 'shaving gel'],
  HAIR_COLOR: ['صبغه', 'صبغه شعر', 'لون شعر', 'hair color', 'hair colour', 'hair dye', 'bleach powder'],
};
const CLASS_PHRASES = Object.entries(EXCLUDED_CLASSES).flatMap(([klass, phrases]) => phrases.map(phrase => ({ klass, words: identityWords(phrase) })));

function containsPhrase(words: string[], phrase: string[]): boolean {
  for (let i = 0; i + phrase.length <= words.length; i++) if (phrase.every((word, k) => words[i + k] === word)) return true;
  return false;
}

export function excludedClassesIn(text: string): string[] {
  const words = identityWords(text);
  return [...new Set(CLASS_PHRASES.filter(phrase => containsPhrase(words, phrase.words)).map(phrase => phrase.klass))];
}

export type ScopeVerdict = { decision: 'CONTINUE'; reasonCode: string; detail?: string } | { decision: 'SKIP'; reasonCode: string; detail: string };

/**
 * Safe negatives only in OPEN mode; strict brand/category rules in ALLOWLIST_ONLY mode.
 * A barcode or known supplier code (hardIdentifier) always goes on to matching.
 */
export class ScopeGate {
  private readonly denied: BrandDetector;
  private readonly allowedExternal: BrandDetector;
  private readonly classesInCatalog: Set<string>;
  private readonly deniedBrandIds: Set<string>;
  private readonly allowedBrandIds: Set<string>;
  private readonly deniedCategoryIds: Set<string>;
  private readonly allowedCategoryIds: Set<string>;
  private readonly brandCategoryMap: Map<string, 'ALLOW' | 'DENY'>;
  private readonly excludedTermWords: Array<{ term: string; words: string[] }>;
  private readonly disabledClasses: Set<string>;
  private readonly mode: 'OPEN' | 'ALLOWLIST_ONLY';

  constructor(snapshot: CatalogIdentitySnapshot) {
    this.mode = snapshot.policyMode ?? 'OPEN';
    this.denied = new BrandDetector(snapshot.deniedLabels.map((label, i) => ({ id: `denied:${i}`, name: label, aliases: [] })));
    this.allowedExternal = new BrandDetector((snapshot.allowedLabels ?? []).map((label, i) => ({ id: `allowed:${i}`, name: label, aliases: [] })));
    this.classesInCatalog = new Set(snapshot.skus.flatMap(sku => excludedClassesIn(`${sku.productName} ${sku.variantName}`)));
    this.deniedBrandIds = new Set(snapshot.brands.filter(brand => brand.policyEffect === 'DENY').map(brand => brand.id));
    this.allowedBrandIds = new Set(snapshot.brands.filter(brand => brand.policyEffect === 'ALLOW').map(brand => brand.id));
    this.deniedCategoryIds = new Set((snapshot.policyCategories ?? []).filter(c => c.effect === 'DENY').map(c => c.id));
    this.allowedCategoryIds = new Set((snapshot.policyCategories ?? []).filter(c => c.effect === 'ALLOW').map(c => c.id));
    this.brandCategoryMap = new Map(
      (snapshot.brandCategoryRules ?? []).map(r => [`${(r.brandId ?? r.brandName).toLowerCase()}::${r.categoryId}`, r.effect]),
    );
    this.excludedTermWords = (snapshot.excludedTerms ?? [])
      .map(term => ({ term: term.trim(), words: identityWords(term) }))
      .filter(entry => entry.words.length > 0);
    this.disabledClasses = new Set(snapshot.disabledExcludedClasses ?? []);
  }

  private checkCategory(categoryId?: string | null): ScopeVerdict | null {
    if (!categoryId) return null;
    if (this.deniedCategoryIds.has(categoryId)) {
      return { decision: 'SKIP', reasonCode: 'POLICY_CATEGORY_DENIED', detail: 'Category is denied by the Catalog Policy' };
    }
    if (this.mode === 'ALLOWLIST_ONLY' && this.allowedCategoryIds.size > 0 && !this.allowedCategoryIds.has(categoryId)) {
      return { decision: 'SKIP', reasonCode: 'CATEGORY_NOT_IN_ALLOWLIST', detail: 'Category is outside the active allowlist' };
    }
    return null;
  }

  private matchesExcludedTerm(name: string): string | null {
    if (!this.excludedTermWords.length) return null;
    const words = identityWords(name);
    for (const entry of this.excludedTermWords) {
      if (containsPhrase(words, entry.words)) return entry.term;
    }
    return null;
  }

  decide(input: { name: string; catalogBrands: BrandHit[]; categoryId?: string | null; hardIdentifier: boolean }): ScopeVerdict {
    if (input.hardIdentifier) return { decision: 'CONTINUE', reasonCode: 'HARD_IDENTIFIER' };

    const excludedTerm = this.matchesExcludedTerm(input.name);
    if (excludedTerm) {
      return { decision: 'SKIP', reasonCode: 'POLICY_EXCLUDED_TERM', detail: `Matched excluded term '${excludedTerm}'` };
    }

    if (input.catalogBrands.length) {
      if (input.catalogBrands.every(hit => this.deniedBrandIds.has(hit.brandId))) {
        return { decision: 'SKIP', reasonCode: 'POLICY_BRAND_DENIED', detail: `${input.catalogBrands[0].label} is excluded by the Catalog Policy` };
      }

      if (input.categoryId) {
        const pairEffects = input.catalogBrands
          .map(hit => this.brandCategoryMap.get(`${hit.brandId.toLowerCase()}::${input.categoryId}`))
          .filter((v): v is 'ALLOW' | 'DENY' => Boolean(v));
        if (pairEffects.includes('DENY') && !pairEffects.includes('ALLOW')) {
          return { decision: 'SKIP', reasonCode: 'POLICY_BRAND_CATEGORY_DENIED', detail: `${input.catalogBrands[0].label} + category combination is excluded by policy` };
        }
        if (pairEffects.includes('ALLOW')) {
          return { decision: 'CONTINUE', reasonCode: 'POLICY_BRAND_CATEGORY_ALLOWED' };
        }
      }

      const categoryVerdict = this.checkCategory(input.categoryId);
      if (categoryVerdict) return categoryVerdict;

      if (this.mode === 'ALLOWLIST_ONLY') {
        const allowed = input.catalogBrands.some(hit => this.allowedBrandIds.has(hit.brandId));
        if (!allowed) {
          return { decision: 'SKIP', reasonCode: 'BRAND_NOT_IN_ALLOWLIST', detail: `${input.catalogBrands[0].label} is not in the brand allowlist` };
        }
      }

      return { decision: 'CONTINUE', reasonCode: 'CATALOG_BRAND' };
    }

    const denied = this.denied.detect(input.name).filter(hit => hit.basis === 'EXACT');
    if (denied.length) return { decision: 'SKIP', reasonCode: 'POLICY_BRAND_DENIED', detail: `${denied[0].label} is excluded by the Catalog Policy` };

    const classes = excludedClassesIn(input.name).filter(
      klass => !this.classesInCatalog.has(klass) && !this.disabledClasses.has(klass),
    );
    if (classes.length) return { decision: 'SKIP', reasonCode: `OUT_OF_SCOPE_${classes[0]}`, detail: `A ${classes[0].toLowerCase().replace(/_/g, ' ')} product; the catalog holds none` };

    const categoryVerdict = this.checkCategory(input.categoryId);
    if (categoryVerdict) return categoryVerdict;

    if (this.mode === 'ALLOWLIST_ONLY') {
      const allowedExternal = this.allowedExternal.detect(input.name).filter(hit => hit.basis === 'EXACT');
      if (allowedExternal.length) {
        return { decision: 'CONTINUE', reasonCode: 'POLICY_BRAND_ALLOWED' };
      }
      return { decision: 'SKIP', reasonCode: 'NOT_IN_ALLOWLIST', detail: 'Allowlist mode is active and no allowlisted brand matched' };
    }

    return { decision: 'CONTINUE', reasonCode: 'UNKNOWN_SCOPE' };
  }
}

// ─── Candidate index and identity check ──────────────────────────────────────

export interface RowIdentity {
  name: string;
  barcode: string | null;
  code: string | null;
  measure: { size: number; unit: string } | null;
  /** More than one different size stated in the line. */
  measureConflict: boolean;
  packCount: number | null;
  fingerprint: string;
}

export interface CandidateEvidence {
  skuId: string;
  label: string;
  score: number;
  supports: boolean;
  measure: 'SAME' | 'DIFFERENT' | 'UNSTATED' | 'UNKNOWN';
  vetoes: string[];
  onlyRow?: string[];
  onlyCatalog?: string[];
}

export type MatchVerdict =
  | { kind: 'MATCH'; skuId: string; basis: string; score: number; brandHits: BrandHit[]; candidates: CandidateEvidence[] }
  | { kind: 'AMBIGUOUS' | 'CONFLICT' | 'NONE'; reasonCode: string; detail: string; brandHits: BrandHit[]; candidates: CandidateEvidence[] };

interface Entry { sku: SnapshotSku; brand: SnapshotBrand; title: ParsedTitle; markers: ReturnType<typeof variantMarkers>; label: string; descriptors: string[] }

const GENERIC_VARIANTS = new Set(['standard', 'default', 'regular', 'original', 'normal', 'single', 'unit', 'عادي', 'اساسي']);
const variantText = (variant: string) => {
  const stripped = stripMeasures(variant);
  return identityWords(stripped).every(word => GENERIC_VARIANTS.has(word)) ? '' : stripped;
};

const STRONG_SCORE = 0.7;
const SUPPORTED_SCORE = 0.4;
const CLEAR_MARGIN = 0.2;

export class CandidateIndex {
  private readonly entries: Entry[];
  private readonly byBrand = new Map<string, Entry[]>();
  private readonly byBarcode = new Map<string, Entry[]>();
  private readonly bySku = new Map<string, Entry>();
  private readonly byDescriptor = new Map<string, Entry[]>();
  readonly brands: BrandDetector;

  constructor(
    snapshot: CatalogIdentitySnapshot,
    /** Supplier's own codes already tied to canonical SKUs. */
    private readonly supplierCodes: Map<string, string>,
    /** Learned wording (fingerprint) → SKU, for this supplier and global. */
    private readonly learned: Map<string, string>,
  ) {
    const brands = new Map(snapshot.brands.map(brand => [brand.id, brand]));
    this.brands = new BrandDetector(snapshot.brands);
    this.entries = snapshot.skus.flatMap(sku => {
      const brand = brands.get(sku.brandId);
      if (!brand) return [];
      const text = `${sku.productName} ${variantText(sku.variantName)}`.trim();
      const title = parseIdentityTitle(stripMeasures(text), [brand.name, ...brand.aliases]);
      return [{ sku, brand, title, markers: variantMarkers(text), label: `${brand.name} ${sku.productName}${sku.size !== null ? ` ${sku.size}${sku.sizeUnit ?? ''}` : ''}`,
        descriptors: [...new Set(title.descriptors.filter(word => word.length >= 4))] }];
    });
    for (const entry of this.entries) {
      this.bySku.set(entry.sku.skuId, entry);
      this.byBrand.set(entry.brand.id, [...(this.byBrand.get(entry.brand.id) ?? []), entry]);
      for (const barcode of entry.sku.barcodes) this.byBarcode.set(gtinKey(barcode), [...(this.byBarcode.get(gtinKey(barcode)) ?? []), entry]);
      for (const word of entry.descriptors) {
        for (const key of [word, `~${phoneticSkeleton(word)}`]) this.byDescriptor.set(key, [...(this.byDescriptor.get(key) ?? []), entry]);
      }
    }
  }

  get size() { return this.entries.length; }

  /** The SKUs a barcode, a known supplier code or learned wording names, with the identifier that named each. */
  hardHits(row: RowIdentity): Array<{ entry: Entry; basis: string }> {
    const hits: Array<{ entry: Entry; basis: string }> = [];
    if (row.barcode) {
      const seen = new Set<string>();
      for (const form of gtinForms(row.barcode)) for (const entry of this.byBarcode.get(gtinKey(form)) ?? []) {
        if (!seen.has(entry.sku.skuId)) { seen.add(entry.sku.skuId); hits.push({ entry, basis: 'BARCODE' }); }
      }
    }
    const coded = row.code ? this.supplierCodes.get(row.code.trim().toLowerCase()) : undefined;
    if (coded && this.bySku.has(coded)) hits.push({ entry: this.bySku.get(coded)!, basis: 'SUPPLIER_CODE' });
    const learned = this.learned.get(row.fingerprint);
    if (learned && this.bySku.has(learned)) hits.push({ entry: this.bySku.get(learned)!, basis: 'LEARNED_ALIAS' });
    return hits;
  }

  private evaluate(row: RowIdentity, rowTitle: ParsedTitle, rowMarkers: ReturnType<typeof variantMarkers>, entry: Entry): CandidateEvidence {
    const vetoes: string[] = [];
    const same = row.measure ? sameMeasure(row.measure, { size: entry.sku.size, unit: entry.sku.sizeUnit }) : null;
    const measure: CandidateEvidence['measure'] = !row.measure ? 'UNSTATED' : same === null ? 'UNKNOWN' : same ? 'SAME' : 'DIFFERENT';
    if (measure === 'DIFFERENT') vetoes.push('SIZE_DIFFERS');
    if (measure === 'UNKNOWN') vetoes.push('SIZE_NOT_COMPARABLE');
    if ((row.packCount ?? 1) !== entry.sku.packCount) vetoes.push('PACK_DIFFERS');
    // A strength stated on one side only is unknown, not a clash ("Niacinamide 10%" vs "Niacinamide 10% + Zinc 1%"); two sets neither of which contains the other clash.
    const subset = (x: Array<string | number>, y: Array<string | number>) => x.every(value => y.includes(value));
    const markerClash = (a: Array<string | number>, b: Array<string | number>) => a.length > 0 && b.length > 0 && !subset(a, b) && !subset(b, a);
    if (markerClash(rowMarkers.percents, entry.markers.percents)) vetoes.push('STRENGTH_DIFFERS');
    if (markerClash(rowMarkers.spf, entry.markers.spf)) vetoes.push('SPF_DIFFERS');
    if (titleFactConflict(rowTitle, entry.title)) vetoes.push('STATED_FACTS_CONTRADICT');
    const shared = rowMarkers.percents.some(value => entry.markers.percents.includes(value)) || rowMarkers.spf.some(value => entry.markers.spf.includes(value));
    return { skuId: entry.sku.skuId, label: entry.label, score: Math.round(wordingOverlap(rowTitle, entry.title) * 100) / 100,
      supports: wordingSupportsTitle(rowTitle, entry.title, shared), measure, vetoes };
  }

  /**
   * One row against the catalog. Order: hard identifiers (barcode, supplier code, learned wording), each re-checked against what the row states; then the
   * brand's SKUs, vetoed by any contradiction (size, pack, strength, SPF, stated facts) and ranked by wording; then a bounded recovery for close calls.
   * A size the row does not state never links: size is what tells a product's SKUs apart.
   */
  match(row: RowIdentity): MatchVerdict {
    const brandHits = this.brands.detect(row.name);
    const brandLabels = brandHits.length ? brandHits.map(hit => hit.label) : [];
    const rowTitle = parseIdentityTitle(stripMeasures(row.name), [...brandLabels, ...brandHits.flatMap(hit => {
      const entry = this.byBrand.get(hit.brandId)?.[0];
      return entry ? [entry.brand.name, ...entry.brand.aliases] : [];
    })]);
    const rowMarkers = variantMarkers(row.name);
    if (row.measureConflict) {
      return { kind: 'CONFLICT', reasonCode: 'SEVERAL_SIZES_STATED', detail: 'The line states more than one size', brandHits, candidates: [] };
    }

    // 1. Hard identifiers.
    const hard = this.hardHits(row);
    const hardSkus = [...new Set(hard.map(hit => hit.entry.sku.skuId))];
    if (hardSkus.length > 1) {
      return { kind: 'CONFLICT', reasonCode: 'IDENTIFIERS_DISAGREE', detail: `${hard.map(hit => hit.basis).join(', ')} point to different SKUs`, brandHits,
        candidates: hardSkus.map(id => this.evaluate(row, rowTitle, rowMarkers, this.bySku.get(id)!)) };
    }
    if (hardSkus.length === 1) {
      const entry = this.bySku.get(hardSkus[0])!;
      const evidence = this.evaluate(row, rowTitle, rowMarkers, entry);
      const basis = hard.map(hit => hit.basis).join('+');
      const brandClash = brandHits.length > 0 && !brandHits.some(hit => hit.brandId === entry.brand.id);
      const blocking = evidence.vetoes.filter(veto => veto !== 'SIZE_NOT_COMPARABLE');
      if (brandClash) blocking.push('BRAND_DIFFERS');
      if (blocking.length) {
        return { kind: 'CONFLICT', reasonCode: `${hard[0].basis}_CONTRADICTED`, detail: `${basis} names ${entry.label}, but the line states otherwise (${blocking.join(', ')})`,
          brandHits, candidates: [{ ...evidence, vetoes: blocking }] };
      }
      return { kind: 'MATCH', skuId: entry.sku.skuId, basis, score: 1, brandHits, candidates: [evidence] };
    }

    // 2. Retrieval: the named brands' SKUs; with no brand, only SKUs sharing a distinctive (non-vocabulary) word.
    let pool: Entry[];
    let brandless = false;
    if (brandHits.length) {
      pool = brandHits.flatMap(hit => this.byBrand.get(hit.brandId) ?? []);
      if (!pool.length) return { kind: 'NONE', reasonCode: 'BRAND_HAS_NO_SKUS', detail: `${brandHits[0].label} has no active catalog SKU`, brandHits, candidates: [] };
    } else {
      brandless = true;
      const found = new Set<Entry>();
      for (const word of rowTitle.descriptors.filter(word => word.length >= 4)) {
        for (const entry of this.byDescriptor.get(word) ?? []) found.add(entry);
        const skeleton = phoneticSkeleton(word);
        if (skeleton.length >= 4) for (const entry of this.byDescriptor.get(`~${skeleton}`) ?? []) found.add(entry);
      }
      pool = [...found];
      if (!pool.length) return { kind: 'NONE', reasonCode: 'NO_KNOWN_BRAND', detail: 'No catalog brand or product line is named', brandHits, candidates: [] };
    }

    const evaluated = pool.map(entry => ({ entry, evidence: this.evaluate(row, rowTitle, rowMarkers, entry) }))
      .sort((a, b) => b.evidence.score - a.evidence.score || Number(b.evidence.supports) - Number(a.evidence.supports));
    const near = evaluated.slice(0, 5).map(item => item.evidence);
    const eligible = evaluated.filter(item => !item.evidence.vetoes.some(veto => veto !== 'SIZE_NOT_COMPARABLE') && item.evidence.measure !== 'UNKNOWN');
    if (!eligible.length) {
      const sameProductOtherSize = evaluated.find(item => item.evidence.vetoes.length === 1 && item.evidence.vetoes[0] === 'SIZE_DIFFERS' && item.evidence.supports);
      return { kind: 'NONE', reasonCode: sameProductOtherSize ? 'SIZE_NOT_IN_CATALOG' : 'NO_CANDIDATE',
        detail: sameProductOtherSize ? `The catalog holds ${sameProductOtherSize.evidence.label}, not this size` : 'Every catalog SKU of this brand contradicts the line', brandHits, candidates: near };
    }
    const [top] = eligible;
    // Other sizes of the top product do not compete with it: size is decided separately (stated, or the row goes to review).
    const second = eligible.find(item => item !== top && item.entry.sku.productId !== top.entry.sku.productId);
    const strong = (item: typeof top) => (item.evidence.supports && item.evidence.score >= SUPPORTED_SCORE) || item.evidence.score >= STRONG_SCORE;
    const clear = !second || top.evidence.score - second.evidence.score >= CLEAR_MARGIN;

    if (strong(top) && clear) {
      if (!row.measure) {
        const sizes = eligible.filter(item => item.entry.sku.productId === top.entry.sku.productId);
        return { kind: 'AMBIGUOUS', reasonCode: 'SIZE_NOT_STATED', detail: `Looks like ${top.entry.brand.name} ${top.entry.sku.productName}, but the line states no size (${sizes.length} catalog size${sizes.length === 1 ? '' : 's'})`,
          brandHits, candidates: near };
      }
      if (brandless && !(top.evidence.supports && top.evidence.score >= STRONG_SCORE)) {
        return { kind: 'NONE', reasonCode: 'NO_KNOWN_BRAND', detail: `No brand is named; ${top.evidence.label} shares only some wording`, brandHits, candidates: near };
      }
      return { kind: 'MATCH', skuId: top.entry.sku.skuId, basis: brandless ? 'BRANDLESS_PRODUCT_LINE' : 'BRAND_SIZE_WORDING', score: top.evidence.score, brandHits, candidates: near };
    }

    // 3. Bounded recovery: among close candidates, the one whose stated facts and words the row covers exactly, with nothing left over on either side.
    const close = eligible.filter(item => top.evidence.score - item.evidence.score < CLEAR_MARGIN && item.evidence.score >= 0.25);
    const fits = close.map(item => {
      const comparison = compareTitles(rowTitle, item.entry.title);
      item.evidence.onlyRow = comparison.onlySupplier;
      item.evidence.onlyCatalog = comparison.onlyCatalog;
      return { item, exact: comparison.onlySupplier.length === 0 && comparison.onlyCatalog.length === 0 };
    });
    const exact = fits.filter(fit => fit.exact);
    if (exact.length === 1 && row.measure && !brandless) {
      return { kind: 'MATCH', skuId: exact[0].item.entry.sku.skuId, basis: 'RECOVERED_EXACT_WORDING', score: exact[0].item.evidence.score, brandHits, candidates: near };
    }
    if (close.length >= 2) {
      return { kind: 'AMBIGUOUS', reasonCode: 'COMPETING_CANDIDATES', detail: `${close.length} catalog SKUs fit the line about equally`, brandHits, candidates: near };
    }
    // The brand's only SKU of this size that nothing contradicts, sharing the row's wording, with every word of the row read: the row only adds facts the
    // catalog name leaves unstated ("serum" on a name that states no type). Unread words on the row block this.
    if (!brandless && row.measure && eligible.length === 1 && top.evidence.measure === 'SAME' && top.evidence.score >= 0.5) {
      const comparison = compareTitles(rowTitle, top.entry.title);
      if (!comparison.unreadInRow) return { kind: 'MATCH', skuId: top.entry.sku.skuId, basis: 'SOLE_UNCONTRADICTED_CANDIDATE', score: top.evidence.score, brandHits, candidates: near };
    }
    if (brandless || top.evidence.score < 0.25) {
      return { kind: 'NONE', reasonCode: 'NO_CANDIDATE', detail: 'No catalog SKU of this brand is described by the line', brandHits, candidates: near };
    }
    return { kind: 'AMBIGUOUS', reasonCode: 'WEAK_WORDING', detail: `Only ${top.evidence.label} fits, and the wording does not confirm it`, brandHits, candidates: near };
  }
}

/** Text used for audit: the folded line. */
export const auditText = (value: string) => foldIdentityText(value).slice(0, 300);
