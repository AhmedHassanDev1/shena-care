import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminCatalogImportRowOutcome as Outcome, AdminCatalogImportStatus as Status, CatalogDecision, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { StorageService } from '../../../platform/storage/storage.service';
import { SpreadsheetParserService, ParsedSpreadsheet } from './spreadsheet-parser.service';
import { RowNormalizationService } from './row-normalization.service';
import { MatchClassification, ProductIdentityMatchResult, ProductIdentityService, CandidateItemIdentityInput } from './product-identity.service';
import { IngestionEligibilityService } from './ingestion-eligibility.service';
import { compileEligibilityPolicy, EligibilityDecision, eligibilityMappingKey } from './ingestion-eligibility.policy';
import { CatalogIntakeService } from '../../catalog/public';
import { independentLinkSupport, sameGtin, sameUrl } from './catalog-decision-engine';
import { parseIdentityTitle, physicalMeasure, titleFactConflict } from './identity-text';

type Policy = ReturnType<typeof compileEligibilityPolicy>;
type Decision = { outcome: Outcome; reasonCode: string; reason: string; matchedSkuId?: string; identity?: Record<string, unknown> };
const POLICY_TEXT: Record<string, string> = {
  POLICY_NOT_CONFIGURED: 'No Catalog Policy is active yet', BRAND_NOT_ALLOWED: 'The brand is not enabled in the Catalog Policy',
  BRAND_UNKNOWN: 'The brand is not a known canonical brand or alias', BRAND_AMBIGUOUS: 'The brand name points to more than one brand',
  CATEGORY_DENIED: 'The category is excluded', CATEGORY_NOT_ALLOWED: 'No enabled brand allows this category',
  CATEGORY_NOT_ALLOWED_FOR_BRAND: 'This category is not allowed for the brand', CATEGORY_UNKNOWN: 'The category is missing or unknown',
  CATEGORY_AMBIGUOUS: 'The category or product type fits more than one approved leaf category', CATEGORY_REQUIRES_LEAF: 'A precise sub-category is required',
  CATEGORY_CONFLICTS_PRODUCT_TYPE: 'The stated category contradicts the product type the name states',
  PRODUCT_TYPE_NOT_IN_TAXONOMY: 'The product type has no approved leaf category, so no brand can allow it',
  PRODUCT_EXCLUDED: 'The product is explicitly excluded in the Catalog Policy',
  BRAND_NOT_IN_ALLOWLIST: 'The brand is not on the Catalog Policy allowlist',
  BRAND_SPELLING_UNCONFIRMED: 'The brand is not on the Catalog Policy but closely resembles an allowed brand',
  BRAND_NEW: 'The brand is new to the catalog: it is verified on its official website and added automatically for this category',
  CATEGORY_HIERARCHY_AMBIGUOUS: 'The category hierarchy loops', CATEGORY_HIERARCHY_UNKNOWN: 'The category hierarchy is not fully in the Catalog Policy',
};
/** Suggestion score at which an unknown brand is treated as a probable misspelling of an allowed one (asked about) rather than an unlisted brand (skipped). */
const SPELLING_HOLD_SCORE = 0.5;
/** Policy SKIP is a settled REJECTED row; policy HOLD waits for a person. Both keep the policy version that decided them. */
const policyDecision = (d: EligibilityDecision): Decision => ({
  outcome: d.outcome === 'SKIP' ? Outcome.REJECTED : Outcome.HOLD, reasonCode: `POLICY_${d.reason}`, reason: POLICY_TEXT[d.reason] ?? d.reason,
});

/** Admin lists are short product lists, not supplier exports; the bound keeps one request's matching honest. */
export const ADMIN_IMPORT_MAX_ROWS = 5000;
const MATCH_CHUNK = 200;
const MAX_NAME = 300;
const MAX_FIELD = 200;
const MAX_URL = 2000;
const SPREADSHEET_MIME = /^(text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;
const MATCH_LOCK = 'admin-catalog-import:match';

type Field = 'name' | 'brand' | 'size' | 'barcode' | 'category' | 'url';

/** Exact folded header names only. A column that is not listed here is never read, so price, cost and stock columns cannot leak in. */
const HEADERS: Record<Field, string[]> = {
  name: ['name', 'productname', 'product', 'title', 'itemname', 'اسم المنتج', 'المنتج', 'اسم', 'الاسم', 'اسم الصنف', 'الصنف'],
  brand: ['brand', 'brandname', 'manufacturer', 'الماركه', 'ماركه', 'العلامه التجاريه', 'براند'],
  size: ['size', 'volume', 'netcontent', 'net content', 'weight', 'الحجم', 'المقاس', 'الوزن', 'السعه'],
  barcode: ['barcode', 'gtin', 'ean', 'upc', 'الباركود', 'باركود'],
  category: ['category', 'categoryname', 'التصنيف', 'القسم', 'الفئه'],
  url: ['url', 'link', 'sourceurl', 'source url', 'productpage', 'product page', 'productlink', 'product link', 'الرابط', 'رابط', 'رابط المنتج'],
};

const foldHeader = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[\r\n\t_\-./]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const FOLDED: Record<Field, Set<string>> = Object.fromEntries(
  (Object.keys(HEADERS) as Field[]).map(field => [field, new Set(HEADERS[field].flatMap(h => [foldHeader(h), foldHeader(h).replace(/ /g, '')]))])) as Record<Field, Set<string>>;

export interface ColumnMap { mapped: Partial<Record<Field, string>>; ignored: string[] }

export interface AdminImportReceipt {
  jobId: string;
  status: Status;
  reused: boolean;
  totalRows: number;
  columnMap: ColumnMap;
  totals?: Record<string, number>;
  matching?: { status: 'COMPLETED' | 'FAILED_RETRYABLE'; error?: string };
}

interface PreparedRow {
  rowNumber: number;
  name: string;
  brand: string | null;
  size: number | null;
  sizeUnit: string | null;
  barcode: string | null;
  invalidBarcode: string | null;
  categoryHint: string | null;
  sourceUrl: string | null;
  sourceCells: Record<string, unknown>;
  outcome: Outcome;
  reasonCode: string | null;
  reason: string | null;
}

export interface ResolveRowInput { action: 'LINK_SKU' | 'REJECT'; skuId?: string; note: string }

/** The canonical identity a row was admitted under, for intake and research. */
export interface RowAdmission { brandId: string; brandName: string; brandAliases: string[]; websiteUrl: string | null; categoryId: string; policyVersion: number | null }

export interface RowCorrection { name?: string; brand?: string; size?: number; sizeUnit?: string; categoryHint?: string; sourceUrl?: string; barcode?: string | null }

/** Identity key independent of the brand label used: the same product listed as "Clary" or "Clary Corporation" has one key. */
export const identityKeyOf = (brandId: string, baseName: string, size: number | null, unit: string | null) => `k1:${brandId}:${baseName}:${size ?? 'nosize'}${unit ?? ''}`;

// eslint-disable-next-line no-control-regex -- stripping control characters from spreadsheet cells is the point
const cell = (value: unknown): string => (value === null || value === undefined ? '' : String(value)).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Admin Catalog Bootstrap: an Admin uploads a plain product list to grow the catalog. Rows go through the same canonical identity engine as every other source
 * (ProductIdentityService) and the same downstream research, media and publication workflow; this service only keeps the list's own rows and decisions.
 *
 * Contract: an import only ever adds knowledge. It never creates SKUs, offers, prices or stock, and nothing absent from a list is touched.
 */
@Injectable()
export class AdminCatalogImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: SpreadsheetParserService,
    private readonly normalizer: RowNormalizationService,
    private readonly identity: ProductIdentityService,
    private readonly eligibility: IngestionEligibilityService,
    private readonly catalogIntake: CatalogIntakeService,
  ) {}

  /**
   * Policy for a stated brand, with two deterministic rescues before anything is skipped: the curated alias dictionary (e.g. "سيرافي" is CeraVe) and the policy's own
   * spelling suggestions. A brand that resolves to nothing allowed is skipped (not on the allowlist); one that closely resembles an allowed brand is held for a person,
   * because a spelling guess must never admit a product on its own.
   */
  private judgeBrand(policy: Policy, brand: string, category: string, productName: string): { decision: EligibilityDecision; brandLabel: string; suggestion?: { brandId: string; name: string; score: number } } {
    const first = policy.evaluate('', brand, category, productName);
    // Only a stated brand that the policy does not know at all is looked at again. "No enabled brand allows this leaf" is the same situation for a new brand:
    // the leaf may simply be one no brand brings in yet.
    const unknownBrand = this.identity.isStatedBrand(brand) && !policy.brandOf(brand) && (first.reason === 'BRAND_UNKNOWN' || first.reason === 'CATEGORY_NOT_ALLOWED');
    if (!unknownBrand) return { decision: first, brandLabel: brand };
    const suggestions = policy.suggestBrands(brand);
    const curated = this.identity.canonicalizeBrand(brand);
    const sameBrand = suggestions.find(s => this.identity.canonicalizeBrand(s.name) === curated);
    if (sameBrand) return { decision: policy.evaluate('', sameBrand.name, category, productName), brandLabel: sameBrand.name };
    const top = suggestions.find(s => s.effect === 'ALLOW' && s.score >= SPELLING_HOLD_SCORE);
    const synthetic = (outcome: EligibilityDecision['outcome'], reason: string, extra: Partial<EligibilityDecision> = {}): EligibilityDecision => ({ ...first, outcome, reason, ...extra });
    // A probable misspelling of an allowed brand is asked about; correcting it cannot admit a leaf no brand allows, so that stays the definite skip it was.
    if (top) return first.reason === 'CATEGORY_NOT_ALLOWED' ? { decision: first, brandLabel: brand }
      : { decision: synthetic('HOLD', 'BRAND_SPELLING_UNCONFIRMED'), brandLabel: brand, suggestion: { brandId: top.brandId, name: top.name, score: top.score } };
    // A brand new to the catalog (owner decision 2026-11-07): the pipeline verifies it on its official website and adds it for exactly this row's leaf. The leaf is
    // settled first, by the same rules as every row; without a leaf there is nothing to add the brand for.
    const leaf = policy.leafFor('', category, productName);
    if (leaf.outcome === 'ALLOW') return { decision: synthetic('HOLD', 'BRAND_NEW', { categoryId: leaf.categoryId, category: leaf.category }), brandLabel: brand };
    return { decision: synthetic(leaf.outcome, leaf.reason, { category: leaf.category }), brandLabel: brand };
  }

  /** Maps headers to fields by exact folded name; everything else is ignored and reported, never read. */
  mapColumns(headers: string[]): ColumnMap {
    const mapped: Partial<Record<Field, string>> = {};
    for (const header of headers) {
      const folded = foldHeader(header);
      for (const field of Object.keys(FOLDED) as Field[]) {
        if (!mapped[field] && (FOLDED[field].has(folded) || FOLDED[field].has(folded.replace(/ /g, '')))) { mapped[field] = header; break; }
      }
    }
    const used = new Set(Object.values(mapped));
    return { mapped, ignored: headers.filter(header => !used.has(header)) };
  }

  private prepareRow(parsedRow: ParsedSpreadsheet['rows'][number], columns: ColumnMap['mapped']): PreparedRow {
    const read = (field: Field) => (columns[field] ? cell(parsedRow.data[columns[field]!]) : '');
    const name = read('name');
    const brand = read('brand');
    const sizeText = read('size');
    const barcodeText = read('barcode');
    const category = read('category');
    const urlText = read('url');
    const sourceCells: Record<string, unknown> = {};
    for (const field of Object.keys(columns) as Field[]) sourceCells[columns[field]!] = parsedRow.data[columns[field]!];

    const prepared: PreparedRow = { rowNumber: parsedRow.sourceRow, name, brand: brand || null, size: null, sizeUnit: null, barcode: null, invalidBarcode: null,
      categoryHint: category || null, sourceUrl: null, sourceCells, outcome: Outcome.PENDING, reasonCode: null, reason: null };
    const settle = (outcome: Outcome, reasonCode: string, reason: string) => { if (prepared.outcome === Outcome.PENDING || outcome === Outcome.REJECTED) Object.assign(prepared, { outcome, reasonCode, reason }); };

    if (!name) settle(Outcome.REJECTED, 'MISSING_NAME', 'Product name is required');
    else if (name.length > MAX_NAME) settle(Outcome.REJECTED, 'NAME_TOO_LONG', `Product name is longer than ${MAX_NAME} characters`);
    if (brand.length > MAX_FIELD || category.length > MAX_FIELD) settle(Outcome.REJECTED, 'FIELD_TOO_LONG', `Brand and category are limited to ${MAX_FIELD} characters`);

    if (barcodeText) {
      const barcode = this.normalizer.normalizeBarcode(barcodeText);
      if (barcode.isValid) prepared.barcode = barcode.barcode;
      else prepared.invalidBarcode = barcodeText;
    }
    if (sizeText) {
      const extracted = this.normalizer.extractSizeAndPack(sizeText);
      if (extracted.size !== null && extracted.unit) { prepared.size = extracted.size; prepared.sizeUnit = extracted.unit; }
      else settle(Outcome.HOLD, 'SIZE_UNREADABLE', `Size "${sizeText.slice(0, 60)}" is not a readable quantity and unit`);
    } else if (name) {
      // No size cell: the size the Admin wrote in the product name ("… Cleanser 200 ml") is the row's size, as the identity engine already reads it.
      const fromName = this.normalizer.extractSizeAndPack(name);
      if (fromName.size !== null && fromName.unit) { prepared.size = fromName.size; prepared.sizeUnit = fromName.unit; }
    }
    if (urlText) {
      try {
        const url = new URL(urlText);
        // Stored as provenance only; every fetch of it still passes the research source validator.
        if (url.protocol === 'https:' && urlText.length <= MAX_URL && !url.username && !url.password) prepared.sourceUrl = url.toString();
      } catch { /* an unusable URL is simply not kept */ }
    }
    return prepared;
  }

  private sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Stores the original, admits every row with its outcome, then matches. A retried upload of the same file resolves to the same job and resumes matching. */
  async upload(file: Express.Multer.File, actorId: string): Promise<AdminImportReceipt> {
    if (!file?.buffer?.length) throw new BadRequestException('File is required');
    if (!SPREADSHEET_MIME.test(file.mimetype)) throw new BadRequestException('A CSV or XLSX product list is required');
    this.storage.validateFile(file);
    const parsed = this.parser.parseSpreadsheet(file.buffer, file.originalname, { maxRows: ADMIN_IMPORT_MAX_ROWS });
    const columnMap = this.mapColumns(parsed.headers);
    if (!columnMap.mapped.name) {
      throw new BadRequestException({ code: 'NAME_COLUMN_NOT_FOUND', message: 'The file needs a product name column', headers: parsed.headers });
    }
    const checksum = this.sha256(file.buffer);

    const settled = async (): Promise<AdminImportReceipt | null> => {
      const existing = await this.prisma.adminCatalogImportJob.findUnique({ where: { sourceChecksum: checksum } });
      if (!existing) return null;
      return this.receipt(existing.id, true);
    };

    let receipt = await settled();
    if (!receipt) {
      const rows = parsed.rows.map(row => this.prepareRow(row, columnMap.mapped));
      try {
        const jobId = await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-catalog-import:${checksum}`}))`;
          const raced = await tx.adminCatalogImportJob.findUnique({ where: { sourceChecksum: checksum }, select: { id: true } });
          if (raced) return { id: raced.id, created: false };
          const fileUrl = await this.storage.uploadFile(file, true, 'catalog-imports', actorId);
          try {
            const job = await tx.adminCatalogImportJob.create({ data: {
              sourceKey: new URL(fileUrl).pathname.slice('/storage/'.length), sourceChecksum: checksum,
              sourceFileName: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200), sourceMimeType: file.mimetype, sourceSizeBytes: file.buffer.length,
              uploadedBy: actorId, columnMap: columnMap as unknown as Prisma.InputJsonValue,
            } });
            for (let start = 0; start < rows.length; start += 1000) {
              await tx.adminCatalogImportRow.createMany({ data: rows.slice(start, start + 1000).map(row => ({
                jobId: job.id, rowNumber: row.rowNumber, name: row.name, brand: row.brand, size: row.size, sizeUnit: row.sizeUnit, barcode: row.barcode,
                invalidBarcode: row.invalidBarcode, categoryHint: row.categoryHint, sourceUrl: row.sourceUrl, sourceCells: row.sourceCells as Prisma.InputJsonValue,
                outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason,
              })) });
            }
            return { id: job.id, created: true };
          } catch (error) {
            await this.storage.deleteFile(fileUrl);
            throw error;
          }
        }, { timeout: 120000 });
        receipt = await this.receipt(jobId.id, !jobId.created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') receipt = await settled();
        if (!receipt) throw error;
      }
    }

    if (receipt.status !== Status.COMPLETED) {
      const matching = await this.match(receipt.jobId).then(
        () => ({ status: 'COMPLETED' as const }),
        error => ({ status: 'FAILED_RETRYABLE' as const, error: error instanceof Error ? error.message : String(error) }));
      receipt = { ...(await this.receipt(receipt.jobId, receipt.reused)), matching };
    }
    return receipt;
  }

  private async receipt(jobId: string, reused: boolean): Promise<AdminImportReceipt> {
    const job = await this.prisma.adminCatalogImportJob.findUniqueOrThrow({ where: { id: jobId } });
    return { jobId, status: job.status, reused, totalRows: await this.prisma.adminCatalogImportRow.count({ where: { jobId } }),
      columnMap: job.columnMap as unknown as ColumnMap, totals: (job.totals as Record<string, number> | null) ?? undefined };
  }

  /**
   * Classifies every PENDING row with the shared identity engine. Safe to repeat: a decided row is never rewritten, so a retry, a crash or two
   * concurrent calls converge. With recheck, rows still waiting on a person (HOLD, NEW_CANDIDATE) are looked at again, e.g. after their SKU was created.
   */
  async match(jobId: string, options: { recheck?: boolean; rowIds?: string[]; keepNew?: boolean } = {}): Promise<Record<string, number>> {
    const job = await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import not found');
    try {
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.MATCHING, lastError: null } });
      if (options.recheck) {
        // A Catalog Policy change can settle earlier policy outcomes either way, so policy skips are looked at again too.
        await this.prisma.adminCatalogImportRow.updateMany({
          // A settled automatic decision is never reopened by a recheck (NULL-safe: an undecided row is always eligible).
          where: { jobId, resolvedBy: null, ...(options.rowIds && { id: { in: options.rowIds } }), AND: [{ OR: [{ decision: null }, { decision: { notIn: [CatalogDecision.AUTO_ACCEPT, CatalogDecision.AUTO_LINK] } }] }], OR: [
            { outcome: { in: [Outcome.HOLD, Outcome.NEW_CANDIDATE] }, reasonCode: { not: 'SIZE_UNREADABLE' }, ...(options.keepNew && { NOT: { outcome: Outcome.NEW_CANDIDATE } }) },
            { outcome: Outcome.REJECTED, reasonCode: { startsWith: 'POLICY_' } },
            // Repeats of an earlier row are looked at again only when the pipeline asks for them, once their product exists.
            ...(options.rowIds ? [{ outcome: Outcome.REJECTED, reasonCode: 'DUPLICATE_OF_ROW' }] : []),
          ] },
          data: { outcome: Outcome.PENDING, reasonCode: null, reason: null, decision: null, stage: null },
        });
      }
      // The policy active when matching runs decides every row of this pass.
      const policy = await this.eligibility.compile((await this.eligibility.current())?.id);
      let cursor = 0;
      for (;;) {
        const chunk = await this.prisma.adminCatalogImportRow.findMany({
          where: { jobId, outcome: Outcome.PENDING, rowNumber: { gt: cursor } }, orderBy: { rowNumber: 'asc' }, take: MATCH_CHUNK });
        if (!chunk.length) break;
        cursor = chunk[chunk.length - 1].rowNumber;
        await this.matchChunk(job.createdAt, chunk, policy);
      }
      const totals = await this.totals(jobId);
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.COMPLETED, totals, completedAt: new Date() } });
      return totals;
    } catch (error) {
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.FAILED, lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
      throw error;
    }
  }

  private async totals(jobId: string): Promise<Record<string, number>> {
    const grouped = await this.prisma.adminCatalogImportRow.groupBy({ by: ['outcome'], where: { jobId }, _count: { _all: true } });
    const totals: Record<string, number> = { PENDING: 0, LINKED_EXISTING: 0, NEW_CANDIDATE: 0, HOLD: 0, REJECTED: 0 };
    for (const group of grouped) totals[group.outcome] = group._count._all;
    totals.total = Object.values(totals).reduce((sum, count) => sum + count, 0);
    // The automatic pipeline's ends, alongside the matcher's outcomes.
    const decisions = await this.prisma.adminCatalogImportRow.groupBy({ by: ['decision'], where: { jobId }, _count: { _all: true } });
    for (const name of Object.values(CatalogDecision)) totals[name] = 0;
    totals.UNDECIDED = 0;
    for (const group of decisions) totals[group.decision ?? 'UNDECIDED'] = group._count._all;
    return totals;
  }

  private async matchChunk(jobCreatedAt: Date, rows: Array<Prisma.AdminCatalogImportRowGetPayload<object>>, policy: Policy): Promise<void> {
    const inputs = new Map<string, CandidateItemIdentityInput>();
    const brands = new Map<string, string | null>();
    const stated = new Map<string, EligibilityDecision>();
    const suggestions = new Map<string, { brandId: string; name: string; score: number }>();
    const canonicalBrands = new Map<string, string>();
    const skipped: typeof rows = [];
    for (const row of rows) {
      const isStated = this.identity.isStatedBrand(row.brand);
      const inferred = isStated ? null : await this.identity.inferBrandFromName(row.name);
      const judged = this.judgeBrand(policy, isStated ? row.brand! : inferred ?? '', row.categoryHint ?? '', row.name);
      // Once the policy resolved the brand (by name or an approved alias such as "clary"), matching uses the canonical brand, never the raw label, whatever the
      // category outcome: a row held for its category must still find the SKU it already is (that SKU's verified category then decides).
      const canonical = policy.brandOf(judged.brandLabel);
      const allowedBrand = canonical && canonical.effect === 'ALLOW' && canonical.isActive ? canonical : undefined;
      const brand = judged.decision.outcome === 'ALLOW' && judged.decision.brandName ? judged.decision.brandName : canonical?.name ?? judged.brandLabel;
      // Policy before identity: a disallowed brand or a known disallowed category is settled here, with no matching spend.
      const decision = judged.decision;
      stated.set(row.id, decision);
      if (judged.suggestion) suggestions.set(row.id, judged.suggestion);
      if (decision.outcome === 'SKIP') { skipped.push(row); continue; }
      brands.set(row.id, inferred);
      if (allowedBrand) canonicalBrands.set(row.id, allowedBrand.id);
      // An Admin list's barcode cell that is not a valid GTIN (often a merchant code) proves nothing and contradicts nothing: it is kept on the row and ignored as evidence.
      inputs.set(row.id, { name: row.name, brand, brandId: decision.outcome === 'ALLOW' ? decision.brandId ?? null : allowedBrand?.id ?? null, barcode: row.barcode, invalidBarcode: null,
        size: row.size?.toNumber() ?? null, sizeUnit: row.sizeUnit, category: row.categoryHint, rawName: row.name, rawBrand: row.brand });
    }
    const batch = await this.identity.prepareBatch([...inputs.values()]);
    const results = new Map<string, ProductIdentityMatchResult>();
    for (const row of rows) if (inputs.has(row.id)) results.set(row.id, await this.identity.classifyCandidateMatch(inputs.get(row.id)!, batch));
    // Same brand, name and packaging as exactly one SKU: linked automatically only with support that is not the row's own wording.
    const linkable = new Map<string, string>();
    for (const row of rows) {
      const result = results.get(row.id);
      if (result?.classification === MatchClassification.LIKELY_MATCH && result.reason === 'brand_name_size_match_requires_review' && result.suggestedSkuId &&
          (result.candidates ?? []).filter(candidate => candidate.exactName && candidate.samePackaging).length <= 1) linkable.set(row.id, result.suggestedSkuId);
    }
    const snapshots = linkable.size ? await this.catalogIntake.identitySnapshot([...new Set(linkable.values())]) : new Map();
    const support = new Map<string, string>();
    for (const [rowId, skuId] of linkable) {
      const row = rows.find(item => item.id === rowId)!;
      const result = results.get(rowId)!;
      const sku = snapshots.get(skuId);
      if (!sku) continue;
      const admittedBrandId = stated.get(rowId)?.brandId ?? canonicalBrands.get(rowId);
      const keys = [result.fingerprint, ...(admittedBrandId ? [identityKeyOf(admittedBrandId, this.identity.wordingKey(row.name, null), row.size?.toNumber() ?? null, row.sizeUnit)] : [])];
      const provenanceRows = await this.prisma.adminCatalogImportRow.count({ where: { fingerprint: result.fingerprint, matchedSkuId: skuId, id: { not: rowId },
        decision: { in: [CatalogDecision.AUTO_ACCEPT, CatalogDecision.AUTO_LINK] } } });
      const verdict = keys.map(key => independentLinkSupport({ rowFingerprint: key, rowSourceUrl: row.sourceUrl, rowBarcode: row.barcode, sku, provenanceRows }))
        .find(item => item.supported);
      if (verdict) support.set(rowId, verdict.basis!);
    }
    // The page the row names is the verified identity page of exactly one SKU of this brand and size: the page, not the wording, is the evidence. This links rows
    // written in another script ("كلاري شامبو شعر") or with a misspelt brand that resembles an allowed one, when they point at an already verified product page.
    for (const row of rows) {
      const result = results.get(row.id);
      if (!result || !row.sourceUrl || support.has(row.id) || row.size === null || !row.sizeUnit) continue;
      if (result.classification === MatchClassification.EXACT_MATCH || result.classification === MatchClassification.CONFLICT ||
          result.classification === MatchClassification.INVALID || result.classification === MatchClassification.OUT_OF_SCOPE) continue;
      const suggestion = suggestions.get(row.id);
      const brandId = canonicalBrands.get(row.id) ?? (suggestion && suggestion.score >= SPELLING_HOLD_SCORE ? suggestion.brandId : undefined);
      if (!brandId) continue;
      const skuId = await this.samePageSku(row, brandId);
      if (!skuId) continue;
      linkable.set(row.id, skuId);
      support.set(row.id, canonicalBrands.has(row.id) ? 'SAME_VERIFIED_SOURCE_PAGE' : 'SAME_VERIFIED_SOURCE_PAGE_BRAND_CORRECTED');
      if (!canonicalBrands.has(row.id)) suggestions.delete(row.id);
    }
    // A row that resolved to a canonical product is judged as that product: its own Brand/Category, and any explicit exclusion.
    const products = await this.eligibility.productsForSkus([...new Set([...[...results.values()]
      .filter(r => r.classification === MatchClassification.EXACT_MATCH && r.matchedSkuId).map(r => r.matchedSkuId!), ...[...support.keys()].map(id => linkable.get(id)!)])]);
    const policyEvidence = (d: EligibilityDecision, text?: EligibilityDecision) => ({ policy: { id: d.policyId, version: d.version, outcome: d.outcome, reason: d.reason,
      category: (text ?? d).category ?? null, categoryId: d.categoryId ?? null, ...(text && text !== d && { statedOutcome: text.outcome, statedReason: text.reason }) } });

    for (const row of skipped) {
      const d = stated.get(row.id)!;
      await this.prisma.adminCatalogImportRow.updateMany({ where: { id: row.id, outcome: Outcome.PENDING },
        data: { ...policyDecision(d), identity: policyEvidence(d) as unknown as Prisma.InputJsonValue } });
    }

    // Decide and write inside one critical section, so two imports of the same new product elect one candidate.
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MATCH_LOCK}))`;
      const fingerprints = [...new Set([...results.values()].map(result => result.fingerprint))];
      // Only a candidate still being worked on blocks: one that ended held (no page, a contradiction) must not stop a later row that brings better evidence.
      const peers = await tx.adminCatalogImportRow.findMany({
        where: { fingerprint: { in: fingerprints }, outcome: Outcome.NEW_CANDIDATE, OR: [{ decision: null }, { decision: CatalogDecision.RETRY_AUTOMATIC }] },
        select: { id: true, fingerprint: true, rowNumber: true, jobId: true, job: { select: { createdAt: true } } },
      });
      type Peer = { id: string; rowNumber: number; jobId: string; createdAt: Date };
      const claimed = new Map<string, Peer[]>();
      const claim = (fingerprint: string, peer: Peer) => claimed.set(fingerprint, [...(claimed.get(fingerprint) ?? []), peer]);
      for (const peer of peers) claim(peer.fingerprint!, { id: peer.id, rowNumber: peer.rowNumber, jobId: peer.jobId, createdAt: peer.job.createdAt });

      for (const row of rows) {
        const result = results.get(row.id);
        if (!result) continue;
        const text = stated.get(row.id)!;
        const supportedSku = support.has(row.id) ? linkable.get(row.id)! : null;
        const linkedSku = result.classification === MatchClassification.EXACT_MATCH && result.matchedSkuId ? result.matchedSkuId : supportedSku;
        const product = linkedSku ? products.get(linkedSku) : undefined;
        const judged = product ? policy.evaluateIdentity(product) : text;
        let decision: Decision = judged.outcome !== 'ALLOW' ? policyDecision(judged)
          : supportedSku ? { outcome: Outcome.LINKED_EXISTING, reasonCode: `AUTO_LINK_${support.get(row.id)}`, reason: support.get(row.id)!.startsWith('SAME_VERIFIED_SOURCE_PAGE') ? 'The row names the verified product page of exactly one catalog SKU of this brand and size' : 'Same brand, name and packaging as one catalog SKU, with independent support', matchedSkuId: supportedSku }
          : this.decide(inputs.get(row.id)!, result);
        if (suggestions.has(row.id)) decision = { ...decision, identity: { ...decision.identity, brandSuggestion: suggestions.get(row.id) } };
        // No brand at all is the more useful reason than "unknown brand".
        if (!product && judged.reason === 'BRAND_UNKNOWN' && !this.identity.isStatedBrand(inputs.get(row.id)!.brand))
          decision = { outcome: Outcome.HOLD, reasonCode: 'MISSING_BRAND', reason: 'No brand could be read or inferred for an unknown product' };
        decision = { ...decision, identity: { ...decision.identity, ...policyEvidence(judged, text) } };
        if (decision.outcome === Outcome.NEW_CANDIDATE) {
          // Oldest wins: a product waiting from an earlier row (this file or an earlier one) is the single candidate.
          const earlier = (claimed.get(result.fingerprint) ?? []).find(peer => peer.id !== row.id &&
            (peer.createdAt.getTime() < jobCreatedAt.getTime() || (peer.jobId === row.jobId && peer.rowNumber < row.rowNumber)));
          if (earlier) decision = { outcome: Outcome.REJECTED, reasonCode: 'DUPLICATE_OF_ROW', reason: 'The same product is already waiting from an earlier row', identity: { duplicateOfRowId: earlier.id } };
        }
        const written = await tx.adminCatalogImportRow.updateMany({
          where: { id: row.id, outcome: Outcome.PENDING },
          data: { outcome: decision.outcome, reasonCode: decision.reasonCode, reason: decision.reason, fingerprint: result.fingerprint, matchedSkuId: decision.matchedSkuId ?? null,
            identity: { classification: result.classification, route: result.route ?? null, matchReason: result.reason, conflicts: result.conflicts,
              suggestedSkuId: result.suggestedSkuId ?? null, candidates: result.candidates ?? [], inferredBrand: brands.get(row.id) ?? null, ...decision.identity } as unknown as Prisma.InputJsonValue },
        });
        if (written.count && decision.outcome === Outcome.NEW_CANDIDATE) claim(result.fingerprint, { id: row.id, rowNumber: row.rowNumber, jobId: row.jobId, createdAt: jobCreatedAt });
      }
    }, { timeout: 60000 });
  }

  /**
   * The one verified SKU of this brand whose identity page is the page the row names, with the row's exact size and nothing in the row's wording that contradicts
   * it (another type, area, active or target). None, or more than one, returns null.
   */
  private async samePageSku(row: Prisma.AdminCatalogImportRowGetPayload<object>, brandId: string): Promise<string | null> {
    const stated = physicalMeasure(row.size?.toNumber() ?? null, row.sizeUnit);
    if (!stated || !row.sourceUrl) return null;
    const skus = (await this.catalogIntake.verifiedSkusForBrand(brandId)).filter(sku => sku.sourceUrls.some(url => sameUrl(url, row.sourceUrl!)) && (sku.packCount ?? 1) === 1);
    const sameSize = skus.filter(sku => { const m = physicalMeasure(sku.size, sku.sizeUnit); return m?.dimension === stated.dimension && Math.abs(m.value - stated.value) < 1e-6; });
    if (sameSize.length !== 1) return null;
    const sku = sameSize[0];
    if (row.barcode && sku.barcode && sku.barcodeStatus === 'VERIFIED' && !sameGtin(row.barcode, sku.barcode)) return null;
    const labels = [row.brand ?? '', sku.productName.split(' ')[0]];
    const strip = (name: string) => this.productNameOf(name);
    if (titleFactConflict(parseIdentityTitle(strip(row.name), labels), parseIdentityTitle(strip(sku.productName), labels))) return null;
    return sku.skuId;
  }

  private decide(input: CandidateItemIdentityInput, result: ProductIdentityMatchResult): Decision {
    switch (result.classification) {
      case MatchClassification.INVALID:
      case MatchClassification.OUT_OF_SCOPE:
        return { outcome: Outcome.REJECTED, reasonCode: result.classification, reason: result.reason };
      case MatchClassification.EXACT_MATCH:
        if (result.matchedSkuId) return { outcome: Outcome.LINKED_EXISTING, reasonCode: 'VERIFIED_EXISTING_SKU', reason: result.reason, matchedSkuId: result.matchedSkuId };
        return { outcome: Outcome.HOLD, reasonCode: 'AMBIGUOUS_IDENTITY', reason: result.reason };
      case MatchClassification.CONFLICT:
        return { outcome: Outcome.HOLD, reasonCode: 'IDENTITY_CONFLICT', reason: result.reason };
      case MatchClassification.LIKELY_MATCH:
        // Another size or variant of a known product is a distinct SKU, never a merge: it goes through the same source verification as any new product, which must
        // state this exact size before anything is created.
        if (result.reason === 'brand_and_product_name_match_different_size_or_variant' && !result.candidates?.length && !result.conflicts.some(c => c !== 'different_size_or_variant_requires_review')
            && this.identity.isStatedBrand(input.brand) && !result.conflicts.includes('missing_net_content') && input.size != null) {
          return { outcome: Outcome.NEW_CANDIDATE, reasonCode: 'NEW_SIZE_OF_KNOWN_PRODUCT', reason: 'Another size or variant of a catalog product; verified as its own SKU' };
        }
        return { outcome: Outcome.HOLD, reasonCode: result.reason === 'invalid_gtin_held' ? 'INVALID_BARCODE' : 'AMBIGUOUS_IDENTITY', reason: result.reason };
      default: {
        if (result.existingCandidateId || result.previouslyRejectedCandidateId || result.possibleDuplicateCandidateIds?.length) {
          return { outcome: Outcome.HOLD, reasonCode: 'POSSIBLE_DUPLICATE_CANDIDATE', reason: result.reason };
        }
        if (!this.identity.isStatedBrand(input.brand)) return { outcome: Outcome.HOLD, reasonCode: 'MISSING_BRAND', reason: 'No brand could be read or inferred for an unknown product' };
        if (result.conflicts.includes('missing_net_content')) return { outcome: Outcome.HOLD, reasonCode: 'MISSING_NET_CONTENT', reason: 'Size and unit are needed to tell this product apart from other sizes' };
        return { outcome: Outcome.NEW_CANDIDATE, reasonCode: 'UNKNOWN_PRODUCT', reason: 'No canonical SKU matches; ready for research and intake' };
      }
    }
  }

  /** An Admin settles a held or new row: link it to a canonical SKU the identity engine accepts, or reject it. Nothing here edits the catalog. */
  async resolveRow(rowId: string, input: ResolveRowInput, actorId: string) {
    const row = await this.prisma.adminCatalogImportRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Row not found');
    if (row.outcome !== Outcome.HOLD && row.outcome !== Outcome.NEW_CANDIDATE) {
      throw new ConflictException({ code: 'ROW_NOT_OPEN', message: `A ${row.outcome} row cannot be resolved` });
    }
    if (input.action === 'LINK_SKU') {
      if (!input.skuId) throw new BadRequestException('skuId is required to link');
      const identityInput: CandidateItemIdentityInput = { name: row.name, brand: row.brand ?? '', barcode: row.barcode, invalidBarcode: row.invalidBarcode,
        size: row.size?.toNumber() ?? null, sizeUnit: row.sizeUnit };
      // The same canonical identity safeguard as any other link: explicit conflicts and colliding barcodes refuse, whoever asks.
      await this.identity.assertSkuAssociation(identityInput, input.skuId, this.prisma, true);
      // A manual link obeys the same Catalog Policy: an excluded or disallowed product is never linked.
      const product = (await this.eligibility.productsForSkus([input.skuId])).get(input.skuId);
      const policy = await this.eligibility.compile((await this.eligibility.current())?.id);
      const judged = product ? policy.evaluateIdentity(product) : null;
      if (judged?.outcome === 'SKIP') throw new ConflictException({ code: `POLICY_${judged.reason}`, message: POLICY_TEXT[judged.reason] ?? judged.reason });
    }
    const data = input.action === 'LINK_SKU'
      ? { outcome: Outcome.LINKED_EXISTING, matchedSkuId: input.skuId!, reasonCode: 'ADMIN_LINKED', reason: 'Linked to a canonical SKU by an Admin', decision: CatalogDecision.AUTO_LINK, stage: 'COMPLETE' }
      : { outcome: Outcome.REJECTED, reasonCode: 'ADMIN_REJECTED', reason: 'Rejected by an Admin', decision: CatalogDecision.SKIP, stage: 'COMPLETE' };
    const written = await this.prisma.adminCatalogImportRow.updateMany({
      where: { id: rowId, outcome: row.outcome },
      data: { ...data, resolvedBy: actorId, resolvedAt: new Date(), resolutionNote: input.note.trim() },
    });
    if (!written.count) throw new ConflictException({ code: 'ROW_CHANGED', message: 'The row changed; reload before deciding' });
    await this.refreshTotals(row.jobId);
    return this.prisma.adminCatalogImportRow.findUniqueOrThrow({ where: { id: rowId } });
  }

  private async refreshTotals(jobId: string): Promise<void> {
    await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { totals: await this.totals(jobId) } });
  }

  // ─── Automatic pipeline support ────────────────────────────────────────────

  /** Rows the pipeline should look at now: matched but undecided, or a due automatic retry. */
  async rowsForAutopilot(jobId: string, now = new Date()) {
    return this.prisma.adminCatalogImportRow.findMany({ where: { jobId, outcome: { not: Outcome.PENDING }, OR: [
      { decision: null }, { decision: CatalogDecision.RETRY_AUTOMATIC, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    ] }, orderBy: { rowNumber: 'asc' } });
  }

  /** Jobs with automatic retries that are due, for the background runner. */
  async jobsWithDueRetries(now = new Date()): Promise<string[]> {
    const rows = await this.prisma.adminCatalogImportRow.findMany({ where: { decision: CatalogDecision.RETRY_AUTOMATIC, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      select: { jobId: true }, distinct: ['jobId'], take: 20 });
    return rows.map(row => row.jobId);
  }

  async getRow(rowId: string) {
    const row = await this.prisma.adminCatalogImportRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Row not found');
    return row;
  }

  /** A short lease so two runners (or a retry and a person) never work the same row at once. */
  async claimRow(rowId: string, ms = 5 * 60_000): Promise<boolean> {
    const now = new Date();
    const claimed = await this.prisma.adminCatalogImportRow.updateMany({ where: { id: rowId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + ms) } });
    return claimed.count === 1;
  }

  async updateRowProgress(rowId: string, data: { decision?: CatalogDecision | null; stage?: string | null; matchedSkuId?: string | null; attempts?: number;
    nextAttemptAt?: Date | null; lastError?: string | null; reasonCode?: string; reason?: string; releaseLease?: boolean; verifiedSourceUrl?: string }) {
    const { releaseLease, verifiedSourceUrl, ...rest } = data;
    // The page that verified a new product's identity, kept on the row so a resumed run researches the same page.
    const identity = verifiedSourceUrl ? { identity: { ...(((await this.getRow(rowId)).identity ?? {}) as Record<string, unknown>), verifiedSourceUrl } as Prisma.InputJsonValue } : {};
    const row = await this.prisma.adminCatalogImportRow.update({ where: { id: rowId }, data: { ...rest, ...identity, ...(releaseLease && { leaseUntil: null }) } });
    if (data.decision !== undefined) await this.refreshTotals(row.jobId);
    return row;
  }

  /**
   * A row that named no size gets the one size a trusted page states for it. Never replaces a stated size. The row is then matched again with that size, so an
   * existing SKU of that size is linked rather than duplicated.
   */
  async fillRowSizeFromSource(rowId: string, size: { value: number; unit: string }): Promise<boolean> {
    const written = await this.prisma.adminCatalogImportRow.updateMany({ where: { id: rowId, size: null }, data: { size: size.value, sizeUnit: size.unit } });
    if (!written.count) return false;
    const row = await this.getRow(rowId);
    await this.match(row.jobId, { recheck: true, rowIds: [rowId] });
    return true;
  }

  /**
   * The rows of this row's job that wait for the same new brand (same folded label), with the leaves and pages they bring. The brand is added once, for all of
   * these leaves; a later file for another leaf goes through the Catalog Policy like any known brand.
   */
  async newBrandGroup(rowId: string): Promise<{ label: string; rowIds: string[]; categoryIds: string[]; pageUrls: string[] }> {
    const row = await this.getRow(rowId);
    const label = row.brand ?? '';
    const key = eligibilityMappingKey(label);
    const rows = await this.prisma.adminCatalogImportRow.findMany({ where: { jobId: row.jobId, outcome: Outcome.HOLD, reasonCode: 'POLICY_BRAND_NEW' },
      select: { id: true, brand: true, sourceUrl: true, identity: true } });
    const same = rows.filter(item => eligibilityMappingKey(item.brand ?? '') === key);
    const leafOf = (identity: Prisma.JsonValue) => ((identity ?? {}) as { policy?: { categoryId?: string | null } }).policy?.categoryId ?? null;
    return { label, rowIds: same.map(item => item.id),
      categoryIds: [...new Set(same.map(item => leafOf(item.identity)).filter((id): id is string => Boolean(id)))],
      pageUrls: [...new Set(same.map(item => item.sourceUrl).filter((url): url is string => Boolean(url)))] };
  }

  /** The canonical brand and exact leaf a row was admitted under by the current Catalog Policy. */
  async admission(rowId: string): Promise<RowAdmission | null> {
    const row = await this.getRow(rowId);
    const current = await this.eligibility.current();
    const policy = await this.eligibility.compile(current?.id);
    const brand = this.identity.isStatedBrand(row.brand) ? row.brand! : (await this.identity.inferBrandFromName(row.name)) ?? '';
    const judged = this.judgeBrand(policy, brand, row.categoryHint ?? '', row.name).decision;
    if (judged.outcome !== 'ALLOW' || !judged.brandId || !judged.categoryId) return null;
    const document = current?.document as { brands?: Array<{ id: string; aliases?: string[] }> } | undefined;
    const record = await this.prisma.brand.findUnique({ where: { id: judged.brandId }, select: { name: true, websiteUrl: true } });
    return { brandId: judged.brandId, brandName: record?.name ?? judged.brandName ?? brand, brandAliases: document?.brands?.find(b => b.id === judged.brandId)?.aliases ?? [],
      websiteUrl: record?.websiteUrl ?? null, categoryId: judged.categoryId, policyVersion: judged.version };
  }

  /**
   * Pages that verified another size of the same product (same brand, same base name). A row with no page of its own may be checked against them: the page must state
   * this row's exact size, so a sibling's evidence never stands in for a size it does not name.
   */
  async siblingSources(rowId: string, brandId: string): Promise<string[]> {
    const row = await this.getRow(rowId);
    const base = this.productNameOf(row.name);
    const urls = (await this.catalogIntake.verifiedSkusForBrand(brandId)).filter(sku => this.identity.sameBaseName(sku.productName, base)).flatMap(sku => sku.sourceUrls);
    return [...new Set(urls)].filter(url => url.startsWith('https://')).slice(0, 3);
  }

  identityKey(row: { name: string; size: Prisma.Decimal | null; sizeUnit: string | null }, brandId: string): string {
    return identityKeyOf(brandId, this.identity.wordingKey(row.name, null), row.size?.toNumber() ?? null, row.sizeUnit);
  }

  /** The name a new canonical product takes: the row's own wording and casing, without its size (size makes the SKU, not the product). */
  productNameOf(name: string): string {
    const extracted = this.normalizer.extractSizeAndPack(name);
    if (extracted.size === null) return name.trim();
    const stripped = name.replace(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?\s?(?:fl\.?\s?oz|ml|g|gm|gr|kg|l|oz|مل|ملي|جم|جرام|لتر)(?![\p{L}\p{N}])/giu, ' ').replace(/\s+/g, ' ').trim();
    return stripped.length >= 2 ? stripped : name.trim();
  }

  /**
   * Binds a row to a new SKU, atomically per SKU: the first row bound owns it (its research and media run once); any other row that reached the same SKU (a concurrent
   * import of the same product) is a link to it. Exactly one owner, whatever the timing.
   */
  async bindRowToSku(rowId: string, skuId: string): Promise<'OWNER' | 'LINKED'> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sku-owner:${skuId}`}))`;
      const other = await tx.adminCatalogImportRow.findFirst({ where: { matchedSkuId: skuId, id: { not: rowId }, outcome: Outcome.NEW_CANDIDATE,
        OR: [{ decision: null }, { decision: { notIn: [CatalogDecision.SKIP] } }] }, select: { id: true } });
      await tx.adminCatalogImportRow.update({ where: { id: rowId }, data: { matchedSkuId: skuId } });
      return other ? 'LINKED' : 'OWNER';
    });
  }

  /** A person corrects what a row states (brand, size, category, page URL); the row goes back through matching and the pipeline as if new. */
  async correctRow(rowId: string, correction: RowCorrection, actorId: string, note: string) {
    const row = await this.getRow(rowId);
    if (row.decision === CatalogDecision.AUTO_ACCEPT || row.decision === CatalogDecision.AUTO_LINK) {
      throw new ConflictException({ code: 'ROW_SETTLED', message: 'This row already produced a catalog product; correct the product instead' });
    }
    let sourceUrl = row.sourceUrl;
    if (correction.sourceUrl !== undefined) {
      const url = new URL(correction.sourceUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new BadRequestException('Only https product pages are read');
      sourceUrl = url.toString();
    }
    let barcode = row.barcode;
    if (correction.barcode !== undefined) {
      const normalized = correction.barcode ? this.normalizer.normalizeBarcode(correction.barcode) : null;
      if (correction.barcode && !normalized?.isValid) throw new BadRequestException('Not a valid GTIN');
      barcode = normalized?.barcode ?? null;
    }
    await this.prisma.adminCatalogImportRow.update({ where: { id: rowId }, data: {
      name: correction.name?.trim() || row.name, brand: correction.brand?.trim() || row.brand, categoryHint: correction.categoryHint?.trim() || row.categoryHint, sourceUrl, barcode,
      ...(correction.size !== undefined && { size: new Prisma.Decimal(correction.size), sizeUnit: correction.sizeUnit ?? row.sizeUnit }),
      outcome: Outcome.PENDING, reasonCode: null, reason: null, decision: null, stage: null, attempts: 0, nextAttemptAt: null, lastError: null, leaseUntil: null,
      resolutionNote: `Corrected by ${actorId}: ${note}`.slice(0, 500),
    } });
    await this.match(row.jobId);
    return this.getRow(rowId);
  }

  /** Puts a held or failed row back to the automatic pipeline. */
  async retryRow(rowId: string) {
    const row = await this.getRow(rowId);
    if (row.decision === CatalogDecision.AUTO_ACCEPT || row.decision === CatalogDecision.AUTO_LINK || row.decision === CatalogDecision.SKIP) return row;
    return this.prisma.adminCatalogImportRow.update({ where: { id: rowId }, data: { decision: null, attempts: 0, nextAttemptAt: null, lastError: null, leaseUntil: null } });
  }

  async listJobs(limit = 50) {
    return this.prisma.adminCatalogImportJob.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
      select: { id: true, sourceFileName: true, uploadedBy: true, status: true, totals: true, createdAt: true, completedAt: true } });
  }

  async getJob(jobId: string) {
    const job = await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import not found');
    return { ...job, totals: await this.totals(jobId) };
  }

  async listRows(jobId: string, filter: { outcome?: Outcome; offset?: number; limit?: number } = {}) {
    if (!(await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new NotFoundException('Import not found');
    const where = { jobId, ...(filter.outcome && { outcome: filter.outcome }) };
    const [rows, total] = await Promise.all([
      this.prisma.adminCatalogImportRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: Math.max(filter.offset ?? 0, 0), take: Math.min(Math.max(filter.limit ?? 100, 1), 500) }),
      this.prisma.adminCatalogImportRow.count({ where }),
    ]);
    return { total, rows };
  }
}
