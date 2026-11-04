import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CatalogService, BrandService, SkuIdentityCandidate } from '../../catalog/public';
import { RowNormalizationService } from './row-normalization.service';
import { IngestionStatus, Prisma } from '@prisma/client';
import { compareTitles, describeTitle, foldIdentityText, legacyFoldIdentityText, gtinForms, gtinKey, parseIdentityTitle, physicalMeasure, retrievalQuery, titleFactConflict, wordingOverlap, wordingSupportsTitle } from './identity-text';

type IdentitySku = {
  id: string;
  code: string;
  productId: string;
  product: { name: string; spf?: number | null; brand: { name: string } };
  size: { toNumber(): number } | null;
  sizeUnit: string | null;
  packCount: number | null;
  variantName: string;
  barcode: string | null;
  isActive: boolean;
  barcodeAliases?: Array<{ barcode: string; status: string }>;
};

export enum MatchClassification {
  EXACT_MATCH = 'EXACT_MATCH',
  LIKELY_MATCH = 'LIKELY_MATCH',
  CONFLICT = 'CONFLICT',
  NO_MATCH = 'NO_MATCH',
  OUT_OF_SCOPE = 'OUT_OF_SCOPE',
  INVALID = 'INVALID',
}

export interface CandidateItemIdentityInput {
  /** Server-side admission, never accepted by a public DTO. */
  eligibilityApproved?: boolean;
  /** The canonical Brand ID the pinned policy resolved; authoritative over the brand label. */
  brandId?: string | null;
  supplierId: string;
  supplierSkuCode: string;
  name: string;
  brand: string;
  barcode?: string | null;
  /** A barcode cell that is not a valid GTIN, kept as stated. Identity then waits for a reviewer who has seen it. */
  invalidBarcode?: string | null;
  size?: number | null;
  sizeUnit?: string | null;
  variantName?: string | null;
  packageCount?: number | null;
  /** Retained reviewed packaging facts must agree too; a stored SKU ID cannot erase them. */
  physicalEvidence?: Array<{ size?: number; sizeUnit?: string; variantName?: string; packageCount?: number }>;
  category?: string | null;
  rawBrand?: string | null;
  rawName?: string | null;
  /** The ingestion row being classified: excluded from the candidate sweep and used for oldest-wins election. */
  candidateItemId?: string;
  candidateCreatedAt?: Date;
}

/** Read retained physical source facts at every write boundary; never trust matchedSkuId as evidence. */
export function candidateIdentityInput(item: { name: string; brand: string; barcode: string | null;
  supplierSkuCode: string; enrichment?: unknown }, supplierId: string): CandidateItemIdentityInput {
  const evidence = item.enrichment as { media?: Array<{ originType?: string; review?: {
    isTest?: boolean; size?: number; sizeUnit?: string; variantName?: string; packCount?: number;
  } }>; source?: { normalized?: {
    extractedSize?: number; extractedUnit?: string; extractedPackCount?: number; invalidBarcode?: string;
  } } } | null;
  const normalized = evidence?.source?.normalized;
  return { supplierId, supplierSkuCode: item.supplierSkuCode, name: item.name, brand: item.brand,
    barcode: item.barcode, invalidBarcode: normalized?.invalidBarcode, size: normalized?.extractedSize, sizeUnit: normalized?.extractedUnit,
    packageCount: normalized?.extractedPackCount,
    physicalEvidence: evidence?.media?.filter(m => m.originType === 'verified' && m.review?.isTest === false)
      .map(m => ({ size: m.review!.size, sizeUnit: m.review!.sizeUnit,
        variantName: m.review!.variantName, packageCount: m.review!.packCount })) };
}

export interface CanonicalSkuSnapshot {
  id: string;
  code: string;
  productId: string;
  productName: string;
  brandName: string;
  size?: number | null;
  sizeUnit?: string | null;
  variantName?: string | null;
  barcode?: string | null;
  packCount?: number | null;
}

/** A ranked canonical SKU a reviewer may confirm. Retrieval and text overlap are never identity proof. */
export interface IdentityCandidate {
  skuId: string;
  productId: string;
  code: string;
  productName: string;
  variantName: string;
  /** Concentration, SPF and version facts the catalog records for this SKU. */
  formula: string[];
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
  score: number;
  samePackaging: boolean;
  /** Same base wording as the catalog title, so a new SKU here would be a duplicate unless its packaging differs. */
  exactName: boolean;
  /** Reviewer explanation only: what both sides state, what only one states, and which evidence is missing. */
  shared: string[];
  onlySupplier: string[];
  onlyCatalog: string[];
  missing: string[];
}

/** A close SKU a hard fact rules out, listed with the facts so a reviewer sees why it is not offered. */
export interface RejectedIdentityCandidate {
  skuId: string;
  code: string;
  productName: string;
  variantName: string;
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
  conflicts: string[];
}

export interface RowInterpretation {
  size: number | null;
  sizeUnit: string | null;
  packCount: number | null;
  formula: string[];
  facts: string[];
  unreadWords: string[];
  barcodeState: 'VALID' | 'INVALID' | 'MISSING';
  unresolved: string[];
}

// Reasons a reviewer's "different product" can settle: resemblance only, never a stated same name in the same packaging.
const RESOLVABLE_AS_NEW = ['retrieved_candidate_requires_review', 'ambiguous_candidates_require_review',
  'brand_and_product_name_match_different_size_or_variant'];

export type IdentityRoute = 'VERIFIED' | 'CONFLICT' | 'AMBIGUOUS' | 'NEW';

export interface ProductIdentityMatchResult {
  identityState?: 'VERIFIED_IDENTITY' | 'EXPLICIT_CONFLICT' | 'INSUFFICIENT_EVIDENCE';
  route?: IdentityRoute;
  classification: MatchClassification;
  matchedSkuId: string | null;
  reason: string;
  fingerprint: string;
  conflicts: string[];
  canonicalSku?: CanonicalSkuSnapshot | null;
  existingCandidateId?: string | null;
  /** A retrieved canonical SKU a reviewer may confirm; never applied automatically (GLO-276). */
  suggestedSkuId?: string | null;
  /** Top-K candidates in deterministic rank order; empty unless the row reached bounded retrieval. */
  candidates?: IdentityCandidate[];
  rejectedCandidates?: RejectedIdentityCandidate[];
  /** A rejected row with the same identity (GLO-278): shown to the reviewer instead of creating a new candidate. */
  previouslyRejectedCandidateId?: string | null;
  /** Open candidates with the same brand and net content but different wording: duplicate cannot be ruled out. */
  possibleDuplicateCandidateIds?: string[];
}

type AliasWithSku = { skuId: string; supplierSkuCode: string; sku: IdentitySku };

/**
 * One batch's identity lookups, loaded together instead of once per row. A snapshot, not a lock: every persisted
 * association is revalidated by assertSkuAssociation inside its own write.
 */
export interface IdentityBatchContext {
  aliases: Map<string, AliasWithSku>;
  barcodes: Map<string, { active: IdentitySku[]; primaryIds: Set<string>; inactive: IdentitySku | null }>;
  reviewedWordings: Set<string>;
  candidates: Map<string, SkuIdentityCandidate[]>;
  brands: Map<string, { id: string; name: string } | null>;
}

// Bounded retrieval: per identity block in SQL, then attribute-aware ranking of at most 2K rows in memory.
const RETRIEVAL_K = 20;
const CANDIDATE_TOP_K = 5;
const REJECTED_TOP_K = 3;
const MIN_WORDING_OVERLAP = 0.45;
const MIN_WORDING_OVERLAP_SAME_PACKAGING = 0.3;
const SUGGESTION_MARGIN = 0.1;
const NEAR_SAME_NAME = 0.8;

// Placeholder brand cells mean "brand not stated", not "invalid product".
const PLACEHOLDER_BRANDS = ['unknown', 'general', 'n/a', 'na', 'none', '-', 'غير معروف', 'عام'];

function identityMarkers(text: string, spf?: number | null): string[] {
  const found = foldIdentityText(text)
    .match(/\d+(?:\.\d+)?\s*%|spf\s*\d+\+?|(?:عامل\s+حمايه|حمايه|اس\s*بي\s*اف)\s*\d+\+?|(?:version|formula|v|اصدار)\s*\d+|(?:old|new)\s+formula|تركيبه\s+(?:جديده|قديمه)/g)
    ?.map(x => x.replace(/\s/g, '').replace(/^(?:version|formula|اصدار)/, 'v').replace(/^(?:عامل)?(?:حمايه)|^اسبياف/, 'spf')
      .replace(/^تركيبهجديده$/, 'newformula').replace(/^تركيبهقديمه$/, 'oldformula')) ?? [];
  return [...new Set([...found, ...(spf && !found.some(x => x.startsWith('spf')) ? [`spf${spf}`] : [])])].sort();
}

// Curated brand alias dictionary (AR & EN mapping to canonical keys)
const BRAND_ALIASES: Record<string, string> = {
  'سيرافي': 'cerave',
  'cerave': 'cerave',
  'بيوديرما': 'bioderma',
  'bioderma': 'bioderma',
  'لاروش بوزيه': 'la-roche-posay',
  'لاروش-بوزيه': 'la-roche-posay',
  'la roche posay': 'la-roche-posay',
  'la-roche-posay': 'la-roche-posay',
  'يوسيرين': 'eucerin',
  'eucerin': 'eucerin',
  'اورجيناري': 'the-ordinary',
  'the ordinary': 'the-ordinary',
  'the-ordinary': 'the-ordinary',
  'ordinary': 'the-ordinary',
  'فيشي': 'vichy',
  'vichy': 'vichy',
  'سيتافيل': 'cetaphil',
  'cetaphil': 'cetaphil',
  'ستارفيل': 'starville',
  'starville': 'starville',
  'افين': 'avene',
  'avene': 'avene',
  'نيتروجينا': 'neutrogena',
  'neutrogena': 'neutrogena',
  'بانوكسيل': 'panoxyl',
  'panoxyl': 'panoxyl',
  'كوسركس': 'cosrx',
  'cosrx': 'cosrx',
  'ايزدين': 'isdin',
  'isdin': 'isdin',
};

function routeOf(result: ProductIdentityMatchResult): IdentityRoute | undefined {
  switch (result.classification) {
    case MatchClassification.EXACT_MATCH: return 'VERIFIED';
    case MatchClassification.CONFLICT: return 'CONFLICT';
    case MatchClassification.LIKELY_MATCH: return 'AMBIGUOUS';
    case MatchClassification.NO_MATCH:
      return result.existingCandidateId || result.previouslyRejectedCandidateId || result.possibleDuplicateCandidateIds?.length ? 'AMBIGUOUS' : 'NEW';
    default: return undefined;
  }
}

@Injectable()
export class ProductIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: CatalogService,
    private readonly brandService: BrandService,
    @Optional() private readonly rowNormalizationService?: RowNormalizationService,
  ) {}

  normalizeString(str: string): string {
    if (!str) return '';
    return foldIdentityText(str)
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/(^-|-$)+/g, '');
  }

  canonicalizeBrand(brand: string): string {
    if (!brand) return '';
    const norm = this.normalizeString(brand);
    return BRAND_ALIASES[norm] || BRAND_ALIASES[brand.toLowerCase().trim()] || norm;
  }

  isInvalidBrand(brand: string): boolean {
    if (!brand || !brand.trim()) return true;
    const trimmed = brand.trim().toLowerCase();
    if (/^\d+$/.test(trimmed) || trimmed.length < 2) return true;
    const invalidKeywords = ['unknown', 'general', 'fake', 'fakebrand', 'scam', 'n/a', 'none', 'غير معروف', 'عام', 'invalid', 'prohibited'];
    if (invalidKeywords.some((k) => trimmed.includes(k))) {
      return true;
    }
    return false;
  }

  /** True when a brand value actually names a brand (not blank or a placeholder such as "General"). */
  isStatedBrand(brand?: string | null): boolean {
    const trimmed = (brand ?? '').trim().toLowerCase();
    return Boolean(trimmed) && !PLACEHOLDER_BRANDS.includes(trimmed);
  }

  /**
   * Infers a brand named inside a product title (e.g. "سيرافي كريم …", "CeraVe Cleanser …") from curated aliases and
   * active catalog brands. Returns null unless exactly one brand is found — a guess is worse than "unknown".
   */
  async inferBrandFromName(name: string): Promise<string | null> {
    const text = ` ${this.normalizeString(name).replace(/-/g, ' ')} `;
    const found = new Map<string, string>();
    for (const [alias, key] of Object.entries(BRAND_ALIASES)) {
      if (text.includes(` ${this.normalizeString(alias).replace(/-/g, ' ')} `)) found.set(key, key);
    }
    const brands = await this.prisma.brand.findMany({ where: { isActive: true }, select: { name: true } });
    for (const brand of brands) {
      if (text.includes(` ${this.normalizeString(brand.name).replace(/-/g, ' ')} `)) found.set(this.canonicalizeBrand(brand.name), brand.name);
    }
    if (found.size !== 1) return null;
    const [key, display] = [...found.entries()][0];
    return brands.find(b => this.canonicalizeBrand(b.name) === key)?.name ?? display;
  }

  /**
   * Generates a deterministic, versioned product identity fingerprint.
   * Format: v1:<brand_norm>:<name_norm>:<variant_norm>:<size><unit>
   */
  generateFingerprint(input: {
    brand: string;
    name: string;
    variantName?: string | null;
    size?: number | null;
    sizeUnit?: string | null;
    packageCount?: number | null;
  }, legacy = false): string {
    const fold = legacy ? legacyFoldIdentityText : foldIdentityText;
    const normalize = (value: string) => value ? fold(value).trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)+/g, '') : '';
    const brandNorm = this.canonicalizeBrand(input.brand);
    let nameNorm = normalize(input.name);
    let size = input.size;
    let unit = input.sizeUnit;
    let packCount = input.packageCount;

    if (this.rowNormalizationService) {
      const extracted = this.rowNormalizationService.extractSizeAndPack(input.name, input.sizeUnit ?? undefined, fold);
      if (extracted.cleanTitle) {
        const cleanNorm = normalize(extracted.cleanTitle);
        if (cleanNorm && cleanNorm !== nameNorm && (extracted.size !== null || extracted.packCount !== null)) {
          nameNorm = cleanNorm;
        }
      }
      if ((size === undefined || size === null) && extracted.size !== null) {
        size = extracted.size;
        unit = extracted.unit;
      }
      if (packCount === undefined || packCount === null) packCount = extracted.packCount;
    }

    const variantNorm = input.variantName ? this.normalizeString(input.variantName) : 'default';
    const sizeNorm = size !== undefined && size !== null ? `${size}` : 'nosize';
    const unitNorm = unit ? this.normalizeString(unit) : 'nounit';

    return `v1:${brandNorm}:${nameNorm}:${variantNorm}:${sizeNorm}${unitNorm}${packCount === null || packCount === undefined ? '' : `:pack${packCount}`}`;
  }

  private canonicalConflicts(
    input: CandidateItemIdentityInput,
    sku: IdentitySku,
    size: number | null,
    unit: string | null,
    packCount: number | null,
  ): string[] {
    const conflicts: string[] = [];
    // An unstated brand cannot veto, but a stated one must agree.
    if (this.isStatedBrand(input.brand) &&
        this.canonicalizeBrand(input.brand) !== this.canonicalizeBrand(sku.product.brand.name)) {
      conflicts.push('brand_mismatch');
    }
    const verifiedBarcode = this.barcodeVerifies(input.barcode, sku);
    // Names may be translated; explicit semantic facts still veto both barcode and supplier aliases.
    const labels = this.brandLabels(input.brand, sku.product.brand.name);
    if (titleFactConflict(this.parseTitle(input.name, labels), this.parseTitle(sku.product.name, labels))) {
      conflicts.push('product_formulation_mismatch');
    }
    const [a, b] = [identityMarkers(input.name), identityMarkers(`${sku.product.name} ${sku.variantName}`, sku.product.spf)];
    if (a.length && b.length && JSON.stringify(a) !== JSON.stringify(b)) conflicts.push('formula_version_mismatch');
    if (input.barcode && !verifiedBarcode && (sku.barcode || sku.barcodeAliases?.length)) {
      conflicts.push('barcode_mismatch');
    }
    // A fact the catalog never recorded is unknown: it cannot contradict the row, and it cannot corroborate it either.
    const canonicalSize = sku.size?.toNumber() ?? null;
    const [stated, recorded] = [physicalMeasure(size, unit), physicalMeasure(canonicalSize, sku.sizeUnit)];
    if (stated && recorded) {
      if (stated.dimension !== recorded.dimension) conflicts.push('size_unit_mismatch');
      else if (Math.abs(stated.value - recorded.value) > 1e-6) conflicts.push('size_mismatch');
    } else {
      if (size !== null && canonicalSize !== null && size !== canonicalSize) conflicts.push('size_mismatch');
      if (unit && sku.sizeUnit && unit.toLowerCase() !== sku.sizeUnit.toLowerCase()) conflicts.push('size_unit_mismatch');
    }
    if (input.variantName && this.normalizeString(input.variantName) !== this.normalizeString(sku.variantName)) {
      conflicts.push('variant_mismatch');
    }
    if (packCount !== null && (packCount !== (sku.packCount ?? 1))) {
      conflicts.push('pack_count_mismatch');
    }
    return conflicts;
  }

  private get normalizer(): RowNormalizationService {
    return this.rowNormalizationService ?? new RowNormalizationService();
  }

  private barcodeVerifies(barcode: string | null | undefined, sku: IdentitySku): boolean {
    if (!barcode) return false;
    const key = gtinKey(barcode.trim());
    return (Boolean(sku.barcode) && gtinKey(sku.barcode!) === key) ||
      Boolean(sku.barcodeAliases?.some(alias => alias.status === 'approved' && gtinKey(alias.barcode) === key));
  }

  private brandLabels(...brands: string[]): string[] {
    const keys = new Set(brands.filter(Boolean).map(brand => this.canonicalizeBrand(brand)));
    return [...brands.filter(Boolean), ...Object.keys(BRAND_ALIASES).filter(alias => keys.has(BRAND_ALIASES[alias]))];
  }

  private parseTitle(name: string, labels: string[]) {
    return parseIdentityTitle(this.normalizer.extractSizeAndPack(name).cleanTitle, labels);
  }

  /** One evidence boundary for proposed associations, including stored/reviewed IDs. No writes. */
  validateIdentity(input: CandidateItemIdentityInput, sku: IdentitySku, reviewedAlias = false, reviewerConfirmation = false, reviewedWording = false) {
    const extracted = this.normalizer.extractSizeAndPack(input.name);
    const size = input.size ?? extracted.size;
    const unit = input.sizeUnit ?? extracted.unit;
    const pack = input.packageCount ?? extracted.packCount;
    const conflicts = this.canonicalConflicts(input, sku, size, unit, pack);
    for (const facts of input.physicalEvidence ?? []) {
      conflicts.push(...this.canonicalConflicts({ ...input, ...facts }, sku,
        facts.size ?? null, facts.sizeUnit ?? null, facts.packageCount ?? null));
    }
    if (extracted.size !== null && input.size != null && extracted.size !== input.size) conflicts.push('source_size_contradiction');
    if (extracted.unit && input.sizeUnit && extracted.unit.toLowerCase() !== input.sizeUnit.toLowerCase()) conflicts.push('source_unit_contradiction');
    if (extracted.packCount !== null && input.packageCount != null && extracted.packCount !== input.packageCount) conflicts.push('source_pack_contradiction');
    const barcode = this.normalizer.normalizeBarcode(input.barcode);
    if (input.barcode && !barcode.isValid) conflicts.push('invalid_gtin');
    if (!sku.isActive) conflicts.push('canonical_sku_inactive');
    if (conflicts.length) return { state: 'EXPLICIT_CONFLICT' as const, conflicts };
    const [incomingMarkers, canonicalMarkers] = [identityMarkers(input.name), identityMarkers(`${sku.product.name} ${sku.variantName}`, sku.product.spf)];
    if (Boolean(incomingMarkers.length) !== Boolean(canonicalMarkers.length) || /(?:بتاع|بتاعة|مش فاكر|حاجة|حاجه)/u.test(input.name)) {
      return { state: 'INSUFFICIENT_EVIDENCE' as const, conflicts: ['identity_requires_formula_or_description_evidence'] };
    }
    const sameName = this.sameBaseName(input.name, sku.product.name);
    const labels = this.brandLabels(input.brand, sku.product.brand.name);
    // Exact wording, or every supplier word accounted for by the canonical title. Unknown extra words retain uncertainty.
    const wording = sameName || (this.isStatedBrand(input.brand) && wordingSupportsTitle(this.parseTitle(input.name, labels),
      this.parseTitle(sku.product.name, labels), incomingMarkers.length > 0));
    const [stated, recorded] = [physicalMeasure(size, unit), physicalMeasure(sku.size?.toNumber() ?? null, sku.sizeUnit)];
    const physical = Boolean(stated && recorded) && (pack !== null || (sku.packCount ?? 1) === 1);
    const matchingBarcode = this.barcodeVerifies(input.barcode, sku);
    // A reused code or a barcode claims identity; only corroborating wording and packaging keep that claim believable.
    // A reviewer may accept wording no rule can read, but never against a stated fact above or without the same packaging.
    // A barcode the SKU does not record is not a contradiction, but only a review of that barcode lets the alias vouch for it.
    const unrecordedBarcode = Boolean(input.barcode) && !matchingBarcode;
    const verified = (matchingBarcode && (sameName || (wording && physical))) ||
      (reviewedAlias && physical && (reviewedWording || (wording && !unrecordedBarcode))) || (reviewerConfirmation && physical);
    return { state: verified ? 'VERIFIED_IDENTITY' as const : 'INSUFFICIENT_EVIDENCE' as const,
      conflicts: verified ? [] : ['identity_requires_independent_evidence'] };
  }

  async assertSkuAssociation(input: CandidateItemIdentityInput, skuId: string,
    db: Prisma.TransactionClient = this.prisma, reviewerConfirmation = false): Promise<void> {
    const barcode = this.normalizer.normalizeBarcode(input.barcode);
    if (input.barcode && !barcode.isValid) throw new ConflictException('EXPLICIT_CONFLICT: invalid_gtin');
    input = { ...input, barcode: barcode.barcode };
    const sku = await db.sku.findUnique({ where: { id: skuId }, include: {
      product: { include: { brand: true } }, barcodeAliases: { where: { status: 'approved' } },
    } });
    if (!sku) throw new ConflictException('EXPLICIT_CONFLICT: canonical SKU unavailable');
    const alias = await db.supplierSkuAlias.findUnique({ where: { supplierId_supplierSkuCode: {
      supplierId: input.supplierId, supplierSkuCode: input.supplierSkuCode,
    } } });
    if (alias && alias.skuId !== skuId) throw new ConflictException('EXPLICIT_CONFLICT: supplier code reuse');
    let decision = this.validateIdentity(input, sku as IdentitySku, alias?.skuId === skuId, reviewerConfirmation);
    const heldBarcode = Boolean(input.invalidBarcode) && !reviewerConfirmation;
    if (decision.state !== 'EXPLICIT_CONFLICT' && (decision.state !== 'VERIFIED_IDENTITY' || heldBarcode)) {
      const reviewed = alias?.skuId === skuId && await this.wordingWasReviewed(db, input, skuId);
      if (reviewed) decision = this.validateIdentity(input, sku as IdentitySku, true, reviewerConfirmation, true);
      else if (heldBarcode) decision = { state: 'INSUFFICIENT_EVIDENCE', conflicts: ['invalid_gtin'] };
    }
    if (decision.state !== 'VERIFIED_IDENTITY') throw new ConflictException(`${decision.state}: ${decision.conflicts.join(', ')}`);
    if (input.barcode) {
      const forms = gtinForms(input.barcode);
      const other = await db.sku.findFirst({ where: { id: { not: skuId }, isActive: true,
        OR: [{ barcode: { in: forms } }, { barcodeAliases: { some: { barcode: { in: forms }, status: 'approved' } } }] } });
      if (other) throw new ConflictException('EXPLICIT_CONFLICT: barcode_collision_multiple_skus');
    }
  }

  /** The stored key for one row's wording and barcode cell. */
  wordingKeyFor(input: CandidateItemIdentityInput): string {
    return this.wordingKey(input.name, this.barcodeCell({ ...input, invalidBarcode: this.malformedBarcode(input) }));
  }

  /** How matching read a row, for a reviewer. Read-only; decides nothing. */
  interpretRow(input: CandidateItemIdentityInput): RowInterpretation {
    const extracted = this.normalizer.extractSizeAndPack(input.name);
    const size = input.size ?? extracted.size;
    const sizeUnit = input.sizeUnit ?? extracted.unit;
    const described = describeTitle(this.parseTitle(input.name, this.brandLabels(input.brand)));
    const malformed = this.malformedBarcode(input);
    return { size, sizeUnit, packCount: input.packageCount ?? extracted.packCount, formula: identityMarkers(input.name), ...described,
      barcodeState: malformed ? 'INVALID' : input.barcode ? 'VALID' : 'MISSING',
      unresolved: [...(size === null || !sizeUnit ? ['row_size_missing'] : []), ...(malformed ? ['invalid_gtin'] : input.barcode ? [] : ['missing_barcode']),
        ...(described.unreadWords.length ? ['unread_wording'] : [])] };
  }

  /** A reviewer's "different product" settles resemblance, never a same-name twin in the same packaging or a stated conflict. */
  reviewerMayCreateNew(analysis: ProductIdentityMatchResult, review?: { decision?: string } | null): boolean {
    return review?.decision === 'NEW_PRODUCT' && analysis.classification === MatchClassification.LIKELY_MATCH &&
      RESOLVABLE_AS_NEW.includes(analysis.reason) && !analysis.candidates?.some(candidate => candidate.exactName && candidate.samePackaging);
  }

  /** The key a reviewer's confirmation is stored under: the same wording and barcode cell may reuse it, a changed one may not. */
  wordingKey(name: string, barcodeCell?: string | null): string {
    return `${this.baseName(name)}|${barcodeCell ?? ''}`;
  }

  private barcodeCell(input: { barcode?: string | null; invalidBarcode?: string | null }): string {
    return input.invalidBarcode ?? (input.barcode ? gtinKey(input.barcode.trim()) : '');
  }

  /** Did a reviewer confirm this exact supplier wording for this code and SKU? Only explicit confirmations count. */
  private async wordingWasReviewed(db: Prisma.TransactionClient, input: CandidateItemIdentityInput, skuId: string): Promise<boolean> {
    const reviewed = await db.ingestionItem.findMany({
      where: { supplierSkuCode: input.supplierSkuCode, job: { supplierId: input.supplierId },
        enrichment: { path: ['identityReview', 'skuId'], equals: skuId } },
      select: { enrichment: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50,
    });
    const key = this.wordingKey(input.name, this.barcodeCell(input));
    return reviewed.some(row => (row.enrichment as { identityReview?: { wordingKey?: string } }).identityReview?.wordingKey === key);
  }

  sameBaseName(a: string, b: string): boolean {
    return this.baseName(a) === this.baseName(b);
  }

  private baseName(value: string): string {
    return this.normalizeString(this.rowNormalizationService?.extractSizeAndPack(value).cleanTitle || value);
  }

  /**
   * Could two same-brand, same-size titles name one product? Titles in different scripts (Arabic vs Latin) cannot be
   * compared word by word, so they may. Same-script titles may only when their distinguishing words (brand and size
   * removed) mostly overlap — a brand's many different 30 ml serums are not duplicates of each other (GLO-281).
   */
  mayBeSameProduct(a: string, b: string, brand: string): boolean {
    const arabic = /[؀-ۿ]/;
    if (arabic.test(a) !== arabic.test(b)) return true;
    const brandWords = new Set(this.normalizeString(brand).split('-'));
    const words = (value: string) => new Set(this.baseName(value).split('-').filter(w => w && !brandWords.has(w)));
    const [x, y] = [words(a), words(b)];
    const union = new Set([...x, ...y]).size;
    return union === 0 || [...x].filter(w => y.has(w)).length / union >= 0.5;
  }

  private snapshot(sku: IdentitySku): CanonicalSkuSnapshot {
    return {
      id: sku.id, code: sku.code, productId: sku.productId,
      productName: sku.product.name, brandName: sku.product.brand.name,
      size: sku.size?.toNumber() ?? null, sizeUnit: sku.sizeUnit,
      packCount: sku.packCount, variantName: sku.variantName, barcode: sku.barcode,
    };
  }

  /**
   * Classifies candidate match into EXACT_MATCH, LIKELY_MATCH, NO_MATCH, CONFLICT, OUT_OF_SCOPE, or INVALID.
   */
  async classifyCandidateMatch(input: CandidateItemIdentityInput, batch?: IdentityBatchContext): Promise<ProductIdentityMatchResult> {
    const lookups = batch ?? await this.prepareBatch([input]);
    const result = await this.classify(input, lookups);
    const held = this.holdForMalformedBarcode(input, result, lookups);
    return { ...held, route: routeOf(held) };
  }

  /**
   * A malformed barcode proves nothing and contradicts nothing, but it is unexplained evidence on the row: nothing links
   * automatically and nothing earns research until a reviewer has seen that exact cell for this code.
   */
  private holdForMalformedBarcode(input: CandidateItemIdentityInput, result: ProductIdentityMatchResult, lookups: IdentityBatchContext): ProductIdentityMatchResult {
    const raw = this.malformedBarcode(input);
    if (!raw) return result;
    const conflicts = [...result.conflicts, 'invalid_gtin'];
    if (result.classification === MatchClassification.EXACT_MATCH && result.matchedSkuId) {
      if (lookups.reviewedWordings.has(this.reviewedWordingKey(input.supplierSkuCode, result.matchedSkuId, { ...input, invalidBarcode: raw }))) return result;
      return { ...result, classification: MatchClassification.LIKELY_MATCH, identityState: 'INSUFFICIENT_EVIDENCE', matchedSkuId: null,
        suggestedSkuId: result.matchedSkuId, reason: 'invalid_gtin_held', conflicts };
    }
    if (result.classification === MatchClassification.NO_MATCH) return { ...result, classification: MatchClassification.LIKELY_MATCH,
      identityState: 'INSUFFICIENT_EVIDENCE', reason: 'invalid_gtin_held', conflicts };
    return { ...result, conflicts };
  }

  private malformedBarcode(input: CandidateItemIdentityInput): string | null {
    return input.invalidBarcode || (input.barcode && !this.normalizer.normalizeBarcode(input.barcode).isValid ? input.barcode : null);
  }

  private async classify(input: CandidateItemIdentityInput, lookups: IdentityBatchContext): Promise<ProductIdentityMatchResult> {
    const barcode = this.normalizer.normalizeBarcode(input.barcode);
    input = { ...input, invalidBarcode: this.malformedBarcode(input), barcode: barcode.isValid ? barcode.barcode : null };
    let effectiveSize = input.size !== undefined && input.size !== null ? input.size : null;
    let effectiveUnit = input.sizeUnit || null;
    let effectivePackCount = input.packageCount ?? null;

    if (this.rowNormalizationService) {
      const extracted = this.rowNormalizationService.extractSizeAndPack(input.name, input.sizeUnit ?? undefined);
      if (effectiveSize === null && extracted.size !== null) {
        effectiveSize = extracted.size;
        effectiveUnit = extracted.unit;
      }
      if (effectivePackCount === null) effectivePackCount = extracted.packCount;
    }

    const fingerprint = this.generateFingerprint({
      brand: input.brand,
      name: input.name,
      variantName: input.variantName,
      size: effectiveSize,
      sizeUnit: effectiveUnit,
      packageCount: effectivePackCount,
    });

    // 0. Mandatory identifier validation (a brand may be unstated; it then simply cannot vouch for identity)
    const brandStated = this.isStatedBrand(input.brand);
    if (!input.name || !input.name.trim()) {
      return {
        classification: MatchClassification.INVALID,
        matchedSkuId: null,
        reason: 'missing_required_product_fields',
        fingerprint,
        conflicts: ['missing_name_or_brand'],
        canonicalSku: null,
      };
    }

    // 0b. Brand validity check
    if (!input.eligibilityApproved && brandStated && this.isInvalidBrand(input.brand)) {
      return {
        classification: MatchClassification.INVALID,
        matchedSkuId: null,
        reason: 'invalid_or_unvetted_brand',
        fingerprint,
        conflicts: ['unrecognized_or_invalid_brand'],
        canonicalSku: null,
      };
    }

    // 0c. Category & scope evaluation via RowNormalizationService
    if (this.rowNormalizationService) {
      const scope = this.rowNormalizationService.classifyScope(input.name, input.brand);
      if (!input.eligibilityApproved && !scope.isEligible && scope.category === 'excluded') {
        return {
          classification: MatchClassification.OUT_OF_SCOPE,
          matchedSkuId: null,
          reason: scope.reason || 'excluded_category_goods',
          fingerprint,
          conflicts: [scope.reason || 'excluded_category_goods'],
          canonicalSku: null,
        };
      }
    }

    // 1. Verified supplier alias: the cheapest reuse of a reviewed mapping, still revalidated against this row.
    const alias = lookups.aliases.get(input.supplierSkuCode);

    if (alias && alias.sku.isActive) {
      const validation = this.validateIdentity(input, alias.sku, true, false,
        lookups.reviewedWordings.has(this.reviewedWordingKey(input.supplierSkuCode, alias.skuId, input)));
      const conflicts = validation.state === 'EXPLICIT_CONFLICT' ? [...validation.conflicts] : [];
      if (input.barcode && !conflicts.includes('barcode_mismatch')) {
        const known = lookups.barcodes.get(gtinKey(input.barcode.trim()));
        if (known?.active.some(sku => sku.id !== alias.skuId)) conflicts.push('barcode_collision_multiple_skus');
      }
      if (conflicts.length) return {
        classification: MatchClassification.CONFLICT, identityState: 'EXPLICIT_CONFLICT', matchedSkuId: null,
        reason: 'supplier_alias_identity_conflict', fingerprint, conflicts, canonicalSku: null,
      };
      if (validation.state !== 'VERIFIED_IDENTITY') return {
        classification: MatchClassification.LIKELY_MATCH, identityState: 'INSUFFICIENT_EVIDENCE', matchedSkuId: null,
        reason: 'supplier_alias_requires_identity_review', fingerprint, conflicts: validation.conflicts,
        canonicalSku: this.snapshot(alias.sku),
        // New wording under a reviewed code: a reviewer may confirm it once, and that wording is then reused.
        suggestedSkuId: alias.skuId,
      };
      return {
        identityState: 'VERIFIED_IDENTITY',
        classification: MatchClassification.EXACT_MATCH,
        matchedSkuId: alias.skuId,
        reason: 'matched_supplier_sku_alias',
        fingerprint,
        conflicts: [],
        canonicalSku: this.snapshot(alias.sku),
      };
    }

    // 2. Verified GTIN: primary barcode + SkuBarcodeAlias (GLO-242)
    if (input.barcode) {
      const rawBarcode = input.barcode.trim();
      const known = lookups.barcodes.get(gtinKey(rawBarcode));
      const matchedSkus = known?.active ?? [];

      // 2a. Barcode collision: multiple canonical SKUs mapped to same barcode
      if (matchedSkus.length > 1) {
        return {
          classification: MatchClassification.CONFLICT,
          matchedSkuId: null,
          reason: 'barcode_collision_multiple_skus',
          fingerprint,
          conflicts: [`barcode ${rawBarcode} resolves to multiple canonical SKUs: ${matchedSkus.map((s) => s.code).join(', ')}`],
          canonicalSku: null,
        };
      }

      // 2b. Exactly one canonical SKU mapped
      if (matchedSkus.length === 1) {
        const canonicalSku = matchedSkus[0];
        const validation = this.validateIdentity(input, canonicalSku);
        const conflicts = (validation.state === 'EXPLICIT_CONFLICT' ? validation.conflicts : [])
          .map(conflict => conflict === 'brand_mismatch' ? 'barcode_brand_mismatch' :
            conflict === 'size_mismatch' ? 'barcode_size_mismatch' : conflict);

        if (conflicts.length > 0) {
          return {
            classification: MatchClassification.CONFLICT,
            identityState: 'EXPLICIT_CONFLICT',
            matchedSkuId: null,
            reason: 'barcode_matched_with_conflicting_facts',
            fingerprint,
            conflicts,
            canonicalSku: null,
          };
        }

        // Barcode and brand alone cannot override contradictory or insufficient title evidence.
        const corroborated = validation.state === 'VERIFIED_IDENTITY';
        if (!corroborated) {
          return {
            classification: MatchClassification.LIKELY_MATCH,
            identityState: 'INSUFFICIENT_EVIDENCE',
            matchedSkuId: null,
            reason: 'barcode_match_without_independent_corroboration',
            fingerprint,
            conflicts: ['barcode_requires_brand_or_name_corroboration'],
            canonicalSku: this.snapshot(canonicalSku),
            // A suggestion cannot be confirmed until the shared evidence boundary also permits it.
            suggestedSkuId: canonicalSku.id,
          };
        }

        return {
          identityState: 'VERIFIED_IDENTITY',
          classification: MatchClassification.EXACT_MATCH,
          matchedSkuId: canonicalSku.id,
          reason: known!.primaryIds.has(canonicalSku.id) ? 'barcode_exact_match' : 'barcode_alias_exact_match',
          fingerprint,
          conflicts: [],
          canonicalSku: this.snapshot(canonicalSku),
        };
      }

      // 2c. The barcode belongs to an existing but INACTIVE canonical SKU: never "new" (GLO-278) and never silently
      // revived — a reviewer decides whether to reactivate it.
      if (known?.inactive) {
        return {
          classification: MatchClassification.CONFLICT,
          matchedSkuId: null,
          reason: 'barcode_matches_inactive_canonical_sku',
          fingerprint,
          conflicts: ['canonical_sku_inactive'],
          canonicalSku: this.snapshot(known.inactive),
        };
      }
    }

    // 3. Top-K candidates inside the brand block. Text similarity retrieves and ranks; it never links.
    const retrieved = lookups.candidates.get(this.retrievalKey(input));
    if (brandStated && retrieved?.length) {
      const ranked = this.rankCandidates(input, retrieved, effectiveSize, effectiveUnit, effectivePackCount);
      const decision = this.routeCandidates(input, ranked, fingerprint, effectiveSize, effectiveUnit, effectivePackCount);
      if (decision) return decision;
    }

    // 4. Cross-supplier candidate sweep (GLO-278): every open candidate (no row cap), by barcode or identity
    // fingerprint. The OLDEST matching row is the primary — every concurrent importer elects the same one, so two
    // uploads of a new product converge on a single candidate instead of each creating (or pointing at) the other.
    const openStatuses = [IngestionStatus.pending, IngestionStatus.review_required, IngestionStatus.approved];
    // Rows admitted before GLO-285 keep the fingerprint of the older folding; they are still the same product.
    const legacyFingerprint = this.generateFingerprint({ brand: input.brand, name: input.name, variantName: input.variantName,
      size: effectiveSize, sizeUnit: effectiveUnit, packageCount: effectivePackCount }, true);
    // Literal JSON paths: these predicates must match the expression indexes of 20261104100000 on every query plan.
    const fingerprints = [...new Set([fingerprint, legacyFingerprint])];
    const identityMatch = Prisma.sql`(${input.barcode ? Prisma.sql`i.barcode = ${input.barcode.trim()} OR` : Prisma.empty}
      i.enrichment #>> '{source,fingerprint}' IN (${Prisma.join(fingerprints)}) OR i.enrichment #>> '{identity,fingerprint}' IN (${Prisma.join(fingerprints)}))`;
    const notSelf = input.candidateItemId ? Prisma.sql`AND i.id <> ${input.candidateItemId}::uuid` : Prisma.empty;
    const olderThanSelf = input.candidateItemId && input.candidateCreatedAt
      ? Prisma.sql`AND (i.created_at, i.id) < (${input.candidateCreatedAt.toISOString()}::timestamp(3), ${input.candidateItemId}::uuid)`
      : Prisma.empty;
    // Literals, not parameters: the planner can only use the partial index when it can prove this predicate.
    const open = Prisma.raw(openStatuses.map(status => `'${status}'`).join(', '));
    const [existingCandidateItem] = await this.prisma.$queryRaw<Array<{ id: string; brand: string }>>(Prisma.sql`
      SELECT i.id, i.brand FROM ingestion.ingestion_items i
      WHERE ${identityMatch} AND i.status IN (${open}) ${notSelf} ${olderThanSelf}
      ORDER BY i.created_at ASC, i.id ASC LIMIT 1`);

    if (existingCandidateItem) {
      const brandsDisagree = brandStated && this.isStatedBrand(existingCandidateItem.brand) &&
        this.canonicalizeBrand(existingCandidateItem.brand) !== this.canonicalizeBrand(input.brand);
      if (brandsDisagree) {
        return {
          classification: MatchClassification.CONFLICT,
          matchedSkuId: null,
          reason: 'candidate_identity_conflict_across_suppliers',
          fingerprint,
          conflicts: ['candidate_barcode_brand_conflict'],
          canonicalSku: null,
          existingCandidateId: existingCandidateItem.id,
        };
      }
      return {
        classification: MatchClassification.NO_MATCH,
        matchedSkuId: null,
        reason: 'no_canonical_match_found_existing_candidate_reused',
        fingerprint,
        conflicts: input.barcode ? [] : ['missing_barcode'],
        canonicalSku: null,
        existingCandidateId: existingCandidateItem.id,
      };
    }

    // A reviewer already rejected this identity (any supplier): surface it instead of resurrecting a new candidate.
    const [previouslyRejected] = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT i.id FROM ingestion.ingestion_items i
      WHERE ${identityMatch} AND i.status = 'rejected' ${notSelf}
      ORDER BY i.updated_at DESC LIMIT 1`);

    // Same brand + same net content and plausibly the same product in other words (e.g. Arabic vs English title, no
    // barcode): identity cannot be proven either way, so the row is flagged for review rather than becoming a second
    // candidate. Clearly different products of the brand in the same size are not flagged.
    const possibleDuplicateCandidateIds: string[] = [];
    if (brandStated && effectiveSize !== null && effectiveUnit) {
      // Only OLDER rows with a DIFFERENT fingerprint: same-fingerprint rows are settled by oldest-wins election, and a
      // newer differently-worded row flags itself — so racing importers never stall each other.
      // The brand filter belongs before the cap: other brands' rows must not push this brand's duplicate out of it.
      const sameSize = await this.prisma.$queryRaw<Array<{ id: string; brand: string; name: string }>>(Prisma.sql`
        SELECT i.id, i.brand, i.name FROM ingestion.ingestion_items i
        WHERE i.status IN (${open})
          AND lower(i.brand) IN (${Prisma.join(this.brandLabels(input.brand).map(label => label.toLowerCase()))})
          AND i.enrichment #>> '{source,normalized,extractedSize}' = ${String(effectiveSize)}
          AND i.enrichment #>> '{source,normalized,extractedUnit}' = ${effectiveUnit}
          AND i.enrichment #>> '{source,fingerprint}' <> ${fingerprint}
          ${notSelf} ${olderThanSelf}
        ORDER BY i.created_at ASC, i.id ASC LIMIT 500`);
      possibleDuplicateCandidateIds.push(...sameSize
        .filter(c => this.isStatedBrand(c.brand) && this.canonicalizeBrand(c.brand) === this.canonicalizeBrand(input.brand) &&
          this.mayBeSameProduct(input.name, c.name, input.brand))
        .map(c => c.id));
    }

    return {
      classification: MatchClassification.NO_MATCH,
      matchedSkuId: null,
      reason: 'no_canonical_match_found',
      fingerprint,
      conflicts: [...(input.barcode ? [] : ['missing_barcode']), ...(brandStated ? [] : ['missing_brand']),
        ...(effectiveSize === null || !effectiveUnit ? ['missing_net_content'] : [])],
      canonicalSku: null,
      existingCandidateId: null,
      previouslyRejectedCandidateId: previouslyRejected?.id ?? null,
      possibleDuplicateCandidateIds,
    };
  }

  private retrievalKey(input: CandidateItemIdentityInput): string {
    return `${input.supplierSkuCode}|${input.name}`;
  }

  private reviewedWordingKey(code: string, skuId: string, input: CandidateItemIdentityInput): string {
    return `${code}\u0000${skuId}\u0000${this.wordingKey(input.name, this.barcodeCell(input))}`;
  }

  /**
   * Loads every alias, GTIN, reviewed wording, brand and Top-K candidate block for a batch of rows in one query each.
   * Rows already settled by an alias or a GTIN never reach retrieval.
   */
  async prepareBatch(inputs: CandidateItemIdentityInput[]): Promise<IdentityBatchContext> {
    const batch: IdentityBatchContext = { aliases: new Map(), barcodes: new Map(), reviewedWordings: new Set(), candidates: new Map(), brands: new Map() };
    if (!inputs.length) return batch;
    const include = { barcodeAliases: { where: { status: 'approved' as const } }, product: { include: { brand: true } } };
    const supplierId = inputs[0].supplierId;
    const aliases = await this.prisma.supplierSkuAlias.findMany({
      where: { supplierId, supplierSkuCode: { in: [...new Set(inputs.map(input => input.supplierSkuCode))] } },
      include: { sku: { include } },
    });
    for (const alias of aliases) batch.aliases.set(alias.supplierSkuCode, alias as unknown as AliasWithSku);

    const valid = (input: CandidateItemIdentityInput) => {
      const barcode = this.normalizer.normalizeBarcode(input.barcode);
      return barcode.isValid ? barcode.barcode : null;
    };
    const forms = [...new Set(inputs.flatMap(input => { const barcode = valid(input); return barcode ? gtinForms(barcode) : []; }))];
    if (forms.length) {
      const [primary, reviewed] = await Promise.all([
        this.prisma.sku.findMany({ where: { barcode: { in: forms } }, include, orderBy: { id: 'asc' } }),
        this.prisma.skuBarcodeAlias.findMany({ where: { barcode: { in: forms }, status: 'approved' }, include: { sku: { include } }, orderBy: { skuId: 'asc' } }),
      ]);
      const entry = (barcode: string) => {
        const key = gtinKey(barcode);
        if (!batch.barcodes.has(key)) batch.barcodes.set(key, { active: [], primaryIds: new Set(), inactive: null });
        return batch.barcodes.get(key)!;
      };
      const add = (barcode: string, sku: IdentitySku) => {
        const known = entry(barcode);
        if (!sku.isActive) known.inactive ??= sku;
        else if (!known.active.some(existing => existing.id === sku.id)) known.active.push(sku);
      };
      for (const sku of primary as unknown as IdentitySku[]) {
        add(sku.barcode!, sku);
        if (sku.isActive) entry(sku.barcode!).primaryIds.add(sku.id);
      }
      for (const row of reviewed as unknown as Array<{ barcode: string; sku: IdentitySku | null }>) if (row.sku) add(row.barcode, row.sku);
    }

    // Only wording no rule can read needs a reviewer's earlier confirmation: most batches never run this query.
    const unread = inputs.filter(input => {
      const alias = batch.aliases.get(input.supplierSkuCode);
      return alias?.sku.isActive && (this.malformedBarcode(input) || this.validateIdentity({ ...input, barcode: valid(input) }, alias.sku, true)
        .conflicts.includes('identity_requires_independent_evidence'));
    });
    if (unread.length) {
      const reviewed = await this.prisma.$queryRaw<Array<{ code: string; skuId: string; wordingKey: string }>>(Prisma.sql`
        SELECT DISTINCT i.supplier_sku_code AS code, i.enrichment->'identityReview'->>'skuId' AS "skuId",
          i.enrichment->'identityReview'->>'wordingKey' AS "wordingKey"
        FROM ingestion.ingestion_items i JOIN ingestion.ingestion_jobs j ON j.id = i.job_id
        WHERE j.supplier_id = ${supplierId}::uuid AND i.enrichment ? 'identityReview'
          AND i.supplier_sku_code IN (${Prisma.join([...new Set(unread.map(input => input.supplierSkuCode))])})`);
      for (const row of reviewed) batch.reviewedWordings.add(`${row.code}\u0000${row.skuId}\u0000${row.wordingKey}`);
    }

    const unsettled = inputs.filter(input => {
      const alias = batch.aliases.get(input.supplierSkuCode);
      const barcode = valid(input);
      return !(alias?.sku.isActive) && !(barcode && batch.barcodes.has(gtinKey(barcode))) &&
        input.name?.trim() && this.isStatedBrand(input.brand);
    });
    if (!unsettled.length) return batch;
    const labels = [...new Set(unsettled.filter(input => !input.brandId).map(input => input.brand))];
    if (labels.length) {
      const slugs = labels.flatMap(label => [this.canonicalizeBrand(label), this.normalizeString(label)]);
      const brands = await this.prisma.brand.findMany({
        where: { OR: [{ slug: { in: slugs } }, { name: { in: labels, mode: 'insensitive' } }] },
        select: { id: true, name: true, slug: true }, orderBy: { id: 'asc' },
      });
      for (const label of labels) batch.brands.set(label, brands.find(brand => brand.slug === this.canonicalizeBrand(label)) ??
        brands.find(brand => brand.slug === this.normalizeString(label)) ??
        brands.find(brand => brand.name.toLowerCase() === label.toLowerCase()) ??
        // A label that is itself a canonical ID or a slug the folded lookups above did not produce.
        await this.brandService.getBrand(label));
    }
    const requests = unsettled.flatMap(input => {
      const brand = input.brandId ?? batch.brands.get(input.brand)?.id;
      if (!brand) return [];
      const extracted = this.normalizer.extractSizeAndPack(input.name, input.sizeUnit ?? undefined);
      const size = input.size ?? extracted.size;
      const unit = input.size != null ? input.sizeUnit ?? extracted.unit : extracted.unit;
      return [{ key: this.retrievalKey(input), brandId: brand, size: size ?? null, sizeUnit: unit ?? null,
        query: retrievalQuery(extracted.cleanTitle, this.brandLabels(input.brand)) }];
    });
    if (requests.length) batch.candidates = await this.catalogService.findSkuIdentityCandidates(requests, RETRIEVAL_K);
    return batch;
  }

  /** Vetoes first, then attribute-aware score, then stable IDs: the same catalog always yields the same order. */
  private rankCandidates(input: CandidateItemIdentityInput, rows: SkuIdentityCandidate[], size: number | null, unit: string | null, pack: number | null) {
    const labels = this.brandLabels(input.brand, rows[0].brandName);
    const incoming = this.parseTitle(input.name, labels);
    const stated = physicalMeasure(size, unit);
    return rows.map(row => {
      const sku: IdentitySku = { id: row.skuId, code: row.code, productId: row.productId, variantName: row.variantName,
        product: { name: row.productName, spf: row.spf, brand: { name: row.brandName } },
        size: row.size === null ? null : { toNumber: () => row.size! }, sizeUnit: row.sizeUnit, packCount: row.packCount,
        barcode: row.barcode, isActive: row.isActive, barcodeAliases: row.barcodeAliases.map(barcode => ({ barcode, status: 'approved' })) };
      const conflicts = this.canonicalConflicts(input, sku, size, unit, pack);
      const sameName = this.sameBaseName(input.name, row.productName);
      const overlap = sameName ? 1 : wordingOverlap(incoming, this.parseTitle(row.productName, labels));
      const samePackaging = Boolean(stated && physicalMeasure(row.size, row.sizeUnit)) && (pack ?? 1) === (row.packCount ?? 1) && !conflicts.length;
      const score = overlap + (samePackaging ? 0.25 : 0) + row.textScore * 0.1;
      const missing = [...(stated ? [] : ['row_size_missing']), ...(physicalMeasure(row.size, row.sizeUnit) ? [] : ['catalog_size_missing'])];
      return { row, sku, conflicts, sameName, overlap, samePackaging, score, missing,
        comparison: compareTitles(incoming, this.parseTitle(row.productName, labels)) };
    }).sort((a, b) => b.score - a.score || a.row.productId.localeCompare(b.row.productId) || a.row.skuId.localeCompare(b.row.skuId));
  }

  private routeCandidates(input: CandidateItemIdentityInput, ranked: ReturnType<ProductIdentityService['rankCandidates']>,
    fingerprint: string, size: number | null, unit: string | null, pack: number | null): ProductIdentityMatchResult | null {
    const stated = physicalMeasure(size, unit);
    const statesPackagingOf = (c: { row: SkuIdentityCandidate }) => {
      const recorded = physicalMeasure(c.row.size, c.row.sizeUnit);
      return stated && recorded && stated.dimension === recorded.dimension && Math.abs(stated.value - recorded.value) < 1e-6 && pack === c.row.packCount &&
        this.normalizeString(input.variantName || 'Default') === this.normalizeString(c.row.variantName);
    };
    const exactPackaging = ranked.filter(c => c.sameName && statesPackagingOf(c));
    const viable = ranked.filter(c => !c.conflicts.length && c.row.isActive &&
      (c.sameName || c.overlap >= (c.samePackaging ? MIN_WORDING_OVERLAP_SAME_PACKAGING : MIN_WORDING_OVERLAP)));
    const candidates: IdentityCandidate[] = viable.slice(0, CANDIDATE_TOP_K).map(c => ({ skuId: c.row.skuId, productId: c.row.productId, code: c.row.code,
      productName: c.row.productName, variantName: c.row.variantName, formula: identityMarkers(`${c.row.productName} ${c.row.variantName}`, c.row.spf),
      size: c.row.size, sizeUnit: c.row.sizeUnit, packCount: c.row.packCount,
      score: Math.round(c.score * 1000) / 1000, samePackaging: c.samePackaging, exactName: c.sameName,
      shared: c.comparison.shared, onlySupplier: c.comparison.onlySupplier, onlyCatalog: c.comparison.onlyCatalog,
      missing: [...c.missing, ...(c.comparison.unreadInRow ? ['unread_wording'] : [])] }));
    const rejectedCandidates: RejectedIdentityCandidate[] = ranked
      .filter(c => c.conflicts.length && c.row.isActive && c.overlap >= MIN_WORDING_OVERLAP).slice(0, REJECTED_TOP_K)
      .map(c => ({ skuId: c.row.skuId, code: c.row.code, productName: c.row.productName, variantName: c.row.variantName,
        size: c.row.size, sizeUnit: c.row.sizeUnit, packCount: c.row.packCount, conflicts: [...new Set(c.conflicts)] }));

    // A name alone never establishes a variant; all known packaging dimensions must agree.
    if (exactPackaging.length === 1 || (exactPackaging.length && exactPackaging.every(c => c.conflicts.length))) {
      const exact = exactPackaging[0];
      const validation = this.validateIdentity(input, exact.sku);
      if (exact.row.isActive && validation.state === 'EXPLICIT_CONFLICT') return {
        classification: MatchClassification.CONFLICT, identityState: 'EXPLICIT_CONFLICT', matchedSkuId: null,
        reason: 'name_matched_with_conflicting_facts', fingerprint, conflicts: validation.conflicts, candidates, rejectedCandidates,
      };
      if (!exact.row.isActive) {
        return {
          classification: MatchClassification.CONFLICT,
          matchedSkuId: null,
          reason: 'name_size_matches_inactive_canonical_sku',
          fingerprint,
          conflicts: ['canonical_sku_inactive'],
          canonicalSku: this.snapshot(exact.sku),
        };
      }
      // Name + size agreement retrieves a strong candidate but is not identity proof (formulation,
      // version or a reused name can differ): a reviewer confirms before any offer is written.
      return {
        classification: MatchClassification.LIKELY_MATCH,
        identityState: 'INSUFFICIENT_EVIDENCE',
        matchedSkuId: null,
        reason: 'brand_name_size_match_requires_review',
        fingerprint,
        conflicts: ['name_match_requires_identity_review'],
        canonicalSku: this.snapshot(exact.sku),
        suggestedSkuId: exact.row.skuId,
        candidates,
        rejectedCandidates,
      };
    }

    // Several SKUs fit equally or the supplier wording only comes close: list them, and elect one only when it clearly leads.
    if (viable.length) {
      const [top, second] = viable;
      const clearLeader = top.samePackaging && (!second || top.score - second.score >= SUGGESTION_MARGIN);
      return {
        classification: MatchClassification.LIKELY_MATCH,
        identityState: 'INSUFFICIENT_EVIDENCE',
        matchedSkuId: null,
        reason: clearLeader ? 'retrieved_candidate_requires_review' : 'ambiguous_candidates_require_review',
        fingerprint,
        conflicts: [clearLeader ? 'candidate_requires_identity_review' : 'multiple_candidates_require_review'],
        canonicalSku: clearLeader ? this.snapshot(top.sku) : null,
        suggestedSkuId: clearLeader ? top.row.skuId : null,
        candidates,
        rejectedCandidates,
      };
    }

    // Same product name/brand but different size -> LIKELY_MATCH requiring review
    const packagingOnly = (conflict: string) => ['size_mismatch', 'size_unit_mismatch', 'pack_count_mismatch', 'variant_mismatch', 'barcode_mismatch'].includes(conflict);
    if (ranked.some(c => (c.sameName || c.overlap >= NEAR_SAME_NAME) && c.conflicts.every(packagingOnly))) {
      return {
        classification: MatchClassification.LIKELY_MATCH,
        matchedSkuId: null,
        reason: 'brand_and_product_name_match_different_size_or_variant',
        fingerprint,
        conflicts: ['different_size_or_variant_requires_review'],
        canonicalSku: null,
        candidates: [],
        rejectedCandidates,
      };
    }
    return null;
  }

  /** The identity fingerprint stored on an admitted row so concurrent importers can find each other (GLO-278). */
  rowFingerprint(input: { brand: string; name: string; size?: number | null; sizeUnit?: string | null; packageCount?: number | null }): string | null {
    return this.isStatedBrand(input.brand) ? this.generateFingerprint(input) : null;
  }

  /**
   * Registers an approved Supplier SKU Alias for automatic matching on future imports.
   */
  async createSupplierSkuAlias(supplierId: string, supplierSkuCode: string, skuId: string): Promise<void> {
    const existing = await this.prisma.supplierSkuAlias.findUnique({
      where: { supplierId_supplierSkuCode: { supplierId, supplierSkuCode } },
    });
    if (existing) {
      // Re-pointing a reviewed supplier code to another SKU would silently move future offers; it needs review.
      if (existing.skuId !== skuId) {
        throw new ConflictException(`Supplier code ${supplierSkuCode} is already linked to a different canonical SKU`);
      }
      return;
    }
    await this.prisma.supplierSkuAlias.create({ data: { supplierId, supplierSkuCode, skuId } });
  }
}

